# SayIt AI 润色供应商

SayIt 有两个核心功能：语音转文本（ASR）和 AI 文本润色。ASR 部分可以参考 [豆包语音识别凭证获取](豆包ASR凭据获取.md) 和 [阿里云千问语音识别](aliyun.md)。

AI 润色功能可以去除口癖词（嗯、啊、那个）、修正语音识别错误、自动分段排版等，都可以通过 Prompt 自定义控制。

SayIt 已对接国内常用的 AI 服务商（通义千问、DeepSeek、豆包等），同时支持 OpenAI 兼容格式，可以接入其他供应商或第三方中转。

## 1. 最佳实践

**推荐 DeepSeek deepseek-v4-flash 作为默认选择。** 质量最好、价格极低、速度可接受。

DeepSeek V4 Flash（2026 年 4 月发布）是 284B 参数的 MoE 模型，13B 激活参数，支持 1M 上下文。关闭思考模式后速度接近旧版 deepseek-chat，但质量明显更好，价格还更便宜（输入 1 元/百万 Token，输出 2 元/百万 Token）。

如果对延迟极度敏感（需要 <500ms），可以用通义千问 qwen3.6-flash，速度最快但质量略逊。

| 供应商　　　 | 模型　　　　　　　| 短文本　　| 长文本　　 | 每月成本 |
| --------------| -------------------| -----------| ------------| ----------|
| **DeepSeek** | deepseek-v4-flash | **803ms** | **2089ms** | ~1.5 元　|
| 通义千问　　 | qwen3.6-flash　　 | 393ms　　 | 1308ms　　 | ~3.8 元　|

> 月成本按每天 100 次、每次约 100 字估算。V4 Flash 默认开启 thinking，会导致延迟飙升到 2~7 秒。SayIt 已在代码中自动关闭思考模式，无需用户手动配置。

## 2. 如何选择AI模型

- **速度**：总耗时由 TTFT（Time To First Token，首个字生成时间）和 TPS（每秒 Token 数）决定。语音转写场景下，总耗时超过 1~2 秒会有明显等待感。
- **质量**：能否准确执行 Prompt 指令——去口癖、识别自我修正、格式化列表、纠正专有名词大小写等。
- **价格**：V4 Flash 的自动 prompt 缓存机制让重复 system prompt 的场景成本极低。

## 3. 实测数据

以下数据是 2026 年 5 月实测的，使用非流式请求（和 SayIt 实际调用方式一致），每条用例跑了 3 次取中位数。

### 速度

| 供应商　 | 模型　　　　　　　　　　　　　| 短文本 | 中等文本 | 长文本（~200字） |
| ----------| -------------------------------| --------| ----------| ------------------|
| DeepSeek | deepseek-v4-flash（关闭思考） | 803ms　| 971ms　　| 2089ms　　　　　 |
| 通义千问 | qwen3.6-flash　　　　　　　　 | 393ms　| 489ms　　| 1308ms　　　　　 |


### 质量

两家都能正确去口癖、识别列表结构、纠正专有名词大小写（DeepSeek、ChatGPT、OpenAI 等）。V4 Flash 在专有名词纠正和格式化方面更稳定，输出更简洁。


## 4. 关于豆包

豆包的语音识别（ASR）是目前中文场景下最好的，SayIt 推荐使用豆包 ASR。但豆包的 AI 文本模型（lite 和 mini 都测了）延迟极不稳定，中长文本经常超过 10 秒，不适合语音转写的润色场景。建议 ASR 用豆包，AI 润色用 DeepSeek 或通义千问。

## 5. 价格参考

| 供应商　 | 模型　　　　　　　　 | 输入（百万Token） | 输出（百万Token） |
| ----------| ----------------------| -------------------| -------------------|
| DeepSeek | deepseek-v4-flash　　| 1 元　　　　　　　| 2 元　　　　　　　|
| 通义千问 | qwen3.6-flash　　　　| 1.8 元　　　　　　| 10.8 元　　　　　 |
| 豆包　　 | doubao-seed-2-0-mini | 0.2 元　　　　　　| 2 元　　　　　　　|



## 6. 配置指南

> 建议直接使用官方 API。第三方中转站延迟普遍更高。

### DeepSeek（推荐）

- API 地址：`https://api.deepseek.com`
- 模型：`deepseek-v4-flash`
- 获取 API Key：[platform.deepseek.com](https://platform.deepseek.com/api_keys)
- **注意**：SayIt 会自动在请求中添加 `thinking: {type: "disabled"}` 关闭思考模式以降低延迟
![alt text](DeepSeek获取API.png)

### 通义千问

- API 地址：`https://dashscope.aliyuncs.com/compatible-mode`
- 模型：`qwen3.6-flash`
- 获取 API Key：[百炼平台](https://bailian.console.aliyun.com/?spm=a2c4g.11186623.0.0.60905ec6iyaRqr&tab=model#/api-key)
![alt text](百炼获取API.png)

### 豆包（火山方舟）
- API 地址：`https://ark.cn-beijing.volces.com/api/v3`
- 模型：`doubao-seed-2-0-mini-260215`
![alt text](豆包获取API.png)