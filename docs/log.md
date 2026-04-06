# Development Log

> 每次提交推送到远程前，必须同步更新本文件。

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
