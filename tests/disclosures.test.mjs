import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadReport, cashBridge, createDisclosureStore, readLimitedBody, acquireCashDisclosure } from '../lib/disclosures.mjs';
import { searchReports } from '../lib/disclosure-search.mjs';
import { continuityContext } from '../lib/research-continuity.mjs';

test('下载只能访问官方PDF主机，每次跳转重新检查；不抓取本地或其他URL', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secrets' } }); };
  await assert.rejects(downloadReport('http://127.0.0.1/report.pdf', { fetchImpl }), /官方/); assert.equal(requests, 0);
  await assert.rejects(downloadReport('https://static.cninfo.com.cn/finalpage/x.PDF', { fetchImpl }), /官方/); assert.equal(requests, 1);
});
test('上传/下载大小限制生效，非PDF不会进入解析', async () => {
  async function* chunks() { yield Buffer.alloc(5); yield Buffer.alloc(5); }
  await assert.rejects(readLimitedBody(chunks(), 8), /文件过大/);
  await assert.rejects(createDisclosureStore('/unused').ingest(Buffer.from('not a PDF')), /有效 PDF/);
});
test('同一通用检索使用动态orgId并筛除摘要和错误公司', async () => {
  for (const thscode of ['600519.SH','000333.SZ']) {
    const code = thscode.slice(0,6), calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, data: new URLSearchParams(options.body) });
      return Response.json(calls.length === 1 ? [{code,category:'A股',orgId:`dynamic-${code}`,zwjc:'检索公司'}] : {announcements:[
        {secCode:code,orgId:`dynamic-${code}`,adjunctType:'PDF',announcementTitle:'2025年年度报告',announcementId:'123',adjunctUrl:'finalpage/2026-03-31/123.PDF',announcementTime:1774915200000},
        {secCode:code,orgId:`dynamic-${code}`,adjunctType:'PDF',announcementTitle:'2025年年度报告摘要',announcementId:'124',adjunctUrl:'finalpage/2026-03-31/124.PDF',announcementTime:1774915200000},
        {secCode:'999999',orgId:'wrong',adjunctType:'PDF',announcementTitle:'2025年年度报告',announcementId:'125',adjunctUrl:'finalpage/2026-03-31/125.PDF',announcementTime:1774915200000},
      ]});
    };
    const found = await searchReports({thscode,year:2025,period:'annual'}, {fetchImpl});
    assert.equal(found.length,1); assert.equal(found[0].companyCode,thscode);
    assert.equal(calls[1].data.get('stock'),`${code},dynamic-${code}`);
  }
});
test('补查拆分以同一原始报表计算，不拼接旧净额；冲突单独保留', () => {
  const document = { id:'DOC-CASH-test',rawFields:[
    {fiscal_year:2024,operating_cash_inflow:100,operating_cash_outflow:50,sales_cash:80,purchase_cash:40,act_cash_flow_net:50},
    {fiscal_year:2025,operating_cash_inflow:120,operating_cash_outflow:60,sales_cash:90,purchase_cash:45,act_cash_flow_net:60},
  ] };
  const old = [{id:'FUYAO-CASH',rawFields:[{fiscal_year:2025,act_cash_flow_net:99}]}]; const before = structuredClone(old);
  const bridge = cashBridge(document, old);
  assert.equal(bridge.inflowContribution,20); assert.equal(bridge.outflowContribution,-10); assert.equal(bridge.netDelta,10); assert.equal(bridge.arithmeticResidual,0);
  assert.equal(bridge.conflicts[0].priorValue,99); assert.deepEqual(old,before);
});
test('五项分项齐全时解除旧现金流缺口；不完整文档不能制造已解决状态', () => {
  const cash = { id:'FUYAO-CASH' }, doc = {id:'DOC-CASH-test',provider:'disclosure-pdf',rawFields:[2025,2024].map(fiscal_year=>({fiscal_year,operating_cash_inflow:100,operating_cash_outflow:50,sales_cash:80,purchase_cash:40,act_cash_flow_net:50}))};
  const options = {task:{},memory:{unresolved:{question:'流入和流出怎样变化？'}},currentQuestion:{text:'请接着上次的现金流入流出继续。'},kind:'followup',activity:{}};
  assert.ok(continuityContext({...options,evidence:[cash]}).blocker);
  const context = continuityContext({...options,evidence:[cash,doc]}); assert.equal(context.blocker,null); assert.equal(context.resolution.evidenceId,doc.id);
  doc.rawFields[0].sales_cash = null; assert.ok(continuityContext({...options,evidence:[cash,doc]}).blocker);
});

test('失败后重新采用同范围已核验财报会清除旧失败标记，不重复调用模型', async () => {
  const evidence = { id:'DOC-CASH-test', companyCode:'000001.SZ', scopeKey:'test', documentId:'document' };
  const task = { documentEvidence:[evidence], documents:[{id:'document'}], supplement:{status:'failed',message:'old failure'} }; let saved=0;
  const found = await acquireCashDisclosure({task,revision:3,scope:{thscode:'000001.SZ',scopeKey:'test'},save:async()=>{saved++;},callModel:()=>{throw new Error('must not call');}});
  assert.equal(found.reused,true); assert.equal(task.supplement.status,'verified'); assert.equal(task.supplement.revision,3); assert.equal(saved,1);
});
