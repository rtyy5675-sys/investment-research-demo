/** Deterministic input preparation. No model summary, preference inference or numeric clipping. */
const chars = value => JSON.stringify(value)?.length || 0;
const blockSizes = data => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, chars(value)]));
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const locator = (data, collection, extra = {}) => ({ taskId: data.taskContext?.summary?.taskId ?? null, collection, ...extra });

function previousIndex(previous, data) {
  if (!previous || typeof previous !== 'object') return previous;
  const sameCompany = !previous.researchScope?.thscode || !data.scope?.thscode || previous.researchScope.thscode === data.scope.thscode;
  const sameScope = sameCompany && (!previous.researchScope?.scopeKey || !data.scope?.scopeKey || previous.researchScope.scopeKey === data.scope.scopeKey);
  return {
    ...pick(previous, ['revision', 'researchScope']),
    ...(sameScope ? {
      ...pick(previous, ['questionUnderstanding', 'focus', 'keyCondition', 'otherConditions', 'nextAction']),
      analyses: Array.isArray(previous.analyses) ? previous.analyses.map((analysis, index) => ({ index, ...pick(analysis, ['question', 'claim', 'support', 'evidenceIds']) })) : [],
    } : {}),
    contextNote: sameScope ? '仅保留上版问题、主张、未决项与来源索引，省略上版答案正文；历史判断不是本次事实。' : '上版范围不同，仅保留定位；不能将其判断用于本次范围。',
    sourceLocator: locator(data, 'result', { revision: previous.revision ?? null }),
  };
}

function financialProjection(evidence, data, index) {
  if(evidence?.provider === 'disclosure-pdf' && /^DOC-(CASH|NOTES)-/.test(evidence.id) && Array.isArray(evidence.citations) && evidence.citations.length) {
    const projected = {...evidence};
    // Our normalized envelope renders the same table/quotes into text. Preserve
    // the full literal quotations and all numbers once, with their page labels.
    delete projected.text;
    projected.interpretationNotes = '原始财报逐字引文，按页码核查表头、单位和合并口径；摘录不代表完整披露，算术变化不自动证明经营原因或回款质量。';
    projected.sourceLocator = locator(data,'evidence',{index,id:evidence.id,originalTextProperty:'text'});
    return projected;
  }
  // Unknown evidence formats retain their full text. Only the known normalized financial
  // envelope can safely replace duplicated rendered numbers with the complete raw table.
  if (evidence?.provider !== 'fuyao-mcp' || !['FUYAO-INCOME', 'FUYAO-CASH', 'FUYAO-BALANCE'].includes(evidence.id) || !Array.isArray(evidence.rawFields) || !evidence.rawFields.length) return evidence;
  const fieldDescriptions = {};
  for (const match of String(evidence.text || '').matchAll(/([^（）；：。\n]{1,100})（([a-z][a-z0-9_]*)）=/g)) fieldDescriptions[match[2]] = match[1].trim();
  if (evidence.fieldDescriptions) Object.assign(fieldDescriptions, evidence.fieldDescriptions);
  const numericFields = new Set(evidence.rawFields.flatMap(row => Object.keys(row)).filter(key => !['thscode', 'period', 'fiscal_year', 'fiscal_period', 'currency', 'report_date_ms', 'period_end_ms'].includes(key)));
  // A novel tool field without a description must not silently lose its only explanation.
  if ([...numericFields].some(key => !fieldDescriptions[key])) return evidence;
  return {
    ...pick(evidence, ['id', 'title', 'period', 'unit', 'locator', 'sourceUrl', 'provider', 'companyCode', 'companyName', 'scopeKey', 'scope', 'fetchedAt', 'queriedAt', 'requestId', 'tool', 'toolArguments', 'rawFields']),
    fieldDescriptions,
    interpretationNotes: [
      '合并报表、原币元；null表示未披露，不能补零；不可与千元或万元混用。',
      evidence.id === 'FUYAO-BALANCE' ? '资产负债表是各期末时点余额，不是期间流量。' : 'annual是完整财年累计；quarterly是年初至报告期末累计，不是单季度，不可直接当作单季环比。',
      '当前可查询数据可能包含后续重述，不是历史时点快照；report_date_ms不代表首次披露日；日期为毫秒时间戳。',
      '购建长期资产支付的现金不等于全部资本投入或投资活动现金流净额。',
    ],
    sourceLocator: locator(data, 'evidence', { index, id: evidence.id, scopeKey: evidence.scopeKey ?? null, originalTextProperty: 'text' }),
    contextNote: '原文数值与完整rawFields重复，改用未截断的数值表及字段说明；原文保留在任务证据。',
  };
}

export function prepareResearchData(stage, data, { maxChars = 32000 } = {}) {
  if (!Number.isInteger(maxChars) || maxChars < 1000) throw new RangeError('maxChars must be an integer >= 1000');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('Research data must be an object');
  const prepared = structuredClone(data);
  if (prepared.personalResearchMemory) {
    const memory = prepared.personalResearchMemory;
    if(memory.usage?.focus===false){memory.focus=null;delete memory.researchGoal;}
    // Keep the authoritative question state and source locations, not another
    // copy of past answer bodies or PDF quotations. Actual sources are supplied
    // in evidence after their task, version and report period are checked.
    memory.evidence_refs = (memory.evidence_refs || []).map(ref => pick(ref, ['taskId','analysisRevision','evidenceId','companyCode','scopeKey','documentId','sourceUrl','pages','locator']));
    if(memory.current_result) memory.current_result = pick(memory.current_result, ['taskId','revision','scope','progress','evidenceIds','boundary']);
    delete memory.attribution_corrections; // camelCase is the same canonical data
    memory.attributionCorrections = (memory.attributionCorrections || []).map(item => ({kind:item.kind,sourceMessage:item.sourceMessage,updatedAt:item.updatedAt}));
  }
  const audit = {
    version: 'research-input-v1', stage, maxChars, inputChars: chars(data), outputChars: 0,
    inputBlocks: blockSizes(data), outputBlocks: {}, transformations: [],
    policy: '当前问题、当前关注和事实数值不静默裁剪；省略项以任务定位回查，剩余历史不能视为全部约束。字符计数不是模型Token计数。',
  };
  if(data.personalResearchMemory) audit.transformations.push({path:'personalResearchMemory',action:'project_case_state_and_source_index',reason:'保留研究问题与来源，历史回答正文和引文从已核验的evidence读取，避免重复作为事实注入。',sourceLocator:{memoryId:data.personalResearchMemory.id,version:data.personalResearchMemory.version}});
  const stamp = () => {
    prepared.contextPreparation = audit;
    if (prepared.taskContext?.truncation) {
      for (let i = 0; i < 4; i++) {
        const size = chars(prepared.taskContext);
        prepared.taskContext.truncation.charCount = size;
        prepared.taskContext.estimatedInputTokens = Math.ceil(size / 2);
      }
    }
    audit.outputBlocks = blockSizes(Object.fromEntries(Object.entries(prepared).filter(([key]) => key !== 'contextPreparation')));
    for (let i = 0; i < 4; i++) audit.outputChars = chars(prepared);
    return audit.outputChars;
  };
  const pressured = () => stamp() > maxChars;
  const record = (path, action, reason, sourceLocator) => audit.transformations.push({ path, action, reason, sourceLocator });
  if (!pressured()) return prepared;

  const context = prepared.taskContext;
  if (Array.isArray(prepared.questionHistory) && (Array.isArray(context?.recentQuestions) || Array.isArray(context?.summary?.userInstructions?.items))) {
    delete prepared.questionHistory;
    record('questionHistory', 'remove_duplicate_history', 'taskContext已有带消息定位的历史账本；当前问题应由currentQuestion完整提供。', locator(data, 'messages'));
  }
  if (pressured() && prepared.previousResult) {
    prepared.previousResult = previousIndex(prepared.previousResult, prepared);
    record('previousResult', 'replace_with_source_index', '上版答案不作为事实重复投喂，保留同范围主张、未决条件及证据ID。', locator(data, 'result', { revision: data.previousResult.revision ?? null }));
  }
  if (pressured() && Array.isArray(prepared.evidence)) {
    prepared.evidence = prepared.evidence.map((evidence, index) => {
      const projected = financialProjection(evidence, prepared, index);
      if (projected !== evidence) record(`evidence[${index}]`, 'project_complete_numeric_table', '保留全部rawFields、字段解释、单位、范围与来源，移除重复渲染的数值正文。', projected.sourceLocator);
      return projected;
    });
  }
  // Further loss requires a separately supplied complete current question. Without it,
  // preserving an excerpt of the latest message would silently change the live request.
  const hasCurrentQuestion = typeof prepared.currentQuestion === 'string' ? !!prepared.currentQuestion : !!prepared.currentQuestion?.text;
  if (pressured() && hasCurrentQuestion && Array.isArray(context?.recentQuestions) && Array.isArray(context?.summary?.userInstructions?.items)) {
    context.recentQuestions = [];
    context.truncation ||= {};
    context.truncation.occurred = true;
    record('taskContext.recentQuestions', 'remove_duplicate_history', '原话摘录已在userInstructions账本；本轮原问题由currentQuestion独立完整保留。', locator(data, 'messages'));
  }
  const instructions = context?.summary?.userInstructions;
  if (pressured() && hasCurrentQuestion && Array.isArray(instructions?.items) && instructions.items.length > 2) {
    const oldItems = instructions.items;
    for (const recentCount of [4, 2, 1]) {
      const selected = [...new Map([oldItems[0], ...oldItems.filter(item => item.pinned), ...oldItems.slice(-recentCount)].map(item => [item.id ?? item.messageIndex, item])).values()];
      instructions.items = selected;
      instructions.selection = '预算降级：仅保留首条与近期原话摘录，不代表全部用户要求；被省略历史仍在原任务messages中。当前问题独立完整保留。';
      context.truncation ||= {};
      context.truncation.occurred = true;
      context.truncation.retainedInstructionCount = selected.length;
      context.truncation.omittedInstructionCount = (data.taskContext?.truncation?.omittedInstructionCount || 0) + oldItems.length - selected.length;
      if (!pressured()) break;
    }
    const selectedIds = new Set(instructions.items.map(item => item.id ?? item.messageIndex));
    record('taskContext.summary.userInstructions.items', 'omit_older_message_excerpts', '仅按时间确定性折叠，未推断哪些约束可忽略；必要时应回查原任务。', locator(data, 'messages', { omittedMessageIndexes: oldItems.filter(item => !selectedIds.has(item.id ?? item.messageIndex)).map(item => item.messageIndex ?? item.id) }));
  }
  if (pressured()) {
    const error = Object.assign(new Error('当前问题、必要证据与固定研究状态超过输入预算；未裁剪当前要求或财务数值。请缩小本次问题或资料范围。'), { code: 'CONTEXT_BUDGET_EXCEEDED', category: 'context_limit', retryable: false, contextPreparation: audit });
    throw error;
  }
  return prepared;
}
