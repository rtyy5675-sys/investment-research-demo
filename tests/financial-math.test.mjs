import test from 'node:test';
import assert from 'node:assert/strict';
import { auditAmountText, amountIssues, financialComparisons } from '../lib/financial-math.mjs';
import { validateDecisionResult } from '../lib/decision-state.mjs';
test('历史现金流差额错误有明确更正且不改原字符串',()=>{
 const text='经营活动现金流量净额从928.26亿元增至969.90亿元，增加约41.16亿元，同比增长约4.5%。';
 const result=auditAmountText(text);assert.equal(result.issues.length,1);assert.match(result.text,/增加约41.64亿元/);assert.match(text,/41.16/);
 assert.throws(()=>validateDecisionResult({summary:text},[],[]),/金额差额/);
});
test('允许展示金额四舍五入导致的小差异，不改变用户输入对象',()=>{
 assert.equal(auditAmountText('归母净利润从441.21亿元升至507.45亿元，增加约66.23亿元。').issues.length,0);
 assert.equal(amountIssues({text:'由100.0亿元降至80.0亿元，减少20.0亿元'}).length,0);
});
test('从原始字段计算差额与正基期同比，零和负基期不补造同比',()=>{
 const evidence=[{id:'E',rawFields:[{fiscal_year:2023,operating_income:100e8,zero:0,negative:-5e8},{fiscal_year:2024,operating_income:120e8,zero:5e8,negative:-4e8}]}];
 const copy=structuredClone(evidence), rows=financialComparisons(evidence);
 assert.deepEqual(evidence,copy);assert.equal(rows.find(r=>r.field==='operating_income').deltaYi,20);assert.equal(rows.find(r=>r.field==='operating_income').changePct,20);assert.equal(rows.find(r=>r.field==='zero').changePct,null);assert.equal(rows.find(r=>r.field==='negative').changePct,null);assert.equal(rows.length,3);
});
