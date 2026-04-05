# Gemini CLI Plugin for Claude Code

## 项目概述

将 Google Gemini CLI 集成到 Claude Code 的插件，支持代码审查、对抗性审查、任务委派等。
架构参考 `codex-plugin-cc`（薄转发器模式），去除 Broker 改用文件锁并发控制，并修复其已知的 Windows 兼容性、超时、进程泄漏等问题。

## 目录结构

```
gemini-plugin-cc/
├── .claude-plugin/
│   └── marketplace.json              # Marketplace 元数据
├── .gitignore
├── CLAUDE.md                         # ← 本文件
├── codex-plugin-cc/                  # 参考实现（Codex 插件原版）
│   ├── .claude-plugin/marketplace.json
│   ├── plugins/codex/                # Codex 插件完整源码
│   │   ├── .claude-plugin/plugin.json
│   │   ├── agents/codex-rescue.md
│   │   ├── commands/*.md             # 7 个斜杠命令
│   │   ├── hooks/hooks.json
│   │   ├── prompts/*.md
│   │   ├── schemas/review-output.schema.json
│   │   ├── scripts/                  # Node.js 运行时
│   │   │   ├── codex-companion.mjs   # 主入口
│   │   │   ├── app-server-broker.mjs # Broker（Gemini 版不需要）
│   │   │   ├── session-lifecycle-hook.mjs
│   │   │   ├── stop-review-gate-hook.mjs
│   │   │   └── lib/                  # 核心库
│   │   │       ├── app-server.mjs    # JSON-RPC 客户端（Gemini 版不需要）
│   │   │       ├── args.mjs
│   │   │       ├── broker-endpoint.mjs
│   │   │       ├── broker-lifecycle.mjs
│   │   │       ├── codex.mjs
│   │   │       ├── fs.mjs
│   │   │       ├── git.mjs
│   │   │       ├── job-control.mjs
│   │   │       ├── process.mjs
│   │   │       ├── prompts.mjs
│   │   │       ├── render.mjs
│   │   │       ├── state.mjs
│   │   │       ├── tracked-jobs.mjs
│   │   │       └── workspace.mjs
│   │   └── skills/*/SKILL.md         # 3 个内部技能
│   ├── tests/                        # 参考测试用例
│   ├── package.json
│   └── README.md
├── docs/
│   ├── implementation-plan.md        # 完整实施计划（含架构、模块设计、代码示例）
│   ├── design-boundaries-and-quality-gates.md  # 设计边界 + 6 阶段质量门禁
│   ├── gemini-plugin-adversarial-review-report.md  # 对抗式审查报告
│   └── log.md                        # ★ 开发日志（每次提交推送前必须同步更新）
├── plugins/
│   └── gemini/                       # ★ 目标插件（已实现）
│       ├── .claude-plugin/
│       │   └── plugin.json           # 插件清单
│       ├── agents/
│       │   └── gemini-rescue.md      # 任务委派子代理
│       ├── commands/
│       │   ├── review.md             # /gemini:review
│       │   ├── adversarial-review.md # /gemini:adversarial-review
│       │   ├── rescue.md             # /gemini:rescue
│       │   ├── setup.md              # /gemini:setup
│       │   ├── status.md             # /gemini:status
│       │   ├── result.md             # /gemini:result
│       │   └── cancel.md             # /gemini:cancel
│       ├── hooks/
│       │   └── hooks.json            # SessionStart/End/Stop 生命周期钩子
│       ├── prompts/
│       │   ├── adversarial-review.md # 对抗性审查提示模板
│       │   └── stop-review-gate.md   # 停止审查门控提示
│       ├── schemas/
│       │   └── review-output.schema.json  # 审查输出 JSON Schema（宽松模式）
│       ├── scripts/
│       │   ├── gemini-companion.mjs       # 主 CLI 入口（子命令分发）
│       │   ├── session-lifecycle-hook.mjs  # Session 生命周期钩子
│       │   ├── stop-review-gate-hook.mjs   # 停止审查门控钩子
│       │   └── lib/
│       │       ├── gemini.mjs        # Gemini CLI 集成核心（headless 调用、锁、JSON 提取）
│       │       ├── git.mjs           # Git 上下文收集
│       │       ├── state.mjs         # 状态持久化（~/.claude/plugin-data/gemini-state/）
│       │       ├── process.mjs       # 跨平台进程管理（含 Windows 修复）
│       │       ├── job-control.mjs   # 任务控制（并发锁、cancel 两阶段中断）
│       │       ├── tracked-jobs.mjs  # 任务追踪（状态机、进度上报）
│       │       ├── render.mjs        # 输出渲染（Markdown 格式化）
│       │       ├── args.mjs          # 参数解析
│       │       ├── fs.mjs            # 文件工具（EAGAIN 安全读取）
│       │       ├── workspace.mjs     # 工作区检测
│       │       └── prompts.mjs       # 模板加载与插值
│       ├── skills/
│       │   ├── gemini-cli-runtime/
│       │   │   └── SKILL.md
│       │   ├── gemini-result-handling/
│       │   │   └── SKILL.md
│       │   └── gemini-prompting/
│       │       ├── SKILL.md
│       │       └── references/
│       │           ├── gemini-prompt-recipes.md
│       │           └── gemini-prompt-antipatterns.md
│       └── CHANGELOG.md
├── tests/                            # 单元测试
│   ├── args.test.mjs
│   ├── fs.test.mjs
│   ├── process.test.mjs
│   ├── state.test.mjs
│   └── gemini.test.mjs
└── package.json
```

## 架构要点

- **薄转发器模式**: 斜杠命令(MD) → gemini-companion.mjs → lib/gemini.mjs → `gemini -p -o stream-json`
- **无 Broker**: Gemini CLI 无状态，用文件锁 `gemini.lock` 串行化并发请求
- **三层 JSON 提取**: prompt engineering → JSON 块提取 → 纯文本 fallback（因 Gemini response 是自由文本）
- **活动检测超时**: stream-json 事件流有输出就续期，默认 30 分钟硬超时

## 与 Codex 插件的关键差异

| 方面 | Codex | Gemini |
|------|-------|--------|
| CLI 调用 | JSON-RPC app-server | 直接 `gemini -p` headless |
| 通信 | JSON-RPC 2.0 | stdin/stdout JSON |
| Broker | 需要 | 不需要（文件锁） |
| 模型 | `--model gpt-5.4-mini` | `-m pro/flash/flash-lite` |
| 输出 | 结构化 JSON | `-o json` / `-o stream-json` |
| 移除的文件 | — | app-server, broker-*, protocol.d.ts |

## Codex 已知问题修复清单

| 问题 | 修复 |
|------|------|
| Windows spawn 缺 `shell:true` | 所有 spawn 添加 `shell: process.platform === "win32"` |
| UNC 路径不兼容 | git 用 `-C` 参数，非 git 回退临时目录 |
| stdin EAGAIN 崩溃 | try/catch 捕获，返回空 |
| 任务无限循环 | 可配置硬超时 + stream-json 活动检测续期 |
| Broker 进程泄漏 | 无 Broker 架构，文件锁 + 孤儿检测 |
| 符号链接崩溃 | `lstatSync` + try/catch |
| maxBuffer 溢出 | 设置 50MB |

## 实施阶段

| Phase | 内容 | 状态 |
|-------|------|------|
| 1 | 基础框架: plugin.json, process, args, fs, workspace | 已完成 |
| 2 | 核心运行时: gemini.mjs, git, state, prompts | 已完成 |
| 3 | 任务系统: tracked-jobs, job-control, render | 已完成 |
| 4 | 主入口与命令: companion, commands, agents, skills | 已完成 |
| 5 | Hooks: lifecycle, review-gate, hooks.json | 已完成 |
| 6 | 配置与测试: package.json, tests, E2E | 已完成 |

## 开发约定

- **运行时**: Node.js ≥ 18.18.0, ESM (`type: "module"`)
- **编码**: UTF-8 (no BOM), LF 行尾
- **模块限制**: 每个 lib 模块 < 400 行, gemini-companion.mjs < 600 行
- **安全**: 不泄漏 API key, spawn 不拼接用户输入, 状态文件不存储凭证
- **跨平台**: Windows shell/UNC/taskkill, Unix process group SIGTERM
- **详细设计**: 见 `docs/implementation-plan.md` 和 `docs/design-boundaries-and-quality-gates.md`
- **开发日志**: 见 `docs/log.md`，每次 `git push` 前必须同步更新，记录本次变更的具体内容
- **变更日志**: 见 `plugins/gemini/CHANGELOG.md`，遵循 [Keep a Changelog](https://keepachangelog.com/) 格式，版本号遵循语义化版本
