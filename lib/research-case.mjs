// A pure domain projection over the existing personal research store. No second memory engine.
const text = value => typeof value === 'string' ? value.trim().slice(0, 3000) : '';
const copy = value => value == null ? value : structuredClone(value);
const cashFields = ['operating_cash_inflow', 'operating_cash_outflow', 'sales_cash', 'purchase_cash', 'act_cash_flow_net'];
const sameQuestion = (a, b) => text(a).replace(/[\s，。？?；;：:]/g, '') === text(b).replace(/[\s，。？?；;：:]/g, '');
const questionKey = value => { let hash = 2166136261; for (const character of text(value)) hash = Math.imul(hash ^ character.codePointAt(0), 16777619); return (hash >>> 0).toString(36); };
const splitQuestion = value => /流入.{0,20}流出|流出.{0,20}流入|收款.{0,12}付款/.test(value)
  && !/质量|原因|构成|具体项目|持续/.test(value);
const sameResearchScope = (left, right) => {
  if (!left || !right || !left.thscode || !right.thscode || !Number.isInteger(left.year) || !Number.isInteger(right.year)
    || !['annual', 'quarterly'].includes(left.period) || !['annual', 'quarterly'].includes(right.period)) return false;
  return left.thscode === right.thscode && left.year === right.year && left.period === right.period
    && (left.period !== 'quarterly' || ([1, 2, 3, 4].includes(left.quarter) && left.quarter === right.quarter))
    && (left.yearsCount == null || right.yearsCount == null || left.yearsCount === right.yearsCount)
    && (!left.scopeKey || !right.scopeKey || left.scopeKey === right.scopeKey);
};

export function contextIntent(value) {
  const raw = text(value);
  // Only the speaker's own utterance may change their default. Object vocabulary
  // is never a duration signal; quotes, hypotheses and questions are not orders.
  const ownWords = raw.replace(/```[\s\S]*?```|“[^”]*”|「[^」]*」|『[^』]*』|‘[^’]*’|"[^"]*"|'[^']*'/g, ' ').trim();
  const hypothetical = /(?:^|[，,。；;\s])(?:如果|假如|假设|要是|倘若|比如|例如)/.test(ownWords);
  const reported = /(?:^|[，,。；;\s])(?:别人|有人|他人|朋友|同事|专家|分析师|他|她)(?:认为|建议|说|提到)|^(?:据说|听说|转述|引用|我(?:在|只是)?(?:引用|转述)|以下是别人的)/.test(ownWords);
  const attributionCandidate = /(?:不是我|并非我|不代表我).{0,12}(?:观点|看法|判断)|(?:观点|看法).{0,12}(?:不是我|并非我)|(?:引用|转述|别人|他人).{0,20}(?:不是我|不代表我)|(?:那个|这个).{0,8}(?:观点|说法).{0,8}(?:引用|转述|别人|他人)/.test(ownWords);
  const questionForm = /[？?]|是否|能否|可否|要不要|是不是|会不会|能不能|有没有|为什么|怎样|怎么样|如何|怎么|什么|哪个|哪些|多少|(?:吗|么|呢)(?:[，,。；;！!\s]|$)/.test(ownWords);
  const inquiry = questionForm || /我(?:更|主要|最)?想(?:弄清|了解|知道|问)|我在问|请解释|想请问/.test(ownWords);
  const directInterest = /我(?:更|主要|最|一直|长期)?(?:关注|关心|想弄清|想了解|想知道)|我现在主要研究/.test(ownWords);
  const futureTime = /以后|今后|往后|从今(?:以后)?|从现在起/.test(ownWords);
  const turnTime = /这次|本次|本轮|现在先|暂时|先不|先只/.test(ownWords);
  const defaultSetting = /(?:^|[，,。；;\s])(?:请|请你|帮我|请帮我)?(?:把|将).{0,30}(?:设为|设置为|改为).{0,12}默认|(?:^|[，,。；;\s])(?:请|请你|帮我|请帮我)?(?:设为|设置为|改为).{0,12}默认|(?:^|[，,。；;\s])(?:请|请你|帮我|请帮我)?默认(?:关注|关心|研究|沿用|使用)/.test(ownWords);
  const durationInstruction = /^(?:请|请你|帮我|请帮我)?\s*长期(?:地)?(?:关注|关心|研究|沿用|使用)/.test(ownWords);
  const futureWithdrawal = /(?:^|[，,。；;\s])(?:以后|今后|往后|从现在起)(?:请|请你|帮我)?(?:不看|不要看|不再看)/.test(ownWords);
  const futureInstruction = futureWithdrawal || /(?:^|[，,。；;\s])(?:请|请你|帮我|请帮我|我希望|我决定|我)?(?:以后|今后|往后|从今(?:以后)?|从现在起)(?:请|请你|帮我|我(?:会|要|将|希望)?)?(?:主要|优先|重点|只|都)?(?:关注|关心|研究|沿用|记住|分析|看|改看|改为|改成|换成|(?:不再|不要再?|不用|停止|取消|撤回|删除)(?:这个|该|之前的|原来的)?(?:关注点|关注|关心|研究|分析|沿用|默认))/.test(ownWords);
  const withdrawAction = futureWithdrawal || /(?:不用|不再|不要|停止|取消|撤回|删除).{0,15}(?:关注|关心|研究|沿用|默认|这个关注点|该关注点)|(?:关注点|默认).{0,10}(?:不用|取消|撤回|删除)/.test(ownWords);
  const replacementAction = /改为|改成|改看|改研究|改关注|改分析|换成|主要研究|主要关注|优先关注|只看|只研究|只关注/.test(ownWords);
  const turnOverride = /先不看|先不研究|先只|只看|只分析|只研究|不用沿用|不要沿用|不沿用|本次不用|这次不用|本轮不用|暂时不|改看|换个话题|换个议题|换成|改为/.test(ownWords);
  const safeDirective = !!ownWords && !hypothetical && !reported && !inquiry;
  const futureDirective = safeDirective && (defaultSetting || durationInstruction || futureInstruction);
  const currentDirective = safeDirective && !futureDirective && turnOverride;
  const ownAttributionDenial = /^我(?:在|只是)?(?:引用|转述)/.test(ownWords)
    && /不是我的|并非我的|不代表我的/.test(ownWords);
  const attributionCorrection = !!ownWords && !hypothetical && !inquiry && attributionCandidate
    && (!reported || ownAttributionDenial);
  const excludeHistory = safeDirective && !futureDirective
    && /(?:本次|这次|本轮).{0,12}(?:不|不要|不用|停止).{0,8}(?:沿用|使用|读取|参考).{0,8}(?:历史|记忆|旧关注|旧背景)|(?:本次|这次|本轮).{0,12}(?:不|不要|不用|禁用|关闭).{0,8}(?:历史|记忆|旧关注|旧背景)/.test(ownWords);

  const temporalScope = futureTime || defaultSetting || durationInstruction ? 'future'
    : turnTime || currentDirective || excludeHistory ? 'turn' : 'unspecified';
  const speechAct = hypothetical ? 'hypothetical' : attributionCorrection ? 'change_instruction' : reported ? 'reported_speech'
    : attributionCorrection || futureDirective || currentDirective || excludeHistory ? 'change_instruction'
      : inquiry ? 'question'
        : directInterest ? 'expressed_interest' : 'statement';
  const operation = attributionCorrection ? 'attribution_correction'
    : futureDirective ? withdrawAction && !replacementAction ? 'withdraw_default' : 'set_default'
      : currentDirective ? 'set_turn'
        : directInterest && !hypothetical && !reported ? 'express_focus' : 'none';
  const kind = operation === 'attribution_correction' ? 'attribution_correction'
    : ['set_default', 'withdraw_default'].includes(operation) ? 'case' : operation === 'set_turn' ? 'turn' : 'none';
  const reason = hypothetical ? '条件假设不修改默认关注。' : attributionCorrection ? '记录用户明确的观点归属纠正。'
    : reported ? '转述或引用不作为用户修改指令。'
      : excludeHistory ? '本轮明确排除历史上下文；不等于撤销长期关注。'
      : futureDirective ? '用户明确指定后续适用范围并提出关注修改。'
        : currentDirective ? '仅改变当前研究范围，不覆盖长期默认。'
          : operation === 'express_focus' ? '表达本次研究关切；可建立初始来源，不代表要求替换已有默认。'
            : '未发现可以确定执行的关注修改。';
  return { kind, scope: kind === 'case' ? 'case' : kind === 'turn' ? 'turn' : null,
    focusText: operation !== 'none' && operation !== 'attribution_correction' ? raw : '', attributionCorrection,
    speechAct, temporalScope, operation, explicitChange: ['set_default', 'withdraw_default', 'set_turn', 'attribution_correction'].includes(operation),
    allowNaturalCapture: operation === 'express_focus', excludeHistory, reason };
}

function questionItem(question, entry, status = 'open', overrides = {}) {
  return { id: `question:${entry.source?.taskId || entry.id || 'legacy'}:${entry.source?.analysisRevision || entry.version || 0}:${status}:${questionKey(question)}`,
    question: text(question), status, why_it_matters: text(entry.unresolved?.nextCheck),
    taskId: entry.source?.taskId || null, revision: entry.source?.analysisRevision || null, scope:copy(entry.source?.scope||null), ...overrides };
}

export function normalizeResearchCase(value) {
  if (!value) return null;
  const entry = copy(value);
  // An empty remainingQuestion is meaningful: it must not resurrect keyCondition.
  const hasProgress = entry.researchProgress && Object.hasOwn(entry.researchProgress, 'unresolvedQuestion');
  let question = hasProgress ? text(entry.researchProgress.unresolvedQuestion)
    : Array.isArray(entry.open_questions) ? text(entry.open_questions.find(item => item.status !== 'resolved')?.question)
      : text(entry.unresolved?.question);
  let existing = (entry.open_questions || []).filter(item => item.status !== 'resolved');
  if (!question && hasProgress) {
    // Completion of the latest report must not erase conditions from another
    // report period (or questions whose original period is unknown).
    existing = existing.filter(item => !sameResearchScope(item.scope, entry.source?.scope));
    if (existing.length) question = text(existing[0].question);
  }
  entry.unresolved = { ...(entry.unresolved || {}), question };
  const primary = existing.find(item => sameQuestion(item.question, question) && sameResearchScope(item.scope, entry.source?.scope))
    || existing.find(item => sameQuestion(item.question, question));
  entry.open_questions = question ? [questionItem(question, entry, 'open',
    primary ? { ...primary, scope: copy(primary.scope || null) } : {}),
    ...existing.filter(item => item !== primary)].slice(0, 12) : [];
  entry.resolved_questions = Array.isArray(entry.resolved_questions) ? entry.resolved_questions : [];
  entry.evidence_refs = Array.isArray(entry.evidence_refs) ? entry.evidence_refs : [];
  entry.current_result = entry.current_result || null;
  entry.attributionCorrections = entry.attributionCorrections || entry.attribution_corrections || [];
  entry.attribution_corrections = entry.attributionCorrections;
  return entry;
}

export function caseQuestionText(memory) {
  return normalizeResearchCase(memory)?.unresolved?.question || '';
}

export function projectResearchCase(entry, snapshot, previous) {
  const result = snapshot.result;
  const old = normalizeResearchCase(previous);
  const hasProgress = !!result.progress;
  let question = hasProgress ? text(result.progress.remainingQuestion) : text(result.keyCondition?.question);
  const evidence = (snapshot.evidence || []).filter(item => item.companyCode === entry.companyCode
    && item.scopeKey === result.researchScope.scopeKey);
  const refs = evidence.map(item => ({ taskId: snapshot.id, revision: snapshot.revision, analysisRevision: snapshot.revision, id: item.id, evidenceId: item.id,
    companyCode: item.companyCode, scopeKey: item.scopeKey, sourceUrl: item.sourceUrl || null,
    pages: [...new Set((item.citations || []).map(citation => citation.page).filter(Number.isInteger))],
    documentId: item.documentId || null, locator: text(item.locator),
    citations: (item.citations || []).slice(0, 20).map(({ field, page, quote }) => ({ field, page, quote: text(quote).slice(0, 300) })) }));
  const currentRefs = new Set(refs.map(item => item.id));
  const verifiedDoc = evidence.find(item => item.provider === 'disclosure-pdf'
    && item.rawFields?.length >= 2 && item.rawFields.every(row => cashFields.every(field => Number.isFinite(row[field])))
    && result.cashBridge?.evidenceId === item.id && Number.isFinite(result.cashBridge.arithmeticResidual)
    && Math.abs(result.cashBridge.arithmeticResidual) <= 1);
  if (verifiedDoc && splitQuestion(question)) {
    question = !splitQuestion(text(result.keyCondition?.question)) ? text(result.keyCondition?.question) : '';
  }
  const turnOnly = snapshot.contextIntent?.scope === 'turn' || snapshot.contextIntent?.kind === 'turn'
    || snapshot.focus?.scope === 'turn' || result.focus?.scope === 'turn';
  const keepUnanswered = !question && hasProgress && result.progress.status==='answered';
  const resolvedIds = new Set(Array.isArray(result.resolvedQuestionIds) ? result.resolvedQuestionIds.filter(id => typeof id === 'string') : []);
  const explicitResolutionAllowed = hasProgress && ['advanced', 'answered'].includes(result.progress.status) && refs.length > 0;
  const oldOpen = [];
  const resolved = [...(old?.resolved_questions || [])];
  for (const prior of old?.open_questions || []) {
    const sameScope = sameResearchScope(prior.scope, result.researchScope);
    const cashResolved = sameScope && verifiedDoc && splitQuestion(prior.question);
    const explicitlyResolved = sameScope && explicitResolutionAllowed && resolvedIds.has(prior.id);
    if (cashResolved || explicitlyResolved) {
      resolved.push({ ...copy(prior), status: 'resolved',
        evidence_ids: cashResolved ? [verifiedDoc.id] : refs.map(ref => ref.id), resolvedAtRevision: snapshot.revision,
        resolvedBy: { taskId: snapshot.id, revision: snapshot.revision, scope: copy(result.researchScope) } });
      if (sameQuestion(prior.question, question)) question = '';
    } else if (!sameScope || turnOnly || keepUnanswered || !question || sameQuestion(prior.question, question)) {
      // Unknown or different report scopes remain open; a new year's result cannot retire them.
      oldOpen.push(copy(prior));
    }
  }
  const openQuestions = [...oldOpen, ...(question ? [questionItem(question, entry)] : [])]
    .filter((item, index, all) => all.findIndex(other => sameQuestion(other.question, item.question)
      && (other.id === item.id || sameResearchScope(other.scope, item.scope))) === index).slice(0, 12);
  if (((turnOnly || keepUnanswered) && oldOpen.length) || (!question && openQuestions.length)) question = openQuestions[0].question;
  if (verifiedDoc) resolved.push(questionItem('经营现金流入、流出各自对净额变化的算术贡献', entry, 'resolved', {
    id: `cash-split:${entry.companyCode}:${result.researchScope.scopeKey}`, evidence_ids: [verifiedDoc.id],
    boundary: '仅解决同期收支算术拆分，不代表回款质量、经营原因或可持续性已解决。' }));
  const next = { ...entry,
    researchProgress: hasProgress ? { ...entry.researchProgress, unresolvedQuestion: question,
      change: text(result.progress.change), blocker: text(result.progress.blocker) } : entry.researchProgress,
    unresolved: { ...entry.unresolved, question },
    open_questions: openQuestions,
    resolved_questions: [...new Map(resolved.map(item => [item.id, item])).values()].slice(-20),
    evidence_refs: [...new Map([...(old?.evidence_refs || []), ...refs].map(ref => [`${ref.taskId}:${ref.evidenceId || ref.id}`, ref])).values()].slice(-40),
    current_result: { taskId: snapshot.id, revision: snapshot.revision, caseRevision: entry.version,
      scope: copy(result.researchScope), questionUnderstanding: text(result.questionUnderstanding),
      progress: copy(result.progress || null),
      // Only persist answers anchored in sources actually acquired in this result.
      analyses: (result.analyses || []).filter(item => item.evidenceIds?.length
        && item.evidenceIds.every(id => currentRefs.has(id))).slice(0, 12)
        .map(item => ({ question: text(item.question), answer: text(item.answer), intent: item.intent,
          support: item.support, evidenceIds: [...item.evidenceIds] })),
      evidenceIds: refs.map(ref => ref.id), used_context_ids: snapshot.memoryUsed?.id ? [snapshot.memoryUsed.id] : [],
      boundary: '这是历史研究快照；其中的分析和数值不是当前事实，新期间必须重新核验。' },
  };
  return normalizeResearchCase(next);
}
