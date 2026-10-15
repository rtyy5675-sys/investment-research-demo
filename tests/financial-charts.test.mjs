import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFinancialCharts,chartDomain,chartPeriod,comparison,chartAmount} from '../lib/financial-charts.mjs';
const scope={name:'测试公司',thscode:'000001.SZ',year:2025,period:'annual',quarter:null,scopeKey:'test:annual'};
const evidence=(id,rawFields,extra={})=>({id,provider:'fuyao-mcp',companyCode:scope.thscode,scope,scopeKey:scope.scopeKey,unit:'CNY元（已核验）',rawFields,...extra});
const income=()=>evidence('FUYAO-INCOME',[{fiscal_year:2025,operating_income:2e8,parent_holder_net_profit:-1e7},{fiscal_year:2024,operating_income:1e8,parent_holder_net_profit:0}]);
test('利润表按年份排序，营收与归母利润分开，金额从已归一元换算为亿元',()=>{
  const views=buildFinancialCharts({researchScope:scope},[income()]);
  assert.equal(views.length,1);assert.equal(views[0].metrics.length,2);
  assert.deepEqual(views[0].metrics[0].points.map(p=>p.value),[1e8,2e8]);assert.equal(chartAmount(2e8),'2.00');
  assert.equal(views[0].metrics[1].points[1].value,-1e7);assert.equal(comparison(0,-1).percent,null);assert.equal(comparison(-2,3).percent,null);
});
test('缺失数值不是零，缺少利润来源就不出现利润图',()=>{
  const missing=income();missing.rawFields[0].parent_holder_net_profit=null;
  const view=buildFinancialCharts({researchScope:scope},[missing])[0];assert.equal(view.metrics[1].points[1].value,null);assert.equal(chartAmount(null),'未披露');assert.equal(comparison(null,1).delta,null);
  const cash=evidence('FUYAO-CASH',[{fiscal_year:2025,act_cash_flow_net:1},{fiscal_year:2024,act_cash_flow_net:2}]);assert.deepEqual(buildFinancialCharts({researchScope:scope},[cash]).map(v=>v.id),['cash']);
});
test('拒绝错误公司、scopeKey、单位、币种及重复期间，不能串用资料',()=>{
  for(const mutate of [e=>e.companyCode='600519.SH',e=>e.scopeKey='old',e=>e.unit='CNY千元',e=>e.provider='unknown',e=>e.rawFields[0].currency='USD',e=>e.rawFields.push(e.rawFields[0]),e=>e.scope={...scope,year:2024}]){const item=income();mutate(item);assert.equal(buildFinancialCharts({researchScope:scope},[item]).length,0);}
});
test('累计季度明确标注YTD，不混入不同季度',()=>{
  const quarterly={...scope,period:'quarterly',quarter:3};const item=income();item.scope=quarterly;item.rawFields.forEach(row=>row.fiscal_period='Q3');
  assert.match(buildFinancialCharts({researchScope:quarterly},[item])[0].metrics[0].points[0].label,/前三季度累计/);item.rawFields[0].fiscal_period='Q2';assert.equal(buildFinancialCharts({researchScope:quarterly},[item]).length,0);assert.equal(chartPeriod({...quarterly,quarter:2}),'2025 年上半年累计');
});
test('现金三活动保留正负值、不同来源不拼接，坐标轴包括零',()=>{
  const cash=evidence('FUYAO-CASH',[{fiscal_year:2024,act_cash_flow_net:5,invest_cash_flow_net:-9,financing_cash_flow_net:3},{fiscal_year:2025,act_cash_flow_net:4,invest_cash_flow_net:2,financing_cash_flow_net:-6}]);
  const view=buildFinancialCharts({researchScope:scope},[cash])[0];assert.equal(view.groups[1].points[0].value,-9);assert.equal(view.groups[2].points[1].value,-6);const domain=chartDomain([-9,5,null]);assert.ok(domain[0]<-9&&domain[1]>5);assert.equal(chartDomain([5])[0],0);assert.ok(chartDomain([0,0])[1]>0);
});
test('瀑布锁定同一份PDF并用原始值复算，流出增加取负贡献',()=>{
  const source=evidence('DOC-CASH-a',[{fiscal_year:2025,operating_cash_inflow:120,operating_cash_outflow:90,act_cash_flow_net:30},{fiscal_year:2024,operating_cash_inflow:100,operating_cash_outflow:50,act_cash_flow_net:50}],{provider:'disclosure-pdf'});
  const result={researchScope:scope,cashBridge:{evidenceId:source.id,currentYear:2025,previousYear:2024}};const view=buildFinancialCharts(result,[source])[0];
  assert.deepEqual(view.steps.map(s=>s.value),[50,20,-40,30]);assert.equal(view.steps[2].start,70);assert.equal(view.steps[2].end,30);
  assert.equal(buildFinancialCharts({...result,cashBridge:{...result.cashBridge,evidenceId:'missing'}},[source]).length,0);
  source.rawFields[0].act_cash_flow_net=31;assert.equal(buildFinancialCharts(result,[source]).length,0);
});
