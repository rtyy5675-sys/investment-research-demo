// Resolve references against persisted, published evidence. Memory summaries are
// never promoted to financial data. The caller supplies server-owned storage.
export async function restoreCaseEvidence(memory, scope, { loadTask, documentStore, ownerId = 'local-personal' }) {
  const evidence = [], documents = [], rejected = [], sources = new Map();
  if (!memory || memory.ownerId !== ownerId || memory.companyCode !== scope.thscode) return { evidence, documents, rejected };
  let refs = memory.evidence_refs || [];
  // Older records saved only the source result pointer. Recover locations from
  // that exact published version, including PDFs omitted by the old allowlist.
  if(!refs.length && /^[a-f0-9-]{36}$/.test(memory.source?.taskId||'')){
    const source=await loadTask(memory.source.taskId).catch(()=>null);
    sources.set(memory.source.taskId,source);
    const version=source?.result?.revision===memory.source.analysisRevision?{result:source.result,evidence:source.evidence}
      :source?.history?.find(item=>item.result?.revision===memory.source.analysisRevision);
    if((source?.ownerId||'local-personal')===ownerId&&version?.result?.researchScope?.scopeKey===scope.scopeKey)
      refs=(version.evidence||[]).map(item=>({taskId:memory.source.taskId,analysisRevision:memory.source.analysisRevision,evidenceId:item.id,companyCode:item.companyCode,scopeKey:item.scopeKey}));
  }
  for (const ref of refs.slice(-30)) {
    if (ref.companyCode !== scope.thscode || ref.scopeKey !== scope.scopeKey) continue;
    const reject = reason => rejected.push({ taskId: ref.taskId, evidenceId: ref.evidenceId, reason });
    if (!/^[a-f0-9-]{36}$/.test(ref.taskId || '')) { reject('invalid_source'); continue; }
    if (!sources.has(ref.taskId)) sources.set(ref.taskId, await loadTask(ref.taskId).catch(() => null));
    const source = sources.get(ref.taskId);
    if (!source || (source.ownerId || 'local-personal') !== ownerId) { reject('source_unavailable'); continue; }
    const version = source.result?.revision === ref.analysisRevision ? { result: source.result, evidence: source.evidence }
      : source.history?.find(item => item.result?.revision === ref.analysisRevision);
    const item = version?.evidence?.find(item => item.id === ref.evidenceId && item.companyCode === scope.thscode && item.scopeKey === scope.scopeKey);
    if (!item || version.result?.researchScope?.scopeKey !== scope.scopeKey) { reject('scope_or_revision_mismatch'); continue; }
    if (item.provider === 'disclosure-pdf') {
      const document = source.documents?.find(doc => doc.id === item.documentId && doc.status === 'verified');
      const stored = document && await documentStore?.load(document.id).catch(() => null);
      if (!stored || stored.document.id !== item.documentId) { reject('document_unavailable'); continue; }
      documents.push(structuredClone(document));
    } else if (item.provider !== 'fuyao-mcp') { reject('unsupported_evidence'); continue; }
    evidence.push({ ...structuredClone(item), restoredFrom: { taskId: ref.taskId, analysisRevision: ref.analysisRevision, memoryId: memory.id, memoryVersion: memory.version } });
  }
  return { evidence: [...new Map(evidence.map(item => [item.id, item])).values()], documents: [...new Map(documents.map(item => [item.id, item])).values()], rejected };
}
