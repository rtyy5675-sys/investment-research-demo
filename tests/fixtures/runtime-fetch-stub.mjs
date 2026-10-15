// Isolated runtime verification only. No real model, MCP, company or financial claim.
import { setTimeout as wait } from 'node:timers/promises';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
let cashDenied = false;
let saveDenied = false;
let answerCount = 0;
if (process.env.STUB_CASE === 'storage') {
  const write = fs.writeFile;
  fs.writeFile = async (path, contents, ...args) => {
    if (!saveDenied && String(path).includes('/artifacts/tasks/') && typeof contents === 'string' && JSON.parse(contents).status === 'complete') { saveDenied = true; throw Object.assign(new Error('Synthetic ENOSPC'), { code: 'ENOSPC' }); }
    return write(path, contents, ...args);
  };
  syncBuiltinESMExports();
}
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const body = await request.json().catch(() => null);
  if (request.url.startsWith('https://runtime-model.invalid/')) {
    await wait(Number(process.env.STUB_DELAY_MS || 5), undefined, { signal: request.signal });
    if (process.env.STUB_CASE === 'model_error') return new Response('synthetic rate limit', { status: 429 });
    const properties = body.response_format.json_schema.schema.properties;
    const memoryMode = process.env.STUB_CASE === 'memory';
    const inputText = body.messages?.at(-1)?.content || '';
    const taskInput = memoryMode ? JSON.parse(inputText.slice(inputText.indexOf('{'))) : {};
    const memory = taskInput.personalResearchMemory;
    const effectiveFocus = memory?.usage?.focus === false ? taskInput.currentFocus?.text : memory?.focus?.text;
    const rememberedProgress = memory?.progress?.change || memory?.current_result?.summary || "已有研究进度";
    const targetYear = /最新/.test(taskInput.currentFocus?.text || '') ? null : Number((taskInput.currentFocus?.text || '').match(/20\d{2}/)?.[0] || 2024);
    let result;
    if (properties.ok) result = {ok:true};
    else if (properties.companyQueries) result = { companyQueries: ['999999.SZ'], periodIntent: 'replace', period: 'annual', year: memoryMode ? targetYear : 2024, quarter: null, yearsCount: 2, requestedEvidenceIds: memoryMode && !memory && !process.env.STUB_MEMORY_DROP ? ['FUYAO-INCOME'] : ['FUYAO-INCOME', 'FUYAO-CASH'], workMessage: '[合成验收]选择必要报表', clarification: '' };
    else if (properties.issues) result = { issues: process.env.STUB_CASE==='final_reject'&&answerCount>1?[{severity:'error',message:'[合成验收]最终草稿的主张与引用不一致'}]:process.env.STUB_CASE==='final_suggestion'?[{severity:'suggestion',message:'[合成验收]可选措辞优化'}]:[], workMessage: '[合成验收]仅检查执行链路' };
    else if (properties.analyses) result = { resolvedQuestionIds: [], questionUnderstanding: '合成研究：利润变化', summary: '仅验证运行机制，不代表真实公司事实。', progress: {status: 'answered', change: '仅验证执行机制。', remainingQuestion: '', blocker: ''}, analyses: [{ question: memory ? '接续上次的现金问题' : '资料是否取得', intent: 'question', claim: '', claimSource: { messageId: '', quote: '' }, answer: memory ? `按${memory.usage?.focus === false ? "本轮" : "历史"}关注继续核查：${effectiveFocus || taskInput.currentFocus?.text || "当前问题"}。沿用进度：${rememberedProgress}。仅用于执行机制验收。` : '仅用于执行机制验收。', support: 'not_applicable', evidenceIds: memoryMode ? taskInput.evidence.map(item=>item.id) : ['FUYAO-INCOME', 'FUYAO-CASH'] }], keyCondition: { question: memoryMode && !memory ? '经营现金流是否支持利润变化？' : '', whyItMatters: '', nextCheck: memoryMode && !memory ? '核查现金流量表' : '' }, otherConditions: [], nextAction: { kind: 'none', toolId: '', question: '', reason: '合成链路结束' }, scope: '虚构公司、合成字段，非金融验证' };
    else result = { requestedEvidenceIds: memoryMode ? (memory?(process.env.STUB_MEMORY_DROP?['FUYAO-CASH']:['FUYAO-INCOME','FUYAO-CASH']):['FUYAO-INCOME']) : [], workMessage: '合成验收：接续资料选择', clarification: '' };
    if(properties.analyses){answerCount++;if(memoryMode&&!memory&&!taskInput.evidence.some(item=>item.id==='FUYAO-CASH'))result.nextAction={kind:'query',toolId:'FUYAO-CASH',question:'[合成验收]补查同期间现金流',reason:'核对旧问题的现金支持'};}
    return json({ choices: [{ message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  }
  if (request.url.startsWith('https://fuyao.aicubes.cn/mcp/')) {
    if (request.method === 'GET') return new Response(null, { status: 405 });
    if (body?.id == null) return new Response(null, { status: 202 });
    let result;
    if (body.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'synthetic-runtime-test', version: '1' } };
    else if (body.method === 'tools/list') result = { tools: ['get_meta_tickers_search', 'get_a_share_financials_income_statements', 'get_a_share_financials_cash_flow_statements', 'get_a_share_financials_balance_sheets'].map(name => ({ name, inputSchema: { type: 'object', properties: {} } })) };
    else if (body.method === 'tools/call') {
      const name = body.params.name;
      if (name.includes('cash_flow') && process.env.STUB_CASE === 'partial' && !cashDenied) { cashDenied = true; result = { content: [], structuredContent: { code: 1003, message: 'permission denied in synthetic test', data: null } }; }
      else {
        const item = name === 'get_meta_tickers_search' ? [{ name: '合成验收虚构公司', thscode: '999999.SZ', asset_type: 'a-share' }] : (process.env.STUB_CASE==='memory'?[2025,2024,2023]:[2024, 2023]).map(year => ({ thscode: '999999.SZ', period: 'annual', fiscal_year: year, fiscal_period: 'FY', currency: 'CNY', period_end_ms: Date.parse(`${year}-12-31T00:00:00+08:00`), report_date_ms: Date.parse('2026-03-01T00:00:00+08:00'), operating_income: 100000000, parent_holder_net_profit: 10000000, act_cash_flow_net: 20000000, assets_total: 300000000, total_debt: 50000000 }));
        result = { content: [], structuredContent: { code: 0, data: { item }, request_id: `synthetic-${name}` } };
      }
    } else throw new Error(`Unexpected synthetic MCP method ${body.method}`);
    return json({ jsonrpc: '2.0', id: body.id, result });
  }
  throw new Error(`External fetch forbidden in isolated runtime verification: ${request.url}`);
};
