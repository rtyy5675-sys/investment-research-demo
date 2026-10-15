import React, { useId, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronDown, LoaderCircle, Pencil, RotateCw, Settings2, Trash2, X } from 'lucide-react';
import { researchStorageLabels } from './lib/research-storage.js';
import { researchResumeScope, researchResumePeriod } from './lib/research-resume.js';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './components/ui/sheet';

const originLabel = focus => focus?.status==='withdrawn' ? '此前关注已撤回' : ['third_party','quoted'].includes(focus?.source) ? '转述的他人观点' : focus?.source === 'user' ? '你明确的关注' : 'AI 暂拟的关注 · 可修改';
const focusOf = entry => Array.isArray(entry?.focus) ? entry.focus[0] : entry?.focus;
const usedEntries = used => Array.isArray(used) ? used : used?.entries || (used?.entry ? [used.entry] : used ? [used] : []);
const questionText = question => typeof question === 'string' ? question : question?.text || question?.question || '';
function openQuestions(entry) {
  return Array.isArray(entry?.open_questions)
    ? entry.open_questions.filter(question => question?.status !== 'resolved' && question?.status !== 'withdrawn')
    : entry?.unresolved?.question ? [entry.unresolved] : [];
}
const resolvedQuestions = entry => Array.isArray(entry?.resolved_questions) ? entry.resolved_questions : [];
const companyLabel = entry => entry.companyName || entry.companyCode || '这项研究';
const dateLabel = value => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
function scopeLabel(scope) {
  if (!scope) return '';
  if (typeof scope === 'string') return scope;
  const years = scope.years || scope.year;
  const yearText = Array.isArray(years) ? years.join('、') : years;
  const period = scope.periodLabel || (scope.period==='annual'?'年度':scope.period==='quarterly'?({1:'一季度累计',2:'上半年累计',3:'前三季度累计',4:'全年累计'}[scope.quarter]||'累计季度'):scope.period) || scope.reportType || scope.reportPeriod;
  const parts = [yearText, period].filter(value => typeof value === 'string' || typeof value === 'number');
  if (!parts.length && scope.start && scope.end) return `${scope.start} — ${scope.end}`;
  return parts.join(' · ');
}
function FocusOrigin({ focus }) {
  const provenance=focus?.provenance;
  if(provenance?.kind==='memory_editor'||focus?.updatedBy==='memory_editor')return <p className="pm-note">关注来源：记忆管理中的明确修改{dateLabel(provenance?.updatedAt||focus?.updatedAt)&&` · ${dateLabel(provenance?.updatedAt||focus?.updatedAt)}`}</p>;
  if(provenance?.taskId)return <p className="pm-note">关注来源：<a href={`/?task=${encodeURIComponent(provenance.taskId)}`}>{['third_party','quoted'].includes(focus?.source)?'转述的他人观点':provenance.kind==='user_message'?'用户原话':'AI 暂拟理解'}{scopeLabel(provenance.scope)&&` · ${scopeLabel(provenance.scope)}`}</a></p>;
  return <p className="pm-note">关注来源：旧记录未单独保存，可修改后明确。</p>;
}

export function MemoryHome({ memories = [], loading = false, error = '', storage, onRefresh, onContinue, onManage }) {
  const entries = memories.filter(entry => !entry.disabled).slice(0, 3);
  const storageLabels = researchStorageLabels(storage);
  return <section className="pm-home" aria-label="接着上次研究" aria-busy={loading}>
    <div className="pm-section-heading"><h2>接着上次研究</h2><button type="button" onClick={onManage}><Settings2 size={13} />管理研究记忆</button></div>
    {loading && <p className="pm-loading" role="status"><LoaderCircle size={14} className="spin" />正在读取研究进度…</p>}
    {error && <div className="pm-home-error" role="alert"><p>暂时无法读取研究记录，不能据此判断记录是否存在。</p><p>{typeof error === 'string' ? error : error.message}</p><button type="button" onClick={onRefresh} disabled={loading}><RotateCw size={13} />重新读取</button></div>}
    {entries.length ? <div className="pm-home-list">{entries.map(entry => {
      const pending = openQuestions(entry);
      const remaining = questionText(pending[0]);
      const scope = researchResumeScope(entry);
      const previousChange = entry.current_result?.progress?.change || entry.researchProgress?.change;
      return <button type="button" className="pm-continue" key={entry.id} disabled={loading || !!error} onClick={() => onContinue?.(entry)}>
        <div><strong>{companyLabel(entry)}</strong><span>{researchResumePeriod(scope) || '报告期待补充'}</span></div>
        <span className="pm-stop-label">{remaining ? '上次停在这里' : '上次研究进展'}</span>
        <p className="pm-stop-question">{remaining || previousChange || '暂未记录具体进度，可确认报告期后继续研究。'}</p>
        {focusOf(entry)?.text && <p className="pm-card-focus">{originLabel(focusOf(entry))}：{focusOf(entry).text}</p>}
        <span className="pm-continue-footer">{!scope ? '补充报告期后继续' : remaining ? '继续核查原报告期' : '沿用原报告期继续'}<ArrowRight size={14} /></span>
      </button>;
    })}</div> : !loading && !error && <p className="pm-empty">当前服务没有可沿用的研究记录。完成研究后，关注和进度会显示在这里。</p>}
    <p className="pm-home-note">{storageLabels.note}</p>
  </section>;
}

export function MemoryInline({ task, revision, onDisable, onManage, busy = false }) {
  if (task?.memoryPolicy?.enabled === false || revision !== task?.result?.revision) return null;
  const entry = usedEntries(task?.memoryUsed).find(item => !item.disabled);
  if (!entry) return null;
  const focus = focusOf(entry);
  const resolved = questionText(resolvedQuestions(entry)[0]);
  const remaining = questionText(openQuestions(entry)[0]);
  const sourceTask = entry.source?.taskId || focus?.provenance?.taskId;
  const context = [resolved && `上次已解决：${resolved}`, remaining && `这次接着核查：${remaining}`].filter(Boolean).join('；') || focus?.text;
  if (!context) return null;
  return <section className="pm-use research-update" aria-label="本轮沿用的研究进度">
    <strong>接着上次的研究</strong><p>{context}</p>
    <div className="pm-use-top">{sourceTask && <a href={`/?task=${encodeURIComponent(sourceTask)}`}>查看来源</a>}{onManage && <button type="button" onClick={onManage} disabled={busy}>修改关注</button>}{onDisable && <button type="button" onClick={onDisable} disabled={busy}>本次不用</button>}</div>
  </section>;
}

export function MemoryUse({ task, onDisable, onEnable, onManage, busy = false }) {
  const used = task?.memoryUsed;
  const entries = usedEntries(used).filter(entry => !entry.disabled);
  if (task?.memoryPolicy?.enabled === false) return <section className="pm-use pm-use-disabled" aria-label="本次研究记忆"><span>本次不沿用研究记忆。</span>{onEnable && <button type="button" disabled={busy} onClick={onEnable}>允许沿用</button>}<button type="button" onClick={onManage}>管理</button></section>;
  const entry = entries[0];
  const focus = focusOf(entry);
  const pending = openQuestions(entry);
  const saved = task.result && task.memoryStatus === 'saved' && task.memorySaved?.analysisRevision === task.result.revision ? task.memorySaved : null;
  if (!entry && !saved) return null;
  return <section className="pm-use" aria-label="本次沿用的研究背景">
    {entry && <><div className="pm-memory-focus"><span>本轮沿用</span><p>{entry.usage?.focus===false ? '本轮按当前关注分析，仅读取此前研究进度。' : focus?.text || '此前研究进度'}</p></div>
    <div className="pm-memory-unresolved"><strong>进入本轮时未解决</strong><p>{pending.length ? pending.slice(0, 2).map(questionText).join('；') : '没有记录未决问题。'}</p></div></>}
    {saved && <div className="pm-memory-unresolved"><strong>本轮更新</strong>{saved.resolvedQuestions?.length > 0 && <p>新增解决：{saved.resolvedQuestions.map(questionText).join('；')}</p>}<p>仍待核查：{saved.openQuestions?.length ? saved.openQuestions.map(questionText).join('；') : '本轮记录中没有未决问题。'}</p></div>}
    {entry && <><div className="pm-use-top"><span>{entry.usage?.focus===false?'本轮未沿用旧关注':originLabel(focus)}</span><button type="button" onClick={onManage}>修改</button><button type="button" disabled={busy} onClick={onDisable}>本次不用</button></div>
    <details><summary>来源与适用范围<ChevronDown size={12} /></summary><div className="pm-use-details">{entry.usage?.focus!==false&&<FocusOrigin focus={focus} />}{entry.source?.taskId && <p><a href={`/?task=${encodeURIComponent(entry.source.taskId)}`}>来源研究{entry.version ? ` · 记录第 ${entry.version} 版` : ''}</a></p>}{scopeLabel(entry.source?.scope) && <p>上次研究期间：{scopeLabel(entry.source.scope)}</p>}<p className="pm-note">历史关注不作为本期财务事实。</p></div></details></>}
  </section>;
}

function MemoryEntry({ entry, onUpdate, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editButton = useRef(null), deleteButton = useRef(null);
  const id = useId();
  const focus = focusOf(entry);
  const pending = openQuestions(entry);
  const resolved = resolvedQuestions(entry);
  function edit() {
    setDraft({ focusText: focus?.text || '', unresolvedQuestion: questionText(pending[0]), unresolvedNextCheck: pending[0]?.nextCheck || '', expectedVersion: entry.version });
    setEditing(true); setConfirmDelete(false); setError(''); setSaved(false);
  }
  async function mutate(action) {
    setBusy(true); setError(''); setSaved(false);
    try { await action(); setSaved(true); return true; }
    catch (failure) { setError(failure?.message || '未能保存，输入已保留。请重试。'); return false; }
    finally { setBusy(false); }
  }
  async function save(event) {
    event.preventDefault();
    if (await mutate(() => onUpdate(entry.id, { ...draft, disabled: !!entry.disabled }))) setEditing(false);
  }
  return <article className={`pm-entry ${entry.disabled ? 'pm-entry-disabled' : ''}`}>
    <div className="pm-entry-heading"><div><h3>{companyLabel(entry)}</h3>{entry.companyCode && entry.companyName && <small>{entry.companyCode}</small>}</div><span className="pm-entry-state">{entry.disabled ? '已停用' : '可用于接续'}</span></div>
    {editing ? <form onSubmit={save}>
      <label htmlFor={`${id}-focus`}>你希望后续沿用的关注点</label><textarea autoFocus id={`${id}-focus`} value={draft.focusText} maxLength={3000} rows={3} onChange={event => setDraft({ ...draft, focusText: event.target.value })} />
      <p className="pm-note">保存修改后，这条关注点将标为由你明确。</p>
      <label htmlFor={`${id}-question`}>尚未解决的问题</label><textarea id={`${id}-question`} value={draft.unresolvedQuestion} maxLength={3000} rows={2} onChange={event => setDraft({ ...draft, unresolvedQuestion: event.target.value })} />
      <label htmlFor={`${id}-check`}>下一步需要核查什么</label><textarea id={`${id}-check`} value={draft.unresolvedNextCheck} maxLength={3000} rows={2} onChange={event => setDraft({ ...draft, unresolvedNextCheck: event.target.value })} />
      <div className="pm-entry-actions"><button className="pm-primary" type="submit" disabled={busy || !draft.focusText.trim()}>{busy && <LoaderCircle size={13} className="spin" />}保存修改</button><button type="button" disabled={busy} onClick={() => { setEditing(false); setError(''); requestAnimationFrame(() => editButton.current?.focus()); }}>取消</button></div>
    </form> : <><div className="pm-entry-field"><span>{originLabel(focus)}</span><p>{focus?.text || '未记录关注点'}</p></div>{pending.length > 0 && <div className="pm-entry-field"><span>仍未解决</span>{pending.map((question, index) => <React.Fragment key={question?.id || index}><p>{questionText(question)}</p>{question?.nextCheck && <p className="pm-next-check">下一步：{question.nextCheck}</p>}</React.Fragment>)}</div>}{resolved.length > 0 && <details><summary>已经解决 · {resolved.length} 项</summary>{resolved.map((question, index) => <p className="pm-note" key={question?.id || index}>{questionText(question)}</p>)}</details>}
      <div className="pm-entry-actions"><button ref={editButton} type="button" disabled={busy} onClick={edit}><Pencil size={13} />修改</button><button type="button" disabled={busy} onClick={() => mutate(() => onUpdate(entry.id, { disabled: !entry.disabled, expectedVersion: entry.version }))}>{entry.disabled ? '启用' : '停用'}</button><button ref={deleteButton} type="button" className="pm-delete" disabled={busy} onClick={() => { setConfirmDelete(true); setError(''); }}><Trash2 size={13} />删除记忆</button>{busy && <LoaderCircle size={13} className="spin" />}</div></>}
    {confirmDelete && !editing && <div className="pm-delete-confirm" role="group" aria-label="确认删除记忆"><p>删除{companyLabel(entry)}的研究记忆？相关会话和研究结果会保留。</p><div><button type="button" disabled={busy} onClick={() => mutate(() => onRemove(entry.id, entry.version))}>确认删除记忆</button><button type="button" disabled={busy} onClick={() => { setConfirmDelete(false); requestAnimationFrame(() => deleteButton.current?.focus()); }}>取消</button></div></div>}
    {error && <p className="pm-error" role="alert">{error}{editing && ' 编辑内容已保留；若版本冲突，请先复制本次修改，再刷新核对最新记录。'}</p>}
    {saved && !editing && <p className="pm-saved" role="status"><Check size={12} />已保存</p>}
    <FocusOrigin focus={focus} /><div className="pm-entry-meta">{scopeLabel(entry.source?.scope) && <span>最近研究期间：{scopeLabel(entry.source.scope)}</span>}{entry.source?.taskId && <a href={`/?task=${encodeURIComponent(entry.source.taskId)}`}>查看最近研究{entry.source.analysisRevision ? ` · 第 ${entry.source.analysisRevision} 版` : ''}</a>}{dateLabel(entry.updatedAt || entry.source?.updatedAt) && <span>保存于 {dateLabel(entry.updatedAt || entry.source?.updatedAt)}</span>}</div>
  </article>;
}

export function MemoryManager({ storage, open, entries = [], loading = false, error = '', onClose, onRefresh, onUpdate, onRemove }) {
  const close = useRef(null);
  const opener = useRef(null);
  return <Sheet open={open} onOpenChange={nextOpen => { if (!nextOpen) onClose?.(); }}>
    <SheetContent className="pm-manager gap-0 sm:max-w-[480px]" side="right" showCloseButton={false}
      onOpenAutoFocus={event => { opener.current = document.activeElement; event.preventDefault(); close.current?.focus(); }}
      onCloseAutoFocus={event => { event.preventDefault(); const target = opener.current; if (target?.isConnected && target.matches('button,a[href],input,textarea,[tabindex]')) target.focus(); else document.querySelector('button[aria-label="研究上下文"]')?.focus(); }}>
    <SheetHeader className="pm-manager-header flex-row"><div><SheetTitle>研究记忆</SheetTitle><SheetDescription>接续关注与未决问题，保留来源。</SheetDescription></div><SheetClose asChild><button type="button" ref={close} aria-label="关闭研究记忆"><X size={19} /></button></SheetClose></SheetHeader>
    <div className="pm-manager-body"><div className="pm-manager-intro"><p>记忆用于接上此前的研究，不替你作投资判断。停用后不再沿用；删除只移除这条记忆，原会话仍保留。</p><button type="button" onClick={onRefresh} disabled={loading}><RotateCw size={13} className={loading ? 'spin' : ''} />{loading ? '刷新中' : '刷新记录'}</button></div>
      {error && <p className="pm-error" role="alert">{typeof error === 'string' ? error : error.message}</p>}
      {loading && !entries.length && <p className="pm-loading" role="status"><LoaderCircle size={16} className="spin" />正在读取研究记忆…</p>}
      {!loading && !entries.length && <div className="pm-manager-empty"><BookOpen size={24} /><h3>还没有研究记忆</h3><p>完成一项研究后，相关关注点和未决问题会出现在这里。你可以随时修改、停用或删除。</p></div>}
      {entries.map(entry => <MemoryEntry key={entry.id} entry={entry} onUpdate={onUpdate} onRemove={onRemove} />)}
    </div><footer className="pm-manager-footer">{researchStorageLabels(storage).note}</footer>
    </SheetContent>
  </Sheet>;
}
