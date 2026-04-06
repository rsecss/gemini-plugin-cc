# Development Log

> 每次提交推送到远程前，必须同步更新本文件。

## 2026-04-06 — 真实 Gemini review 联调后的超时与审查发现修复

**Commit**: `unreleased` — `fix(review): preserve payload schema and timeout window during real gemini validation`

**问题**:
1. 首次真实 `working-tree` review 在修复 `--sandbox` 后仍然失败：
   - `node plugins/gemini/scripts/gemini-companion.mjs review --json --scope working-tree`
   - 返回 `Gemini task timed out after 1800s of inactivity.`
2. 复查实现发现 `createActivityTimeout()` 存在真实缺陷：
   - 初始超时使用 `defaultTimeoutMs`（当前 30 分钟）
   - 但一旦收到首个事件，`extend()` 就把窗口错误地重置为固定 `5` 分钟
   - 对于 review 这种可能长时间无中间 token 的请求，会被过早杀掉，且错误消息还误导性地显示为 1800s
3. 修复超时逻辑后，再次真实 review 成功返回结构化 JSON，并指出两条有效问题：
   - clean review 的 `payload.target/context` 结构与正常 review 漂移
   - `extractModelHint()` 会把任意引号内容误识别成 model id

**修复**:
1. `plugins/gemini/scripts/lib/gemini.mjs`
   - `createActivityTimeout()` 改为每次事件都重置为调用方配置的 `timeoutMs`
   - 不再在首个事件后把窗口缩短为固定 5 分钟
   - 导出该函数以便建立针对性单测
2. `tests/gemini.test.mjs`
   - 新增 `createActivityTimeout()` 回归测试，验证事件发生后仍保留完整配置的 inactivity window
3. `plugins/gemini/scripts/gemini-companion.mjs`
   - `buildNoChangesReviewResult()` 改为接受完整 `context`
   - clean review 结果现在保留完整 `payload.target` 与 `payload.context`
   - 与普通 review 的 JSON 结构保持一致
4. `plugins/gemini/scripts/lib/models.mjs`
   - `extractModelHint()` 只匹配与 model 语义直接相关的错误模式
   - 删除泛化的引号回退，避免把 `"my-project-id"` 这类字符串误报成模型名
5. `tests/models.test.mjs`
   - 新增 quoted-text 场景回归测试，防止再次把非模型字符串识别为 model id

**真实联调结果**:
1. `pro` 模型：
   - 首次真实 review 成功返回结构化 JSON，并提出 2 条有效发现
   - 两条发现均已按上文修复
2. `flash` 模型：
   - 当前第三方 token 无权限访问 `gemini-3-flash-preview`
   - 插件已正确归一化错误为 `MODEL_UNAVAILABLE`，并给出候选模型建议
3. clean branch diff 冒烟：
   - `node plugins/gemini/scripts/gemini-companion.mjs review --json --base main`
   - 返回结构化 `approve`
   - 且 `payload.target/context` 已恢复完整结构

**验证**:
1. `npm test` 通过，当前共 77 个测试全部通过
2. 实机命令：
   - `node plugins/gemini/scripts/gemini-companion.mjs task --json "Reply with exactly: PONG"` → 成功
   - `node plugins/gemini/scripts/gemini-companion.mjs review --json --scope working-tree` → 能拿到真实结构化 review 并发现有效问题
   - `node plugins/gemini/scripts/gemini-companion.mjs review --json --scope working-tree -m flash` → 正确返回归一化的 403 模型无权限错误

**变更文件**:
- `plugins/gemini/scripts/lib/gemini.mjs` — 修复活动超时续期逻辑
- `plugins/gemini/scripts/gemini-companion.mjs` — 修复 clean review payload 结构漂移
- `plugins/gemini/scripts/lib/models.mjs` — 收紧模型名提取规则
- `tests/gemini.test.mjs` — 新增 activity timeout 回归测试
- `tests/models.test.mjs` — 新增 quoted-text 模型提取回归测试
- `plugins/gemini/CHANGELOG.md` — 记录未发布修复摘要

---

## 2026-04-06 — 真实 Gemini 联调修复 task 路径的 `--sandbox` 参数契约

**Commit**: `unreleased` — `fix(task): normalize gemini sandbox flag for cli 0.36.0`

**问题**:
1. 真实联调命令：
   - `node plugins/gemini/scripts/gemini-companion.mjs task --json "Reply with exactly: PONG"`
2. 初次执行失败，Gemini CLI 返回：
   - `Cannot use both a positional prompt and the --prompt (-p) flag together`
3. 进一步对比发现：
   - 直接 PowerShell 管道 `@'... '@ | gemini -o stream-json` 正常
   - `cmd /c "echo ... | gemini -o stream-json"` 也正常
4. 根因不是认证或网络，而是插件 task 路径传参错误：
   - `executeTaskRun()` 传入 `sandbox: "sandbox"`
   - `runGeminiHeadless()` 组装为 `-s sandbox`
   - 在本机 `gemini 0.36.0` 中，`--sandbox` 是布尔开关，不接受该字符串值
   - 结果 `sandbox` 被 CLI 当成额外位置参数，从而与 stdin headless prompt 冲突

**修复**:
1. `plugins/gemini/scripts/lib/gemini.mjs`
   - 新增 `appendSandboxArgs()`
   - 将 `sandbox` 兼容为 `boolean | string`
   - 对当前 CLI：
     - `true` / `"true"` / `"sandbox"` → `--sandbox`
     - `false` / `null` / `"off"` / `"none"` → 不传
   - 保留对未来可能带值语法的 fallback
2. `plugins/gemini/scripts/gemini-companion.mjs`
   - `executeTaskRun()` 不再传 `"sandbox"` 字符串
   - 改为 `request.write ? false : (config.defaultSandbox ?? true)`
   - 因此默认只读 task 仍然启用 sandbox，但调用契约改为当前 CLI 可接受的布尔语义
3. `tests/gemini.test.mjs`
   - fake gemini 现在会拒绝旧的 `-s sandbox` / `--sandbox sandbox`
   - 新增回归测试，验证 legacy `"sandbox"` 配置值也会被正确归一化成布尔 flag

**实机验证**:
1. 直接 Gemini CLI：
   - `@'Reply with exactly: PONG'@ | gemini -o stream-json`
   - 返回 `PONG`
2. 通过插件入口：
   - `node plugins/gemini/scripts/gemini-companion.mjs task --json "Reply with exactly: PONG"`
   - 修复前失败
   - 修复后返回：
     ```json
     {
       "status": 0,
       "rawOutput": "PONG",
       "error": null,
       "errorDetail": null
     }
     ```
3. `npm test` 通过，当前共 75 个测试全部通过

**变更文件**:
- `plugins/gemini/scripts/lib/gemini.mjs` — 新增 `appendSandboxArgs()`，兼容当前 Gemini CLI 的布尔 `--sandbox`
- `plugins/gemini/scripts/gemini-companion.mjs` — task 路径改用布尔 sandbox 语义
- `tests/gemini.test.mjs` — 新增 sandbox 参数契约回归测试
- `plugins/gemini/CHANGELOG.md` — 记录未发布修复摘要

---

## 2026-04-06 — 借鉴参考仓库收敛模型层并精简 review 接口

**Commit**: `unreleased` — `refactor(gemini): extract model layer and normalize CLI failures`

**背景**:
1. 参考仓库 `abiswas97/gemini-plugin-cc` 中，`models.mjs` 把模型别名、默认值和候选建议收拢到独立模块，这一点对当前仓库同样成立。
2. 当前实现中，模型别名解析散落在 `gemini-companion.mjs` 入口层；review command 先解析一次 target 生成 job 元数据，执行时又解析一次；Gemini 的 403/429 stderr 直接穿透到用户界面，接口噪声较大。
3. 这类逻辑不需要引入参考仓库更重的 ACP/session 结构，但值得借鉴其“模型能力集中管理”的设计。

**修复**:
1. 新增 `plugins/gemini/scripts/lib/models.mjs`：
   - `resolveRequestedModel()` 负责 CLI 显式 `-m` 输入
   - `resolveConfiguredModel()` 负责 state/config 默认模型回退
   - `suggestAlternativeModels()` 统一输出备选 alias
   - `normalizeGeminiCliError()` 识别 403/429 等模型相关失败并产出稳定错误结构
2. `gemini-companion.mjs` 去掉内联 `MODEL_ALIASES` 和 `normalizeRequestedModel()`，统一改为调用 `lib/models.mjs`
3. `handleReviewCommand()` 改为先构造一次 review request，并把已解析的 `target` 传入 `executeReviewRun()`，避免重复解析 review 目标
4. review/task 执行路径在 Gemini 明确返回模型不可用或限流时：
   - 生成更短、更稳定的错误摘要
   - 给出 `--model` 备选 alias
   - 保留原始 stderr 作为 raw detail
5. `render.mjs` 新增 `renderGeminiFailure()`，把模型相关失败从“原始 stderr 文本”升级为稳定 Markdown 输出
6. README / CHANGELOG 同步更新，记录新的模型层和错误归一化行为

**变更文件**:
- `plugins/gemini/scripts/lib/models.mjs` — 新增模型解析与 Gemini CLI 错误归一化模块
- `plugins/gemini/scripts/gemini-companion.mjs` — 去掉入口层模型别名常量，复用已解析 review target，接入规范化错误输出
- `plugins/gemini/scripts/lib/render.mjs` — 新增 `renderGeminiFailure()`
- `tests/models.test.mjs` — 新增模型解析、建议候选、403/429 归一化测试
- `tests/render.test.mjs` — 新增 Gemini 失败渲染回归测试
- `README.md` — 更新架构与模型 FAQ
- `plugins/gemini/CHANGELOG.md` — 记录未发布重构摘要

**验证**:
1. `npm test` 通过，当前共 74 个测试全部通过
2. 实机命令验证（不触发 Gemini 远程请求）：
   - `node plugins/gemini/scripts/gemini-companion.mjs review --json --base main`
   - 返回本地结构化 approve 结果：`No commits or file changes found between the current branch and main.`

---
## 2026-04-06 — 修复 `stream-json` 空响应提取与空 diff review 短路

**Commit**: `unreleased` — `fix(review): handle gemini stream-json events and empty review targets`

**问题**:
1. 本机 `gemini 0.36.0` 的真实 `-o stream-json` 输出中：
   - assistant 正文位于 `message.content`
   - 最终 `result` 事件只包含 `status/stats`，不再带 `response`
2. 现有 `extractResponseFromEvents()` 仅识别：
   - `result.response`
   - `message.text`
因此即使 Gemini 实际已经回答，插件仍会把结果误判为 `Empty response`。
3. 当前仓库在 `main` 分支执行 `branch diff against main` 时，目标实际上为空，但插件仍会调用 Gemini 进行 review，导致多余请求和误导性失败。

**复现证据**:
1. 直接运行最小命令：
   ```powershell
   @'
   reply with exactly: hi
   '@ | gemini -o stream-json
   ```
2. 观察到真实事件序列：
   - `{"type":"message","role":"assistant","content":"hi","delta":true}`
   - `{"type":"result","status":"success","stats":{...}}`
3. 由此确认空响应不是 Gemini 未回答，而是插件读取错字段。

**修复**:
1. `extractResponseFromEvents()` 改为优先顺序：
   - `result.response`（兼容旧实现）
   - `assistant` 的 `message.content` / `message.text` delta 拼接
   - `assistant` 非 delta 快照
   - 无 role 元数据时的 generic delta / snapshot fallback（兼容旧版本消息格式）
2. 为 `runGeminiHeadless()` 增加回归测试，覆盖：
   - `assistant/content + result without response`
   - `legacy events without role metadata`
3. `collectWorkingTreeContext()` / `collectBranchContext()` 新增 `hasChanges`
4. `executeReviewRun()` 在 review 目标为空时直接短路返回本地结构化结果，不再调用 Gemini：
   - `branch diff against main` 且无提交/文件差异
   - 干净 working tree
5. 实机验证：
   - `review --base main` 现在直接返回 `No commits or file changes found...`
   - `review --scope working-tree` 在默认模型下已能返回结构化 JSON 结果

**额外发现**:
- 使用 `-m flash-lite` 在当前第三方 token 下会返回 `403 Forbidden`：
  `This token has no access to model gemini-3.1-flash-lite-preview`
- 这不是插件解析问题，而是当前 token 的模型权限限制

**变更文件**:
- `plugins/gemini/scripts/lib/gemini.mjs` — 修正 `stream-json` 事件提取逻辑，补兼容 fallback
- `plugins/gemini/scripts/lib/git.mjs` — 为 working-tree / branch review 上下文增加 `hasChanges`
- `plugins/gemini/scripts/gemini-companion.mjs` — 空 review 目标短路返回本地结构化结果
- `tests/gemini.test.mjs` — 新增 2 个事件格式兼容回归测试
- `plugins/gemini/CHANGELOG.md` — 记录未发布修复摘要

**验证**:
1. `npm test` 通过，当前共 65 个测试全部通过
2. 实机命令验证：
   - `@'reply with exactly: hi'@ | gemini -o stream-json`：确认真实事件结构
   - `node plugins/gemini/scripts/gemini-companion.mjs review --json --base main`：确认空 diff 短路
   - `node plugins/gemini/scripts/gemini-companion.mjs review --json --scope working-tree`：确认非空 review 可返回结构化 JSON

---

## 2026-04-06 — 修复 `/gemini:review` 结构化输出契约与误导性 fallback

**Commit**: `unreleased` — `fix(review): enforce structured output contract for normal review`

**问题**:
1. 普通 `/gemini:review` 只使用内联字符串 prompt：`Review the following code changes and provide structured feedback.`，没有像 `adversarial-review.md` 那样明确要求返回 JSON code block。
2. 当 Gemini 返回自然语言时，`runGeminiReview()` 会伪造一个 fallback 结果：
   - `verdict: "needs-attention"`
   - `summary: <自然语言输出>`
   - `findings: []`
3. 渲染层看到 `findings: []` 后会输出 `No material findings.`，导致最终结果同时出现：
   - “Review completed but output was not structured JSON.”
   - “No material findings.”

这会把“审查输出无效”错误包装成“似乎没有发现问题”，对用户具有明显误导性。

**修复**:
1. 为普通 review 新增专用 prompt 模板 `plugins/gemini/prompts/review.md`
2. 在模板中补齐结构化输出契约，要求 Gemini：
   - 仅返回满足 schema 的 JSON
   - 使用 ```json code block
   - 仅报告可辩护的 material findings
3. `executeReviewRun()` 不再使用普通字符串 prompt，改为统一走 `buildReviewPrompt(context)`
4. `runGeminiReview()` 在 JSON 提取失败时不再伪造空 findings，而是返回：
   - `parsed: null`
   - `fallback: true`
   - `parseError: ...`
   - `rawOutput: ...`
5. `renderReviewResult()` 在 `parsed: null` 时明确输出：
   - 本次 review 未满足结构化输出契约
   - 不应将该结果视为 approval
   - 不应将该结果视为“没有 findings”
6. README 的架构说明同步更新为 `gemini -o stream-json (prompt via stdin)`，避免继续引用旧的 `-p` 路径

**变更文件**:
- `plugins/gemini/prompts/review.md` — 新增普通 review 的结构化 prompt 模板
- `plugins/gemini/scripts/gemini-companion.mjs` — 新增 `buildReviewPrompt()` 并在 `/gemini:review` 中启用
- `plugins/gemini/scripts/lib/gemini.mjs` — 非结构化 review 输出改为 hard failure，不再伪造空 findings
- `plugins/gemini/scripts/lib/render.mjs` — 非结构化 review 输出改为明确告警文案
- `tests/gemini.test.mjs` — 新增 structured/plain-text review 两条回归测试
- `tests/render.test.mjs` — 新增渲染层回归测试，防止再次出现 `No material findings.` 误报
- `README.md` — 更新 headless 架构说明
- `plugins/gemini/CHANGELOG.md` — 记录未发布修复摘要

**验证**:
1. `npm test` 通过，当前共 63 个测试全部通过
2. 新增测试覆盖两条关键回归路径：
   - Gemini 正确返回结构化 review JSON
   - Gemini 返回纯文本 review 时，插件不会再伪造 “No material findings.”

---

## 2026-04-06 — 移除 `-p` 标志，改用 stdin 触发 headless 模式

**Commit**: `395895a` — `fix(gemini): remove -p flag, pass prompt via stdin only`

**问题**: Gemini CLI 的 `-p` 标志在官方文档中未明确定义，且在某些版本中可能不存在或行为不一致。

**修复**:
1. 从 `probeGeminiAuth()` 和 `runGeminiHeadless()` 中移除所有 `-p` 参数
2. 依赖非 TTY 的 stdin 自动触发 headless 模式（Gemini CLI 原生支持）
3. 在 `runGeminiHeadless()` 中添加注释，说明通过 stdin 传递 prompt 可避免 Windows 命令行长度限制
4. 新增 `fake-gemini` 集成测试工具，模拟 Gemini CLI 行为
5. 为 `probeGeminiAuth()` 和 `runGeminiHeadless()` 添加集成测试，验证 stdin-only 调用方式
6. 测试中断言 fake gemini 拒绝 `-p` 标志，防止回归

**变更文件**:
- `plugins/gemini/scripts/lib/gemini.mjs` — 移除 3 处 `-p` 参数，添加 stdin 说明注释
- `tests/gemini.test.mjs` — 新增 `withFakeGemini` 测试工具和 2 个集成测试

---

## 2026-04-05 — v1.0.0 对抗式审查修复

基于 `docs/gemini-plugin-adversarial-review-report.md` 的 8 项发现，进行了针对性修复。

### F1 [P1] 认证探测依赖不存在的 CLI 命令

**问题**: `getGeminiAuthStatus()` 调用 `gemini auth status`，该命令不存在于 Gemini CLI 官方文档中。`ensureGeminiReady()` 和 `buildSetupReport()` 引导用户执行 `!gemini auth login`（同样不存在）。

**修复**: 删除 `getGeminiAuthStatus()`，新增 `probeGeminiAuth()`：
1. 先检查 `GEMINI_API_KEY` 环境变量
2. 再检查 `GOOGLE_APPLICATION_CREDENTIALS` / `GOOGLE_CLOUD_PROJECT`
3. 最后做一次最小 headless 探测（`gemini -p -o json`，15s 超时）

`ensureGeminiReady()` 降级为只检查二进制可用性，认证错误交给运行时自然暴露。所有用户提示改为官方支持方式。

**变更文件**:
- `plugins/gemini/scripts/lib/gemini.mjs` — `getGeminiAuthStatus` → `probeGeminiAuth`
- `plugins/gemini/scripts/lib/process.mjs` — `runCommand` 增加 `timeout` 透传
- `plugins/gemini/scripts/gemini-companion.mjs` — 更新导入、`ensureGeminiReady`、`buildSetupReport`
- `plugins/gemini/scripts/stop-review-gate-hook.mjs` — 更新导入和 `buildSetupNote`
- `plugins/gemini/commands/setup.md` — 认证指引文案

---

### F2 [P1] Review 上下文重复拼接

**问题**: `executeReviewRun()` 构建的 `prompt` 已包含 `context.content`，但 `runGeminiReview()` 又追加了 `reviewContext.content`，导致 token 消耗翻倍。

**修复**: `runGeminiReview()` 中 `promptTemplate` 存在时直接作为完整 prompt 使用，不再追加 `reviewContext.content`。

```diff
- const prompt = opts.promptTemplate
-   ? `${opts.promptTemplate}\n\n${reviewContext.content}`
-   : reviewContext.content;
+ const prompt = opts.promptTemplate ?? reviewContext.content;
```

**变更文件**:
- `plugins/gemini/scripts/lib/gemini.mjs` — `runGeminiReview`

---

### F3 [P1] Cancel 无条件释放全局锁

**问题**: `handleCancel()` 直接删除 `gemini.lock` 而不校验锁归属，可能释放其他任务持有的锁，破坏串行执行语义。

**修复**:
1. `acquireGeminiLock(stateDir, jobId)` 在锁文件中记录 `jobId`
2. 新增 `releaseGeminiLockIfOwner(lockPath, jobId)`，只有归属任务才能释放
3. `handleCancel` 改用 ownership-aware 释放
4. `executeReviewRun` / `executeTaskRun` 传入 `jobId`

**变更文件**:
- `plugins/gemini/scripts/lib/gemini.mjs` — `acquireGeminiLock` 签名、新增 `releaseGeminiLockIfOwner`
- `plugins/gemini/scripts/gemini-companion.mjs` — `handleCancel`、`executeReviewRun`、`executeTaskRun`

---

### F4 [P2] 删除伪 resume 线程能力

**问题**: `rescue.md` 提供 "Continue current thread / Start new thread" 交互，但底层从未持久化 Gemini session ID，也未接通 `-r` 参数，每次都是新会话。

**修复**: 删除 `rescue.md` 中的 `task-resume-candidate` 检查和 thread 选择交互。删除 `gemini-companion.mjs` 中的 `handleTaskResumeCandidate` 死代码及其 switch case，清理未使用的导入（`SESSION_ID_ENV`、`listJobs`、`sortJobsNewestFirst`）。

**变更文件**:
- `plugins/gemini/commands/rescue.md`
- `plugins/gemini/scripts/gemini-companion.mjs`

---

### F5 [P2] 简化中断逻辑，去除 partialEvents 承诺

**问题**: `interruptGeminiTask(pid, partialEvents)` 接受 `partialEvents` 参数，但 job 中从未写入 partial events，且记录的是 Node worker PID 而非 Gemini 子进程 PID。

**修复**: 移除 `partialEvents` 参数，将函数简化为纯进程终止工具（SIGTERM → 3s → SIGKILL），不承诺捕获部分结果。

**变更文件**:
- `plugins/gemini/scripts/lib/gemini.mjs` — `interruptGeminiTask` 签名
- `plugins/gemini/scripts/gemini-companion.mjs` — `handleCancel` 调用处

---

### F6 [P2] 状态更新添加文件锁防并发覆盖

**问题**: `state.json` 的 `load → mutate → save` 无并发保护，多进程（后台 worker、phase 更新、cancel、session hook）可能互相覆盖。

**修复**: 在 `state.mjs` 中新增 `acquireStateLock()` / `releaseStateLock()`，`updateState()` 用 `try/finally` 包裹锁。`state.lock` 与 `gemini.lock` 独立，无循环依赖风险。锁粒度为毫秒级（仅覆盖 load/mutate/save），含孤儿检测和 5s 超时。

**变更文件**:
- `plugins/gemini/scripts/lib/state.mjs`

---

### F7 [P2] 建立最小测试集

**问题**: 仓库无 `tests/` 目录，`npm test` 输出 0 tests 但返回成功，质量门禁形同虚设。

**修复**: 创建 5 个测试文件，共 57 个用例，覆盖核心纯函数模块：

| 文件 | 覆盖模块 | 用例数 |
|------|----------|--------|
| `tests/args.test.mjs` | `parseArgs`, `splitRawArgumentString` | 14 |
| `tests/fs.test.mjs` | `ensureAbsolutePath`, `createTempDir`, `readJsonFile`, `writeJsonFile`, `safeReadFile`, `isProbablyText`, `safeStatFile`, `isReadableFile` | 13 |
| `tests/process.test.mjs` | `formatCommandFailure`, `terminateProcessTree` | 7 |
| `tests/state.test.mjs` | `generateJobId`, `loadState`, `saveState`, `updateState`, `upsertJob`, `setConfig`, `getConfig`, `writeJobFile`, `readJobFile` | 9 |
| `tests/gemini.test.mjs` | `extractStructuredJson`, `parseGeminiOutput`, `parseStructuredOutput` | 14 |

**变更文件**:
- `tests/*.test.mjs`（新建 5 个）
- `package.json` — 增加 `test:ci` script

---

### F8 [P3] Schema 清理

**问题**: `review-output.schema.json` 中 `confidence` 字段为 required，但渲染层不消费；`adversarial-review.md` prompt 仍要求返回 confidence。

**修复**: 从 schema 的 `required` 和 `properties` 中移除 `confidence`。同步更新 `adversarial-review.md`，删除 confidence 相关指令。

**变更文件**:
- `plugins/gemini/schemas/review-output.schema.json`
- `plugins/gemini/prompts/adversarial-review.md`

---

### 其他清理

- `CLAUDE.md` — 更新 `tracked-jobs.mjs` 注释（`partialEvents` → `进度上报`）
