export function researchResumeScope(entry) {
  const primary = entry?.open_questions?.find(item => !['resolved', 'withdrawn'].includes(item.status));
  // A primary question's own scope wins. Missing legacy scope must not be
  // silently relabeled with the most recent result's period.
  const scope = primary ? primary.scope : entry?.source?.scope;
  if (!scope || scope.thscode !== entry.companyCode || !Number.isInteger(scope.year)) return null;
  if (scope.period === 'annual') return scope;
  if (scope.period === 'quarterly' && [1, 2, 3, 4].includes(scope.quarter)) return scope;
  return null;
}

export function researchResumePeriod(scope) {
  if (!scope) return '';
  const report = scope.period === 'annual' ? '年报' : { 1: '一季度累计财报', 2: '上半年累计财报', 3: '前三季度累计财报', 4: '全年累计财报' }[scope.quarter];
  return `${scope.year}年${report}`;
}
