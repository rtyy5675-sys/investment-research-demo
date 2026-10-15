// Real, bounded local acceptance. Reads the configured financial service/model;
// evaluation tasks cannot write personal memory. Does not trade or predict prices.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
const base = 'http://127.0.0.1:8791';
const request = async (path, body) => {
  const response = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
};
const memoryFile = new URL('../artifacts/personal-memory/personal-research-memory.json', import.meta.url);
const digest = async () => createHash('sha256').update(await readFile(memoryFile)).digest('hex');
const before = await digest();
async function done(id) {
  for (let i = 0; i < 250; i++) {
    const task = await request(`/api/tasks/${id}`);
    if (task.status !== 'running') {
      assert.equal(task.status, 'complete', task.error || task.clarification);
      return task;
    }
    await wait(1000);
  }
  throw new Error('Acceptance timed out');
}
function check(task) {
  assert.equal(task.isEvaluation, true);
  assert.equal(task.userView, undefined);
  assert.equal(task.result.contractVersion, 'intent-progress-v1');
  assert.equal(task.result.progress.status, 'blocked');
  assert.ok(task.result.continuation.priorQuestion);
  assert.equal(task.result.nextAction.kind, 'external');
  assert.ok(task.result.analyses.every(item => item.intent === 'question' && !item.claim && item.support === 'not_applicable'));
  assert.equal(task.answerReview.status, 'passed');
  return { taskId: task.id, revision: task.revision, summary: task.result.summary, progress: task.result.progress, analyses: task.result.analyses, evidenceActivity: task.result.evidenceActivity, review: task.answerReview, memoryStatus: task.memoryStatus, modelRunIds: task.metrics.map(item => item.runId) };
}
const started = await request('/api/tasks', { input: '【语义修复验收，不代表真实投资偏好】贵州茅台（600519.SH）最新年报这次怎么样？请接着上次未弄清的现金流入、流出问题继续。', dataSource: 'fuyao', mode: 'single', isEvaluation: true, autoSupplement: false, operationId: randomUUID() });
console.log(JSON.stringify({ createdTaskId: started.id }));
const first = await done(started.id);
const firstReport = check(first);
assert.ok(first.result.evidenceActivity.fetchedIds.length > 0);
assert.ok(first.result.evidenceActivity.financialAttempts > 0);
await request(`/api/tasks/${first.id}/messages`, { message: '请接着上次的现金流入、流出问题继续核查，并说明这轮是否获得了新证据。', kind: 'chat', bot: 'main', operationId: randomUUID() });
const next = await done(first.id);
const nextReport = check(next);
assert.ok(next.result.evidenceActivity.reusedIds.length > 0);
const unchanged = before === await digest();
assert.ok(unchanged, 'Evaluation must not write personal memory');
const report = { checkedAt: new Date().toISOString(), scope: 'One real company, fresh reads and same-scope continuation. Shows accurate blocking, not a solved cash-breakdown task or long-term value proof.', personalMemoryUnchanged: unchanged, first: firstReport, continuation: nextReport };
await writeFile(new URL('../docs/evidence/intent-progress-real-checks.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: 'pass', taskId: next.id, revisions: [first.revision, next.revision], firstActivity: firstReport.evidenceActivity, continuationActivity: nextReport.evidenceActivity, personalMemoryUnchanged: unchanged }));
