# Gemini CLI Plugin for Claude Code

## 项目概述

将 Google Gemini CLI 集成到 Claude Code 的插件，支持代码审查、对抗性审查、任务委派。
薄转发器架构：斜杠命令 → gemini-companion.mjs → lib/gemini.mjs → `gemini -o stream-json`（prompt via stdin）。

## 目录结构

```
gemini-plugin-cc/
├── .claude-plugin/marketplace.json        # Marketplace 元数据
├── .github/workflows/
│   ├── pull-request-ci.yml                # PR CI（Node.js 22, npm test）
│   └── release-please.yml                 # 自动发版（release-please）
├── release-please-config.json             # release-please 配置
├── .release-please-manifest.json          # 版本锚点
├── plugins/gemini/                        # 插件主体
│   ├── .claude-plugin/plugin.json
│   ├── agents/gemini-rescue.md            # 任务委派子代理
│   ├── commands/                          # 7 个斜杠命令
│   │   ├── review.md                      # /gemini:review
│   │   ├── adversarial-review.md          # /gemini:adversarial-review
│   │   ├── rescue.md                      # /gemini:rescue
│   │   ├── setup.md                       # /gemini:setup
│   │   ├── status.md                      # /gemini:status
│   │   ├── result.md                      # /gemini:result
│   │   └── cancel.md                      # /gemini:cancel
│   ├── hooks/hooks.json                   # SessionStart/End/Stop 生命周期钩子
│   ├── prompts/
│   │   ├── review.md                      # 结构化审查提示模板
│   │   ├── adversarial-review.md          # 对抗性审查提示模板
│   │   └── stop-review-gate.md            # 停止审查门控提示
│   ├── schemas/review-output.schema.json  # 审查输出 JSON Schema
│   ├── scripts/
│   │   ├── gemini-companion.mjs           # 主 CLI 入口（子命令分发）
│   │   ├── session-lifecycle-hook.mjs
│   │   ├── stop-review-gate-hook.mjs
│   │   └── lib/
│   │       ├── gemini.mjs                 # Gemini CLI 核心（headless、锁、JSON 提取）
│   │       ├── models.mjs                 # 模型别名解析与错误归一化
│   │       ├── git.mjs                    # Git 上下文收集
│   │       ├── state.mjs                  # 状态持久化
│   │       ├── process.mjs                # 跨平台进程管理
│   │       ├── job-control.mjs            # 并发锁、cancel 两阶段中断
│   │       ├── tracked-jobs.mjs           # 任务状态机、进度上报
│   │       ├── render.mjs                 # Markdown 输出渲染
│   │       ├── args.mjs                   # 参数解析
│   │       ├── fs.mjs                     # 文件工具（EAGAIN 安全读取）
│   │       ├── workspace.mjs              # 工作区检测
│   │       └── prompts.mjs                # 模板加载与插值
│   ├── skills/
│   │   ├── gemini-cli-runtime/SKILL.md
│   │   ├── gemini-result-handling/SKILL.md
│   │   └── gemini-prompting/
│   │       ├── SKILL.md
│   │       └── references/
│   └── CHANGELOG.md
├── tests/                                 # 单元测试（7 个文件）
│   ├── args.test.mjs
│   ├── fs.test.mjs
│   ├── gemini.test.mjs
│   ├── models.test.mjs
│   ├── process.test.mjs
│   ├── render.test.mjs
│   └── state.test.mjs
├── docs/                                  # 设计文档（gitignored）
├── package.json
├── README.md
└── LICENSE                                # Apache-2.0
```

## 架构要点

- **薄转发器**: 斜杠命令(MD) → gemini-companion.mjs → lib/gemini.mjs → `gemini -o stream-json`
- **无 Broker**: Gemini CLI 无状态，文件锁 `gemini.lock` 串行化并发请求
- **三层 JSON 提取**: prompt engineering → JSON 块提取 → 纯文本 fallback
- **活动检测超时**: stream-json 事件流有输出就续期，默认 30 分钟硬超时
- **模型层**: `lib/models.mjs` 集中管理别名解析、默认回退、403/429 错误归一化

## 开发约定

- **运行时**: Node.js ≥ 18.18.0, ESM (`type: "module"`)
- **编码**: UTF-8 (no BOM), LF 行尾
- **模块限制**: 每个 lib 模块 < 400 行, gemini-companion.mjs < 600 行
- **安全**: 不泄漏 API key, spawn 不拼接用户输入, 状态文件不存储凭证
- **跨平台**: Windows shell/UNC/taskkill, Unix process group SIGTERM
- **测试**: `npm test` 运行全部单元测试，CI 在每个 PR 自动执行
- **发版**: release-please 自动管理，Conventional Commits 驱动版本号，合并 Release PR 即发版
- **变更日志**: `plugins/gemini/CHANGELOG.md`，由 release-please 自动更新
- **设计文档**: `docs/` 目录已 gitignore，仅本地参考
