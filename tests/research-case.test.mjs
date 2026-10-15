import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caseQuestionText, contextIntent, normalizeResearchCase } from '../lib/research-case.mjs';
import { createResearchMemoryStore } from '../lib/personal-research-memory.mjs';

const scope = { thscode: '000333.SZ', name: '美的集团', year: 2025, period: 'annual', yearsCount: 2, scopeKey: '000333.SZ:2025:annual' };
const split = '经营现金流入和流出分别怎样变化？';
const remaining = '剩余经营收支项目的具体构成和原因是什么？';
function sample(id = 'first', question = split) {
  return { id, revision: 1, status: 'complete', updatedAt: '2026-10-15T01:00:00.000Z', researchScope: scope,
    lastOperation: { kind: 'chat' }, messages: [{ id: `${id}-message`, from: 'user', revision: 1, text: '我想弄清经营现金变化以及回款质量' }],
    result: { revision: 1, researchScope: scope, questionUnderstanding: '经营现金变化与回款质量', focus: { source: 'ai', text: '本轮理解' },
      progress: { status: 'blocked', change: '只有现金净额', remainingQuestion: question, blocker: '缺分项' },
      analyses: [], keyCondition: { question: split, nextCheck: '取得现金流量表' } }, evidence: [] };
}
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'research-case-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: createResearchMemoryStore(directory) };
}
function addDocument(task) {
  const evidence = { id: 'DOC-CASH-hash', provider: 'disclosure-pdf', companyCode: scope.thscode, scopeKey: scope.scopeKey,
    documentId: 'hash', sourceUrl: 'https://static.cninfo.com.cn/test.PDF', locator: '合并现金流量表',
    rawFields: [2025, 2024].map(fiscal_year => ({ fiscal_year, operating_cash_inflow: 15, operating_cash_outflow: 5, sales_cash: 12, purchase_cash: 3, act_cash_flow_net: 10 })),
    citations: [{ field: 'operating_cash_inflow', page: 137, quote: '经营活动现金流入小计 15 15' }] };
  task.evidence = [evidence]; task.result.cashBridge = { evidenceId: evidence.id, arithmeticResidual: 0 };
  task.result.analyses = [{ question: split, answer: '已从原始表拆分流入和流出。', intent: 'question', support: 'not_applicable', evidenceIds: [evidence.id] }];
}

test('legacy normalized progress is authoritative, including empty completion', () => {
  const entry = { id: 'legacy', unresolved: { question: split }, researchProgress: { unresolvedQuestion: remaining }, source: {} };
  assert.equal(caseQuestionText(entry), remaining);
  assert.equal(normalizeResearchCase(entry).open_questions[0].question, remaining);
  entry.researchProgress.unresolvedQuestion = '';
  assert.equal(caseQuestionText(entry), ''); assert.deepEqual(normalizeResearchCase(entry).open_questions, []);
});

test('natural explicit question remains a sourced user question without a manual remember step', async t => {
  const { store } = await setup(t);
  const memory = await store.capture(sample());
  assert.equal(memory.focus.source, 'user');
  assert.equal(memory.focus.text, '我想弄清经营现金变化以及回款质量');
  assert.equal(memory.focus.sourceMessageId, 'first-message');
  assert.equal(memory.focus.semanticRole, 'research_question');
});

test('verified PDF resolves arithmetic split, persists exact references, leaves economic reasons open across restart', async t => {
  const { store, directory } = await setup(t);
  const first = await store.capture(sample());
  const next = sample('second', remaining); addDocument(next);
  next.memoryUsed = first; next.memoryPolicy = { captureFence: await store.capturePolicy(scope.thscode) };
  next.result.progress.status = 'advanced'; next.result.progress.change = '已经拆分收支贡献';
  const saved = await store.capture(next);
  assert.equal(saved.unresolved.question, remaining);
  assert.ok(saved.resolved_questions.some(item => item.question === split));
  assert.ok(saved.resolved_questions.some(item => item.boundary?.includes('不代表回款质量')));
  assert.deepEqual(saved.source.evidenceIds, ['DOC-CASH-hash']);
  const ref = saved.evidence_refs[0];
  assert.equal(ref.taskId, 'second'); assert.equal(ref.evidenceId, 'DOC-CASH-hash');
  assert.equal(ref.analysisRevision, 1); assert.deepEqual(ref.pages, [137]); assert.equal(ref.documentId, 'hash');
  assert.equal(saved.current_result.analyses[0].answer, '已从原始表拆分流入和流出。');
  const restored = await createResearchMemoryStore(directory).select({ companyCode: scope.thscode, input: scope.thscode });
  assert.equal(restored.unresolved.question, remaining); assert.deepEqual(restored.evidence_refs, saved.evidence_refs);
});

test('all answered does not fall back to a stale keyCondition; verified breakdown cannot reopen split', async t => {
  const { store } = await setup(t);
  const prior=await store.capture(sample());
  const next = sample('answered', ''); next.revision=2;next.result.revision=2;next.updatedAt='2026-10-15T02:00:00.000Z';next.result.progress.status = 'answered';next.result.resolvedQuestionIds=prior.open_questions.map(item=>item.id);
  next.evidence=[{id:'MCP-INCOME',companyCode:scope.thscode,scopeKey:scope.scopeKey}];
  const saved = await store.capture(next);
  assert.equal(saved.unresolved.question, ''); assert.equal(saved.open_questions.length, 0);
  const repeated = sample('repeat'); repeated.revision=3;repeated.result.revision=3;repeated.updatedAt='2026-10-15T03:00:00.000Z';addDocument(repeated); repeated.result.progress.status = 'advanced';
  repeated.result.keyCondition.question = remaining;
  assert.equal((await store.capture(repeated)).unresolved.question, remaining);
});

test('turn focus preserves prior long-term focus, open conditions, and refs; editing primary retains other questions', async t => {
  const { store } = await setup(t);
  const original = sample(); addDocument(original); original.result.progress.remainingQuestion = remaining;
  const first = await store.capture(original);
  const temporary = sample('turn', '行业竞争还有哪些变化？');
  temporary.contextIntent = { kind: 'turn', scope: 'turn' };
  temporary.focus = temporary.result.focus = { source: 'user', scope: 'turn', text: '这次只看竞争格局' };
  temporary.messages[0].text = '这次只看竞争格局';
  const saved = await store.capture(temporary);
  assert.equal(saved.focus.text, first.focus.text);
  assert.deepEqual(saved.open_questions.map(item => item.question), [remaining, '行业竞争还有哪些变化？']);
  assert.equal(saved.evidence_refs[0].documentId, 'hash');
  const edited = await store.update(saved.id, { expectedVersion: saved.version, unresolvedQuestion: '新的首要问题' });
  assert.deepEqual(edited.open_questions.map(item => item.question), ['新的首要问题', '行业竞争还有哪些变化？']);
});

test('intent separates turn, permanent, and attribution correction', () => {
  assert.equal(contextIntent('这次先不看现金流，只看竞争格局').kind, 'turn');
  assert.equal(contextIntent('以后不用这个关注点了，我现在主要研究竞争格局').kind, 'case');
  assert.equal(contextIntent('那个观点是我引用别人的，不是我的。').kind, 'attribution_correction');
  assert.equal(contextIntent('我想弄清利润是否得到现金支持').kind, 'none');
  assert.equal(contextIntent('这次怎么样？').kind, 'none');
  assert.equal(contextIntent('请接着本轮未完成的问题继续').kind, 'none');
});

test('attribution correction is versioned, sourced, and stale in-flight work cannot rewrite it', async t => {
  const { store } = await setup(t);
  const initial = sample();
  initial.lastOperation.kind = 'focus';
  initial.messages[0].text = '我认为经营现金足以支持扩张';
  initial.result.focus = { source: 'user', text: initial.messages[0].text };
  const first = await store.capture(initial);
  const running = sample('running'); running.memoryUsed = first;
  running.memoryPolicy = { captureFence: await store.capturePolicy(scope.thscode) };
  const corrected = await store.update(first.id, { expectedVersion: first.version, attributionCorrection: true },
    { sourceMessage: { id: 'correct-1', taskId: 'correction-task', revision: 2, text: '那个观点是我引用别人的，不是我的' } });
  assert.equal(corrected.focus.source, 'quoted'); assert.equal(corrected.focus.attribution, 'third_party');
  assert.equal(corrected.attributionCorrections[0].sourceMessage.id, 'correct-1');
  assert.equal(corrected.attribution_corrections[0].sourceMessage.id, 'correct-1');
  assert.ok(corrected.revoked_source_ids.includes('first-message'));
  assert.equal(await store.capture(running), null);
  const followup = sample('followup'); followup.messages[0].text = '这份资料有什么变化';
  assert.equal((await store.capture(followup)).focus.source, 'quoted');
});

test('attribution correction preserves a sourced research question rather than turning it into a third-party view', async t => {
  const { store } = await setup(t);
  const first = await store.capture(sample());
  const corrected = await store.update(first.id, { expectedVersion: first.version, attributionCorrection: true },
    { sourceMessage: { id: 'correction-question', taskId: 'same-research', revision: 2, text: '那个观点是我引用别人的，不是我的' } });
  assert.deepEqual(corrected.focus, first.focus);
  assert.equal(corrected.attributionCorrections[0].appliedToFocus, false);
  assert.equal(corrected.attributionCorrections[0].sourceMessage.id, 'correction-question');
  assert.ok(!(corrected.revoked_source_ids || []).includes('first-message'));
  assert.equal(corrected.version, first.version + 1);
  assert.equal(corrected.unresolved.question, first.unresolved.question);
});

test('delayed older research cannot be reported as a successful new save', async t => {
  const { store } = await setup(t);
  const fresh = sample(); fresh.result.createdAt = '2026-10-15T03:00:00.000Z';
  await store.capture(fresh);
  const old = sample('late'); old.result.createdAt = '2026-10-15T01:00:00.000Z';
  assert.equal(await store.capture(old), null);
});

test('answering a different question cannot silently erase an old unresolved question',async t=>{const {store}=await setup(t);const first=await store.capture(sample());const next=sample('another','');next.result.progress.status='answered';next.result.questionUnderstanding='只回答新问题';next.result.resolvedQuestionIds=[];const saved=await store.capture(next);assert.equal(saved.unresolved.question,first.unresolved.question);assert(!saved.resolved_questions.some(q=>q.question===first.unresolved.question));});
