import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { contextIntent, normalizeResearchCase, projectResearchCase } from './research-case.mjs';

const clone = value => value == null ? value : structuredClone(value);
const queues = new Map();
const codePattern = /^\d{6}\.(SZ|SH|BJ)$/;
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function content(value, limit = 3000) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) fail(`内容不能为空，且不能超过 ${limit} 字。`);
  return value.trim();
}
function validScope(scope) {
  return scope && codePattern.test(scope.thscode) && typeof scope.name === 'string' && scope.name.trim()
    && Number.isInteger(scope.year) && scope.year >= 1990 && scope.year <= 2200
    && (scope.period === 'annual' || (scope.period === 'quarterly' && [1, 2, 3, 4].includes(scope.quarter)));
}
function scopeRecord(scope) {
  return Object.fromEntries(['thscode', 'name', 'period', 'year', 'quarter', 'yearsCount', 'scopeKey'].filter(key => scope[key] !== undefined).map(key => [key, clone(scope[key])]));
}
function matchingCode(input, code) {
  const six = code.slice(0, 6);
  return new RegExp(`(?<![0-9A-Za-z])${six}(?:\\.${code.slice(7)})?(?![0-9A-Za-z.]|\\.[A-Za-z])`, 'i').test(input);
}

// This is one local person's research context, never a financial fact cache or investor profile.
export function createResearchMemoryStore(directory, { ownerId = 'local-personal', now = () => new Date() } = {}) {
  const file = resolve(join(directory, 'personal-research-memory.json'));
  const timestamp = () => new Date(now()).toISOString();
  const enqueue = operation => {
    const result = (queues.get(file) || Promise.resolve()).then(operation);
    const drained = result.catch(() => {});
    queues.set(file, drained);
    drained.then(() => { if (queues.get(file) === drained) queues.delete(file); });
    return result.then(clone);
  };
  async function read() {
    try {
      const data = JSON.parse(await readFile(file, 'utf8'));
      if (data.schemaVersion !== 1 || !Array.isArray(data.entries) || !data.captures || !data.focusOverrides) throw new Error('研究记忆文件格式无效。');
      data.entries = data.entries.map(normalizeResearchCase);
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return { schemaVersion: 1, entries: [], captures: {}, focusOverrides: {} };
      throw error;
    }
  }
  async function commit(data) {
    await mkdir(directory, { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await rename(temporary, file);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  const owned = (data, id) => data.entries.find(entry => entry.ownerId === ownerId && entry.id === id);
  const ordered = data => data.entries.filter(entry => entry.ownerId === ownerId && !entry.disabled).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const checkVersion = (entry, expectedVersion) => {
    if (!entry) fail('这条研究记忆不存在或已删除。', 404);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== entry.version) fail('研究记忆已更新，请刷新后再修改。', 409);
  };
  return {
    list() { return enqueue(async () => (await read()).entries.filter(entry => entry.ownerId === ownerId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); },
    get(id) { return enqueue(async () => owned(await read(), id) || null); },
    capturePolicy(companyCode) {
      return enqueue(async () => {
        const entry=(await read()).entries.find(item=>item.ownerId===ownerId&&item.companyCode===companyCode);
        return {companyCode,memoryId:entry?.id??null,version:entry?.version??null,enabled:!entry?.disabled};
      });
    },
    capture(task) {
      const snapshot = task && clone(Object.fromEntries(['id', 'status', 'revision', 'result', 'researchScope', 'focus', 'messages', 'evidence', 'updatedAt', 'isEvaluation', 'memoryPolicy', 'memoryUsed', 'lastOperation', 'contextIntent'].map(key => [key, task[key]])));
      return enqueue(async () => {
        const result = snapshot?.result;
        const scope = result?.researchScope;
        if (snapshot?.status !== 'complete' || !result || result.revision !== snapshot.revision
          || !Number.isInteger(snapshot.revision) || snapshot.isEvaluation || snapshot.memoryPolicy?.enabled === false
          || snapshot.memoryPolicy?.captureBlockedRevision === snapshot.revision
          || !validScope(scope) || typeof snapshot.id !== 'string' || !snapshot.id) return null;
        if (snapshot.researchScope && (!validScope(snapshot.researchScope)
          || snapshot.researchScope.thscode !== scope.thscode
          || snapshot.researchScope.year !== scope.year || snapshot.researchScope.period !== scope.period
          || (scope.period === 'quarterly' && snapshot.researchScope.quarter !== scope.quarter))) return null;
        const data = await read();
        let entry = data.entries.find(item => item.ownerId === ownerId && item.companyCode === scope.thscode);
        // Pausing applies to writes as well as recall, including idempotent
        // retries. Do not change the entry, version or capture ledger here.
        if(entry?.disabled)return null;
        const captureKey = `${ownerId}:${snapshot.id}`;
        const priorCapture = data.captures[captureKey];
        // A deleted entry cannot be recreated by a later revision of its old
        // source task, including after a restart. A genuinely new task may
        // establish new context from its own input and fresh research.
        if (priorCapture && !owned(data, priorCapture.memoryId)) return null;
        if (priorCapture && priorCapture.revision >= snapshot.revision) return owned(data, priorCapture.memoryId) || null;
        // Preserve the policy observed before generation. A run started while
        // paused, or before a pause/resume cycle, must not backfill on return.
        const fence=snapshot.memoryPolicy?.captureFence;
        if(fence&&(!fence.enabled||fence.companyCode!==scope.thscode||fence.memoryId!==(entry?.id??null)||fence.version!==(entry?.version??null)))return null;
        // A run that used an older memory cannot undo an edit or resurrect a deletion.
        if (snapshot.memoryUsed?.id && (!entry || snapshot.memoryUsed.id !== entry.id
          || (Number.isInteger(snapshot.memoryUsed.version) && snapshot.memoryUsed.version < entry.version))) return null;
        // A delayed publication from an older task must not replace newer research progress.
        const sourceUpdatedAt = result.createdAt || snapshot.updatedAt || timestamp();
        if (entry && entry.source.taskId !== snapshot.id && sourceUpdatedAt < entry.source.updatedAt) return null;
        const id = entry?.id || randomUUID();
        const updatedAt = timestamp();
        let currentFocus = result.focus?.source === 'user' ? result.focus : snapshot.focus?.source === 'user' ? snapshot.focus : result.focus || snapshot.focus;
        const rawMessage = snapshot.messages?.findLast(message => message.from === 'user' && message.revision === snapshot.revision);
        const intent = contextIntent(rawMessage?.text);
        const establishesFocus = intent.operation === 'express_focus' && !['user','quoted'].includes(entry?.focus?.source);
        const withdrawsFocus = intent.operation === 'withdraw_default';
        if ((establishesFocus || (intent.kind === 'case' && !withdrawsFocus)) && !intent.attributionCorrection && currentFocus?.scope !== 'turn') {
          currentFocus = { text: rawMessage.text, source: 'user', sourceMessageId: rawMessage.id, scope: 'case' };
        }
        const explicitFocus = currentFocus?.scope !== 'turn' && !intent.attributionCorrection
          && !(entry?.revoked_source_ids || []).includes(currentFocus?.sourceMessageId)
          && ((!snapshot.lastOperation || snapshot.lastOperation.kind === 'focus') || establishesFocus || (intent.kind === 'case' && !withdrawsFocus))
          && currentFocus?.source === 'user' && typeof currentFocus.text === 'string' && currentFocus.text.trim();
        const sourceMessageId = (withdrawsFocus ? rawMessage?.id : null) || currentFocus?.sourceMessageId || (explicitFocus && snapshot.messages?.findLast(message => message.from === 'user' && message.text?.trim() === currentFocus.text.trim())?.id);
        const understanding = typeof result.questionUnderstanding === 'string' ? result.questionUnderstanding.trim().slice(0, 3000) : '';
        const focusProvenance = kind => ({ kind, taskId: snapshot.id, analysisRevision: snapshot.revision,
          ...(sourceMessageId && kind === 'user_message' ? { messageId: sourceMessageId } : {}),
          scope: scopeRecord(scope), updatedAt: currentFocus?.updatedAt || sourceUpdatedAt });
        // A focus can predate the latest research result. Never relabel its
        // original company/period or conversation as the newest source task.
        const priorUserFocus = (['user', 'quoted'].includes(entry?.focus?.source) || currentFocus?.scope === 'turn' || snapshot.contextIntent?.scope === 'turn') && entry?.focus ? {
          ...entry.focus,
          provenance: entry.focus.provenance || { kind: entry.focus.updatedBy === 'memory_editor' ? 'memory_editor' : 'legacy_unknown',
            taskId: null, scope: null, updatedAt: entry.focus.updatedAt || null },
        } : null;
        const focus = withdrawsFocus
          ? {text:'',source:'user',status:'withdrawn',semanticRole:'research_question',provenance:focusProvenance('user_message')}
          : explicitFocus
          ? { text: currentFocus.text.trim().slice(0, 3000), source: 'user', ...(sourceMessageId ? { sourceMessageId } : {}), provenance: focusProvenance('user_message') }
          : priorUserFocus || { text: understanding, source: 'ai', provenance: focusProvenance('ai_analysis') };
        const condition = result.keyCondition || {};
        const previousEntry = entry;
        entry = {
          id, version: (entry?.version || 0) + 1, ownerId, companyCode: scope.thscode, companyName: scope.name.trim(),
          focus: { ...focus, semanticRole: 'research_question', temporalNote: '历史关注原话中的财务状态仅适用于当时的问题，不是当期事实或投资立场。' }, researchGoal: { text: understanding, source: 'ai' },
          researchProgress: result.progress ? { status: result.progress.status, unresolvedQuestion: result.progress.remainingQuestion, analysisRevision: snapshot.revision, taskId: snapshot.id } : null,
          unresolved: { question: typeof condition.question === 'string' ? condition.question.slice(0, 3000) : '', nextCheck: typeof condition.nextCheck === 'string' ? condition.nextCheck.slice(0, 3000) : '', ...(result.nextAction?.kind==='query'&&['FUYAO-INCOME','FUYAO-CASH','FUYAO-BALANCE'].includes(result.nextAction.toolId)?{toolId:result.nextAction.toolId}:{}) },
          progress: [...new Set((result.analyses || []).map(item => typeof item.question === 'string' ? item.question.trim().slice(0, 1000) : '').filter(Boolean))].slice(0, 20),
          source: { taskId: snapshot.id, analysisRevision: snapshot.revision, scope: scopeRecord(scope), updatedAt: sourceUpdatedAt, evidenceIds:[...new Set((snapshot.evidence||[]).filter(item=>item.companyCode===scope.thscode&&item.scopeKey===scope.scopeKey).map(item=>item.id))] },
          attributionCorrections: previousEntry?.attributionCorrections || [],
          revoked_source_ids: previousEntry?.revoked_source_ids || [],
          disabled: entry?.disabled || false, updatedAt,
        };
        entry = projectResearchCase(entry, snapshot, previousEntry);
        data.entries = data.entries.filter(item => item.id !== id);
        data.entries.push(entry);
        data.captures[captureKey] = { revision: snapshot.revision, memoryId: id };
        await commit(data);
        return entry;
      });
    },
    update(id, patch, trusted = {}) {
      const changes = clone(patch);
      const sourceMessage = clone(trusted.sourceMessage);
      return enqueue(async () => {
        const data = await read();
        const entry = owned(data, id);
        checkVersion(entry, changes?.expectedVersion);
        if (changes.attributionCorrection) {
          const updatedAt = timestamp();
          const source = sourceMessage ? { id: sourceMessage.id || null, taskId: sourceMessage.taskId || null, text: content(sourceMessage.text), revision: sourceMessage.revision || null } : null;
          // A question about a premise is not that person's endorsement of it.
          // An unscoped correction must never revoke a legitimate research concern.
          const researchQuestion = /是否|能否|会不会|是不是|想.{0,8}(?:弄清|了解|知道)|关注|关心|[？?]/.test(entry.focus?.text || '');
          const appliedToFocus = entry.focus?.source === 'quoted'
            || (entry.focus?.source === 'user' && !!entry.focus.text?.trim() && !researchQuestion);
          entry.attributionCorrections = [...(entry.attributionCorrections || []), { previousFocus: clone(entry.focus), sourceMessage: source,
            kind: 'third_party_not_user', appliedToFocus, updatedAt }].slice(-20);
          if (appliedToFocus) {
            entry.revoked_source_ids = [...new Set([...(entry.revoked_source_ids || []), entry.focus?.sourceMessageId].filter(Boolean))];
            entry.focus = { ...entry.focus, source: 'quoted', attribution: 'third_party', status: 'reference',
              semanticRole: 'quoted_view', correctedAt: updatedAt,
              correctionSource: source || { kind: 'memory_editor', updatedAt } };
          }
        }
        if (changes.withdrawFocus === true) {
          const updatedAt=timestamp();
          entry.focus={text:'',source:'user',status:'withdrawn',semanticRole:'research_question',updatedAt,
            ...(sourceMessage?.id?{sourceMessageId:sourceMessage.id}:{}),
            provenance:{kind:sourceMessage?'user_message':'memory_editor',taskId:sourceMessage?.taskId||null,messageId:sourceMessage?.id||null,analysisRevision:sourceMessage?.revision||null,scope:{thscode:entry.companyCode,name:entry.companyName},updatedAt}};
          data.focusOverrides[id]=true;
        }
        if (changes.focusText !== undefined) {
          const updatedAt = timestamp();
          entry.focus = { text: content(changes.focusText), source: 'user', updatedBy: 'memory_editor', updatedAt,
            provenance: { kind: 'memory_editor', taskId: null, scope: { thscode: entry.companyCode, name: entry.companyName }, updatedAt } };
          data.focusOverrides[id] = true;
          if (sourceMessage) entry.focus = { ...entry.focus, sourceMessageId: sourceMessage.id,
            provenance: { kind: 'user_message', taskId: sourceMessage.taskId || null, messageId: sourceMessage.id || null,
              analysisRevision: sourceMessage.revision || null, scope: { thscode: entry.companyCode, name: entry.companyName }, updatedAt } };
        }
        for (const [field, target] of [['unresolvedQuestion', 'question'], ['unresolvedNextCheck', 'nextCheck']]) {
          if (changes[field] !== undefined) entry.unresolved[target] = changes[field] === '' ? '' : content(changes[field]);
        }
        if (changes.unresolvedQuestion !== undefined) {
          const previousPrimary = entry.open_questions?.[0]?.id;
          entry.researchProgress = { ...(entry.researchProgress || {}), unresolvedQuestion: entry.unresolved.question };
          entry.open_questions = (entry.open_questions || []).filter(item => item.id !== previousPrimary);
        }
        if (changes.disabled !== undefined) {
          if (typeof changes.disabled !== 'boolean') fail('disabled 必须为布尔值。');
          entry.disabled = changes.disabled;
        }
        entry.version++; entry.updatedAt = timestamp();
        const normalized = normalizeResearchCase(entry);
        Object.assign(entry, normalized);
        await commit(data);
        return entry;
      });
    },
    remove(id, options) {
      const expectedVersion = options?.expectedVersion;
      return enqueue(async () => {
        const data = await read();
        const entry = owned(data, id);
        checkVersion(entry, expectedVersion);
        data.entries = data.entries.filter(item => item.id !== id);
        delete data.focusOverrides[id];
        await commit(data);
        return entry;
      });
    },
    select(options = {}) {
      const selection = clone(options);
      return enqueue(async () => {
        const { input = '', selectedMemoryId, companyCode, excludeTaskId, enabled = true } = selection;
        if (enabled === false) return null;
        const active = ordered(await read()).filter(entry => entry.source.taskId !== excludeTaskId && (!companyCode || entry.companyCode === companyCode));
        if (selectedMemoryId) return active.find(entry => entry.id === selectedMemoryId) || null;
        if (typeof input !== 'string') return null;
        const matches = active.filter(entry => matchingCode(input, entry.companyCode) || (entry.companyName.length >= 2 && input.includes(entry.companyName)));
        return matches.length === 1 ? matches[0] : null;
      });
    },
  };
}
