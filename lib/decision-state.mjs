import { randomUUID } from 'node:crypto';
import { amountIssues } from './financial-math.mjs';

function reject(message, status = 409) { const error = new Error(message); error.status = status; throw error; }
function text(value) {
  if (typeof value !== 'string' || !value.trim()) reject('请填写你自己的内容。', 400);
  if (value.length > 3000) reject('内容过长，请限制在3000字以内。', 400);
  return value.trim();
}
export function prepareFocus(task, data) {
  if (data.operationId && task.operations?.[data.operationId]) return null;
  if (data.expectedRevision !== task.revision || data.expectedFocusVersion !== (task.focus?.version || 0)) reject('研究或关注点已更新，请刷新后再修改；输入仍可保留。');
  if (!task.result || !task.researchScope || task.dataSource !== 'fuyao') reject('请先完成一次扶摇财务研究，再调整关注点。', 400);
  if (task.status !== 'complete') reject('请先完成或重试当前研究，再调整关注点。');
  return { text: text(data.text), source: 'user', scope: 'turn', version: (task.focus?.version || 0) + 1, scopeKey: task.researchScope.scopeKey, updatedAt: new Date().toISOString() };
}
export function recordView(task, data) {
  task.viewOperations ||= {};
  const operationKey = data.operationId ? `${data.action}:${data.operationId}` : null;
  if (operationKey && task.viewOperations[operationKey]) return;
  const view = task.userView || { version: 0, draft: null, confirmations: [] };
  if (data.expectedVersion !== view.version) reject('你的看法已在另一处更新，请刷新后检查；当前输入仍可保留。');
  if (!task.result) reject('取得分析后再记录你的看法。', 400);
  if (data.action === 'draft') {
    if (data.analysisRevision !== task.result.revision) reject('分析已更新，请阅读新版后再保存草稿。');
    const originalText = text(data.text);
    view.draft = { id: randomUUID(), originalText, text: originalText, source: 'user', analysisRevision: task.result.revision, focusVersion: task.result.focus?.version || 0, scopeKey: task.result.researchScope?.scopeKey || null, updatedAt: new Date().toISOString() };
  } else if (data.action === 'confirm') {
    if (!view.draft) reject('请先写下并保存草稿。', 400);
    if (task.status !== 'complete' || task.result.revision !== task.revision || view.draft.analysisRevision !== task.result.revision || view.draft.focusVersion !== (task.result.focus?.version || 0)) reject('分析或关注点已更新，请阅读后重新保存草稿，再确认。');
    view.confirmations.push({ ...structuredClone(view.draft), id: randomUUID(), confirmedAt: new Date().toISOString() });
    view.draft = null;
  } else if (data.action === 'discard') {
    view.draft = null;
  } else reject('不支持的记录操作。', 400);
  view.version++; task.userView = view; task.updatedAt = new Date().toISOString();
  if (operationKey) task.viewOperations[operationKey] = { version: view.version };
}

export function closeResearch(task, revision) {
  if (revision !== task.result?.revision || task.status !== 'complete' || task.revision !== revision) reject('分析已变化，请先查看当前结果。');
  task.researchClosure = { analysisRevision: revision, endedAt: new Date().toISOString() };
}

export function validateDecisionResult(result, evidence, availableFollowups, { currentQuestion, continuity } = {}) {
  if (amountIssues(result).length) throw new Error('回答中的金额差额计算不一致，已阻止发布，请重试。');
  if (!result.analyses?.length) throw new Error('分析没有回应当前问题，未发布结果。');
  const known = new Set(evidence.map(item => item.id));
  if (result.analyses.some(item => item.evidenceIds.some(id => !known.has(id)))) throw new Error('回答引用了未取得的证据，已阻止发布。');
  if (result.analyses.some(item => !['unresolved', 'insufficient'].includes(item.support) && !item.evidenceIds.length)) throw new Error('有证据支持的分析缺少引用，已阻止发布。');
  if (result.nextAction.kind === 'query' && !availableFollowups.some(item => item.id === result.nextAction.toolId)) throw new Error('补查动作不在当前可用资料中，未发布结果。');
  if (result.nextAction.kind === 'query' && (!result.nextAction.question?.trim() || !result.nextAction.reason?.trim())) throw new Error('补查问题与理由不能为空，未发布结果。');
  if (currentQuestion || result.progress) {
    for (const item of result.analyses) {
      if (!['question', 'user_claim', 'system_hypothesis'].includes(item.intent)) throw new Error('分析未区分疑问与主张，未发布结果。');
      const source = item.claimSource;
      if (!source || typeof source.quote !== 'string' || typeof source.messageId !== 'string') throw new Error('主张缺少来源归属，未发布结果。');
      if (item.intent === 'question') {
        if (item.claim || source.quote || source.messageId || item.support !== 'not_applicable') throw new Error('不能把待解疑问改为肯定主张再评价支持或反对，未发布结果。');
      } else if (item.intent === 'user_claim') {
        // Verbatim whole-message attribution is deliberately conservative. It
        // cannot certify semantics; the independent final review checks context.
        if (source.messageId !== currentQuestion?.id || !source.quote || source.quote !== currentQuestion.text || item.claim !== source.quote
          || /是否|能否|会不会|是不是|想.{0,8}(弄清|了解|知道)|[？?]|有人|听说|转述/.test(source.quote)) throw new Error('用户主张必须有明确断言原文，不能截掉疑问或转述限定，未发布结果。');
      } else if (!item.claim?.trim() || source.quote || source.messageId || item.support === 'not_applicable') throw new Error('系统假设必须明确归给 AI，不能冒充用户主张，未发布结果。');
    }
    if(result.resolvedQuestionIds!==undefined&&(!Array.isArray(result.resolvedQuestionIds)||result.resolvedQuestionIds.some(id=>!continuity?.openQuestions?.some(q=>q.id===id))))throw new Error('已解决的问题不属于本轮读取的研究记录，未发布结果。');
    if(result.resolvedQuestionIds?.some(id=>{const q=continuity?.openQuestions?.find(q=>q.id===id);return q?.scope?.scopeKey&&!evidence.some(e=>e.scopeKey===q.scope.scopeKey)}))throw new Error('不同报告期的证据不能直接关闭历史未决问题。');
    const progress = result.progress;
    if (!progress || !['answered', 'advanced', 'blocked'].includes(progress.status) || !progress.change?.trim()) throw new Error('回答未说明本轮实际进展，未发布结果。');
    if (progress.status === 'blocked' && (!progress.blocker?.trim() || !progress.remainingQuestion?.trim())) throw new Error('阻塞必须说明未解决的问题与具体缺口，未发布结果。');
    if (continuity?.priorQuestion && continuity.blocker && (progress.status !== 'blocked' || !['external','query'].includes(result.nextAction.kind))) throw new Error('上次关键问题仍受当前能力阻塞，不能声明已推进或安排无效补查。');
    if (continuity?.resolution && !result.analyses.some(item => item.evidenceIds.includes(continuity.resolution.evidenceId))) throw new Error('已取得的关键分项未被用于更新分析，未发布空补查结果。');
  }
}
