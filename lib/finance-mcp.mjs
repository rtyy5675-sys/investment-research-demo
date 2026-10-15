import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { classifyError, ResearchError } from './research-errors.mjs';

const endpoint = 'https://fuyao.aicubes.cn/mcp/a-share';
const metaEndpoint = 'https://fuyao.aicubes.cn/mcp/meta';
const configFile = new URL('../.env.local', import.meta.url);
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' });
function apiKey() {
  let local = {};
  try { local = parseEnv(readFileSync(configFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return (process.env.FUYAO_API_KEY || local.FUYAO_API_KEY || '').trim();
}
export function dataSources() {
  const configured = !!apiKey();
  return {
    default: 'fuyao',
    fuyao: { id: 'fuyao', name: '扶摇 MCP', configured, status: configured ? 'configured' : 'missing_credentials', message: configured ? 'Key 已配置，尚需验证服务与工具权限；具体公司取数在研究时执行。' : '尚未配置扶摇 API Key，不能查询金融数据。' },
  };
}
const definitions = {
  'FUYAO-INCOME': { title: '扶摇 MCP 利润表', tool: 'get_a_share_financials_income_statements', fields: { operating_income: '营业收入', parent_holder_net_profit: '归母净利润', operating_profit: '营业利润', net_profit: '净利润', operating_costs: '营业成本', operating_expenses: '营业总成本', sales_fee: '销售费用', manage_fee: '管理费用', research_and_development_expenses: '研发费用', profit_total: '利润总额', income_tax_expense: '所得税费用' }, required: ['operating_income', 'parent_holder_net_profit'] },
  'FUYAO-CASH': { title: '扶摇 MCP 现金流量表', tool: 'get_a_share_financials_cash_flow_statements', fields: { act_cash_flow_net: '经营活动现金流量净额', invest_cash_flow_net: '投资活动现金流量净额', pay_fixed_assets_etc_cash: '购建固定资产、无形资产和其他长期资产支付的现金', financing_cash_flow_net: '筹资活动现金流量净额', pay_dividends_profits_interest_cash: '分配股利、利润或偿付利息支付的现金', cash_equivalents_net_addition: '现金及现金等价物净增加额' }, required: ['act_cash_flow_net'] },
  'FUYAO-BALANCE': { title: '扶摇 MCP 资产负债表', tool: 'get_a_share_financials_balance_sheets', fields: { assets_total: '资产总计', cash: '货币资金', accounts_receivable: '应收账款', total_debt: '负债合计', holder_equity_total: '所有者权益合计', total_current_assets: '流动资产合计', non_current_nets_total: '非流动资产合计' }, required: ['assets_total', 'total_debt'] },
};
function periodName(scope) {
  if (!scope) return '按用户指定的 A 股公司与年度或累计报告期查询';
  const target = scope.latest || scope.year == null ? '最新可用报告期' : `${scope.year}年${scope.period === 'annual' ? '全年' : ['','第一季度累计','上半年累计','前三季度累计','全年累计'][scope.quarter] || '累计报告期'}`;
  return `${scope.name || scope.thscode || '所选公司'}；${target}；${scope.yearsCount || 2}年同口径对比；资产负债表为期末时点余额`;
}
export const mcpCatalog = (ids, scope) => ids.map(id => {
  if (!definitions[id]) throw new Error(`未知扶摇财务工具：${id}`);
  return { id, title: definitions[id].title, period: periodName(scope), fields: Object.values(definitions[id].fields) };
});
export function requireFuyaoKey() {
  if (!apiKey()) throw new ResearchError('扶摇 MCP 未授权：请在本机 .env.local 配置 FUYAO_API_KEY，再重新尝试。没有退回资料包，也没有生成研究结论。', { category: 'authentication' });
}
export function decodeResult(result) {
  const payloads = [];
  if (result.structuredContent) payloads.push(result.structuredContent);
  for (const block of result.content || []) {
    if (block.type === 'text') { try { payloads.push(JSON.parse(block.text)); } catch {} }
  }
  const error = payloads.find(value => value && value.code != null && value.code !== 0);
  if (error) {
    const failure = new Error(`扶摇数据服务拒绝查询（code=${error.code}）：${String(error.message || '未知错误').slice(0, 250)}`);
    failure.providerCode = error.code;
    throw classifyError(failure);
  }
  if (result.isError) throw new Error('扶摇 MCP 工具执行失败，未取得可用证据。');
  for (const value of payloads) {
    const data = value?.code === 0 ? value.data : value;
    if (data && Array.isArray(data.item)) return { data, requestId: value.request_id || null };
  }
  throw new Error('扶摇 MCP 返回结构不符合数据接口约定，未将响应当作有效证据。');
}
function redact(error, key, signal) {
  if (error instanceof StreamableHTTPError) error.httpStatus = error.code;
  const clean = classifyError(error, { signal });
  // Keep only a bounded machine code from the native cause, never URLs/headers.
  let cause = error;
  for (let depth = 0; cause && depth < 5; depth += 1, cause = cause.cause) {
    const code = cause.code;
    if (typeof code === 'string' && /^(?:UND_ERR_[A-Z_]+|E(?:CONNRESET|CONNREFUSED|TIMEDOUT|NOTFOUND|AI_AGAIN|PIPE))$/.test(code)) {
      clean.networkCode = code;
      if (clean.message === 'fetch failed') clean.message = `扶摇 MCP 网络连接失败（${code}），本次未取得数据。`;
      break;
    }
  }
  if (key) clean.message = clean.message.replaceAll(key, '[REDACTED]');
  // Avoid retaining an SDK error/cause containing credential-bearing URLs.
  delete clean.cause;
  return clean;
}
async function withClient(url, { signal, onEvent = () => {} } = {}, run) {
  requireFuyaoKey();
  const key = apiKey();
  const createClient = () => new Client({ name: 'jianwei-investment-research', version: '0.4.0' });
  const createTransport = () => new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { 'X-api-key': key } } });
  let client = createClient();
  let transport = createTransport();
  const options = { timeout: 20000, signal };
  let phase = 'initialize';
  let phaseEvent;
  const beginPhase = (callId, attempt) => {
    phaseEvent = { provider: 'fuyao-mcp', tool: `mcp/${phase}`, callId, attempt, startedAt: new Date().toISOString(), server: client.getServerVersion()?.name, serverVersion: client.getServerVersion()?.version };
    onEvent({ ...phaseEvent, status: 'running' });
  };
  const endPhase = () => onEvent({ ...phaseEvent, status: 'complete', completedAt: new Date().toISOString(), server: client.getServerVersion()?.name, serverVersion: client.getServerVersion()?.version });
  const discover = async action => {
    const callId = randomUUID();
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (signal?.aborted) throw signal.reason;
      beginPhase(callId, attempt);
      try { const value = await action(); endPhase(); phaseEvent = null; return value; }
      catch (error) {
        const failure = redact(error, key, signal);
        const retry = attempt === 1 && !signal?.aborted && failure.retryable && ['timeout', 'network', 'rate_limit'].includes(failure.category);
        onEvent({ ...phaseEvent, status: failure.category === 'cancelled' ? 'cancelled' : 'failed', completedAt: new Date().toISOString(), message: failure.message, code: failure.code, networkCode: failure.networkCode || null, category: failure.category, retryable: failure.retryable, retryScheduled: retry });
        phaseEvent = null;
        if (!retry) throw failure;
        await sleep(300, undefined, { signal });
      }
    }
  };
  try {
    let connectionAttempt = 0;
    await discover(async () => {
      if (connectionAttempt++ > 0) {
        await client.close().catch(() => {});
        client = createClient(); transport = createTransport();
      }
      await client.connect(transport, options);
    });
    const tools = [];
    let cursor;
    phase = 'tools/list';
    do {
      const page = await discover(() => client.listTools(cursor ? { cursor } : {}, options));
      tools.push(...page.tools); cursor = page.nextCursor;
    } while (cursor);
    phaseEvent = null;
    return await run({ client, tools, options, server: client.getServerVersion() });
  } catch (error) {
    const failure = redact(error, key, signal);
    if (phaseEvent) onEvent({ ...phaseEvent, status: failure.category === 'cancelled' ? 'cancelled' : 'failed', completedAt: new Date().toISOString(), message: failure.message, code: failure.code, category: failure.category, retryable: failure.retryable, providerCode: failure.providerCode });
    throw failure;
  }
  finally { await client.close().catch(() => {}); }
}
export async function callTool(context, name, args, { onEvent = () => {}, beforeTool = () => {} } = {}) {
  const signal = context.options?.signal;
  const callId = randomUUID();
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const event = { provider: 'fuyao-mcp', server: context.server?.name, serverVersion: context.server?.version, tool: name, arguments: args, callId, attempt, startedAt: new Date().toISOString() };
    try {
      if (signal?.aborted) throw signal.reason;
      if (!context.tools.some(tool => tool.name === name)) throw new ResearchError(`扶摇 MCP 未提供所需工具：${name}`, { category: 'permission' });
      await beforeTool({ tool: name, args, attempt });
      if (signal?.aborted) throw signal.reason;
      onEvent({ ...event, status: 'running' });
      // Decode the MCP envelope even when a business failure has data:null.
      const result = await context.client.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema, context.options);
      const envelope = decodeResult(result);
      onEvent({ ...event, status: 'complete', completedAt: new Date().toISOString(), requestId: envelope.requestId });
      return envelope;
    } catch (error) {
      const failure = redact(error, apiKey(), signal);
      const retry = attempt === 1 && !signal?.aborted && failure.retryable && ['timeout', 'network', 'rate_limit'].includes(failure.category);
      onEvent({ ...event, status: failure.category === 'cancelled' ? 'cancelled' : 'failed', message: failure.message, completedAt: new Date().toISOString(), code: failure.code, category: failure.category, retryable: failure.retryable, providerCode: failure.providerCode, retryScheduled: retry });
      if (!retry) throw failure;
      try { await sleep(150, undefined, { signal }); }
      catch (abort) {
        const stopped = classifyError(abort, { signal });
        onEvent({ ...event, phase: 'retry_wait', status: stopped.category === 'cancelled' ? 'cancelled' : 'failed', completedAt: new Date().toISOString(), message: stopped.message, code: stopped.code, category: stopped.category, retryable: false, providerCode: stopped.providerCode, retryScheduled: false });
        throw stopped;
      }
    }
  }
}
function clarification(message, candidates = []) {
  const error = new Error(message);
  error.code = 'NEEDS_CLARIFICATION';
  error.candidates = candidates;
  return error;
}
export async function resolveSecurity(companyQuery, { signal, onEvent = () => {}, beforeTool = () => {} } = {}) {
  const q = String(companyQuery || '').trim();
  if (!q || q.length > 120) throw clarification('请提供一家 A 股公司的名称或股票代码。');
  return withClient(metaEndpoint, { signal, onEvent }, async context => {
    const envelope = await callTool(context, 'get_meta_tickers_search', { q, asset_type: 'a-share', limit: 50 }, { onEvent, beforeTool });
    const candidates = envelope.data.item.filter(row => row.asset_type === 'a-share' && /^(\d{6})\.(SH|SZ|BJ)$/.test(row.thscode) && typeof row.name === 'string')
      .map(row => ({ thscode: row.thscode, name: row.name }));
    const unique = [...new Map(candidates.map(row => [row.thscode, row])).values()];
    if (unique.length !== 1) throw clarification(unique.length ? '检索到多家公司，请明确选择名称或完整股票代码。' : '没有检索到匹配的 A 股公司，请检查名称或提供完整股票代码。', unique);
    return unique[0];
  });
}
function validateScope(scope) {
  if (!scope || !/^\d{6}\.(SH|SZ|BJ)$/.test(scope.thscode) || typeof scope.name !== 'string' || !scope.name.trim()) throw clarification('研究缺少已消歧的 A 股公司名称或证券代码。');
  if (!['annual', 'quarterly'].includes(scope.period)) throw clarification('请明确选择年度或累计季度报告期。');
  if (!Number.isInteger(scope.yearsCount) || scope.yearsCount < 2 || scope.yearsCount > 5) throw clarification('历史对比需要指定 2 至 5 年。');
  if (scope.year != null && (!Number.isInteger(scope.year) || scope.year < 1990 || scope.year > 2100)) throw clarification('财报年份无效。');
  if (scope.period === 'annual' && scope.quarter != null) throw clarification('年度查询不能同时指定季度。');
  if (scope.period === 'quarterly' && scope.quarter != null && (!Number.isInteger(scope.quarter) || scope.quarter < 1 || scope.quarter > 4)) throw clarification('累计季度应为 1 至 4。');
  if (scope.period === 'quarterly' && !scope.latest && scope.year != null && scope.quarter == null) throw clarification('请明确第一季度、上半年、前三季度或全年累计。');
  return { ...scope, latest: Boolean(scope.latest || scope.year == null) };
}
export function scopeKey(scope) {
  return `${scope.thscode}:${scope.period}:${scope.year}:${scope.period === 'annual' ? 'FY' : `Q${scope.quarter}`}:${scope.yearsCount}`;
}
function quarterOf(row, period) {
  if (period === 'annual') return ['FY', 'Q4'].includes(row.fiscal_period) ? 4 : null;
  const match = /^Q([1-4])$/.exec(row.fiscal_period);
  return match ? Number(match[1]) : null;
}
function dateOf(value) { return Number.isFinite(value) ? dateFormat.format(new Date(value)) : null; }
function checkedRows(envelope, scope) {
  if (!envelope.data.item.length) throw new ResearchError(`扶摇未返回${scope.name}的${scope.period === 'annual' ? '年度' : '累计季度'}报表，未用其他公司或口径替代。`, { category: 'empty_result' });
  return envelope.data.item.map(row => {
    if (row.thscode !== scope.thscode || row.period !== scope.period || row.currency !== 'CNY') throw new Error('扶摇返回的证券代码、报告口径或币种与请求不一致，未发布。');
    const quarter = quarterOf(row, scope.period);
    if (!Number.isInteger(row.fiscal_year) || !quarter) throw new Error('扶摇返回的财年或报告季度无效，未发布。');
    const end = `${row.fiscal_year}-${['','03-31','06-30','09-30','12-31'][quarter]}`;
    if (dateOf(row.period_end_ms) !== end) throw new Error('扶摇返回的期末日期与报告期不一致，未发布。');
    return row;
  });
}
function resolvePeriod(rows, scope) {
  if (!scope.latest) return { ...scope, scopeKey: scopeKey(scope) };
  const candidates = scope.period === 'quarterly' && scope.quarter != null ? rows.filter(row => quarterOf(row, scope.period) === scope.quarter) : rows;
  if (!candidates.length) throw new Error('上游没有所请求季度的可用记录，未用其他季度替代。');
  const sorted = [...candidates].sort((a, b) => b.fiscal_year - a.fiscal_year || quarterOf(b, scope.period) - quarterOf(a, scope.period));
  const latest = sorted[0];
  const resolved = { ...scope, year: latest.fiscal_year, quarter: scope.period === 'annual' ? null : quarterOf(latest, scope.period), latest: false, requestedLatest: true };
  return { ...resolved, scopeKey: scopeKey(resolved) };
}
function financialEvidence(id, envelope, fetchedAt, scope, args, rows) {
  const definition = definitions[id];
  const ordered = Array.from({ length: scope.yearsCount }, (_, index) => scope.year - index).map(year => {
    const matches = rows.filter(row => row.fiscal_year === year && (scope.period === 'annual' || quarterOf(row, scope.period) === scope.quarter));
    if (matches.length !== 1) throw new Error(`扶摇${definition.title}缺少或重复${year}年${scope.period === 'annual' ? '全年' : `第${scope.quarter}季度累计`}记录，未用其他期间替代。`);
    const row = matches[0];
    for (const field of Object.keys(definition.fields)) {
      if (row[field] != null && (typeof row[field] !== 'number' || !Number.isFinite(row[field]))) throw new Error(`扶摇${definition.fields[field]}不是有效数值，未发布。`);
    }
    for (const field of definition.required) {
      if (typeof row[field] !== 'number' || !Number.isFinite(row[field])) throw new Error(`扶摇${year}年${definition.fields[field]}缺失，未补零。`);
    }
    return row;
  });
  const numbers = ordered.map(row => Object.fromEntries(['thscode', 'period', 'fiscal_year', 'fiscal_period', 'currency', 'report_date_ms', 'period_end_ms', ...Object.keys(definition.fields)].map(field => [field, row[field] ?? null])));
  const isBalance = id === 'FUYAO-BALANCE';
  const basis = isBalance ? '资产负债表为各期末时点余额，不是期间累计流量' : scope.period === 'quarterly' ? '年初至该季度期末累计值（YTD），不是单季度值，不可直接当作单季环比' : '对应完整财年的期间累计值';
  const text = ordered.map(row => `${row.fiscal_year}年${scope.period === 'annual' ? '全年' : `截至第${scope.quarter}季度累计`}（期末${dateOf(row.period_end_ms)}）：${Object.entries(definition.fields).map(([field, name]) => `${name}（${field}）=${row[field] == null ? '未披露' : row[field]}元`).join('；')}；上游披露日期字段=${dateOf(row.report_date_ms) || '未提供'}。`).join('\n');
  return { id, title: `${scope.name} · ${definition.title}`, text: `${scope.name}（${scope.thscode}）；${basis}。\n${text}\n合并报表，原币元；本次为当前可查询数据，可能包含后续重述，不是历史时点快照；上游披露日期字段不代表首次披露日。购建长期资产支付的现金不等于全部资本投入或投资活动现金流净额。`, period: `${scope.year}至${scope.year - scope.yearsCount + 1}年同报告期；${basis}`, unit: 'CNY元（不可与千元或万元直接混用）', locator: `${definition.tool}；thscode=${scope.thscode}；period=${scope.period}；查询于${fetchedAt}`, sourceUrl: `https://fuyao.aicubes.cn/docs/mcp/tools/${definition.tool}/`, provider: 'fuyao-mcp', companyCode: scope.thscode, companyName: scope.name, scopeKey: scope.scopeKey, scope: { ...scope }, fetchedAt, queriedAt: fetchedAt, requestId: envelope.requestId, tool: definition.tool, toolArguments: { ...args }, rawFields: numbers };
}
// Context injection keeps the sequential checkpoint/retry coordinator testable
// without opening an MCP connection. The production entry point is queryFuyao.
export async function collectFinancialEvidence(ids, { scope, signal, onEvent = () => {}, beforeTool = () => {}, onEvidence = async () => {} } = {}, context) {
  const requested = validateScope(scope);
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length || uniqueIds.some(id => !definitions[id])) throw new ResearchError('需要至少一个有效的扶摇财务工具。', { category: 'invalid_arguments' });
  const evidence = [];
  let resolved = null;
  try {
    for (const id of uniqueIds) {
      const definition = definitions[id];
      // start/end and limit cannot coexist in the hosted service. Fetch recent
      // periods, then require each exact period locally without substituting.
      const args = { thscode: requested.thscode, period: requested.period, limit: 20 };
      const envelope = await callTool(context, definition.tool, args, { onEvent, beforeTool });
      const rows = checkedRows(envelope, requested);
      if (!resolved) resolved = resolvePeriod(rows, requested);
      // All subsequent tools use this same resolved period, even if their
      // newest available statement is older than the first tool's latest.
      const item = financialEvidence(id, envelope, new Date().toISOString(), resolved, args, rows);
      evidence.push(item);
      // Never repeat a successful upstream request because persistence failed.
      // The caller decides whether/when these checkpoints become answer evidence.
      try { await onEvidence(item, resolved); }
      catch (error) {
        const failure = classifyError(error, { signal });
        if (['cancelled', 'budget_exhausted'].includes(failure.category)) throw failure;
        throw new ResearchError('新资料尚未保存，请重试保存后继续研究。', { category: 'storage_error', cause: error });
      }
    }
    return { evidence, server: context.server, toolCount: context.tools.length, scope: resolved };
  } catch (error) {
    const failure = classifyError(error, { signal });
    failure.partialEvidence = [...evidence];
    failure.resolvedScope = resolved;
    throw failure;
  }
}
export async function queryFuyao(ids, options = {}) {
  // Reject invalid local requests before opening a remote connection.
  validateScope(options.scope);
  if (!Array.isArray(ids) || !ids.length || ids.some(id => !definitions[id])) throw new ResearchError('需要至少一个有效的扶摇财务工具。', { category: 'invalid_arguments' });
  try {
    return await withClient(endpoint, options, context => collectFinancialEvidence(ids, options, context));
  } catch (error) {
    const failure = classifyError(error, { signal: options.signal });
    failure.partialEvidence ??= [];
    failure.resolvedScope ??= null;
    throw failure;
  }
}
export async function checkFuyao() {
  try {
    const finance = await withClient(endpoint, {}, async context => {
      const missing = Object.values(definitions).filter(definition => !context.tools.some(tool => tool.name === definition.tool));
      if (missing.length) throw new Error('扶摇财务服务未提供所需的三类财务工具。');
      return { server: context.server, toolCount: context.tools.length };
    });
    const meta = await withClient(metaEndpoint, {}, async context => {
      if (!context.tools.some(tool => tool.name === 'get_meta_tickers_search')) throw new Error('扶摇元数据服务未提供证券检索工具。');
      return { server: context.server, toolCount: context.tools.length };
    });
    return { ok: true, status: 'connected', message: '已完成财务及证券检索 MCP 握手与工具发现。尚未查询具体公司；报表权限和期间可用性将在研究时验证。', server: finance.server, toolCount: finance.toolCount, meta, checkedAt: new Date().toISOString() };
  } catch (error) {
    const failure = classifyError(error);
    return { ok: false, status: apiKey() ? 'error' : 'missing_credentials', message: failure.message, error: { code: failure.code, category: failure.category, retryable: failure.retryable, status: failure.status, recovery: failure.recovery, providerCode: failure.providerCode }, checkedAt: new Date().toISOString() };
  }
}
