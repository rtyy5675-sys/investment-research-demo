import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchContext } from '../lib/research-context.mjs';
const message = (n, text = `追问${n}`, kind = 'chat') => ({ id: `m${n}`, from: 'user', revision: n, text, kind });
const task = () => ({ id: 'test', revision: 20, input: '仅解释，不给买卖建议', messages: [message(1, '仅解释，不给买卖建议'), ...Array.from({ length: 19 }, (_, i) => message(i + 2))], evidence: [{ id: 'INCOME' }], focus: { source: 'user', text: '现金为何变少', version: 2 }, researchScope: { thscode: 'TEST', period: 'annual', year: 2024 }, result: { keyCondition: { question: '收入增长有无回款支持', nextCheck: '取得现金流明细' }, nextAction: { kind: 'external' } }, userView: { draft: { text: '我看好这家公司' } } });

test('早期原话超过八轮后仍保留，用户看法不进入研究指令', () => {
  const context = buildResearchContext(task());
  assert.equal(context.summary.originalGoal.text, '仅解释，不给买卖建议');
  assert.equal(context.summary.userInstructions.items[0].id, 'm1');
  assert.equal(context.recentQuestions.length, 8);
  assert.ok(!JSON.stringify(context).includes('我看好这家公司'));
  assert.equal(context.summary.explicitFocus.text, '现金为何变少');
  assert.equal(context.truncation.omittedInstructionCount, 0);
});

test('revise 之后不把旧范围旧约束重新注入', () => {
  const source = task(); source.messages.push(message(21, '改研究另一公司2023年', 'revise'), message(22, '只看经营现金流'));
  const context = buildResearchContext(source);
  assert.equal(context.summary.originalGoal.id, 'm21');
  assert.deepEqual(context.summary.userInstructions.items.map(item => item.id), ['m21', 'm22']);
  assert.ok(!JSON.stringify(context).includes('不给买卖建议'));
});

test('长输入按整体字符预算裁剪，保留原文定位与截断标记', () => {
  const source = task(); source.messages = Array.from({ length: 30 }, (_, i) => message(i + 1, '原始约束'.repeat(4000)));
  const context = buildResearchContext(source, { maxChars: 6000 });
  assert.ok(JSON.stringify(context).length <= 6000);
  assert.equal(context.truncation.charCount, JSON.stringify(context).length);
  assert.equal(context.truncation.occurred, true);
  assert.equal(context.summary.originalGoal.id, 'm1');
  assert.equal(context.summary.originalGoal.revision, 1);
  assert.ok(context.summary.originalGoal.sourceSpans);
  assert.ok(context.truncation.sourceLocator.selectedMessageIndexes.includes(0));
});

test('失败、证据和关键待查条件保留；AI 提炼关注不冒充用户明确关注', () => {
  const source = task(); source.focus.source = 'ai'; source.error = '网络超时'; source.status = 'partial'; source.toolRuns = [{ id: 'tool-1', revision: 20, tool: 'cash', status: 'failed', category: 'timeout', message: '超时' }];
  const context = buildResearchContext(source);
  assert.equal(context.summary.explicitFocus, null);
  assert.equal(context.summary.recovery.error.text, '网络超时');
  assert.equal(context.summary.recovery.failedTools[0].id, 'tool-1');
  assert.deepEqual(context.summary.evidenceIds, ['INCOME']);
  assert.equal(context.summary.unresolvedCondition.nextCheck.text, '取得现金流明细');
});

test('明确固定的早期消息优先保留，非法预算拒绝', () => {
  const source = task(); source.contextPinnedMessageIds = ['m7'];
  const context = buildResearchContext(source);
  assert.ok(context.summary.userInstructions.items.some(item => item.id === 'm7'));
  assert.throws(() => buildResearchContext(source, { maxChars: 500 }), RangeError);
  assert.throws(() => buildResearchContext(source, { maxRecentMessages: 0 }), RangeError);
});

test('失效记忆的旧分析不回注未决条件，用户原话与财务来源仍保留',()=>{
  const source=task();source.result.revision=19;source.contextInvalidatedThroughRevision=19;
  const context=buildResearchContext(source);
  assert.equal(context.summary.unresolvedCondition,null);assert.equal(context.summary.snapshotAnalysisRevision,null);
  assert.equal(context.summary.originalGoal.text,'仅解释，不给买卖建议');assert.deepEqual(context.summary.evidenceIds,['INCOME']);
});

import { evaluateResearch } from '../scripts/evaluate-research.mjs';
const definition = { id: 'test', mustAnswer: ['解释变化'], forbiddenInferences: ['预测收益'], followupCondition: '关键资料缺失', endCondition: '问题答到', expectedExceptions: ['失败保留旧结果'], userObservationQuestions: ['用户理解了什么？'] };
const evaluableTask = () => ({ id: 'task', revision: 1, status: 'complete', messages: [], evidence: [{ id: 'source' }], result: { revision: 1, summary: '局部回答', analyses: [{ claim: '待核实主张', answer: '引用有边界', support: 'insufficient', evidenceIds: ['source'] }], nextAction: { kind: 'none' } } });

test('评测结构通过时语义、异常实测、用户理解仍为 pending', () => {
  const report = evaluateResearch(evaluableTask(), definition);
  assert.equal(report.automatedStructure.status, 'pass');
  assert.equal(report.financialSemantics.status, 'pending');
  assert.equal(report.exceptionBehavior.status, 'pending');
  assert.equal(report.userUnderstanding.status, 'pending');
});

test('人工桌面评审不能冒充用户理解观察；引用不存在时结构失败', () => {
  const review = { caseId: 'test', reviewer: 'r', reviewedAt: '2026-10-15', observationType: 'desk_review', userUnderstanding: { items: [{ index: 0, status: 'pass', evidence: '我认为用户能懂' }] } };
  const source = evaluableTask(); source.result.analyses[0].evidenceIds = ['missing'];
  const report = evaluateResearch(source, definition, review);
  assert.equal(report.automatedStructure.status, 'fail');
  assert.equal(report.userUnderstanding.status, 'pending');
  review.observationType = 'observed_user_session'; review.sessionId = 'session1'; review.participantId = 'p1';
  assert.equal(evaluateResearch(evaluableTask(), definition, review).userUnderstanding.status, 'pass');
});
