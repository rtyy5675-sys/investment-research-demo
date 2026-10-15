import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const reports = [];
async function freePort() { const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port; }
async function withServer(settings, check) {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', new URL('../tests/fixtures/runtime-fetch-stub.mjs', import.meta.url).href, 'server.mjs'], { cwd: new URL('../', import.meta.url), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), MODEL_SETTINGS_FILE: `/tmp/jianwei-model-settings-fixture-${process.pid}-${port}.json`, MODEL_PROVIDER: 'openai-compatible', MODEL_API_KEY: 'synthetic-test-only', MODEL_NAME: 'synthetic-runtime-test', MODEL_BASE_URL: 'https://runtime-model.invalid', FUYAO_API_KEY: 'synthetic-test-only', ...settings }, stdio: ['ignore','pipe','pipe'] });
  let logs = ''; child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
  const request = async (path, body) => { const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) }); const result = await response.json(); if (!response.ok) throw Object.assign(new Error(JSON.stringify(result)), { status: response.status }); return result; };
  const poll = async (id, predicate) => { for (let attempt = 0; attempt < 100; attempt++) { const task = await request(`/api/tasks/${id}`); if (predicate(task)) return task; await wait(30); } throw new Error('Verification did not reach expected state'); };
  try {
    for (let i = 0; i < 100; i++) { try { await request('/api/health'); break; } catch { if (child.exitCode !== null) throw new Error(logs); if (i === 99) throw new Error(logs || 'server did not start'); await wait(30); } }
    await check(request, poll);
  } catch(error) { throw new Error(`${error.message}\n${logs}`, { cause: error }); }
  finally { child.kill('SIGTERM'); if (child.exitCode === null) await once(child, 'exit'); }
}

await withServer({ STUB_CASE: 'partial' }, async (request, poll) => {
  const created = await request('/api/tasks', { input: '[合成验收]虚构公司2024年度', isEvaluation: true, operationId: randomUUID() });
  const failed = await poll(created.id, task => task.status !== 'running');
  assert.equal(failed.errorInfo.category, 'permission'); assert.equal(failed.checkpoint.evidence.length, 1); assert.equal(failed.result, null);
  const resumed = await request(`/api/tasks/${created.id}/retry`, { expectedRevision: failed.revision, operationId: randomUUID() });
  const done = await poll(created.id, task => task.status === 'complete' && task.storage.status === 'saved');
  assert.equal(done.revision, resumed.revision); assert.equal(done.evidence.length, 2);
  assert.equal(done.toolRuns.filter(event => event.revision === done.revision && event.status === 'complete' && event.tool.includes('income_statements')).length, 0);
  assert.equal(done.toolRuns.filter(event => event.revision === done.revision && event.status === 'complete' && event.tool.includes('cash_flow_statements')).length, 1);
  const trace = await request(`/api/tasks/${done.id}/trace`); assert.ok(trace.modelCalls.every(call => call.taskId === done.id && Number.isInteger(call.revision) && call.status === 'success'));
  reports.push({ scenario: 'partial_tool_failure_then_resume', taskId: done.id, status: 'pass', evidenceReused: ['FUYAO-INCOME'], onlyMissingFinancialToolRetried: true, traceLinked: true });
});
await withServer({ STUB_DELAY_MS: '2000' }, async (request, poll) => {
  const created = await request('/api/tasks', { input: '[合成验收]用户停止', isEvaluation: true });
  await wait(50); await request(`/api/tasks/${created.id}/stop`, { expectedRevision: created.revision });
  const stopped = await poll(created.id, task => task.status === 'cancelled' && task.execution.endedAt && task.metrics.length > 0 && task.storage.status === 'saved');
  assert.equal(stopped.result, null); assert.equal(stopped.metrics[0].status, 'cancelled'); assert.equal(stopped.endReason, 'user_cancelled');
  await wait(50); assert.equal((await request(`/api/tasks/${created.id}`)).status, 'cancelled');
  reports.push({ scenario: 'stop_propagation_and_no_late_publish', taskId: stopped.id, status: 'pass', modelStatus: stopped.metrics[0].status });
});
await withServer({ STUB_DELAY_MS: '2000', RESEARCH_MAX_DURATION_MS: '100' }, async (request, poll) => {
  const created = await request('/api/tasks', { input: '[合成验收]总预算停止', isEvaluation: true });
  const ended = await poll(created.id, task => task.status === 'budget_exhausted' && task.storage.status === 'saved');
  assert.equal(ended.result, null); assert.equal(ended.errorInfo.category, 'budget_exhausted'); assert.equal(ended.execution.endReason, 'budget_exhausted');
  reports.push({ scenario: 'whole_run_deadline', taskId: ended.id, status: 'pass', resultPublished: false });
});
for (const [name, settings] of [['model_call_budget', { RESEARCH_MAX_MODEL_CALLS: '1' }], ['reported_token_budget', { RESEARCH_MAX_KNOWN_TOKENS: '10' }]]) {
  await withServer(settings, async (request, poll) => {
    const created = await request('/api/tasks', { input: '[合成验收]调用预算', isEvaluation: true });
    const ended = await poll(created.id, task => task.status === 'budget_exhausted' && task.storage.status === 'saved');
    assert.equal(ended.result, null); assert.equal(ended.execution.used.modelCalls, 1);
    reports.push({ scenario: name, taskId: ended.id, status: 'pass', resultPublished: false });
  });
}
await withServer({ STUB_CASE: 'storage' }, async (request, poll) => {
  const created = await request('/api/tasks', { input: '[合成验收]保存失败恢复', isEvaluation: true });
  const failedSave = await poll(created.id, task => task.status === 'complete' && task.storage.status === 'error');
  const count = failedSave.metrics.length;
  const saved = await request(`/api/tasks/${created.id}/persist`, {});
  assert.equal(saved.storage.status, 'saved'); assert.equal(saved.metrics.length, count);
  reports.push({ scenario: 'final_save_failure_and_retry_without_model_rerun', taskId: saved.id, status: 'pass', modelCallsUnchanged: true });
});
await withServer({ STUB_CASE: 'model_error' }, async (request, poll) => {
  const created = await request('/api/tasks', { input: '[合成验收]模型限流', isEvaluation: true });
  const failed = await poll(created.id, task => task.status === 'failed' && task.storage.status === 'saved');
  assert.equal(failed.errorInfo.category, 'rate_limit'); assert.equal(failed.metrics[0].status, 'failure'); assert.ok(failed.metrics[0].runId);
  reports.push({ scenario: 'model_failure_classification_and_trace', taskId: failed.id, status: 'pass', category: failed.errorInfo.category });
});
await withServer({ STUB_CASE: 'final_reject' }, async (request, poll) => {
  const created=await request('/api/tasks',{input:'[合成验收]草稿核验与上一版保留',isEvaluation:true});
  const first=await poll(created.id,t=>t.status==='complete'&&t.storage.status==='saved');
  await request(`/api/tasks/${first.id}/messages`,{message:'请继续解释变化',kind:'chat',bot:'main',operationId:randomUUID()});
  const rejected=await poll(first.id,t=>t.status==='partial'&&t.storage.status==='saved');
  assert.equal(rejected.result.revision,first.result.revision);assert.equal(rejected.answerReview.status,'rejected');assert.equal(rejected.errorInfo.category,'answer_quality');
  const stages=rejected.metrics.filter(m=>m.revision===rejected.revision).map(m=>m.role);
  assert(stages.indexOf('research-answer')<stages.indexOf('research-final-check'));assert.equal(stages.length,3);
  const trace=await request(`/api/tasks/${first.id}/trace`);assert.equal(trace.answerReview.status,'rejected');
  reports.push({scenario:'final_draft_review_rejects_without_overwriting_previous_answer',taskId:first.id,status:'pass',modelCalls:stages.length});
});
await withServer({STUB_CASE:'final_suggestion'},async(request,poll)=>{
  const created=await request('/api/tasks',{input:'[合成验收]表达建议不阻止发布',isEvaluation:true});
  const done=await poll(created.id,t=>t.status==='complete'&&t.storage.status==='saved');
  assert.equal(done.answerReview.status,'passed');assert.equal(done.answerReview.issues[0].severity,'suggestion');
  reports.push({scenario:'nonblocking_review_suggestion_preserves_valid_answer',taskId:done.id,status:'pass'});
});
await mkdir(new URL('../artifacts/runtime-verification/', import.meta.url), { recursive: true });
await writeFile(new URL('../artifacts/runtime-verification/http-checks.json', import.meta.url), JSON.stringify({ evaluatedAt: new Date().toISOString(), scope: 'Real local HTTP/server persistence; synthetic intercepted model and MCP results; no external calls or financial validation.', reports }, null, 2));
console.log(JSON.stringify({ passed: reports.length, reports }, null, 2));
