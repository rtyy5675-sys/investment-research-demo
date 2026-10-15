import { caseQuestionText } from './research-case.mjs';
// Published progress is grounded in evidence acquisition, not in memory writes.
export function evidenceActivity(task, revision, evidence, { fetchedIds = [], reusedIds = [], checkpointIds = [] } = {}) {
  const runs = (task.toolRuns || []).filter(run => run.revision === revision && !run.tool?.startsWith('mcp/'));
  const attempts = [...new Map(runs.map(run => [`${run.callId}:${run.attempt}`, run])).values()];
  return {
    revision, fetchedIds: [...new Set(fetchedIds)], reusedIds: [...new Set(reusedIds)], checkpointIds: [...new Set(checkpointIds)],
    dataToolAttempts: attempts.length,
    financialAttempts: attempts.filter(run => /^get_a_share_financials_/.test(run.tool)).length,
    documentAttempts: attempts.filter(run => run.tool?.startsWith('disclosure/')).length,
    sources: evidence.map(item => ({ id: item.id, origin: fetchedIds.includes(item.id) ? 'fetched' : checkpointIds.includes(item.id) ? 'checkpoint' : reusedIds.includes(item.id) ? 'reused' : 'unknown', queriedAt: item.queriedAt || item.fetchedAt || null, requestId: item.requestId || null })),
  };
}

export function continuityContext({ task, memory, currentQuestion, kind, evidence, activity }) {
  const continuing = !task.contextIntent?.excludeHistory && kind !== 'revise' && kind !== 'focus' && !/只看|只研究|不再|不用沿用|不要沿用|换成|改为|不看|先不/.test(currentQuestion.text);
  const sameCompany = task.result?.researchScope?.thscode === evidence[0]?.companyCode;
  const priorQuestion = continuing ? caseQuestionText(memory) || (sameCompany ? (task.result?.progress ? task.result.progress.remainingQuestion : task.result?.keyCondition?.question) : '') || '' : '';
  const cash = evidence.find(item => item.id === 'FUYAO-CASH');
  const document = evidence.find(item => item.provider === 'disclosure-pdf' && item.rawFields?.length >= 2 && item.rawFields.every(row => ['operating_cash_inflow','operating_cash_outflow','sales_cash','purchase_cash','act_cash_flow_net'].every(key => Number.isFinite(row[key]))));
  const wantsBreakdown = /现金流入|现金流出|流入.{0,12}流出|流出.{0,12}流入|收款.{0,8}付款/.test(`${currentQuestion.text} ${priorQuestion}`);
  // The current connector has only the documented net cash flow fields. Do not
  // infer totals from net, nor suggest repeating this same tool to get new fields.
  const blocker = cash && wantsBreakdown && !document ? {
    code: 'cash_breakdown_not_exposed', evidenceIds: [cash.id],
    message: task.supplement?.status === 'failed' ? `现金流接口没有所需分项；本轮原始财报补查未成功：${task.supplement.message}` : '现金流接口未提供经营活动现金流入、流出及销售收款分项；需要通过原始财报检索或上传补齐，不能从净额推断。',
    sourceUrl: 'https://fuyao.aicubes.cn/docs/api-reference/financials/#现金流量表',
  } : null;
  return { priorQuestion, openQuestions:memory?.open_questions||[], resolvedQuestions:memory?.resolved_questions||[], activity, blocker, resolution: document ? { evidenceId: document.id, coverage: '已核对原始合并现金流表的同期流入、流出、销售收款、采购付款和净额；可作收支算术拆分，不能据此证明回款质量。' } : null,
    boundary: '旧关注是历史疑问，不是当期事实或用户立场。新增资料数量不等于问题已解决；同范围复用必须如实说明。当前资料不能解决的上次问题应标为blocked，不制造核查成功或不可执行的动作。' };
}

export function legacyEvidenceActivity(task, result, evidence) {
  if (result.evidenceActivity) return result.evidenceActivity;
  const reuse = task?.evidenceReuse?.find(item => item.revision === result.revision);
  return reuse ? evidenceActivity(task, result.revision, evidence, reuse) : null;
}
