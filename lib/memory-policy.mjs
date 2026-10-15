/** Invalidate injectable memory derivatives while retaining the original conversation for display. */
export function reconcileTaskMemory(task, liveEntry, { readFailed = false, reason, throughRevision } = {}) {
  const used = task.memoryUsed;
  const saved = task.memorySaved;
  const selectedId = task.memoryPolicy?.selectedMemoryId;
  const reference = used?.id
    ? saved?.id === used.id && (saved.version || 0) >= (used.version || 0) ? saved : used
    : saved;
  const expectedId = used?.id || saved?.id || selectedId;
  if (!expectedId) return { invalidated: false, reason: null };

  let cause = reason || null;
  if (readFailed) cause = 'unavailable';
  else if (!liveEntry || liveEntry.id !== expectedId) cause ||= 'removed';
  else if (liveEntry.disabled) cause ||= 'disabled';
  else if (reference?.version != null && reference.version !== liveEntry.version) cause ||= 'changed';
  if (!cause) return { invalidated: false, reason: null };

  const barrier = Number.isInteger(throughRevision) ? throughRevision
    : Number.isInteger(task.result?.revision) ? task.result.revision : task.revision || 0;
  task.contextInvalidatedThroughRevision = Math.max(task.contextInvalidatedThroughRevision || 0, barrier);
  const currentExplicit = focus => focus?.source === 'user' && (task.messages || []).some(message =>
    message.from === 'user' && message.kind === 'focus' && message.revision === task.revision
    && message.revision > task.contextInvalidatedThroughRevision && message.text?.trim() === focus.text?.trim());
  if (!currentExplicit(task.focus)) task.focus = null;
  if (task.lastOperation?.kind === 'focus' && !currentExplicit(task.lastOperation.focus)) {
    // Clearing the object alone is insufficient: retry would reinsert the old
    // focus text as a new user message and give it priority over the correction.
    task.lastOperation = null;
  } else if (task.lastOperation?.focus && !currentExplicit(task.lastOperation.focus)) task.lastOperation = { ...task.lastOperation, focus: null };
  // These are active input/capture pointers, not the historical result or source conversation.
  task.memoryUsed = null;
  task.memorySaved = null;
  task.contextSummary = null;
  task.memoryInvalidation = { id: expectedId, version: reference?.version ?? null, reason: cause, throughRevision: task.contextInvalidatedThroughRevision };
  task.memoryPolicy = { ...task.memoryPolicy, captureBlockedRevision: task.revision };
  if (!readFailed && (!liveEntry || liveEntry.id !== expectedId || liveEntry.disabled)) {
    task.memoryPolicy.selectedMemoryId = null;
    task.memoryPolicy.enabled = false;
  }
  if (readFailed) task.memoryWarning = '个人记忆暂时无法校验，本轮不沿用旧记忆及其衍生分析。原会话仍保留。';
  return { invalidated: true, reason: cause };
}

export function isMemoryDerivedRevisionInvalid(task, revision = task.result?.revision) {
  return Number.isInteger(revision) && Number.isInteger(task.contextInvalidatedThroughRevision)
    && revision <= task.contextInvalidatedThroughRevision;
}
