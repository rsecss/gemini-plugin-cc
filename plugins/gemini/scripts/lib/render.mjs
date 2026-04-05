/**
 * render.mjs — Markdown output rendering for setup, review, task, status, and cancel reports.
 */

// ── Helpers ────────────────────────────────────────────────────────────

function severityRank(severity) {
  switch (severity) {
    case "critical": return 0;
    case "high": return 1;
    case "medium": return 2;
    default: return 3;
  }
}

function formatLineRange(finding) {
  if (!finding.line_start) return "";
  if (!finding.line_end || finding.line_end === finding.line_start) return `:${finding.line_start}`;
  return `:${finding.line_start}-${finding.line_end}`;
}

function validateReviewResultShape(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "Expected a top-level JSON object.";
  if (typeof data.verdict !== "string" || !data.verdict.trim()) return "Missing string `verdict`.";
  if (typeof data.summary !== "string" || !data.summary.trim()) return "Missing string `summary`.";
  if (!Array.isArray(data.findings)) return "Missing array `findings`.";
  if (!Array.isArray(data.next_steps)) return "Missing array `next_steps`.";
  return null;
}

function normalizeReviewFinding(finding, index) {
  const source = finding && typeof finding === "object" && !Array.isArray(finding) ? finding : {};
  const lineStart = Number.isInteger(source.line_start) && source.line_start > 0 ? source.line_start : null;
  const lineEnd =
    Number.isInteger(source.line_end) && source.line_end > 0 && (!lineStart || source.line_end >= lineStart)
      ? source.line_end
      : lineStart;

  return {
    severity: typeof source.severity === "string" && source.severity.trim() ? source.severity.trim() : "low",
    title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : `Finding ${index + 1}`,
    body: typeof source.body === "string" && source.body.trim() ? source.body.trim() : "No details provided.",
    file: typeof source.file === "string" && source.file.trim() ? source.file.trim() : "unknown",
    line_start: lineStart,
    line_end: lineEnd,
    recommendation: typeof source.recommendation === "string" ? source.recommendation.trim() : "",
  };
}

function normalizeReviewResultData(data) {
  return {
    verdict: data.verdict.trim(),
    summary: data.summary.trim(),
    findings: data.findings.map((f, i) => normalizeReviewFinding(f, i)),
    next_steps: data.next_steps.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()),
  };
}

function escapeMarkdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function formatJobLine(job) {
  const parts = [job.id, `${job.status || "unknown"}`];
  if (job.kindLabel) parts.push(job.kindLabel);
  if (job.title) parts.push(job.title);
  return parts.join(" | ");
}

function pushJobDetails(lines, job, options = {}) {
  lines.push(`- ${formatJobLine(job)}`);
  if (job.summary) lines.push(`  Summary: ${job.summary}`);
  if (job.phase) lines.push(`  Phase: ${job.phase}`);
  if (options.showElapsed && job.elapsed) lines.push(`  Elapsed: ${job.elapsed}`);
  if (options.showDuration && job.duration) lines.push(`  Duration: ${job.duration}`);
  if (job.logFile && options.showLog) lines.push(`  Log: ${job.logFile}`);
  if ((job.status === "queued" || job.status === "running") && options.showCancelHint) {
    lines.push(`  Cancel: /gemini:cancel ${job.id}`);
  }
  if (job.status !== "queued" && job.status !== "running" && options.showResultHint) {
    lines.push(`  Result: /gemini:result ${job.id}`);
  }
  if (job.progressPreview?.length) {
    lines.push("  Progress:");
    for (const line of job.progressPreview) lines.push(`    ${line}`);
  }
}

function appendActiveJobsTable(lines, jobs) {
  lines.push("Active jobs:");
  lines.push("| Job | Kind | Status | Phase | Elapsed | Summary | Actions |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const job of jobs) {
    const actions = [`/gemini:status ${job.id}`];
    if (job.status === "queued" || job.status === "running") actions.push(`/gemini:cancel ${job.id}`);
    lines.push(
      `| ${escapeMarkdownCell(job.id)} | ${escapeMarkdownCell(job.kindLabel)} | ${escapeMarkdownCell(job.status)} | ${escapeMarkdownCell(job.phase ?? "")} | ${escapeMarkdownCell(job.elapsed ?? "")} | ${escapeMarkdownCell(job.summary ?? "")} | ${actions.map((a) => `\`${a}\``).join("<br>")} |`
    );
  }
}

// ── Setup Report ───────────────────────────────────────────────────────

/**
 * Render Gemini setup status.
 * @param {object} report
 * @returns {string}
 */
export function renderSetupReport(report) {
  const lines = [
    "# Gemini Setup",
    "",
    `Status: ${report.ready ? "ready" : "needs attention"}`,
    "",
    "Checks:",
    `- node: ${report.node.detail}`,
    `- npm: ${report.npm.detail}`,
    `- gemini: ${report.gemini.detail}`,
    `- auth: ${report.auth.detail}`,
    `- review gate: ${report.reviewGateEnabled ? "enabled" : "disabled"}`,
  ];

  // Endpoint config
  if (report.endpoint) {
    lines.push(`- API endpoint: ${report.endpoint.customEndpoint ? report.endpoint.apiBase : "default"}`);
    if (report.endpoint.proxy) lines.push(`- proxy: ${report.endpoint.proxy}`);
  }

  lines.push("");

  if (report.actionsTaken?.length > 0) {
    lines.push("Actions taken:");
    for (const action of report.actionsTaken) lines.push(`- ${action}`);
    lines.push("");
  }

  if (report.nextSteps?.length > 0) {
    lines.push("Next steps:");
    for (const step of report.nextSteps) lines.push(`- ${step}`);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

// ── Review Result ──────────────────────────────────────────────────────

/**
 * Render a structured review result.
 * @param {object} parsedResult - { parsed, parseError, rawOutput }
 * @param {{ reviewLabel: string, targetLabel: string }} meta
 * @returns {string}
 */
export function renderReviewResult(parsedResult, meta) {
  if (!parsedResult.parsed) {
    const lines = [
      `# Gemini ${meta.reviewLabel}`,
      "",
      "Gemini did not return valid structured JSON.",
      "",
      `- Parse error: ${parsedResult.parseError}`,
    ];
    if (parsedResult.rawOutput) {
      lines.push("", "Raw response:", "", "```text", parsedResult.rawOutput, "```");
    }
    return `${lines.join("\n").trimEnd()}\n`;
  }

  const validationError = validateReviewResultShape(parsedResult.parsed);
  if (validationError) {
    const lines = [
      `# Gemini ${meta.reviewLabel}`,
      "",
      `Target: ${meta.targetLabel}`,
      "Gemini returned JSON with an unexpected review shape.",
      "",
      `- Validation error: ${validationError}`,
    ];
    if (parsedResult.rawOutput) {
      lines.push("", "Raw response:", "", "```text", parsedResult.rawOutput, "```");
    }
    return `${lines.join("\n").trimEnd()}\n`;
  }

  const data = normalizeReviewResultData(parsedResult.parsed);
  const findings = [...data.findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const lines = [
    `# Gemini ${meta.reviewLabel}`,
    "",
    `Target: ${meta.targetLabel}`,
    `Verdict: ${data.verdict}`,
    "",
    data.summary,
    "",
  ];

  if (findings.length === 0) {
    lines.push("No material findings.");
  } else {
    lines.push("Findings:");
    for (const finding of findings) {
      const lineSuffix = formatLineRange(finding);
      lines.push(`- [${finding.severity}] ${finding.title} (${finding.file}${lineSuffix})`);
      lines.push(`  ${finding.body}`);
      if (finding.recommendation) lines.push(`  Recommendation: ${finding.recommendation}`);
    }
  }

  if (data.next_steps.length > 0) {
    lines.push("", "Next steps:");
    for (const step of data.next_steps) lines.push(`- ${step}`);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

// ── Task Result ────────────────────────────────────────────────────────

/**
 * Render a task result (free-text response).
 * @param {object} parsedResult
 * @returns {string}
 */
export function renderTaskResult(parsedResult) {
  const rawOutput = typeof parsedResult?.rawOutput === "string" ? parsedResult.rawOutput : "";
  if (rawOutput) return rawOutput.endsWith("\n") ? rawOutput : `${rawOutput}\n`;
  const message = String(parsedResult?.failureMessage ?? "").trim() || "Gemini did not return a final message.";
  return `${message}\n`;
}

// ── Status Report ──────────────────────────────────────────────────────

/**
 * Render a multi-job status report.
 * @param {object} report
 * @returns {string}
 */
export function renderStatusReport(report) {
  const lines = [
    "# Gemini Status",
    "",
    `Review gate: ${report.config.stopReviewGate ? "enabled" : "disabled"}`,
    "",
  ];

  if (report.running.length > 0) {
    appendActiveJobsTable(lines, report.running);
    lines.push("");
    lines.push("Live details:");
    for (const job of report.running) pushJobDetails(lines, job, { showElapsed: true, showLog: true });
    lines.push("");
  }

  if (report.latestFinished) {
    lines.push("Latest finished:");
    pushJobDetails(lines, report.latestFinished, { showDuration: true, showLog: report.latestFinished.status === "failed" });
    lines.push("");
  }

  if (report.recent.length > 0) {
    lines.push("Recent jobs:");
    for (const job of report.recent) pushJobDetails(lines, job, { showDuration: true, showLog: job.status === "failed" });
    lines.push("");
  } else if (report.running.length === 0 && !report.latestFinished) {
    lines.push("No jobs recorded yet.", "");
  }

  if (report.needsReview) {
    lines.push("The stop-time review gate is enabled.");
    lines.push("Ending the session will trigger a Gemini adversarial review and block if it finds issues.");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

// ── Single Job Status ──────────────────────────────────────────────────

/**
 * @param {object} job
 * @returns {string}
 */
export function renderJobStatusReport(job) {
  const lines = ["# Gemini Job Status", ""];
  pushJobDetails(lines, job, {
    showElapsed: job.status === "queued" || job.status === "running",
    showDuration: job.status !== "queued" && job.status !== "running",
    showLog: true,
    showCancelHint: true,
    showResultHint: true,
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

// ── Stored Job Result ──────────────────────────────────────────────────

/**
 * Render a stored job result for `/gemini:result`.
 * @param {object} job
 * @param {object} storedJob
 * @returns {string}
 */
export function renderStoredJobResult(job, storedJob) {
  if (storedJob?.rendered) {
    const output = storedJob.rendered.endsWith("\n") ? storedJob.rendered : `${storedJob.rendered}\n`;
    return output;
  }

  const rawOutput =
    (typeof storedJob?.result?.rawOutput === "string" && storedJob.result.rawOutput) || "";
  if (rawOutput) {
    return rawOutput.endsWith("\n") ? rawOutput : `${rawOutput}\n`;
  }

  const lines = [
    `# ${job.title ?? "Gemini Result"}`,
    "",
    `Job: ${job.id}`,
    `Status: ${job.status}`,
  ];

  if (job.summary) lines.push(`Summary: ${job.summary}`);

  if (job.errorMessage) {
    lines.push("", job.errorMessage);
  } else if (storedJob?.errorMessage) {
    lines.push("", storedJob.errorMessage);
  } else {
    lines.push("", "No captured result payload was stored for this job.");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

// ── Cancel Report ──────────────────────────────────────────────────────

/**
 * @param {object} job
 * @returns {string}
 */
export function renderCancelReport(job) {
  const lines = [
    "# Gemini Cancel",
    "",
    `Cancelled ${job.id}.`,
    "",
  ];
  if (job.title) lines.push(`- Title: ${job.title}`);
  if (job.summary) lines.push(`- Summary: ${job.summary}`);
  lines.push("- Check `/gemini:status` for the updated queue.");
  return `${lines.join("\n").trimEnd()}\n`;
}
