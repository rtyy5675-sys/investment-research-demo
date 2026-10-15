import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createResearchMemoryStore } from '../lib/personal-research-memory.mjs';

function task(overrides = {}) {
  const scope = { thscode: '900001.SZ', name: '示例公司甲', period: 'annual', year: 2024, yearsCount: 2, scopeKey: '2024-annual' };
  return {
    id: 'task-1', status: 'complete', revision: 2, updatedAt: '2026-10-15T00:00:00.000Z', researchScope: scope,
    result: { revision: 2, researchScope: scope, questionUnderstanding: '现金能否支持扩张', focus: { text: '现金能否支持扩张', source: 'ai' },
      analyses: [{ question: '利润与现金是否同步？', answer: '经营现金流为 999 亿元', claim: '我看好', support: 'supports' }],
      keyCondition: { question: '扩张资金是否来自经营？', nextCheck: '核查资本投入明细' }, summary: '不要记住这份财务答案' },
    ...overrides,
  };
}
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'personal-research-memory-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: createResearchMemoryStore(directory, { now: () => '2026-10-15T01:00:00.000Z' }) };
}

test('capture stores provenance and research questions, not financial answers or user views; restart and copies work', async t => {
  const { directory, store } = await setup(t);
  const sample = task();
  Object.defineProperty(sample, 'userView', { get() { throw new Error('must never read userView'); } });
  const saved = await store.capture(sample);
  assert.equal(saved.focus.source, 'ai');
  assert.equal(saved.focus.semanticRole, 'research_question');
  assert.equal(saved.source.analysisRevision, 2);
  assert.equal(saved.source.scope.year, 2024);
  assert.deepEqual(saved.progress, ['利润与现金是否同步？']);
  const file = await readFile(join(directory, 'personal-research-memory.json'), 'utf8');
  assert.ok(!file.includes('999') && !file.includes('我看好') && !file.includes('不要记住'));
  saved.focus.text = 'external corruption';
  const restored = createResearchMemoryStore(directory);
  assert.equal((await restored.get(saved.id)).focus.text, '现金能否支持扩张');
  const list = await restored.list(); list[0].unresolved.question = 'corruption';
  assert.equal((await restored.get(saved.id)).unresolved.question, '扩张资金是否来自经营？');
});

test('only completed current scoped A-share results can be captured', async t => {
  const { store } = await setup(t);
  for (const sample of [task({ status: 'partial' }), task({ revision: 3 }), task({ isEvaluation: true }), task({ memoryPolicy: { enabled: false } }), task({ researchScope: { ...task().researchScope, year: 2023 } })]) assert.equal(await store.capture(sample), null);
  for (const patch of [{ thscode: 'AAPL' }, { period: 'quarterly', quarter: 5 }, { year: null }]) {
    const sample = task(); sample.result.researchScope = { ...sample.result.researchScope, ...patch };
    assert.equal(await store.capture(sample), null);
  }
  assert.deepEqual(await store.list(), []);
});

test('matching uses company full name or exact code, preserves provenance, rejects ambiguity and scope mismatch', async t => {
  const { store } = await setup(t);
  const a = await store.capture(task());
  const second = task({ id: 'task-2' });
  second.result.researchScope = second.researchScope = { ...second.researchScope, thscode: '900002.SZ', name: '示例公司乙' };
  const b = await store.capture(second);
  for (const input of ['示例公司甲这次如何', '看看900001', '900001.SZ如何']) assert.equal((await store.select({ input })).id, a.id);
  for (const input of ['示例甲这次如何', '19000011', '900001.SH', 'A900001', '示例公司甲和示例公司乙']) assert.equal(await store.select({ input }), null);
  assert.equal(await store.select({ input: '示例公司甲', companyCode: '900002.SZ' }), null);
  assert.equal(await store.select({ selectedMemoryId: a.id, companyCode: '900002.SZ' }), null);
  assert.equal((await store.select({ selectedMemoryId: b.id })).source.taskId, 'task-2');
  assert.equal(await store.select({ input: '示例公司甲', excludeTaskId: 'task-1' }), null);
  assert.equal(await store.select({ input: '示例公司甲', enabled: false }), null);
});

test('capture is idempotent; explicit source and manual focus survive later AI captures', async t => {
  const { store } = await setup(t);
  const sample = task(); sample.result.focus = { text: '我关注扩张资金来源', source: 'user', sourceMessageId: 'message-1' };
  const initial = await store.capture(sample);
  assert.equal(initial.focus.text, '我关注扩张资金来源');
  assert.equal(initial.focus.source, 'user'); assert.equal(initial.focus.sourceMessageId, 'message-1');
  assert.equal(initial.focus.provenance.kind, 'user_message'); assert.equal(initial.focus.provenance.taskId, sample.id);
  assert.equal(initial.focus.provenance.scope.year, 2024);
  assert.deepEqual(await store.capture(sample), initial);
  const updated = await store.update(initial.id, { expectedVersion: 1, focusText: '现在关注行业竞争', unresolvedQuestion: '', unresolvedNextCheck: '查竞争格局' });
  assert.deepEqual(updated.focus, { text: '现在关注行业竞争', source: 'user', updatedBy: 'memory_editor', updatedAt: '2026-10-15T01:00:00.000Z', provenance: {
    kind: 'memory_editor', taskId: null, scope: { thscode: '900001.SZ', name: '示例公司甲' }, updatedAt: '2026-10-15T01:00:00.000Z',
  } });
  const newer = task({ revision: 3 }); newer.result.revision = 3;
  const captured = await store.capture(newer);
  assert.equal(captured.focus.text, '现在关注行业竞争');
  assert.equal(captured.focus.source, 'user');
  assert.equal((await store.list()).length, 1);
  assert.equal(captured.version, 3);
  await assert.rejects(store.update(initial.id, { expectedVersion: 1, focusText: 'stale' }), error => error.status === 409);
});

test('disabled memories reject capture without changing content/version; deletion cannot resurrect', async t => {
  const { directory, store } = await setup(t);
  const initial = await store.capture(task());
  const disabled = await store.update(initial.id, { expectedVersion: 1, disabled: true });
  assert.equal((await store.list())[0].disabled, true);
  assert.equal(await store.select({ selectedMemoryId: initial.id }), null);
  assert.equal((await store.get(initial.id)).disabled, true);
  const before=await readFile(join(directory,'personal-research-memory.json'),'utf8');
  assert.equal(await store.capture(task()),null);
  const newer = task({ revision: 3 }); newer.result.revision = 3;
  assert.equal(await store.capture(newer),null);
  assert.equal(await readFile(join(directory,'personal-research-memory.json'),'utf8'),before);
  assert.deepEqual(await store.get(initial.id),disabled);
  const active = await store.update(initial.id, { expectedVersion: disabled.version, disabled: false });
  await assert.rejects(store.remove(initial.id, { expectedVersion: disabled.version }), error => error.status === 409);
  await store.remove(initial.id, { expectedVersion: active.version });
  assert.equal(await store.get(initial.id), null);
  assert.equal(await store.select({ input: '示例公司甲' }), null);
  assert.equal(await store.capture(task()), null);
});

test('pause survives restart and a task from the paused interval cannot backfill after re-enabling',async t=>{
  const {directory,store}=await setup(t);
  const initial=await store.capture(task());
  const disabled=await store.update(initial.id,{expectedVersion:initial.version,disabled:true});
  const restarted=createResearchMemoryStore(directory);
  const fence=await restarted.capturePolicy(initial.companyCode);
  assert.deepEqual(fence,{companyCode:initial.companyCode,memoryId:initial.id,version:disabled.version,enabled:false});
  assert.equal(await restarted.select({companyCode:initial.companyCode,input:'示例公司甲'}),null);
  const pausedTask=task({id:'paused-task',memoryPolicy:{captureFence:fence}});
  assert.equal(await restarted.capture(pausedTask),null);
  const active=await restarted.update(initial.id,{expectedVersion:disabled.version,disabled:false});
  assert.deepEqual(active.unresolved,initial.unresolved);assert.deepEqual(active.progress,initial.progress);
  const before=await readFile(join(directory,'personal-research-memory.json'),'utf8');
  assert.equal(await restarted.capture(pausedTask),null);
  assert.equal(await readFile(join(directory,'personal-research-memory.json'),'utf8'),before);
  const fresh=task({id:'fresh-task',memoryPolicy:{captureFence:await restarted.capturePolicy(initial.companyCode)}});
  assert.equal((await restarted.capture(fresh)).version,active.version+1);
});

test('an in-flight write fence becomes stale after a pause/resume cycle, even without recalled text',async t=>{
  const {directory,store}=await setup(t);
  const initial=await store.capture(task());
  const running=task({id:'before-pause',memoryPolicy:{captureFence:await store.capturePolicy(initial.companyCode)}});
  const disabled=await store.update(initial.id,{expectedVersion:initial.version,disabled:true});
  const active=await store.update(initial.id,{expectedVersion:disabled.version,disabled:false});
  const before=await readFile(join(directory,'personal-research-memory.json'),'utf8');
  assert.equal(await store.capture(running),null);
  assert.equal(await readFile(join(directory,'personal-research-memory.json'),'utf8'),before);
  assert.equal((await store.get(initial.id)).version,active.version);
});

test('captured user focus persists across AI interpretation and a new explicit focus replaces it', async t => {
  const { store } = await setup(t);
  const first = task();
  first.result.focus = { text: '我关注现金', source: 'user' };
  first.messages = [{ id: 'focus-message', from: 'user', text: '我关注现金' }];
  const a = await store.capture(first);
  assert.equal(a.focus.sourceMessageId, 'focus-message');
  const second = task({ revision: 3 }); second.result.revision = 3;
  assert.equal((await store.capture(second)).focus.text, '我关注现金');
  const third = task({ revision: 4 }); third.result.revision = 4;
  third.result.focus = { text: '现在关注竞争', source: 'user' };
  assert.equal((await store.capture(third)).focus.text, '现在关注竞争');
});

test('queued independent captures preserve both entries and simultaneous CAS edits cannot both win', async t => {
  const { store } = await setup(t);
  const a = task(); const b = task({ id: 'task-2' });
  b.result.researchScope = b.researchScope = { ...b.researchScope, name: '示例公司乙', thscode: '900002.SZ' };
  const [first] = await Promise.all([store.capture(a), store.capture(b)]);
  assert.equal((await store.list()).length, 2);
  const result = await Promise.allSettled([store.update(first.id, { expectedVersion: 1, focusText: 'one' }), store.update(first.id, { expectedVersion: 1, focusText: 'two' })]);
  assert.deepEqual(result.map(item => item.status), ['fulfilled', 'rejected']);
  assert.equal(result[1].reason.status, 409);
});

test('owners are isolated and no old scope is promoted into current facts', async t => {
  const { directory, store } = await setup(t);
  const initial = await store.capture(task());
  const other = createResearchMemoryStore(directory, { ownerId: 'other' });
  assert.deepEqual(await other.list(), []);
  assert.equal(await other.get(initial.id), null);
  assert.equal(await other.select({ input: '示例公司甲' }), null);
  await assert.rejects(other.update(initial.id, { expectedVersion: 1, focusText: 'x' }), error => error.status === 404);
  const selected = await store.select({ input: '示例公司甲最新情况' });
  assert.equal(selected.source.scope.year, 2024);
  assert.equal(selected.year, undefined);
  assert.equal(selected.evidence, undefined);
});

test('separate instances share a disk queue and cannot lose another owner write', async t => {
  const { directory, store } = await setup(t);
  const other = createResearchMemoryStore(directory, { ownerId: 'other' });
  await Promise.all([store.capture(task()), other.capture(task())]);
  assert.equal((await store.list()).length, 1);
  assert.equal((await other.list()).length, 1);
});

test('capture rejects stale memory snapshots, blocked revisions, and deletion races', async t => {
  const { store } = await setup(t);
  const first = await store.capture(task());
  const running = task({ id: 'task-next', memoryUsed: first });
  running.result.focus = { text: '运行中的旧关注', source: 'user' };
  const changed = await store.update(first.id, { expectedVersion: 1, focusText: '运行期间的新关注' });
  assert.equal(await store.capture(running), null);
  assert.equal((await store.get(first.id)).focus.text, '运行期间的新关注');
  running.memoryUsed = changed;
  running.memoryPolicy = { captureBlockedRevision: 2 };
  assert.equal(await store.capture(running), null);
  delete running.memoryPolicy;
  await store.remove(first.id, { expectedVersion: changed.version });
  assert.equal(await store.capture(running), null);
  assert.deepEqual(await store.list(), []);
});

test('failed atomic update does not alter readable state and queue recovers', async t => {
  const { directory, store } = await setup(t);
  const initial = await store.capture(task());
  const file = join(directory, 'personal-research-memory.json');
  const original = await readFile(file, 'utf8');
  await chmod(directory, 0o500);
  try {
    await assert.rejects(store.update(initial.id, { expectedVersion: 1, focusText: 'must not commit' }));
    assert.equal(await readFile(file, 'utf8'), original);
    assert.deepEqual(await store.get(initial.id), initial);
  } finally { await chmod(directory, 0o700); }
  assert.deepEqual(await store.get(initial.id), initial);
  assert.equal((await store.update(initial.id, { expectedVersion: 1, focusText: 'recovered' })).focus.text, 'recovered');
});

test('普通追问携带的旧用户关注不是新表达，不能盖回记忆编辑', async t => {
  const { store } = await setup(t);
  const original = await store.capture(task());
  await store.update(original.id, { expectedVersion: original.version, focusText: '更正后的现金关注' });
  const followup = task({ id: 'task-followup', lastOperation: { kind: 'chat' } });
  followup.result.focus = { source: 'user', text: '历史遗留的旧关注' };
  assert.equal((await store.capture(followup)).focus.text, '更正后的现金关注');
  const explicit = task({ id: 'task-explicit', lastOperation: { kind: 'focus' } });
  explicit.result.focus = { source: 'user', text: '本轮真正明确的新关注' };
  assert.equal((await store.capture(explicit)).focus.text, '本轮真正明确的新关注');
});

test('原任务更高revision以及服务重启不能复活已删记忆，新任务可建立全新上下文', async t => {
  const { directory, store } = await setup(t);
  const first = await store.capture(task());
  await store.remove(first.id, { expectedVersion: first.version });
  const old = task({ revision: 3 }); old.result.revision = 3;
  assert.equal(await store.capture(old), null);
  const restarted = createResearchMemoryStore(directory);
  assert.equal(await restarted.capture(old), null);
  const fresh = await restarted.capture(task({ id: 'new-task' }));
  assert.notEqual(fresh.id, first.id);
  assert.equal(await restarted.capture(old), null);
  assert.equal((await restarted.get(fresh.id)).source.taskId, 'new-task');
});

test('旧用户关注的原始来源跨新任务和新报告期保留，当前研究进度独立更新', async t => {
  const { store } = await setup(t);
  const original = task(); original.result.focus = { source: 'user', text: '2024年扩张是否靠经营现金', sourceMessageId: 'message-2024' };
  const first = await store.capture(original);
  const next = task({ id: 'task-2025' });
  next.researchScope = next.result.researchScope = { ...next.researchScope, year: 2025, scopeKey: '2025-annual' };
  const latest = await store.capture(next);
  assert.equal(latest.focus.text, first.focus.text); assert.deepEqual(latest.focus.provenance, first.focus.provenance);
  assert.equal(latest.focus.provenance.taskId, original.id); assert.equal(latest.focus.provenance.messageId, 'message-2024');
  assert.equal(latest.focus.provenance.scope.year, 2024);
  assert.equal(latest.source.scope.year, 2025); assert.equal(latest.source.taskId, next.id);
});

test('AI关注与编辑操作有独立来源，编辑不冒充原始聊天或报告期间', async t => {
  const { store } = await setup(t);
  const first = await store.capture(task());
  assert.equal(first.focus.provenance.kind, 'ai_analysis'); assert.equal(first.focus.provenance.taskId, 'task-1');
  const edited = await store.update(first.id, { expectedVersion: first.version, focusText: '现在关注现金回收' });
  assert.equal(edited.focus.provenance.kind, 'memory_editor'); assert.equal(edited.focus.provenance.taskId, null);
  assert.equal(edited.focus.provenance.scope.year, undefined); assert.equal(edited.focus.provenance.messageId, undefined);
  const latest = await store.capture(task({ id: 'next-task' }));
  assert.deepEqual(latest.focus.provenance, edited.focus.provenance);
});

test('旧schema用户关注缺少字段来源时标未知，不伪造为最新任务的表达', async t => {
  const { directory, store } = await setup(t);
  const original = task(); original.result.focus = { source: 'user', text: '旧版本关注' };
  await store.capture(original);
  const file = join(directory, 'personal-research-memory.json');
  const data = JSON.parse(await readFile(file, 'utf8')); delete data.entries[0].focus.provenance;
  await writeFile(file, JSON.stringify(data));
  const latest = await store.capture(task({ id: 'latest-task' }));
  assert.equal(latest.focus.text, '旧版本关注'); assert.equal(latest.focus.provenance.kind, 'legacy_unknown');
  assert.equal(latest.focus.provenance.taskId, null); assert.equal(latest.focus.provenance.scope, null);
  assert.equal(latest.source.taskId, 'latest-task');
});
