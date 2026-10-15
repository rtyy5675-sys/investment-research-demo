import test from 'node:test';
import assert from 'node:assert/strict';
import { newTask, beginRevision, publish, fail } from '../lib/state.mjs';
import { prepareFocus, recordView, closeResearch, validateDecisionResult } from '../lib/decision-state.mjs';

const scope = { name: '示例公司', thscode: '000001.SZ', period: 'annual', year: 2024, quarter: null, yearsCount: 2, scopeKey: '000001.SZ:annual:2024:2' };
const evidence = [{ id: 'FUYAO-INCOME', companyCode: scope.thscode, scopeKey: scope.scopeKey, rawFields: { revenue: 100 } }];
const available = [{ id: 'FUYAO-CASH', title: '现金流量表' }];
const result = () => ({
  questionUnderstanding: '收入下降对经营意味着什么', summary: '只能确认收入变化',
  analyses: [{ question: '收入是否下降', answer: '本期下降', support: 'supported', evidenceIds: ['FUYAO-INCOME'] }],
  keyCondition: { question: '变化能否持续', whyItMatters: '影响下一步理解', nextCheck: '核对现金流' },
  otherConditions: [], nextAction: { kind: 'query', toolId: 'FUYAO-CASH', question: '请补查同期间现金流', reason: '核实利润与现金流的关系' },
  scope: '2024年度', researchScope: structuredClone(scope),
  focus: { text: '收入变化', source: 'ai', version: 1, scopeKey: scope.scopeKey },
});

function completedTask() {
  const task = newTask('研究示例公司2024年收入'); task.dataSource = 'fuyao';
  const rev = beginRevision(task, { message: task.input });
  publish(task, rev, result(), structuredClone(evidence));
  task.researchScope = structuredClone(scope); task.focus = structuredClone(task.result.focus);
  return task;
}
function draft(task, overrides = {}) {
  recordView(task, { action: 'draft', text: '我暂时不能据此判断需求恶化。', analysisRevision: task.result.revision, expectedVersion: task.userView?.version || 0, operationId: 'draft-1', ...overrides });
}
function confirm(task, overrides = {}) {
  recordView(task, { action: 'confirm', expectedVersion: task.userView.version, operationId: 'confirm-1', ...overrides });
}
const conflict = fn => assert.throws(fn, error => error.status === 409);
const invalid = fn => assert.throws(fn, error => error.status === 400);

test('AI 发布不会创建用户观点；用户保存草稿也不会自动确认', () => {
  const task = completedTask(); assert.equal(task.userView, undefined);
  draft(task, { text: '  暂不作判断  ' });
  assert.equal(task.userView.draft.originalText, '暂不作判断');
  assert.equal(task.userView.draft.text, '暂不作判断');
  assert.equal(task.userView.draft.source, 'user');
  assert.equal(task.userView.draft.analysisRevision, task.result.revision);
  assert.equal(task.userView.draft.focusVersion, task.result.focus.version);
  assert.equal(task.userView.draft.scopeKey, scope.scopeKey);
  assert.deepEqual(task.userView.confirmations, []);
});

test('确认需用户已有草稿；确认保留用户原话和分析归属', () => {
  const task = completedTask(); invalid(() => recordView(task, { action: 'confirm', expectedVersion: 0 }));
  draft(task); const original = structuredClone(task.userView.draft); confirm(task);
  const saved = task.userView.confirmations[0];
  assert.equal(saved.originalText, original.originalText); assert.equal(saved.text, original.text);
  assert.equal(saved.analysisRevision, original.analysisRevision); assert.equal(saved.focusVersion, original.focusVersion);
  assert.equal(saved.scopeKey, original.scopeKey); assert.ok(saved.confirmedAt);
  assert.equal(task.userView.draft, null);
});

test('草稿和确认各自幂等，重试不会重复保存观点', () => {
  const task = completedTask(); draft(task); const first = structuredClone(task.userView);
  draft(task, { expectedVersion: 0 }); assert.deepEqual(task.userView, first);
  confirm(task); const saved = structuredClone(task.userView);
  confirm(task, { expectedVersion: 1 }); assert.deepEqual(task.userView, saved);
  assert.equal(task.userView.confirmations.length, 1);
});

test('过期观点版本与过期分析版本均拒绝写入，已有内容不被覆盖', () => {
  const task = completedTask(); draft(task); const saved = structuredClone(task.userView);
  conflict(() => draft(task, { operationId: 'another', expectedVersion: 0, text: '旧窗口内容' }));
  conflict(() => draft(task, { operationId: 'another', analysisRevision: 0 }));
  assert.deepEqual(task.userView, saved);
});

test('未取得分析、空白原话和未知操作不得生成用户记录', () => {
  const empty = newTask('问题'); invalid(() => recordView(empty, { action: 'draft', expectedVersion: 0, text: '我的话' }));
  const task = completedTask();
  invalid(() => draft(task, { text: '   ' }));
  invalid(() => recordView(task, { action: 'AI-auto-confirm', expectedVersion: 0 }));
  assert.equal(task.userView, undefined);
});

test('新分析发布与后续失败均不能修改已确认观点', () => {
  const task = completedTask(); draft(task); confirm(task); const userView = structuredClone(task.userView);
  const rev2 = beginRevision(task, { message: '补查', kind: 'followup' });
  publish(task, rev2, { ...result(), summary: '新增证据改变了分析' }, structuredClone(evidence));
  assert.deepEqual(task.userView, userView);
  const rev3 = beginRevision(task, { message: '新范围', kind: 'revise' }); fail(task, rev3, '查询失败');
  assert.deepEqual(task.userView, userView); assert.equal(task.status, 'partial');
  assert.equal(task.userView.confirmations[0].analysisRevision, 1);
});

test('运行中、旧分析草稿与失败后均不能被确认为当前观点', () => {
  const task = completedTask(); draft(task);
  const rev = beginRevision(task, { message: '新关注', kind: 'focus' });
  conflict(() => confirm(task));
  fail(task, rev, '查询失败'); conflict(() => confirm(task));
  publish(task, rev, result(), structuredClone(evidence)); conflict(() => confirm(task));
  assert.equal(task.userView.confirmations.length, 0); assert.ok(task.userView.draft);
});

test('同一分析版本内关注版本变化也使旧草稿无法确认', () => {
  const task = completedTask(); draft(task); task.result.focus.version++;
  conflict(() => confirm(task)); assert.equal(task.userView.confirmations.length, 0);
});

test('修改关注只生成用户来源新版本，不直接改写分析或证据', () => {
  const task = completedTask(); const snapshot = structuredClone(task);
  const focus = prepareFocus(task, { text: '  盈利能否持续  ', expectedRevision: task.revision, expectedFocusVersion: task.focus.version });
  assert.equal(focus.text, '盈利能否持续'); assert.equal(focus.source, 'user');
  assert.equal(focus.scope, 'turn');
  assert.equal(focus.version, 2); assert.equal(focus.scopeKey, scope.scopeKey);
  assert.deepEqual(task, snapshot);
});

test('关注修改拒绝旧版本、运行中与非扶摇任务，操作重试不创建新版本', () => {
  const task = completedTask(); const args = { text: '盈利持续性', expectedRevision: task.revision, expectedFocusVersion: task.focus.version };
  conflict(() => prepareFocus(task, { ...args, expectedRevision: 0 }));
  conflict(() => prepareFocus(task, { ...args, expectedFocusVersion: 0 }));
  task.status = 'running'; conflict(() => prepareFocus(task, args)); task.status = 'complete';
  task.dataSource = 'unsupported-source'; invalid(() => prepareFocus(task, args)); task.dataSource = 'fuyao';
  task.operations = { 'focus-1': { revision: task.revision } };
  assert.equal(prepareFocus(task, { ...args, operationId: 'focus-1' }), null);
});

test('关注切换后旧发布与旧失败不能覆盖新结果和用户记录', () => {
  const task = completedTask(); draft(task); confirm(task); const userView = structuredClone(task.userView);
  const oldRevision = task.revision;
  const nextFocus = prepareFocus(task, { text: '盈利持续性', expectedRevision: task.revision, expectedFocusVersion: task.focus.version });
  const newRevision = beginRevision(task, { message: nextFocus.text, kind: 'focus' }); task.focus = nextFocus;
  assert.equal(publish(task, oldRevision, { ...result(), summary: '旧返回' }, []), false);
  assert.equal(fail(task, oldRevision, '旧错误'), false); assert.equal(task.status, 'running');
  publish(task, newRevision, { ...result(), focus: nextFocus, summary: '新关注分析' }, evidence);
  assert.equal(task.result.summary, '新关注分析'); assert.equal(task.result.focus.version, 2);
  assert.deepEqual(task.userView, userView); assert.deepEqual(task.evidence, evidence);
});

test('用户可结束研究且不记录观点；关闭状态不代表观点确认', () => {
  const task = completedTask(); closeResearch(task, task.result.revision);
  assert.equal(task.researchClosure.analysisRevision, task.result.revision); assert.equal(task.userView, undefined);
  beginRevision(task, { message: '继续补查', kind: 'followup' }); assert.equal(task.researchClosure, null);
  conflict(() => closeResearch(task, 1));
});

test('支持分析必须引用已取得证据；未解决的问题允许没有证据', () => {
  validateDecisionResult(result(), evidence, available);
  const missing = result(); missing.analyses[0].evidenceIds = []; assert.throws(() => validateDecisionResult(missing, evidence, available), /缺少引用/);
  const unknown = result(); unknown.analyses[0].evidenceIds = ['NOT-FETCHED']; assert.throws(() => validateDecisionResult(unknown, evidence, available), /未取得/);
  const unresolved = result(); unresolved.analyses[0] = { question: '销量呢', answer: '尚无资料', support: 'unresolved', evidenceIds: [] };
  validateDecisionResult(unresolved, evidence, available);
  const empty = result(); empty.analyses = []; assert.throws(() => validateDecisionResult(empty, evidence, available), /没有回应/);
});

test('补查只能指向本轮未取得的可用工具，外部核查与结束不伪装工具调用', () => {
  const unavailable = result(); unavailable.nextAction.toolId = 'NEWS'; assert.throws(() => validateDecisionResult(unavailable, evidence, available), /不在当前可用/);
  const reused = result(); reused.nextAction.toolId = 'FUYAO-INCOME'; assert.throws(() => validateDecisionResult(reused, evidence, available), /不在当前可用/);
  const external = result(); external.nextAction = { kind: 'external', toolId: '', question: '查阅销量公告', reason: '当前工具不提供销量' }; validateDecisionResult(external, evidence, []);
  const done = result(); done.nextAction = { kind: 'none', toolId: '', question: '', reason: '问题已在现有范围内回答' }; validateDecisionResult(done, evidence, []);
});

test('可执行补查必须提供非空问题与取证理由，不能发布空按钮', () => {
  for (const field of ['question', 'reason']) {
    const malformed = result(); malformed.nextAction[field] = '   ';
    assert.throws(() => validateDecisionResult(malformed, evidence, available));
  }
});
