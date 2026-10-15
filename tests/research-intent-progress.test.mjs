import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDecisionResult } from '../lib/decision-state.mjs';
import { evidenceActivity, continuityContext, legacyEvidenceActivity } from '../lib/research-continuity.mjs';

const question = { id: 'user-1', text: '我想弄清利润增长是否有经营现金支持，以及哪些条件仍不能说明回款质量改善。' };
const evidence = [{ id: 'FUYAO-CASH', companyCode: '000001.SZ', queriedAt: '2026-10-15T00:00:00Z' }];
function result() { return { summary: '利润与净额的变化需要分开解释。', analyses: [{ question: '利润与经营现金流的变化怎样影响这个问题？', intent: 'question', claim: '', claimSource: { messageId: '', quote: '' }, support: 'not_applicable', answer: '没有分项就不能区分来源。', evidenceIds: ['FUYAO-CASH'] }], progress: { status: 'blocked', change: '已更新趋势描述，尚未解决收支拆分。', remainingQuestion: '流入、流出分别怎样变化？', blocker: '当前接口没有分项。' }, keyCondition: { question: '流入、流出变化', nextCheck: '合并现金流量表', whyItMatters: '区分收款与付款侧' }, nextAction: { kind: 'external', toolId: '', question: '核查原始现金流量表分项', reason: '区分收支变化' } }; }

test('疑问直接回答，不生成支持或反对用户的断言标签', () => {
  validateDecisionResult(result(), evidence, [], { currentQuestion: question });
  const invented = result(); invented.analyses[0].claim = '归母净利润增长，经营现金流支持增长'; invented.analyses[0].support = 'contradicts';
  assert.throws(() => validateDecisionResult(invented, evidence, [], { currentQuestion: question }), /待解疑问/);
});
test('不能将疑问删去是否后伪装成用户明确主张，转述也不能归给用户', () => {
  for (const input of [question.text, '有人认为经营现金流已经支持利润增长。']) {
    const draft = result(); Object.assign(draft.analyses[0], { intent: 'user_claim', claim: input, claimSource: { messageId: question.id, quote: input }, support: 'contradicts' });
    assert.throws(() => validateDecisionResult(draft, evidence, [], { currentQuestion: { ...question, text: input } }), /疑问或转述/);
    draft.analyses[0].claim = '经营现金流支持利润增长'; draft.analyses[0].claimSource.quote = draft.analyses[0].claim;
    assert.throws(() => validateDecisionResult(draft, evidence, [], { currentQuestion: { ...question, text: input } }));
  }
});
test('明确原话断言和 AI 假设采用不同的来源合同', () => {
  const input = { id: 'user-2', text: '经营现金流支持了利润增长。' };
  const draft = result(); Object.assign(draft.analyses[0], { intent: 'user_claim', claim: input.text, claimSource: { messageId: input.id, quote: input.text }, support: 'contradicts' });
  validateDecisionResult(draft, evidence, [], { currentQuestion: input });
  draft.analyses[0].intent = 'system_hypothesis';
  assert.throws(() => validateDecisionResult(draft, evidence, [], { currentQuestion: input }), /冒充用户/);
  draft.analyses[0].claimSource = { messageId: '', quote: '' };
  validateDecisionResult(draft, evidence, [], { currentQuestion: question });
});
test('新增、复用、检查点及当前轮查询计数分别记录；失败重试计次，握手不计', () => {
  const task = { toolRuns: [{ revision: 1, tool: 'get_a_share_financials_cash_flow_statements', callId: 'old', attempt: 1, status: 'complete' }, ...['running','complete'].map(status => ({ revision: 2, tool: 'mcp/initialize', callId: 'handshake', attempt: 1, status })), ...['running','failed'].map(status => ({ revision: 2, tool: 'get_a_share_financials_cash_flow_statements', callId: 'new', attempt: 1, status })), ...['running','complete'].map(status => ({ revision: 2, tool: 'get_a_share_financials_cash_flow_statements', callId: 'new', attempt: 2, status }))] };
  const activity = evidenceActivity(task, 2, evidence, { fetchedIds: ['FUYAO-CASH'] });
  assert.equal(activity.financialAttempts, 2); assert.equal(activity.dataToolAttempts, 2); assert.equal(activity.sources[0].origin, 'fetched');
  const reused = evidenceActivity(task, 3, evidence, { reusedIds: ['FUYAO-CASH'] });
  assert.equal(reused.financialAttempts, 0); assert.equal(reused.sources[0].origin, 'reused');
  const checkpoint = evidenceActivity(task, 3, evidence, { checkpointIds: ['FUYAO-CASH'] });
  assert.equal(checkpoint.sources[0].origin, 'checkpoint');
  assert.equal(legacyEvidenceActivity({}, { revision: 1 }, evidence), null);
});
test('延续的现金流分项问题未解时必须明确阻塞，不把重复查询或已保存视为完成', () => {
  const memory = { unresolved: { question: '经营现金流入、流出怎样变化？' } };
  const context = continuityContext({ task: {}, memory, currentQuestion: { text: '请接着上次未解决的问题继续。' }, kind: 'chat', evidence, activity: {} });
  assert.equal(context.blocker.code, 'cash_breakdown_not_exposed');
  validateDecisionResult(result(), evidence, [], { currentQuestion: question, continuity: context });
  for (const status of ['advanced','answered']) { const draft = result(); draft.progress.status = status; assert.throws(() => validateDecisionResult(draft, evidence, [], { currentQuestion: question, continuity: context }), /能力阻塞/); }
});
test('新公司、新关注不继承旧公司未决条件；不能靠旧记忆制造本轮任务', () => {
  const task = { result: { researchScope: { thscode: '000002.SZ' }, keyCondition: { question: '现金流入流出变化' } } };
  const options = { task, evidence, currentQuestion: { text: '研究另一家公司。' }, kind: 'chat' };
  assert.equal(continuityContext(options).priorQuestion, '');
  assert.equal(continuityContext({ ...options, kind: 'focus', memory: { unresolved: { question: '旧问题' } } }).priorQuestion, '');
  assert.equal(continuityContext({ ...options, currentQuestion: { text: '不用沿用旧关注，只看费用。' }, memory: { unresolved: { question: '旧问题' } } }).priorQuestion, '');
});
