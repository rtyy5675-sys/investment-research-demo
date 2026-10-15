// Pure calculations, shared with the UI. Never change source evidence or user records.
const amountChange = /(?:从|由)\s*([+-]?[\d,]+(?:\.\d+)?)\s*亿元\s*(?:增至|降至|升至|下降至|上升至|至|到)\s*([+-]?[\d,]+(?:\.\d+)?)\s*亿元\s*[，,]?\s*(增加|减少|上升|下降)\s*约?\s*([+-]?[\d,]+(?:\.\d+)?)\s*亿元/g;
const number = value => Number(value.replaceAll(',', ''));
const step = value => 10 ** -(value.split('.')[1]?.length || 0);
export function auditAmountText(value) {
  const issues = [];
  const text = String(value || '').replace(amountChange, (whole, from, to, direction, delta) => {
    const actual = Math.abs(number(to) - number(from));
    const tolerance = (step(from) + step(to) + step(delta)) / 2 + 1e-8;
    if (Math.abs(actual - Math.abs(number(delta))) <= tolerance) return whole;
    const corrected = actual.toFixed(delta.split('.')[1]?.length || 0);
    issues.push({ original: whole, correctDeltaYi: actual, message: `历史差额更正：原文为${delta}亿元；按展示值复算为${corrected}亿元。原始运行记录保留。` });
    return whole.replace(new RegExp(`${delta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*亿元$`), `${corrected}亿元`);
  });
  return { text, issues };
}
export function amountIssues(value) {
  if (typeof value === 'string') return auditAmountText(value).issues;
  if (Array.isArray(value)) return value.flatMap(amountIssues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(amountIssues);
  return [];
}
export function financialComparisons(evidence) {
  return evidence.flatMap(item => {
    if (!Array.isArray(item.rawFields)) return [];
    const rows = [...item.rawFields].sort((a, b) => b.fiscal_year - a.fiscal_year);
    const [current, previous] = rows;
    if (!current || !previous) return [];
    return Object.keys(current).filter(field => !['fiscal_year','report_date_ms','period_end_ms'].includes(field) && typeof current[field] === 'number' && Number.isFinite(current[field]) && typeof previous[field] === 'number' && Number.isFinite(previous[field])).map(field => ({ evidenceId: item.id, field, year: current.fiscal_year, previousYear: previous.fiscal_year, currentYi: current[field] / 1e8, previousYi: previous[field] / 1e8, deltaYi: (current[field] - previous[field]) / 1e8, changePct: previous[field] > 0 ? (current[field] - previous[field]) / previous[field] * 100 : null }));
  });
}
