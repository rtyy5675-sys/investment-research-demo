import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, ResearchError } from '../lib/research-errors.mjs';
import { callTool, collectFinancialEvidence, decodeResult } from '../lib/finance-mcp.mjs';

const income = 'get_a_share_financials_income_statements';
const cash = 'get_a_share_financials_cash_flow_statements';
const scope = { thscode: '002594.SZ', name: '比亚迪', period: 'annual', year: 2024, quarter: null, yearsCount: 2 };
function rows() {
  return [2024, 2023].map(year => ({ thscode: scope.thscode, period: 'annual', fiscal_year: year, fiscal_period: 'FY', currency: 'CNY', period_end_ms: Date.UTC(year, 11, 31), operating_income: year * 100, parent_holder_net_profit: year, act_cash_flow_net: year * 2 }));
}
const success = () => ({ structuredContent: { code: 0, request_id: 'fixture-request', data: { item: rows() } } });
function context(request, signal) {
  return { client: { request }, tools: [income, cash].map(name => ({ name })), server: { name: 'fixture', version: '1.0' }, options: { signal } };
}

test('classifies actual SDK/HTTP/runtime shapes without inventing provider-code semantics', () => {
  const fixtures = [
    [new Error('Parameter conflict: limit must not be set together with start/end'), 'parameter_conflict', false],
    [Object.assign(new Error('invalid arguments'), { code: -32602 }), 'invalid_arguments', false],
    [Object.assign(new Error('bad key'), { status: 401 }), 'authentication', false],
    [Object.assign(new Error('forbidden'), { status: 403 }), 'permission', false],
    [new ResearchError('no rows', { category: 'empty_result' }), 'empty_result', false],
    [Object.assign(new Error('rate limited'), { status: 429 }), 'rate_limit', true],
    [Object.assign(new Error('Request timed out'), { code: -32001 }), 'timeout', true],
    [Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }), 'network', true],
    [Object.assign(new Error('stopped'), { code: 'CANCELLED' }), 'cancelled', false],
    [Object.assign(new Error('budget'), { code: 'BUDGET_EXHAUSTED' }), 'budget_exhausted', false],
    [Object.assign(new Error('disk full'), { code: 'ENOSPC' }), 'storage_error', false],
    [Object.assign(new Error('unrecognized'), { providerCode: 999 }), 'unknown', false],
  ];
  for (const [error, category, retryable] of fixtures) {
    const result = classifyError(error);
    assert.equal(result.category, category);
    assert.equal(result.retryable, retryable);
    assert.equal(typeof result.status, 'number');
    assert.equal(typeof result.recovery, 'string');
    assert.ok(result.code);
  }
  assert.equal(classifyError(fixtures.at(-1)[0]).providerCode, 999);
  const clarification = Object.assign(new Error('choose'), { code: 'NEEDS_CLARIFICATION', candidates: [{ thscode: '002594.SZ' }] });
  assert.deepEqual(classifyError(clarification).candidates, clarification.candidates);
  assert.equal(classifyError(clarification).code, 'NEEDS_CLARIFICATION');
});

test('MCP business rejection retains providerCode and parameter-conflict classification', () => {
  assert.throws(() => decodeResult({ structuredContent: { code: 1004, message: 'Parameter conflict: limit must not be set together with start/end', data: null } }), error => error.providerCode === 1004 && error.category === 'parameter_conflict');
});

test('transient read-only call retries once with distinct attempt events and budget hooks', async () => {
  let requests = 0;
  const events = [], attempts = [];
  const ctx = context(async () => { if (++requests === 1) throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }); return success(); });
  await callTool(ctx, income, { limit: 20 }, { onEvent: event => events.push(event), beforeTool: attempt => attempts.push(attempt) });
  assert.equal(requests, 2);
  assert.deepEqual(attempts.map(item => item.attempt), [1, 2]);
  assert.deepEqual(events.map(item => item.status), ['running', 'failed', 'running', 'complete']);
  assert.equal(events[1].category, 'network');
  assert.equal(events[1].retryScheduled, true);
  assert.equal(new Set(events.map(item => item.callId)).size, 1);
  assert.ok(events.every(item => item.serverVersion === '1.0'));
});

test('authentication and unknown failures do not retry', async () => {
  for (const failure of [Object.assign(new Error('bad key'), { status: 401 }), new Error('unknown failure')]) {
    let requests = 0;
    await assert.rejects(callTool(context(async () => { requests++; throw failure; }), income, {}));
    assert.equal(requests, 1);
  }
});

test('persistent transient failure is bounded to two requests', async () => {
  let requests = 0;
  await assert.rejects(callTool(context(async () => { requests++; throw Object.assign(new Error('Too many requests'), { status: 429 }); }), income, {}), error => error.category === 'rate_limit');
  assert.equal(requests, 2);
});

test('retry budget denial is preserved and prevents a second remote request', async () => {
  let requests = 0;
  const events = [];
  await assert.rejects(callTool(context(async () => { requests++; throw new Error('Request timed out'); }), income, {}, {
    onEvent: event => events.push(event),
    beforeTool: ({ attempt }) => { if (attempt === 2) throw Object.assign(new Error('budget spent'), { code: 'BUDGET_EXHAUSTED' }); },
  }), error => error.code === 'BUDGET_EXHAUSTED' && error.category === 'budget_exhausted');
  assert.equal(requests, 1);
  assert.equal(events.at(-1).category, 'budget_exhausted');
});

test('cancellation interrupts retry backoff and keeps runtime reason', async () => {
  const controller = new AbortController();
  let requests = 0;
  const pending = callTool(context(async () => { requests++; throw new Error('fetch failed'); }, controller.signal), income, {}, {
    onEvent: event => { if (event.retryScheduled) controller.abort(Object.assign(new Error('stop requested'), { code: 'CANCELLED' })); },
  });
  await assert.rejects(pending, error => error.code === 'CANCELLED' && error.category === 'cancelled');
  assert.equal(requests, 1);
});

test('first successful statement is checkpointed before second starts and survives later failure', async () => {
  const checkpoints = [], calls = [];
  const ctx = context(async request => {
    calls.push(request.params.name);
    if (request.params.name === cash) {
      assert.equal(checkpoints.length, 1);
      throw Object.assign(new Error('forbidden'), { status: 403 });
    }
    assert.equal(request.params.arguments.limit, 20);
    assert.equal('start' in request.params.arguments, false);
    assert.equal('end' in request.params.arguments, false);
    return success();
  });
  await assert.rejects(collectFinancialEvidence(['FUYAO-INCOME', 'FUYAO-CASH'], { scope, onEvidence: async (item, resolvedScope) => { await Promise.resolve(); checkpoints.push({ item, resolvedScope }); } }, ctx), error => {
    assert.equal(error.category, 'permission');
    assert.deepEqual(error.partialEvidence.map(item => item.id), ['FUYAO-INCOME']);
    assert.equal(error.resolvedScope.year, 2024);
    assert.equal(error.partialEvidence[0].scopeKey, checkpoints[0].resolvedScope.scopeKey);
    return true;
  });
  assert.deepEqual(calls, [income, cash]);
});

test('checkpoint save failure retains new evidence without repeating or starting next tool', async () => {
  let requests = 0;
  await assert.rejects(collectFinancialEvidence(['FUYAO-INCOME', 'FUYAO-CASH'], {
    scope, onEvidence: async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); },
  }, context(async () => { requests++; return success(); })), error => error.category === 'storage_error' && error.partialEvidence.length === 1);
  assert.equal(requests, 1);
});

test('budget abort after the first checkpoint retains that checkpoint and resolved scope', async () => {
  const controller = new AbortController();
  let requests = 0;
  const pending = collectFinancialEvidence(['FUYAO-INCOME', 'FUYAO-CASH'], {
    scope, signal: controller.signal,
    onEvidence: async () => controller.abort(Object.assign(new Error('round deadline'), { code: 'BUDGET_EXHAUSTED' })),
  }, context(async () => { requests++; return success(); }, controller.signal));
  await assert.rejects(pending, error => error.category === 'budget_exhausted' && error.partialEvidence.length === 1 && error.resolvedScope.year === 2024);
  assert.equal(requests, 1);
});

test('empty rows fail explicitly and no checkpoint is fabricated', async () => {
  let checkpoints = 0;
  await assert.rejects(collectFinancialEvidence(['FUYAO-INCOME'], { scope, onEvidence: async () => checkpoints++ }, context(async () => ({ structuredContent: { code: 0, data: { item: [] } } }))), error => error.category === 'empty_result' && error.partialEvidence.length === 0);
  assert.equal(checkpoints, 0);
});

test('abort reason classification preserves previously attached partial evidence', () => {
  const controller = new AbortController();
  controller.abort(Object.assign(new Error('budget expired'), { code: 'BUDGET_EXHAUSTED' }));
  const result = classifyError(Object.assign(new Error('SDK abort'), { partialEvidence: [{ id: 'kept' }], resolvedScope: scope }), { signal: controller.signal });
  assert.equal(result.category, 'budget_exhausted');
  assert.deepEqual(result.partialEvidence, [{ id: 'kept' }]);
  assert.deepEqual(result.resolvedScope, scope);
});
