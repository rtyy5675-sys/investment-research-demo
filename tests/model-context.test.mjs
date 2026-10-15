import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareResearchData } from '../lib/model-context.mjs';

const context = () => ({ summary: { taskId: 'context-test', originalGoal: { id: 'm1', text: '解释现金支持' }, userInstructions: { items: Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, messageIndex: i, text: `问题${i}` })) } }, recentQuestions: [{ id: 'm7', text: '本次问题' }], truncation: { occurred: false, omittedInstructionCount: 0 } });

test('预算充足时数据字段不变，字符统计含审计元数据且不修改原始输入', () => {
  const data = { currentQuestion: { id: 'latest', text: '最新问题' }, arbitrary: ['未识别字段保留'], currentFocus: { text: '现金流' } };
  const snapshot = structuredClone(data);
  const output = prepareResearchData('plan', data);
  assert.deepEqual(data, snapshot);
  assert.deepEqual(output.currentQuestion, data.currentQuestion);
  assert.deepEqual(output.arbitrary, data.arbitrary);
  assert.equal(output.contextPreparation.inputBlocks.currentQuestion, JSON.stringify(data.currentQuestion).length);
  assert.equal(output.contextPreparation.outputChars, JSON.stringify(output).length);
  assert.deepEqual(output.contextPreparation.transformations, []);
});

test('超预算首先移除与账本重复的questionHistory，保留完整最新问题和关注', () => {
  const question = '开头'.repeat(500) + '中段唯一约束：只比较半年报累计值' + '结尾'.repeat(500);
  const data = { currentQuestion: { id: 'm9', text: question }, currentFocus: { text: '用户明确关注' }, questionHistory: ['重复内容'.repeat(5000)], taskContext: context() };
  const output = prepareResearchData('plan', data, { maxChars: 6000 });
  assert.equal(output.questionHistory, undefined);
  assert.equal(output.currentQuestion.text, question);
  assert.deepEqual(output.currentFocus, data.currentFocus);
  assert.equal(output.contextPreparation.transformations[0].action, 'remove_duplicate_history');
  assert.ok(output.contextPreparation.outputChars <= 6000);
  assert.equal(output.contextPreparation.outputChars, JSON.stringify(output).length);
});

test('上版巨型答案改为问题主张未决项索引，不把旧答案再次充当证据', () => {
  const data = { currentQuestion: '这次怎么样', scope: { thscode: 'X', scopeKey: 'same' }, previousResult: { revision: 3, researchScope: { thscode: 'X', scopeKey: 'same' }, summary: '旧答案'.repeat(10000), analyses: [{ question: '增长有无现金支持', claim: '待核实', answer: '旧解释'.repeat(10000), support: 'insufficient', evidenceIds: ['CASH'] }], keyCondition: { question: '回款结构', nextCheck: '查明细' } } };
  const output = prepareResearchData('answer', data, { maxChars: 5000 });
  assert.equal(output.previousResult.summary, undefined);
  assert.equal(output.previousResult.analyses[0].answer, undefined);
  assert.equal(output.previousResult.analyses[0].claim, '待核实');
  assert.deepEqual(output.previousResult.keyCondition, data.previousResult.keyCondition);
  assert.equal(output.previousResult.sourceLocator.revision, 3);
  assert.equal(data.previousResult.analyses[0].answer.length, 30000);
});

test('规范财务证据保留全部数值与字段、期间单位和定位，未知格式不删除正文', () => {
  const evidence = { id: 'FUYAO-CASH', provider: 'fuyao-mcp', companyCode: 'X', companyName: '演示公司', scopeKey: '2024', unit: 'CNY元', period: '2024年全年', locator: 'tool/query', sourceUrl: 'https://example.invalid/source', requestId: 'req1', text: '2024年：经营活动现金流量净额（act_cash_flow_net）=123456789元。' + '重复显示'.repeat(5000), rawFields: [{ thscode: 'X', fiscal_year: 2024, act_cash_flow_net: 123456789, currency: 'CNY' }] };
  const output = prepareResearchData('check', { currentQuestion: '比较现金流', evidence: [evidence] }, { maxChars: 5000 });
  assert.deepEqual(output.evidence[0].rawFields, evidence.rawFields);
  assert.equal(output.evidence[0].fieldDescriptions.act_cash_flow_net, '经营活动现金流量净额');
  for (const key of ['unit', 'period', 'scopeKey', 'locator', 'sourceUrl', 'requestId', 'companyCode']) assert.equal(output.evidence[0][key], evidence[key]);
  assert.equal(output.evidence[0].text, undefined);
  assert.equal(output.evidence[0].sourceLocator.originalTextProperty, 'text');
  const unknown = { id: 'UNKNOWN', text: '不可丢失的字段解释'.repeat(1000), rawFields: [{ new_field: 123 }] };
  assert.throws(() => prepareResearchData('answer', { currentQuestion: '问题', evidence: [unknown] }, { maxChars: 3000 }), error => error.code === 'CONTEXT_BUDGET_EXCEEDED');
});

test('旧历史降级明确省略范围，最新问题完整且有独立定位', () => {
  const source = context();
  source.summary.userInstructions.items = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, messageIndex: i, text: `旧问题${i}`.repeat(60) }));
  const currentQuestion = { id: 'm40', revision: 40, text: '当前完整问题：不要沿用旧年报' };
  const output = prepareResearchData('check', { currentQuestion, taskContext: source }, { maxChars: 5500 });
  assert.deepEqual(output.currentQuestion, currentQuestion);
  assert.ok(output.taskContext.summary.userInstructions.items.length < 40);
  assert.match(output.taskContext.summary.userInstructions.selection, /不代表全部用户要求/);
  assert.ok(output.contextPreparation.transformations.some(item => item.sourceLocator.omittedMessageIndexes?.length));
  assert.equal(output.contextPreparation.outputChars, JSON.stringify(output).length);
});

test('必须保留的当前问题或数值证据无法容纳时明确报错，不静默截断', () => {
  const currentQuestion = { id: 'm1', text: '原始输入'.repeat(4000) };
  const data = { currentQuestion, currentFocus: { text: '用户明确关注' } };
  assert.throws(() => prepareResearchData('plan', data, { maxChars: 3000 }), error => error.code === 'CONTEXT_BUDGET_EXCEEDED' && error.contextPreparation.outputBlocks.currentQuestion === JSON.stringify(currentQuestion).length);
  assert.equal(data.currentQuestion.text, currentQuestion.text);
  assert.throws(() => prepareResearchData('plan', data, { maxChars: 100 }), RangeError);
});

test('连续研究仅投喂规范问题和来源索引，旧回答与引文不重复当作事实',()=>{
 const data={currentQuestion:{text:'新问题'},personalResearchMemory:{id:'m',version:2,focus:{text:'我想弄清是否成立',source:'user'},open_questions:[{id:'q',question:'剩余问题'}],evidence_refs:[{taskId:'t',evidenceId:'DOC-CASH-x',pages:[65],citations:[{quote:'重复引文'}]}],current_result:{taskId:'t',revision:1,progress:{remainingQuestion:'剩余问题'},analyses:[{answer:'历史回答'}]}}};
 const output=prepareResearchData('answer',data);
 assert.equal(output.personalResearchMemory.focus.text,data.personalResearchMemory.focus.text);
 assert.deepEqual(output.personalResearchMemory.open_questions,data.personalResearchMemory.open_questions);
 assert.equal(output.personalResearchMemory.current_result.analyses,undefined);
 assert.equal(output.personalResearchMemory.evidence_refs[0].citations,undefined);
 assert.equal(output.contextPreparation.transformations[0].action,'project_case_state_and_source_index');
 assert(data.personalResearchMemory.current_result.analyses.length);
});
