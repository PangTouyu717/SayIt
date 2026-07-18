# SayIt 项目开发指南

## 语言

所有回复必须使用中文。

## ⚠️ 关键教训：改完代码 ≠ 更新应用

SayIt 是 Tauri 桌面应用，用户通过安装包（NSIS/MSI）安装到系统。改源码文件不会影响正在运行的应用。

**正确流程：**
1. 改代码 → 2. `npx tauri build` 构建新安装包 → 3. 关闭运行的 SayIt → 4. 双击安装包装新版本

**严禁：** `cargo check` 通过就以为完事了。那只是检查编译，不生成可用程序。
**严禁：** 在用户看到效果前说"完成了"。

## 网络环境

**GitHub 直连不可用（超时）。** 以下是已验证可用的方式：

| 操作 | 可用方式 | 不可用 |
|------|---------|--------|
| 克隆仓库 | `gh repo clone <repo> -- --depth 1` | `git clone`（超时） |
| 下载 Release | 浏览器手动下载 | curl/gh release download（超时） |
| 下载依赖 | 浏览器手动下载后放指定目录 | cargo 自动下载 |

**huggingface.co、ghproxy.com、hf-mirror.com 全部不可用。**

## 环境配置

### 已安装的工具
- Node.js v24.16.0, npm 11.13.0
- Rust 1.97.1（安装路径：`C:/Users/29035/.cargo/bin/`）
- VS Build Tools 2022（MSVC 14.44.35207）
- Python 3.12.10

### 关键注意事项
1. **cargo 不在 PATH 中。** 必须使用完整路径：`C:/Users/29035/.cargo/bin/cargo`
2. **sherpa-onnx 需要手动下载。** 文件：`sherpa-onnx-v1.13.3-win-x64-static-MT-Release-lib.tar.bz2`（110MB），放在 `C:/Users/29035/.cargo/sherpa-onnx-cache/`，编译时设置环境变量 `SHERPA_ONNX_ARCHIVE_DIR=C:/Users/29035/.cargo/sherpa-onnx-cache`
3. **sherpa-onnx 缓存：** 首次 `cargo check` 后，解压后的库会缓存在 `target/` 目录，后续编译无需再次下载或设置环境变量

## 编译命令

```bash
# 开发模式（推荐日常使用）
cd client && PATH="/c/Users/29035/.cargo/bin:$PATH" npm run tauri dev

# 仅检查编译
cd client/src-tauri && SHERPA_ONNX_ARCHIVE_DIR=C:/Users/29035/.cargo/sherpa-onnx-cache C:/Users/29035/.cargo/bin/cargo check

# 完整打包
cd client && PATH="/c/Users/29035/.cargo/bin:$PATH" npx tauri build
```

## 项目结构速查

- 客户端入口：`client/src-tauri/src/main.rs`
- 录音状态机（核心）：`client/src/services/recorder/RecorderOrchestrator.ts`
- 全局键盘钩子：`client/src-tauri/src/keyboard/mod.rs`
- 文本注入：`client/src-tauri/src/inject/mod.rs`
- 前端页面：`client/src/pages/`
- 设置页面：`client/src/features/settings/`
