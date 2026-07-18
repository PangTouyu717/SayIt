// 硅基流动 ASR — FunAudioLLM/SenseVoiceSmall
// OpenAI /v1/audio/transcriptions 兼容接口，multipart/form-data 上传 WAV。
// API 文档: https://docs.siliconflow.cn

use super::types::{AsrProviderConfig, AsrResult, TestResult};
use std::time::Instant;

const API_URL: &str = "https://api.siliconflow.cn/v1/audio/transcriptions";
const DEFAULT_MODEL: &str = "FunAudioLLM/SenseVoiceSmall";

/// 将 16kHz 单声道 16-bit PCM 封装为 WAV 容器。
fn pcm_to_wav(pcm: &[u8], sr: u32) -> Vec<u8> {
    let ds = pcm.len() as u32;
    let mut w = Vec::with_capacity(44 + pcm.len());
    w.extend_from_slice(b"RIFF");
    w.extend_from_slice(&(36 + ds).to_le_bytes());
    w.extend_from_slice(b"WAVEfmt ");
    w.extend_from_slice(&16u32.to_le_bytes());
    w.extend_from_slice(&1u16.to_le_bytes());
    w.extend_from_slice(&1u16.to_le_bytes());
    w.extend_from_slice(&sr.to_le_bytes());
    w.extend_from_slice(&(sr * 2).to_le_bytes());
    w.extend_from_slice(&2u16.to_le_bytes());
    w.extend_from_slice(&16u16.to_le_bytes());
    w.extend_from_slice(b"data");
    w.extend_from_slice(&ds.to_le_bytes());
    w.extend_from_slice(pcm);
    w
}

pub async fn transcribe(
    audio_pcm_b64: &str,
    sample_rate: u32,
    config: &AsrProviderConfig,
    _hotwords: &[String],
) -> Result<AsrResult, String> {
    let pcm = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        audio_pcm_b64,
    )
    .map_err(|e| format!("base64 解码失败: {}", e))?;

    if pcm.is_empty() {
        return Ok(AsrResult { text: String::new(), elapsed_ms: 0 });
    }

    let wav = pcm_to_wav(&pcm, sample_rate);
    let model = config
        .extra
        .get("model")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_MODEL);

    let file_part = reqwest::multipart::Part::bytes(wav)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("构建 multipart 失败: {}", e))?;

    let form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .text("model", model.to_string());

    let client = reqwest::Client::new();
    let start = Instant::now();

    let resp = client
        .post(API_URL)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .multipart(form)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let elapsed_ms = start.elapsed().as_millis() as u64;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("硅基流动 ASR 错误 {}: {}", status, &body[..body.len().min(300)]));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let text = data
        .get("text")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();

    Ok(AsrResult { text, elapsed_ms })
}

pub async fn test_connection(config: &AsrProviderConfig) -> TestResult {
    // 发送 0.5s 静音作为测试
    let silence = vec![0u8; 16000];
    let wav = pcm_to_wav(&silence, 16000);
    let model = DEFAULT_MODEL;

    let file_part = match reqwest::multipart::Part::bytes(wav)
        .file_name("audio.wav")
        .mime_str("audio/wav")
    {
        Ok(p) => p,
        Err(e) => {
            return TestResult {
                ok: false,
                message: format!("构建测试请求失败: {}", e),
                elapsed_ms: 0,
                detail: String::new(),
            }
        }
    };

    let form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .text("model", model.to_string());

    let client = reqwest::Client::new();
    let start = Instant::now();

    let result = client
        .post(API_URL)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .multipart(form)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await;

    let elapsed_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(resp) if resp.status().is_success() => TestResult {
            ok: true,
            message: format!("连接成功 ({}ms)", elapsed_ms),
            elapsed_ms,
            detail: String::new(),
        },
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            TestResult {
                ok: false,
                message: format!("API 错误 {}: {}", status, &body[..body.len().min(100)]),
                elapsed_ms,
                detail: String::new(),
            }
        }
        Err(e) => TestResult {
            ok: false,
            message: format!("连接失败: {}", e),
            elapsed_ms,
            detail: String::new(),
        },
    }
}
