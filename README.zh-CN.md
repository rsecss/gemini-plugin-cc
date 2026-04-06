<div align="center">

# Gemini Plugin for Claude Code

将 Google Gemini 融入你的 Claude Code 工作流 — 代码审查、对抗性审查、任务委派，全部通过斜杠命令完成。

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE) [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.18.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![Claude Code](https://img.shields.io/badge/Claude%20Code-Plugin-7C3AED?logo=anthropic&logoColor=white)](https://docs.anthropic.com/en/docs/claude-code) [![Gemini CLI](https://img.shields.io/badge/Gemini%20CLI-Integration-4285F4?logo=google&logoColor=white)](https://github.com/google-gemini/gemini-cli)

[English](README.md) | [简体中文](README.zh-CN.md)

</div>

---

## 为什么需要这个插件？

Claude Code 很强，Gemini 也很强。这个插件让你在终端里同时用上两者。

- 发版前让 Gemini 给你的代码做一次**第二意见**审查
- 用对抗性审查**挑战你的设计** — 压力测试假设、权衡和故障模式
- 把任务**委派给 Gemini**，在后台运行的同时继续用 Claude Code 工作

## 快速开始

### 前置条件

- [Gemini CLI](https://github.com/google-gemini/gemini-cli) — `npm install -g @google/gemini-cli`
- Node.js 18.18+

### 安装

```shell
/plugin marketplace add rsecss/gemini-plugin-cc
/plugin install gemini@gemini-plugin
/reload-plugins
/gemini:setup
```

### 第一次使用

```shell
/gemini:review                    # 审查未提交的变更
/gemini:review --base main        # 审查分支与 main 的差异
/gemini:adversarial-review        # 挑战你的设计决策
/gemini:rescue investigate the bug  # 把任务交给 Gemini
```

## 命令一览

| 命令 | 说明 |
|------|------|
| `/gemini:review` | 结构化代码审查（只读） |
| `/gemini:adversarial-review` | 可引导的挑战性审查，聚焦设计与权衡 |
| `/gemini:rescue` | 通过子代理将任务委派给 Gemini |
| `/gemini:setup` | 检查就绪状态，管理审查门控 |
| `/gemini:status` | 查看运行中和最近的任务 |
| `/gemini:result` | 查看已完成任务的输出 |
| `/gemini:cancel` | 取消正在运行的后台任务 |

所有命令支持 `--background`、`--wait` 和 `-m <model>`（别名：`auto`、`pro`、`flash`、`flash-lite`）。

### 代码审查

```shell
/gemini:review                          # 工作区变更
/gemini:review --base main              # 分支差异
/gemini:review --background             # 后台运行
```

### 对抗性审查

不止于代码正确性 — 挑战设计选择、隐含假设和替代方案。

```shell
/gemini:adversarial-review
/gemini:adversarial-review --base main 挑战缓存设计
/gemini:adversarial-review --background 寻找竞态条件
```

### 任务委派

```shell
/gemini:rescue investigate why tests are failing
/gemini:rescue -m flash fix the flaky integration test
/gemini:rescue --background redesign the connection pool
```

用 `/gemini:status` 查看进度，`/gemini:result` 获取结果，`/gemini:cancel` 取消任务。

## 审查门控（可选）

启用后，每次 Claude 响应时会触发一个 `Stop` 钩子，让 Gemini 做针对性审查。如果发现问题，会阻止停止以便 Claude 先处理。

```shell
/gemini:setup --enable-review-gate
/gemini:setup --disable-review-gate
```

> **注意：** 这可能导致 Claude/Gemini 长时间循环，快速消耗用量配额。仅在主动监控时启用。

## 架构

薄转发器模式 — 无 broker，无守护进程：

```
斜杠命令 → gemini-companion.mjs → lib/gemini.mjs → gemini -o stream-json (stdin)
```

- **文件锁并发控制**，替代 broker 进程
- **三层 JSON 提取**：prompt engineering → JSON 块提取 → 纯文本 fallback
- **活动检测超时**：每次 stream 事件重置计时，30 分钟硬上限
- **完整 Windows 支持**：shell 启动、UNC 路径、taskkill、EAGAIN 安全读取

## 常见问题

**需要单独的账号吗？**
不需要。插件使用本地 Gemini CLI 的认证。运行 `gemini` 交互式登录，或设置 `GEMINI_API_KEY` 环境变量。

**可以选择不同的模型吗？**
可以。给任意命令传 `-m <model>`。如果模型不可用，插件会建议替代方案。

## 社区

本项目与 [LINUX DO](https://linux.do/) 社区共享。

## 致谢

基于 [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) 的架构构建。主要适配：用文件锁并发替代 Broker/JSON-RPC、为 Gemini 自由文本输出增加三层 JSON 提取、全面的 Windows 兼容性修复。

## 贡献

请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解开发环境搭建、代码规范和 Pull Request 指南。

## 许可证

[Apache License 2.0](LICENSE)
