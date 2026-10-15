import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Building2, Check, LoaderCircle, Settings2, X } from 'lucide-react';
import { researchStorageLabels } from './lib/research-storage.js';
import { MemoryUse } from './PersonalMemory.jsx';
import { FocusPanel } from './ResearchDecision.jsx';
import { CollaborationLog } from './CollaborationLog.jsx';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './components/ui/sheet';

function reportLabel(scope) {
  if (!scope) return '';
  const period = scope.period === 'quarterly'
    ? ({ 1: '一季度累计', 2: '上半年累计', 3: '前三季度累计', 4: '全年累计' }[scope.quarter] || '累计季度')
    : scope.period === 'annual' ? '年度' : '';
  return [scope.year && `${scope.year} 年`, period].filter(Boolean).join(' · ');
}
function memoryEntries(used) {
  return Array.isArray(used) ? used : used?.entries || (used?.entry ? [used.entry] : used ? [used] : []);
}
function useDrawer() {
  const [drawer, setDrawer] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1279px)');
    const update = () => setDrawer(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return drawer;
}
function MemorySaveState({ task, storage }) {
  const storageLabels = researchStorageLabels(storage);
  const state = task.memoryStatus;
  const committed = !!task.result && !!task.memorySaved && state === 'saved' && task.memorySaved.analysisRevision === task.result.revision;
  const label = task.memoryPolicy?.enabled === false && state !== 'saving' ? '本次不自动更新个人记录' : {
    pending: '研究完成后自动更新个人记录',
    saving: '正在更新个人研究记录',
    saved: committed ? storageLabels.memorySaved : '本轮个人记录更新尚未确认',
    failed: '个人研究记录未更新',
    skipped: task.memoryPolicy?.enabled === false || task.contextIntent?.excludeHistory ? '本次不自动更新个人记录' : '本次未更新个人研究记录',
  }[state];
  if (!label && !task.memoryWarning) return null;
  return <div className={`rc-save-state${state === 'failed' ? ' rc-save-failed' : ''}`} role="status">
    {task.storage?.status === 'saved' && <p><Check size={13} />{storageLabels.conversationSaved}</p>}
    {task.storage?.status === 'error' && <p className="rc-memory-warning">当前对话尚未保存，可在运行记录中重试。</p>}
    {label && <p>{state === 'saving' ? <LoaderCircle size={13} className="spin" /> : committed ? <Check size={13} /> : null}{label}</p>}
    {task.memoryWarning && <p className="rc-memory-warning">{task.memoryWarning}</p>}
  </div>;
}

export function ResearchContext({ task, storage, open, onClose, panelView = 'context', onPanelView, bots, Markdown, onAskWork, onFocusConversation, onManageMemory, onDisableMemory, onEnableMemory, onApplyFocus, onRevise, posting = false }) {
  const close = useRef(null), opener = useRef(null), openingMemory = useRef(false), returningToChat = useRef(false);
  const title = useId();
  const drawer = useDrawer();
  if (!task) return null;
  const scope = task.researchScope || task.result?.researchScope || task.checkpoint?.scope;
  const company = scope?.name || scope?.companyName;
  const code = scope?.thscode || scope?.companyCode;
  const focus = task.focus || task.result?.focus;
  const busy = posting || task.status === 'running';
  const used = memoryEntries(task.memoryUsed);
  const collaboration = panelView === 'collaboration';
  const panelTitle = collaboration ? '协作记录' : '研究上下文';
  function manageMemory() {
    // The manager owns the next modal; do not restore context focus during the handoff.
    openingMemory.current = true;
    if (drawer) onClose?.();
    onManageMemory?.();
  }
  const heading = <><div><span className="rc-eyebrow">{collaboration ? 'RESEARCH TEAM' : 'RESEARCH CONTEXT'}</span>{drawer ? <SheetTitle>{panelTitle}</SheetTitle> : <h2 id={title}>{panelTitle}</h2>}</div>{drawer ? <SheetClose asChild><button ref={close} type="button" className="rc-icon-button" aria-label="关闭研究侧栏"><X size={18} /></button></SheetClose> : <button type="button" className="rc-icon-button" onClick={onClose} aria-label="关闭研究侧栏"><X size={18} /></button>}</>;
  const contents = <>
      {drawer ? <SheetHeader className="rc-header flex-row">{heading}<SheetDescription className="sr-only">查看研究上下文或实际发生的 Bot 协作记录，主对话保持与研究助手沟通。</SheetDescription></SheetHeader> : <header className="rc-header">{heading}</header>}
      <div className="rc-view-switch" role="group" aria-label="研究侧栏内容"><button type="button" aria-pressed={!collaboration} onClick={() => onPanelView('context')}>研究上下文</button><button type="button" aria-pressed={collaboration} onClick={() => onPanelView('collaboration')}>协作记录</button></div>
      {collaboration ? <CollaborationLog key={task.id} task={task} bots={bots} Markdown={Markdown} onAsk={(message, role) => { returningToChat.current = drawer; onAskWork(message, role); }} /> : <div className="rc-content">
        <section className="rc-section rc-scope" aria-label="研究范围"><div className="rc-section-title"><Building2 size={14} /><h3>研究对象</h3></div>
          {scope ? <><strong className="rc-company">{company || code || '已确认的研究对象'}</strong>{company && code && <span className="rc-company-code">{code}</span>}<p className="rc-period">{reportLabel(scope) || '报告期间待确认'}</p>{scope.years?.length > 1 && <p className="rc-caption">比较期间：{scope.years.join('、')} 年</p>}</> : <p className="rc-empty">研究对象和报告期间尚未确认。确认后会显示在这里。</p>}
          <button type="button" className="rc-text-button" onClick={onRevise} disabled={posting}>修改研究问题<ArrowUpRight size={13} /></button>
        </section>
        <section className="rc-section rc-focus">{used.length ? <details><summary>本轮问题理解与调整</summary><FocusPanel key={task.id} focus={focus} originalQuestion={task.input} onApply={onApplyFocus} onRevise={onRevise} disabled={busy} supported={!!task.result && task.dataSource === 'fuyao'} /></details> : <FocusPanel key={task.id} focus={focus} originalQuestion={task.input} onApply={onApplyFocus} onRevise={onRevise} disabled={busy} supported={!!task.result && task.dataSource === 'fuyao'} />}</section>
        <section className="rc-section rc-memory" aria-label="个人研究记忆"><div className="rc-section-title"><BookOpen size={14} /><h3>个人研究记忆</h3><button type="button" className="rc-text-button" onClick={manageMemory}><Settings2 size={12} />管理</button></div>
          {!used.length && task.memoryPolicy?.enabled !== false && <p className="rc-empty">{task.status === 'running' && task.memoryStatus === 'pending' ? '正在确认是否有适用的研究记录。' : '本轮没有沿用历史研究记录。'}</p>}
          <MemoryUse task={task} onDisable={onDisableMemory} onEnable={onEnableMemory} onManage={manageMemory} busy={busy} />
          <MemorySaveState task={task} storage={storage} />
        </section>
      </div>}
      <footer className="rc-footer">{collaboration ? '追问会带入主输入框，由你确认后发送。' : researchStorageLabels(storage).note}</footer>
  </>;
  if (drawer) return <Sheet open={open} onOpenChange={nextOpen => { if (!nextOpen) onClose?.(); }}>
    {open && <SheetContent id="research-context-panel" className={`research-context rc-drawer gap-0 ${collaboration ? 'rc-collaboration' : ''}`} side="right" showCloseButton={false}
      onOpenAutoFocus={event => { openingMemory.current = false; returningToChat.current = false; opener.current = document.activeElement; event.preventDefault(); close.current?.focus(); }}
      onCloseAutoFocus={event => { event.preventDefault(); if (returningToChat.current) { returningToChat.current = false; onFocusConversation?.(); } else if (!openingMemory.current && opener.current?.isConnected) opener.current.focus(); }}>
      {contents}
    </SheetContent>}
  </Sheet>;
  if (!open) return null;
  return <aside id="research-context-panel" className={`research-context ${collaboration ? 'rc-collaboration' : ''}`} role="complementary" aria-labelledby={title}>{contents}</aside>;
}
