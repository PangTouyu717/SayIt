import * as bridge from '@/services/bridge'
import { cn } from '@/lib/utils'
import { resolveAsrDisplayModel } from '@/lib/asrModels'
import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Download, Search, Check, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import HistoryRecordList from '@/components/history/HistoryRecordList'
import { exportHistory } from '@/services/exports'
import {
  countHistory,
  deleteHistory,
  listHistory,
  setHistoryFavorite,
  updateHistoryRecord,
  getActivePreset,
  getSetting,
  type HistoryRecord,
} from '@/services/store'
import { loadAudioAsDataUrl } from '@/services/audioFileService'
import { segmentAsrText } from '@/services/textSegmenter'
import { applyTextReplacements } from '@/services/textReplacement'
import {
  BUILTIN_SET_WORDS_KEY,
  BUILTIN_SET_ACTIVE_KEY,
  CUSTOM_THEMES_KEY,
  CUSTOM_THEME_ACTIVE_KEY,
  composeHotwords,
  normalizeBuiltinSetActive,
  normalizeBuiltinSetWords,
  normalizeCustomThemeActive,
  normalizeCustomThemes,
} from '@/services/hotwords/model'

const HISTORY_PAGE_SIZE = 100

export default function History() {
  const [records, setRecords] = useState<HistoryRecord[]>([])
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE)
  const [totalCount, setTotalCount] = useState(0)
  const [exportResult, setExportResult] = useState<{ filePath: string | null; canceled: boolean } | null>(null)

  const loadRecords = useCallback(async (searchKeyword: string, limit: number, favOnly: boolean) => {
    const [items, total] = await Promise.all([
      listHistory({ keyword: searchKeyword, favoriteOnly: favOnly, limit, offset: 0 }),
      countHistory({ keyword: searchKeyword, favoriteOnly: favOnly }),
    ])
    setRecords(items)
    setTotalCount(total)
  }, [])

  useEffect(() => {
    setVisibleCount(HISTORY_PAGE_SIZE)
  }, [debouncedKeyword, favoriteOnly])

  // 搜索防抖：输入停止 300ms 后才触发查询
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword), 300)
    return () => clearTimeout(timer)
  }, [keyword])

  useEffect(() => {
    void loadRecords(debouncedKeyword, visibleCount, favoriteOnly)
  }, [debouncedKeyword, favoriteOnly, loadRecords, visibleCount])

  // 监听新记录写入，自动刷新列表
  useEffect(() => {
    const unlisten = bridge.listen('history-updated', () => {
      void loadRecords(debouncedKeyword, visibleCount, favoriteOnly)
    })
    return () => { void unlisten.then((fn) => fn()) }
  }, [debouncedKeyword, visibleCount, favoriteOnly, loadRecords])

  const handleDelete = async (id: string) => {
    // Clean up audio file if it exists
    const record = records.find((r) => r.id === id)
    if (record?.audioFilePath) {
      try { await bridge.deleteAudioFile(record.audioFilePath) } catch { /* ignore */ }
    }
    await deleteHistory(id)
    void loadRecords(debouncedKeyword, visibleCount, favoriteOnly)
  }

  const handleToggleFavorite = async (id: string, nextFavorite: boolean) => {
    await setHistoryFavorite(id, nextFavorite)
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, favorite: nextFavorite } : r)))
  }

  const handleExport = async () => {
    const result = await exportHistory({ keyword: debouncedKeyword })
    setExportResult(result)
    if (!result.canceled) setTimeout(() => setExportResult(null), 8000)
  }

  const handleReprocess = async (record: HistoryRecord) => {
    if (!record.audioFilePath) return

    const base64 = await bridge.readAudioFile(record.audioFilePath)
    if (!base64) return

    // Decode base64 WAV → PCM
    const binaryStr = atob(base64)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }
    const pcmData = bytes.slice(44)
    const chunk = pcmData.buffer.slice(pcmData.byteOffset, pcmData.byteOffset + pcmData.byteLength)

    // Diagnostic: compute peak amplitude of the PCM data being sent
    const pcmInt16 = new Int16Array(chunk)
    let reprocessPeak = 0
    for (let i = 0; i < pcmInt16.length; i++) {
      const v = Math.abs(pcmInt16[i])
      if (v > reprocessPeak) reprocessPeak = v
    }
    const reprocessPeakNorm = reprocessPeak / 32768
    const reprocessDurSec = pcmInt16.length / 16000
    console.log('[reprocess-diag] PCM stats', {
      byteLength: chunk.byteLength,
      samples: pcmInt16.length,
      durationSec: reprocessDurSec.toFixed(2),
      peakInt16: reprocessPeak,
      peakNormalized: reprocessPeakNorm.toFixed(4),
      wouldBeSilent: reprocessPeakNorm < 0.01,
    })

    const preset = await getActivePreset()
    const aiEnabled = await getSetting('aiEnabled', false)

    // 加载热词
    let hotwords: string[] = []
    try {
      const [rawSetWords, rawSetActive, rawCustomThemes, rawCustomThemeActive] = await Promise.all([
        getSetting(BUILTIN_SET_WORDS_KEY, {}),
        getSetting(BUILTIN_SET_ACTIVE_KEY, {}),
        getSetting(CUSTOM_THEMES_KEY, []),
        getSetting(CUSTOM_THEME_ACTIVE_KEY, {}),
      ])
      const setWords = normalizeBuiltinSetWords(rawSetWords as Record<string, unknown>)
      const setActive = normalizeBuiltinSetActive(rawSetActive as Record<string, unknown>)
      const themes = normalizeCustomThemes(rawCustomThemes)
      const themeActive = normalizeCustomThemeActive(rawCustomThemeActive as Record<string, unknown>, themes)
      hotwords = composeHotwords([], setWords, setActive, themes, themeActive)
    } catch { /* ignore */ }

    const clientMeta = await bridge.getClientRuntimeInfo().catch(() => null)

    // 使用独立的 WebSocket 连接进行重新识别，避免干扰 RecorderOrchestrator 的全局连接。
    const { getWSUrl } = await import('@/services/runtimeConfig')
    const wsUrl = getWSUrl()

    const result = await new Promise<{ asrText: string; llmText: string; asrMs: number; llmMs: number; durationSec: number; asrEngine?: string; asrModel?: string }>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        try { socket.close() } catch { /* ignore */ }
        reject(new Error('重新识别超时'))
      }, 30_000) // ASR 最多 30 秒

      const socket = new WebSocket(wsUrl)
      socket.binaryType = 'arraybuffer'

      let resolved = false

      socket.onopen = () => {
        // 发送 start
        const startMsg: Record<string, unknown> = {
          cmd: 'start',
          source: 'history_reprocess',
          disable_ai: !aiEnabled,
        }
        if (aiEnabled && preset.systemPrompt) startMsg.system_prompt = preset.systemPrompt
        if (clientMeta) {
          startMsg.client_meta = {
            user_id: clientMeta.userId,
            device_id: clientMeta.deviceId,
            hostname: clientMeta.hostname,
            client_version: clientMeta.clientVersion,
            platform: clientMeta.platform,
            os_version: clientMeta.osVersion,
            local_ip: clientMeta.localIp,
            system_locale: clientMeta.systemLocale,
            cpu_cores: clientMeta.cpuCores,
            memory_mb: clientMeta.memoryMb,
          }
        }
        if (hotwords.length > 0) startMsg.hotwords = hotwords
        socket.send(JSON.stringify(startMsg))

        // 分片发送 PCM 数据
        const CHUNK_SIZE = 32000
        const totalBytes = chunk.byteLength
        for (let offset = 0; offset < totalBytes; offset += CHUNK_SIZE) {
          const end = Math.min(offset + CHUNK_SIZE, totalBytes)
          socket.send(chunk.slice(offset, end))
        }

        // 发送 stop
        socket.send(JSON.stringify({ cmd: 'stop' }))
      }

      socket.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        try {
          const msg = JSON.parse(ev.data)
          console.log('[reprocess-diag] ws message:', msg.type, msg)
          if (msg.type === 'final') {
            resolved = true
            clearTimeout(timeout)
            socket.close()
            resolve({
              asrText: msg.asr_text || '',
              llmText: msg.llm_text || '',
              asrMs: msg.asr_ms || 0,
              llmMs: msg.llm_ms || 0,
              durationSec: Number(msg.duration_sec || 0),
              asrEngine: msg.asr_engine || undefined,
              asrModel: msg.asr_model || undefined,
            })
          } else if (msg.type === 'done' && !resolved) {
            // 没有 final 就 done 了（后端判定为静音/无结果）
            resolved = true
            clearTimeout(timeout)
            socket.close()
            resolve({ asrText: '', llmText: '', asrMs: 0, llmMs: 0, durationSec: 0 })
          } else if (msg.type === 'error') {
            resolved = true
            clearTimeout(timeout)
            socket.close()
            reject(new Error(msg.message || 'backend error'))
          }
        } catch { /* ignore parse errors */ }
      }

      socket.onerror = () => {
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          reject(new Error('WebSocket 连接错误'))
        }
      }

      socket.onclose = (ev) => {
        console.log('[reprocess-diag] ws closed', { code: ev.code, reason: ev.reason, resolved })
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          reject(new Error(`WebSocket 连接意外关闭 code=${ev.code}`))
        }
      }
    })

    // 极速模式下 llmText === asrText（后端未经 LLM 处理时直接复制 asrText）
    // 此时对 asrText 做智能分段提升可读性
    const needsSegment = !result.llmText || result.llmText === result.asrText
    const finalLlm = needsSegment ? segmentAsrText(result.asrText) : result.llmText
    const replacedLlm = await applyTextReplacements(finalLlm)

    await updateHistoryRecord(record.id, {
      asrText: result.asrText,
      llmText: replacedLlm,
      asrMs: result.asrMs,
      llmMs: result.llmMs,
      charCount: (result.llmText || result.asrText).length,
      isEmpty: !(result.llmText || result.asrText).trim(),
      workMode: 'server',
      aiProvider: 'server',
      aiModel: undefined,
      asrProvider: (result.asrModel || result.asrEngine || 'server').replace(/^.*\//, ''),
    })

    void loadRecords(debouncedKeyword, visibleCount, favoriteOnly)
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">历史记录</h1>
          <div className="flex gap-1 rounded-lg border border-border p-0.5">
            <button
              type="button"
              onClick={() => setFavoriteOnly(false)}
              className={cn(
                'rounded-md px-3 py-1 text-xs transition-colors',
                !favoriteOnly ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >全部</button>
            <button
              type="button"
              onClick={() => setFavoriteOnly(true)}
              className={cn(
                'rounded-md px-3 py-1 text-xs transition-colors',
                favoriteOnly ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >收藏</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索历史关键词"
              className="w-64 rounded-md border border-input-border bg-input-bg py-1.5 pl-8 pr-3 text-sm"
            />
          </div>
          <Tooltip content="导出数据">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              onClick={() => void handleExport()}
              aria-label="导出数据"
              title="导出数据"
            >
              <Download className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      </div>

      {exportResult && !exportResult.canceled && exportResult.filePath && (
        <div className="mb-3 flex items-center gap-2 text-xs text-success">
          <Check className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">已保存到 {exportResult.filePath}</span>
          <button
            onClick={() => void invoke('reveal_file_in_folder', { filePath: exportResult.filePath })}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {exportResult?.canceled && (
        <p className="mb-3 text-xs text-muted-foreground">已取消导出。</p>
      )}

      <HistoryRecordList
        records={records}
        onDelete={handleDelete}
        onToggleFavorite={handleToggleFavorite}
        onReprocess={handleReprocess}
        emptyText={keyword.trim() ? '没有匹配的历史记录' : favoriteOnly ? '还没有收藏记录，去历史记录里点一下星标吧。' : '还没有记录，去语音工作台试试吧'}
      />

      {totalCount > records.length && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setVisibleCount((count) => count + HISTORY_PAGE_SIZE)}>
            加载更多
          </Button>
        </div>
      )}
    </div>
  )
}
