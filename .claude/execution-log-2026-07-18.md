# SayIt 项目复刻执行记录

**日期：** 2026-07-18  
**目标：** 将开源项目 [crosswk/SayIt](https://github.com/crosswk/SayIt) 完整复刻到本地，并搭建可编译可运行的开发环境。

---

## 一、项目背景

SayIt 是一个开源的 AI 语音输入工具，由台湾开发者 crosswk 开发。核心功能：

- **按住快捷键说话** → 自动语音识别 → AI 润色 → **文本自动插入到光标位置**
- 支持三种 ASR 模式：服务器模式（默认）、云 API 模式、本地离线模式
- AI 润色支持多种后端：DeepSeek、千问、Azure OpenAI、Ollama、Groq 等
- 按应用自动切换 Prompt 规则（不同应用中自动套用不同的润色策略）

## 二、技术架构

| 层级 | 技术栈 | 说明 |
|------|--------|------|
| 桌面客户端框架 | Tauri v2 | Rust 后端 + WebView2 前端 |
| 前端 UI | React 18 + TypeScript + Tailwind CSS | Vite 6 构建 |
| 系统集成层 | Rust (windows crate) | 全局键盘钩子、文本注入、窗口检测、剪贴板 |
| 持久化存储 | SQLite (rusqlite) | 设置、历史记录、统计数据 |
| 语音识别 | sherpa-onnx (本地) / WebSocket (远程) | 支持 SenseVoice、Qwen3-ASR 等模型 |
| AI 润色 | HTTP API 调用 | 支持 OpenAI 兼容接口 |
| 服务端（可选） | FastAPI + vLLM + Docker | GPU 推理，Qwen3-ASR 1.7B |

## 三、操作过程

### Phase 1：获取源代码

```bash
# 使用 GitHub CLI 克隆（因为 git clone 超时）
gh repo clone crosswk/SayIt sayit-temp -- --depth 1
# 移动到项目根目录
mv sayit-temp/* . && mv sayit-temp/.git . && mv sayit-temp/.all-contributorsrc .
```

**结果：** ✅ 成功获取 SayIt v0.0.9 完整源码

### Phase 2：项目结构分析

项目采用 Client-Server 架构：

```
SayIt/
├── client/                     # 桌面客户端
│   ├── src/                    # React 前端
│   │   ├── components/         # UI 组件
│   │   ├── features/           # 功能模块（设置/更新/调试）
│   │   ├── overlay/            # 悬浮窗（波形动画）
│   │   ├── pages/              # 页面
│   │   ├── services/           # 核心服务
│   │   │   ├── recorder/       # 录音状态机（核心！1473行）
│   │   │   ├── transcription/  # 4种转写后端
│   │   │   ├── personalization/# Prompt 路由
│   │   │   └── store.ts        # 设置存储
│   │   └── hooks/              # React Hooks
│   └── src-tauri/src/          # Rust 后端
│       ├── main.rs             # 入口（460行）
│       ├── keyboard/           # 全局键盘钩子
│       ├── inject/             # 文本注入
│       ├── context/            # 前台窗口检测
│       ├── commands/           # 42个 Tauri IPC 命令
│       ├── providers/          # 云端 API 调用
│       ├── models/             # 本地模型管理
│       └── storage/            # SQLite 存储
├── server/                     # 服务端
│   ├── backend/app/            # FastAPI 应用
│   ├── gateway/                # HTTPS 反代 (Node.js)
│   ├── web/                    # 网页版 Demo
│   └── prompts/                # LLM 提示词模板
└── docs/                       # 用户文档
```

**核心工作流程：**
```
用户按住 Alt → Rust 键盘钩子捕获 PTT-Down
  → RecorderOrchestrator.startRecording()
    → 并行执行：探测窗口 / 解析Prompt路由 / 连接WebSocket / 启动麦克风
    → 显示悬浮窗（波形动画）
  → 用户松开 Alt → stopRecording()
    → 发送音频到 ASR 引擎
    → ASR 返回文本 → AI 润色 → 文本后处理
    → 文本注入到光标处（SendInput / Ctrl+V）
    → 保存历史记录到 SQLite
```

### Phase 3：环境搭建与编译

#### 3.1 已具备的环境
- Node.js v24.16.0 ✅
- npm 11.13.0 ✅
- Python 3.12.10 ✅

#### 3.2 安装 Rust
```bash
winget install Rustlang.Rustup --source winget
# rustc 1.97.1, cargo 1.97.1 ✅
```

#### 3.3 安装 Visual Studio Build Tools 2022
```bash
winget install Microsoft.VisualStudio.2022.BuildTools \
  --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
# MSVC 链接器 14.44.35207 ✅
```

#### 3.4 安装 npm 依赖
```bash
cd client && npm install
# 261 packages ✅
```

#### 3.5 解决 sherpa-onnx 下载问题
**问题：** `sherpa-onnx` 编译时需要从 GitHub 下载约 110MB 的预编译库，但网络无法访问 GitHub Releases。

**解决：** 手动下载 `sherpa-onnx-v1.13.3-win-x64-static-MT-Release-lib.tar.bz2`，放到 `C:\Users\29035\.cargo\sherpa-onnx-cache\`，设置环境变量：
```bash
export SHERPA_ONNX_ARCHIVE_DIR="C:/Users/29035/.cargo/sherpa-onnx-cache"
```

#### 3.6 完整构建
```bash
cd client && npx tauri build
# ✅ 构建成功！
```

### Phase 4：构建产物

| 文件 | 大小 | 路径 |
|------|------|------|
| NSIS 安装包 | 11 MB | `client\src-tauri\target\release\bundle\nsis\SayIt_0.0.9_x64-setup.exe` |
| MSI 中文安装包 | 15 MB | `client\src-tauri\target\release\bundle\msi\SayIt_0.0.9_x64_zh-CN.msi` |
| MSI 英文安装包 | 15 MB | `client\src-tauri\target\release\bundle\msi\SayIt_0.0.9_x64_en-US.msi` |
| 可执行文件 | 38 MB | `client\src-tauri\target\release\sayit.exe` |

## 四、已知问题与注意事项

1. **网络限制：** 本机无法直接访问 GitHub、HuggingFace 等境外站点，git clone 和 cargo 下载依赖时需要走代理或者手动下载
2. **sherpa-onnx 依赖：** 每次 `cargo clean` 后需要重新设置 `SHERPA_ONNX_ARCHIVE_DIR` 环境变量
3. **PATH 问题：** 当前 bash 终端未配置 cargo 路径，每次执行需要完整路径：`C:/Users/29035/.cargo/bin/cargo`
4. **AGPL-3.0 协议：** 本项目基于 SayIt 修改，需要保持开源

## 五、待定制的功能

用户后续会提出具体需求，届时再制定修改计划。已知方向：
- 有些原项目功能不满意 → 需要修改
- 有些功能需要但原项目没有 → 需要新增

## 六、开发命令速查

```bash
# 开发模式运行
cd client && npm run tauri dev

# 仅编译 Rust 后端
cd client/src-tauri && SHERPA_ONNX_ARCHIVE_DIR=... cargo build --release

# 完整打包
cd client && SHERPA_ONNX_ARCHIVE_DIR=... npx tauri build

# 运行安装包
SayIt_0.0.9_x64-setup.exe
```
