import { randomUUID } from 'node:crypto';

const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
export function runLimits(env = process.env) {
  return { durationMs: positive(env.RESEARCH_MAX_DURATION_MS, 240000), modelCalls: positive(env.RESEARCH_MAX_MODEL_CALLS, 4), toolCalls: positive(env.RESEARCH_MAX_TOOL_CALLS, 8), knownTokens: positive(env.RESEARCH_MAX_KNOWN_TOKENS, 120000), inputChars: positive(env.RESEARCH_MAX_INPUT_CHARS, 48000) };
}
export function interruption(code, message) { return Object.assign(new Error(message), { code, category: code === 'BUDGET_EXHAUSTED' ? 'budget_exhausted' : code === 'STORAGE_ERROR' ? 'storage_error' : 'cancelled', retryable: false }); }

export function createRunControl(task, revision, { limits = runLimits(), now = Date.now, onChange = () => {} } = {}) {
  const controller = new AbortController();
  const started = now();
  const execution = { id: randomUUID(), revision, status: 'running', stage: 'starting', startedAt: new Date(started).toISOString(), deadlineAt: new Date(started + limits.durationMs).toISOString(), limits, used: { modelCalls: 0, toolCalls: 0, knownTokens: 0, unknownUsageCalls: 0 }, lastEventAt: new Date(started).toISOString(), endReason: null };
  task.executions ||= []; task.executions.push(execution); task.execution = execution;
  const changed = () => { execution.lastEventAt = new Date(now()).toISOString(); onChange(execution); };
  const abort = reason => { if (!controller.signal.aborted) { controller.abort(reason); changed(); } };
  const exhaust = message => { const error = interruption('BUDGET_EXHAUSTED', message); abort(error); throw error; };
  const timer = setTimeout(() => abort(interruption('BUDGET_EXHAUSTED', '本轮研究达到总时间上限，已停止；已取得的资料和上一版结果保留。')), limits.durationMs);
  timer.unref?.();
  function check() {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (now() - started >= limits.durationMs) exhaust('本轮研究达到总时间上限，已停止。');
    if (execution.used.knownTokens > limits.knownTokens) exhaust('本轮已报告的 Token 用量达到预算上限，未继续调用或发布新结果。');
  }
  return {
    execution, signal: controller.signal, abort, check,
    stage(value) { check(); execution.stage = value; changed(); },
    reserveModel(prompt, schema) {
      check();
      if (execution.used.modelCalls >= limits.modelCalls) exhaust('本轮模型调用次数达到上限，已停止。');
      const chars = (typeof prompt === 'string' ? prompt.length : String(prompt.instructions || '').length + String(prompt.input || '').length) + (schema ? JSON.stringify(schema).length : 0);
      execution.lastInputBudget = { chars, limit: limits.inputChars, includesSchema: !!schema, unit: 'UTF-16 characters, not tokens' };
      if (chars > limits.inputChars) exhaust('本轮输入超过上下文字符预算，请缩小资料或问题范围；原文仍保留。');
      execution.used.modelCalls++; changed();
    },
    beforeTool() { check(); if (execution.used.toolCalls >= limits.toolCalls) exhaust('本轮工具调用次数达到上限，已停止。'); execution.used.toolCalls++; changed(); },
    recordMetric(metric) {
      const input = metric.usage?.input_tokens ?? metric.usage?.prompt_tokens;
      const output = metric.usage?.output_tokens ?? metric.usage?.completion_tokens;
      if (Number.isFinite(input) && Number.isFinite(output)) execution.used.knownTokens += input + output;
      else execution.used.unknownUsageCalls++;
      changed();
      if (execution.used.knownTokens > limits.knownTokens) abort(interruption('BUDGET_EXHAUSTED', '本轮已报告的 Token 用量超过预算，已停止后续步骤；未知用量未按零计费。'));
    },
    finish(status, endReason) { clearTimeout(timer); execution.status = status; execution.endReason = endReason; execution.endedAt = new Date(now()).toISOString(); changed(); },
  };
}
