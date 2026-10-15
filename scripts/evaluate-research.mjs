#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Deterministic structure inspection only. Never a financial correctness judge. */
export function evaluateResearch(task, caseDefinition, review = null) {
  if (!task || typeof task !== 'object' || !Array.isArray(task.messages)) throw new Error('Task must be a local task JSON object with messages[]');
  const checks = [];
  const add = (name, pass, detail = '') => checks.push({ name, status: pass ? 'pass' : 'fail', detail });
  const evidence = Array.isArray(task.evidence) ? task.evidence : [];
  const result = task.result;
  add('task_identity', typeof task.id === 'string' && Number.isInteger(task.revision));
  add('evidence_ids_unique', new Set(evidence.map(item => item.id)).size === evidence.length);
  if (result) {
    add('summary_present', typeof result.summary === 'string' && !!result.summary.trim());
    add('analyses_present', Array.isArray(result.analyses) && result.analyses.length > 0);
    add('published_revision_not_future', Number.isInteger(result.revision) && result.revision <= task.revision);
    const ids = new Set(evidence.map(item => item.id));
    for (const [index, analysis] of (Array.isArray(result.analyses) ? result.analyses : []).entries()) {
      add(`analysis_${index}_claim`, typeof analysis.claim === 'string' && !!analysis.claim.trim());
      add(`analysis_${index}_answer`, typeof analysis.answer === 'string' && !!analysis.answer.trim());
      add(`analysis_${index}_support_enum`, ['supports', 'contradicts', 'insufficient'].includes(analysis.support));
      add(`analysis_${index}_references_exist`, Array.isArray(analysis.evidenceIds) && analysis.evidenceIds.every(id => ids.has(id)));
      if (analysis.support === 'supports') add(`analysis_${index}_support_has_reference`, analysis.evidenceIds?.length > 0);
    }
    const scope = result.researchScope;
    if (scope) add('source_scope_matches_published_scope', evidence.every(item => (!item.companyCode || item.companyCode === scope.thscode) && (!item.scopeKey || item.scopeKey === scope.scopeKey)), 'Only matches identifiers, not financial comparability or source truth');
    add('next_action_enum', ['query', 'external', 'none'].includes(result.nextAction?.kind));
    if (result.nextAction?.kind === 'query') add('query_has_tool_and_reason', !!result.nextAction.toolId && !!result.nextAction.question?.trim() && !!result.nextAction.reason?.trim());
  } else {
    add('no_result_has_explicit_noncompleted_state', ['idle', 'running', 'needs_clarification', 'failed', 'cancelled', 'budget_exhausted'].includes(task.status), 'No financial claim inspected');
  }
  if (task.contextSummary?.truncation) add('context_actual_chars_within_declared_budget', JSON.stringify(task.contextSummary).length <= task.contextSummary.truncation.maxChars);
  const manualSection = (name, rubric) => {
    const hasReviewer = typeof review?.reviewer === 'string' && !!review.reviewer.trim() && typeof review.reviewedAt === 'string' && !!review.reviewedAt.trim();
    const hasObservedUser = name !== 'userUnderstanding' || (review?.observationType === 'observed_user_session' && typeof review?.sessionId === 'string' && !!review.sessionId.trim() && typeof review?.participantId === 'string' && !!review.participantId.trim());
    const submitted = review?.caseId === caseDefinition.id && hasReviewer && hasObservedUser && review?.[name];
    const items = rubric.map((criterion, index) => {
      const assessed = submitted?.items?.find(item => item.index === index);
      const usable = assessed && ['pass', 'fail'].includes(assessed.status) && typeof assessed.evidence === 'string' && !!assessed.evidence.trim();
      return { index, criterion, status: usable ? assessed.status : 'pending', evidence: usable ? assessed.evidence : null };
    });
    return { status: items.some(item => item.status === 'fail') ? 'fail' : items.every(item => item.status === 'pass') ? 'pass' : 'pending', items };
  };
  return {
    caseId: caseDefinition.id, taskId: task.id, revision: task.revision, evaluatedAt: new Date().toISOString(),
    automatedStructure: { status: checks.every(check => check.status === 'pass') ? 'pass' : 'fail', checks },
    financialSemantics: manualSection('financialSemantics', [...caseDefinition.mustAnswer, ...caseDefinition.forbiddenInferences.map(item => `不得：${item}`), `补查条件：${caseDefinition.followupCondition}`, `结束条件：${caseDefinition.endCondition}`]),
    exceptionBehavior: manualSection('exceptionBehavior', caseDefinition.expectedExceptions),
    userUnderstanding: manualSection('userUnderstanding', caseDefinition.userObservationQuestions),
    reviewSource: review?.caseId === caseDefinition.id ? { reviewer: review.reviewer || null, reviewedAt: review.reviewedAt || null, observationType: review.observationType || 'unspecified', note: 'Manual assertions are recorded, not independently verified by this script' } : null,
    decision: '结构通过不能证明金融正确、异常已实测或用户已理解。尚未填写的人工项一律 pending；手工审查通过也不是普遍可靠性或投资收益证明。',
  };
}

async function main() {
  const args = process.argv.slice(2), get = flag => { const position = args.indexOf(flag); return position >= 0 ? args[position + 1] : null; };
  if (!get('--task') || !get('--case')) throw new Error('Usage: node scripts/evaluate-research.mjs --task <local-task.json> --case <case-id> [--review <manual-review.json>] [--output <report.json>]');
  const catalog = JSON.parse(await readFile(new URL('../evaluation/cases.json', import.meta.url), 'utf8'));
  const definition = catalog.cases.find(item => item.id === get('--case'));
  if (!definition) throw new Error(`Unknown case: ${get('--case')}`);
  const raw = JSON.parse(await readFile(resolve(get('--task')), 'utf8'));
  const review = get('--review') ? JSON.parse(await readFile(resolve(get('--review')), 'utf8')) : null;
  if (review && review.caseId !== definition.id) throw new Error('Manual review caseId does not match --case');
  const report = evaluateResearch(raw.task || raw, definition, review);
  const serialized = JSON.stringify(report, null, 2) + '\n';
  if (get('--output')) await writeFile(resolve(get('--output')), serialized);
  process.stdout.write(serialized);
  if (report.automatedStructure.status === 'fail') process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 2; });
