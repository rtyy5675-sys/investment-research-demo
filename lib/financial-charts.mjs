// A fixed rendering contract over published evidence. Never parse amounts from prose.
export const chartAmount = value => Number.isFinite(value) ? (value / 1e8).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '未披露';
export const signedAmount = value => `${value > 0 ? '+' : ''}${chartAmount(value)}`;
const finite = value => typeof value === 'number' && Number.isFinite(value);
export function chartPeriod(scope, year = scope?.year) {
  if (scope?.period === 'annual') return `${year} 年全年`;
  return `${year} 年${({1:'一季度累计',2:'上半年累计',3:'前三季度累计',4:'全年累计'})[scope?.quarter] || '累计期间'}`;
}
function sameScope(item, scope) {
  const own = item.scope;
  return scope && own && (!scope.scopeKey || !item.scopeKey || item.scopeKey === scope.scopeKey) && item.companyCode === scope.thscode && own.thscode === scope.thscode && own.period === scope.period && own.year === scope.year && (scope.period === 'annual' || own.quarter === scope.quarter) && /^CNY元(?:[（；]|$)/.test(item.unit || '') && ['fuyao-mcp','disclosure-pdf'].includes(item.provider);
}
function periodRows(item, scope) {
  if (!Array.isArray(item.rawFields)) return null;
  const rows = [scope.year - 1, scope.year].map(year => item.rawFields.filter(row => row.fiscal_year === year));
  if (rows.some(matches => matches.length !== 1)) return null;
  const pair = rows.map(matches => matches[0]);
  if (pair.some(row => (row.thscode && row.thscode !== scope.thscode) || (row.currency && row.currency !== 'CNY') || (row.period && row.period !== scope.period) || (row.fiscal_period && !(scope.period === 'annual' ? ['FY','Q4'].includes(row.fiscal_period) : row.fiscal_period === `Q${scope.quarter}`)))) return null;
  return pair;
}
export function comparison(previous, current) {
  if (!finite(previous) || !finite(current)) return { delta:null, percent:null };
  return { delta:current - previous, percent:previous > 0 ? (current - previous) / previous * 100 : null };
}
export function buildFinancialCharts(result, evidence = []) {
  const scope = result.researchScope;
  if (!scope || !Number.isInteger(scope.year) || !['annual','quarterly'].includes(scope.period) || (scope.period === 'quarterly' && ![1,2,3,4].includes(scope.quarter))) return [];
  const sources = evidence.filter(item => sameScope(item, scope)).map(source => ({source, rows:periodRows(source, scope)})).filter(item => item.rows);
  const views = [];
  const income = sources.find(item => item.source.id === 'FUYAO-INCOME');
  if (income) {
    const metrics = [['operating_income','营业收入'],['parent_holder_net_profit','归母净利润']].map(([field,label]) => ({field,label,points:income.rows.map(row => ({label:chartPeriod(scope,row.fiscal_year),shortLabel:`${row.fiscal_year} 年`,value:finite(row[field]) ? row[field] : null}))})).filter(item => item.points.some(point => point.value !== null));
    if (metrics.length) views.push({id:'income',label:'利润表现',title:'收入与利润怎样变化',scope,source:income.source,metrics,note:'分别比较营业收入和归母净利润的同期变化；切换指标时，刻度随对应数值调整。'});
  }
  const cash = sources.find(item => item.source.id === 'FUYAO-CASH');
  if (cash) {
    const groups = [['act_cash_flow_net','经营活动'],['invest_cash_flow_net','投资活动'],['financing_cash_flow_net','筹资活动']].map(([field,label]) => ({field,label,points:cash.rows.map(row => ({label:chartPeriod(scope,row.fiscal_year),shortLabel:`${row.fiscal_year} 年`,value:finite(row[field]) ? row[field] : null}))})).filter(group => group.points.some(point => point.value !== null));
    if (groups.length) views.push({id:'cash',label:'三类现金流',title:'现金从哪些活动流入或流出',scope,source:cash.source,groups,note:'展示各类活动的现金流净额；正值为净流入，负值为净流出。三项合计不一定等于现金净增加额，还可能存在汇率影响等项目。'});
  }
  const bridgeSource = sources.find(item => item.source.id === result.cashBridge?.evidenceId && item.source.provider === 'disclosure-pdf');
  if (bridgeSource && result.cashBridge.currentYear === scope.year && result.cashBridge.previousYear === scope.year - 1) {
    const [previous,current] = bridgeSource.rows;
    const fields = ['operating_cash_inflow','operating_cash_outflow','act_cash_flow_net'];
    const reconciles = row => Math.abs(row.operating_cash_inflow - row.operating_cash_outflow - row.act_cash_flow_net) <= Math.max(.01,Math.abs(row.act_cash_flow_net)*1e-12);
    if (bridgeSource.rows.every(row => fields.every(field => finite(row[field])) && reconciles(row))) {
      const inflow = current.operating_cash_inflow - previous.operating_cash_inflow;
      const outflow = previous.operating_cash_outflow - current.operating_cash_outflow;
      views.push({id:'bridge',label:'净额拆解',title:'经营现金流净额是怎样变化的',scope,source:bridgeSource.source,previous,current,steps:[
        {label:`${previous.fiscal_year} 年`,subLabel:'经营净额',value:previous.act_cash_flow_net,start:0,end:previous.act_cash_flow_net,kind:'total',detail:'上年同期经营活动现金流净额'},
        {label:'流入变化',subLabel:'对净额的影响',value:inflow,start:previous.act_cash_flow_net,end:previous.act_cash_flow_net+inflow,kind:'change',detail:'本期流入减上年同期流入；流入增加抬高净额，减少压低净额'},
        {label:'流出变化',subLabel:'对净额的影响',value:outflow,start:previous.act_cash_flow_net+inflow,end:current.act_cash_flow_net,kind:'change',detail:'上年同期流出减本期流出；流出增加会压低净额，因此这里显示负向贡献'},
        {label:`${current.fiscal_year} 年`,subLabel:'经营净额',value:current.act_cash_flow_net,start:0,end:current.act_cash_flow_net,kind:'total',detail:'本期经营活动现金流净额'},
      ],note:'这是同一份合并报表的收支变化拆分，不能单独证明经营原因或回款质量；原始元值计算，亿元展示可能有舍入尾差。',conflicts:result.cashBridge.conflicts || []});
    }
  }
  return views;
}
// All charts include zero; negative amounts are never drawn as positive bars.
export function chartDomain(values) {
  const numbers = values.filter(finite);
  const low = Math.min(0,...numbers), high = Math.max(0,...numbers);
  const span = high-low || 1e8;
  return [low < 0 ? low-span*.12 : 0, high > 0 ? high+span*.15 : span*.15];
}
