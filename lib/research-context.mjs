import { isMemoryDerivedRevisionInvalid } from './memory-policy.mjs';
/** A deterministic, bounded task ledger. It does not infer preferences or summarize stance. */
const stringify = value => JSON.stringify(value);
const string = value => value == null ? '' : String(value);
const pick = (object, keys) => Object.fromEntries(keys.filter(key => object?.[key] !== undefined).map(key => [key, object[key]]));

function excerpt(value, limit) {
  const text = string(value);
  if (text.length <= limit) return { text, originalChars: text.length, truncated: false };
  const head = Math.ceil(limit * 0.65), tail = limit - head;
  return { text: text.slice(0, head) + '\n[原文中段已省略]\n' + text.slice(-tail), originalChars: text.length, truncated: true, sourceSpans: [[0, head], [text.length - tail, text.length]] };
}

export function buildResearchContext(task, { maxChars = 18000, maxRecentMessages = 8 } = {}) {
  if (!Number.isInteger(maxChars) || maxChars < 3000) throw new RangeError('maxChars must be an integer >= 3000');
  if (!Number.isInteger(maxRecentMessages) || maxRecentMessages < 1 || maxRecentMessages > 50) throw new RangeError('maxRecentMessages must be 1..50');
  const messages = Array.isArray(task.messages) ? task.messages : [];
  const allUsers = messages.map((message, index) => ({ ...message, messageIndex: index })).filter(message => message.from === 'user');
  const cutoffMessage = allUsers.findLast(message => message.kind === 'revise');
  const users = allUsers.filter(message => !cutoffMessage || message.messageIndex >= cutoffMessage.messageIndex);
  const root = cutoffMessage || users[0] || { id: null, revision: task.revision ?? 0, text: task.input, messageIndex: null, kind: 'input' };
  const messageRecord = (message, limit) => ({ id: message.id ?? null, revision: message.revision ?? null, messageIndex: message.messageIndex, kind: message.kind ?? 'chat', pinned: task.contextPinnedMessageIds?.includes(message.id) || false, ...excerpt(message.text, limit) });
  let textLimit = 1600, recentCount = Math.min(maxRecentMessages, users.length), instructionCount = Math.min(100, users.length), evidenceCount = 40, failureCount = 4;
  const make = () => {
    // Preserve early instructions and recent updates without claiming these are all semantic constraints.
    const pinnedIds = new Set(Array.isArray(task.contextPinnedMessageIds) ? task.contextPinnedMessageIds : []);
    const priority = [...users.filter(message => pinnedIds.has(message.id)), ...users.slice(0, 2), ...users.slice(-Math.max(0, instructionCount - 2))];
    const selected = [...new Map(priority.map(message => [message.messageIndex, message])).values()].slice(0, instructionCount).sort((a, b) => a.messageIndex - b.messageIndex);
    const rawScope = task.researchScope || task.pendingResearchScope;
    const scope = rawScope ? pick(rawScope, ['name', 'thscode', 'period', 'year', 'quarter', 'yearsCount', 'scopeKey']) : null;
    if (scope) for (const key of Object.keys(scope)) if (typeof scope[key] === 'string') scope[key] = scope[key].slice(0, 160);
    const evidence = Array.isArray(task.evidence) ? task.evidence : [];
    const checkpoints = task.checkpoint?.evidence || (Array.isArray(task.evidenceCheckpoints) ? task.evidenceCheckpoints : Array.isArray(task.checkpoints) ? task.checkpoints : []);
    const failedTools = (task.toolRuns || []).filter(run => ['failed', 'cancelled', 'timeout'].includes(run.status));
    const instructions = selected.map(message => messageRecord(message, textLimit));
    const recentQuestions = users.slice(-recentCount).map(message => messageRecord(message, Math.min(textLimit, 1200)));
    const result = {
      summary: {
        taskId: task.id ?? null, revision: task.revision ?? null,
        originalGoal: messageRecord(root, textLimit),
        explicitFocus: task.focus?.source === 'user' ? { ...pick(task.focus, ['source', 'version', 'scopeKey']), ...excerpt(task.focus.text, Math.min(textLimit, 1200)) } : null,
        researchScope: scope,
        snapshotAnalysisRevision: isMemoryDerivedRevisionInvalid(task) ? null : task.result?.revision ?? null,
        snapshotNote: '范围、未决条件与 evidenceIds 是已有分析快照；revise 后不能当作新范围已取证。最终以本轮独立传入的 scope/evidence 为准。',
        userInstructions: { selection: '用户原话，未推断哪些是约束；优先保留显式固定消息、前两条及近期消息。省略内容需回查原文，不能声称已覆盖所有要求。', sinceRevision: cutoffMessage?.revision ?? null, items: instructions },
        unresolvedCondition: !isMemoryDerivedRevisionInvalid(task) && task.result?.keyCondition ? { question: excerpt(task.result.keyCondition.question, Math.min(textLimit, 700)), nextCheck: excerpt(task.result.keyCondition.nextCheck, Math.min(textLimit, 700)), nextAction: pick(task.result.nextAction, ['kind', 'toolId']) } : null,
        memoryInvalidation: task.memoryInvalidation || null,
        evidenceIds: evidence.slice(0, evidenceCount).map(item => string(item.id).slice(0, 180)),
        recovery: { status: task.status ?? null, error: task.error ? excerpt(typeof task.error === 'string' ? task.error : stringify(task.error), Math.min(textLimit, 700)) : null, execution: task.execution ? pick(task.execution, ['id', 'revision', 'status', 'stage', 'endReason']) : null, failedTools: failedTools.slice(-failureCount).map(run => ({ ...pick(run, ['id', 'callId', 'attempt', 'revision', 'tool', 'status', 'category', 'retryable', 'retryScheduled']), message: excerpt(run.message || run.error, 250) })), checkpointIds: checkpoints.slice(-evidenceCount).map(checkpoint => string(checkpoint.id || checkpoint.toolId || checkpoint.evidence?.id || '').slice(0, 180)) },
        previousFailure: task.previousFailure ? { ...pick(task.previousFailure, ['revision','status','endReason','category','scopeKey']), message: excerpt(task.previousFailure.message, 400) } : null,
        boundary: '用户看法 userView 不属于研究指令；本摘要不推断立场。',
      },
      recentQuestions,
      truncation: { occurred: false, maxChars, charCount: 0, originalUserMessageCount: users.length, retainedInstructionCount: selected.length, omittedInstructionCount: users.length - selected.length, omittedRecentCount: users.length - recentQuestions.length, omittedEvidenceCount: Math.max(0, evidence.length - evidenceCount), omittedFailureCount: Math.max(0, failedTools.length - failureCount), sourceLocator: { taskId: task.id ?? null, collection: 'messages', sinceMessageIndex: root.messageIndex, selectedMessageIndexes: selected.map(message => message.messageIndex) }, note: '按 JavaScript UTF-16 字符计数；文本裁剪保留头尾及原文位置。Token 为粗估，不能保证模型窗口。' },
      estimatedInputTokens: 0,
    };
    result.truncation.occurred = result.truncation.omittedInstructionCount > 0 || result.truncation.omittedRecentCount > 0 || result.truncation.omittedEvidenceCount > 0 || result.truncation.omittedFailureCount > 0 || /"truncated":true/.test(stringify(result.summary)) || recentQuestions.some(item => item.truncated);
    // Includes this metadata; settle digit-length changes before returning the actual bound.
    for (let i = 0; i < 4; i++) { const chars = stringify(result).length; result.truncation.charCount = chars; result.estimatedInputTokens = Math.ceil(chars / 2); }
    return result;
  };
  let output = make();
  for (let attempts = 0; stringify(output).length > maxChars && attempts < 100; attempts++) {
    if (textLimit > 64) textLimit = Math.max(64, Math.floor(textLimit * 0.7));
    else if (recentCount > 1) recentCount--;
    else if (instructionCount > 2) instructionCount = Math.max(2, Math.floor(instructionCount * 0.7));
    else if (evidenceCount > 0) evidenceCount = Math.max(0, evidenceCount - 5);
    else if (failureCount > 1) failureCount--;
    else throw new RangeError('Structured context metadata exceeds maxChars; increase the budget');
    output = make();
  }
  return output;
}
