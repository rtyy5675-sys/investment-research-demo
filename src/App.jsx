import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message, MessageAvatar, MessageContent, MessageActions, MessageAction, PromptInput, PromptInputTextarea, PromptInputActions, ChatContainerRoot, ChatContainerContent, ChatContainerScrollButton } from './components/prompt-kit';
import { Button } from './components/ui/button';
import { TooltipProvider } from './components/ui/tooltip';
import { ResearchNavigation, WorkspaceMenu, DetailSheet } from './WorkspaceControls.jsx';
import { DecisionAnswer, UserView } from './ResearchDecision.jsx';
import { RunStatus } from './RunStatus.jsx';
import { MemoryHome, MemoryManager } from './PersonalMemory.jsx';
import { ResearchContext } from './ResearchContext.jsx';
import { DisclosurePanel } from './DisclosurePanel.jsx';
import { ModelConnection } from './ModelConnection.jsx';
import { Liquid } from 'liquid-gooey';
import { researchResumeScope, researchResumePeriod } from './lib/research-resume.js';
import { Bot, ArrowUp, ArrowUpRight, ArrowRight, Plus, PanelLeftClose, PanelLeft, MessageSquare, Search, ShieldCheck, Sparkles, MoreHorizontal, X, BookOpen, ChevronRight, LoaderCircle, RotateCcw, Pencil, FlaskConical, CircleAlert, ExternalLink, FileText, CheckCheck, Square, PanelRight, Brain, Copy, Check } from 'lucide-react';

const BOTS = { main: { name: '研究助手', short: '主 Bot', subtitle: '把问题推进到有依据的判断', icon: Sparkles }, research: { name: '研究 Bot', short: '研究 Bot', subtitle: '资料查证 · 历史比较', icon: Search }, verify: { name: '核验 Bot', short: '核验 Bot', subtitle: '口径核对 · 推理检查', icon: ShieldCheck } };
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const txt = (value) => typeof value === 'string' ? value : Array.isArray(value) ? value.join('；') : value ? JSON.stringify(value) : '';
const DEFAULT_FOLLOWUP = '请补查当前经营判断最关键的现金流或资产负债证据，说明对原判断的影响。';
const FALLBACK_STARTERS = [
  { title: '利润增长，现金流跟上了吗？', description: '比较利润与经营现金流', input: '请研究我关注公司的年度营收、利润与经营现金流变化。利润增长是否得到现金流支持，哪些判断还需要补查？' },
  { title: '上半年经营变化意味着什么？', description: '同期累计财报比较', input: '请比较一家公司的上半年营收、利润和经营现金流与去年同期的变化，说明哪些结论有依据、哪些还不能确定。' },
  { title: '接着上次未解决的问题继续', description: '沿用研究进度，核对新资料', input: '请接着上次未解决的问题继续，说明新资料改变了什么，以及仍缺少什么证据。' }
];
function scopeLabel(scope) {
  if (!scope) return '';
  const company = [scope.name, scope.thscode].filter(Boolean).join(' · ');
  const period = scope.period === 'quarterly' ? ({ 1: '一季度', 2: '上半年累计', 3: '前三季度累计', 4: '全年累计' }[scope.quarter] || '累计季度') : '年度';
  const report = scope.year ? `${scope.year} 年${period}` : scope.latest ? '最新可用财报' : '';
  return [company, report].filter(Boolean).join(' · ');
}
const shortTitle = (input) => (input || '新的研究').replace(/^【[^】]*】\s*/, '').replace(/[？?。].*/, '').slice(0, 26);
const safeUrl = value => { try { if (typeof value !== 'string' || !value) return null; const url = new URL(value, window.location.origin); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; } };
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data; try { data = await response.json(); } catch { throw new Error('研究服务暂时无法读取，请稍后重试。'); }
  if (!response.ok) { const error = new Error(txt(data.error?.message || data.error || data.message) || `请求失败（${response.status}）`); error.status = response.status; error.task = data.task; throw error; }
  return data;
}
function Markdown({ children }) { return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, href }) => safeUrl(href) ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>, table: ({ children }) => <div className="table-scroll"><table>{children}</table></div> }}>{txt(children).replaceAll('availableFollowups', '可补查资料列表')}</ReactMarkdown></div>; }
function Avatar({ bot = 'main' }) { const Icon = BOTS[bot]?.icon || MessageSquare; return <MessageAvatar className={`avatar ${bot}`} alt={BOTS[bot]?.name || '研究助手'} fallback={<Icon size={16} strokeWidth={1.7} />} />; }
function AnswerActions({ result, onEvidence, onNotice }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const content = [result.summary, ...(result.analyses || []).flatMap(item => [item.question, item.claim, item.answer]), result.keyCondition?.question, result.keyCondition?.nextCheck, result.scope].filter(Boolean).join('\n\n');
    try { await navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { onNotice('未能复制，请选择需要的文字后复制。'); }
  }
  return <MessageActions className="answer-actions"><MessageAction tooltip={copied ? '已复制' : '复制本版分析'}><Button variant="ghost" size="icon-sm" onClick={copy} aria-label={copied ? '已复制分析' : '复制分析'}>{copied ? <Check size={14} /> : <Copy size={14} />}</Button></MessageAction><MessageAction tooltip="核对本版原始资料"><Button variant="ghost" size="icon-sm" onClick={onEvidence} aria-label="查看本版依据"><BookOpen size={14} /></Button></MessageAction><span>{copied ? '已复制' : `第 ${result.revision} 版分析`}</span></MessageActions>;
}
function taskTurns(task) {
  const results = new Map();
  for (const saved of task.history || []) { const result = saved.result || saved; if (result?.summary) results.set(Number(result.revision), { result, evidence: saved.evidence || [] }); }
  if (task.result) results.set(Number(task.result.revision), { result: task.result, evidence: task.evidence || [] });
  const revs = [...new Set([...task.messages.map(m => Number(m.revision)), ...results.keys()])].sort((a, b) => a - b);
  return revs.map(revision => ({ revision, messages: task.messages.filter(m => Number(m.revision) === revision), ...results.get(revision) }));
}
export default function App() {
  const [config, setConfig] = useState(null), [task, setTask] = useState(null);
  const [input, setInput] = useState(''), [composing, setComposing] = useState('chat');
  const [sessions, setSessions] = useState(() => read('yanjian-sessions', []));
  const [posting, setPosting] = useState(false), [notice, setNotice] = useState('');
  const [sidebar, setSidebar] = useState(false), [evidenceView, setEvidenceView] = useState(null), [menu, setMenu] = useState(false), [toolsOpen, setToolsOpen] = useState(false), [mode, setMode] = useState('single');
  const evidenceOpener = useRef(null);
  const taskRef = useRef(null), generation = useRef(0), pending = useRef(null), lastOperation = useRef(null), inputRef = useRef(null), focusAnchor = useRef(null), bottomRef = useRef(null), pollRef = useRef(null);
  const [contextOpen, setContextOpen] = useState(() => window.matchMedia('(min-width: 1280px)').matches);
  const [panelView, setPanelView] = useState('context');
  const sidebarRef = useRef(null);
  const [dataSources, setDataSources] = useState(null);
  const [connectionOpen, setConnectionOpen] = useState(false), [connectionBusy, setConnectionBusy] = useState(false), [connectionCheck, setConnectionCheck] = useState(null);
  const connectionOpener = useRef(null);
  const [memories,setMemories]=useState([]),[researchStorage,setResearchStorage]=useState(null),[memoryOpen,setMemoryOpen]=useState(false),[memoryLoading,setMemoryLoading]=useState(true),[memoryError,setMemoryError]=useState(''),[selectedMemoryId,setSelectedMemoryId]=useState(null);
  const memoryReadGeneration=useRef(0);
  async function refreshMemories(){
    const request=++memoryReadGeneration.current;setMemoryLoading(true);setMemoryError('');
    try{const data=await api('/api/memories');if(request!==memoryReadGeneration.current)return;setMemories(data.entries||[]);if(data.researchStorage)setResearchStorage(data.researchStorage);}
    catch(error){if(request===memoryReadGeneration.current)setMemoryError(error.message);}
    finally{if(request===memoryReadGeneration.current)setMemoryLoading(false);}
  }
  function manageMemories(){setMemoryOpen(true);setMenu(false);setEvidenceView(null);setConnectionOpen(false);refreshMemories();}
  async function updateMemory(id,data){const updated=await api(`/api/memories/${encodeURIComponent(id)}`,data);setMemories(updated.entries||[]);const currentId=taskRef.current?.id;if(currentId){const fresh=await api(`/api/tasks/${encodeURIComponent(currentId)}`);if(taskRef.current?.id===currentId)saveTask(fresh);}return updated.entry;}
  function removeMemory(id,version){return updateMemory(id,{action:'remove',expectedVersion:version});}
  function continueMemory(entry){
    if(memoryLoading||memoryError)return;
    const scope=researchResumeScope(entry),period=researchResumePeriod(scope);
    newTask();setSelectedMemoryId(entry.id);
    setInput(`继续研究${entry.companyName}（${entry.companyCode}）${period}。${scope?.yearsCount?`保持此前${scope.yearsCount}年同期比较范围。`:''}请接着上次未解决的问题继续。`);
    if(!period)setNotice('这条记录缺少明确的报告期，请补充年份及年报或季度后再发送。');
    inputRef.current?.focus();
  }
  async function toggleTaskMemory(enabled){if(!taskRef.current)return;try{setPosting(true);await writeTask('memory',{enabled,expectedRevision:taskRef.current.revision,operationId:crypto.randomUUID()});}catch(error){setNotice(error.message);}finally{setPosting(false);}}
  useEffect(()=>{refreshMemories();},[]);
  useEffect(()=>{if(task?.memoryStatus==='saved')refreshMemories();},[task?.id,task?.revision,task?.memoryStatus]);
  function saveTask(next) {
    if (!next?.id) return;
    if (taskRef.current?.id === next.id && (Number(next.revision) < Number(taskRef.current.revision) || (Number(next.revision) === Number(taskRef.current.revision) && (next.stateVersion || 0) < (taskRef.current.stateVersion || 0)))) return;
    taskRef.current = next; setTask(next); setMode(next.mode || 'single');
    localStorage.setItem('yanjian-last-task', next.id);
    setSessions(previous => { const updated = [{ id: next.id, title: shortTitle(next.input), company: next.researchScope?.name, isDemo: !!next.isEvaluation || /【[^】]*(演示|验收|测试|检查|修复)/.test(next.input), updatedAt: next.updatedAt }, ...previous.filter(s => s.id !== next.id)].slice(0, 12); localStorage.setItem('yanjian-sessions', JSON.stringify(updated)); return updated; });
    const url = new URL(location.href); url.searchParams.set('task', next.id); history.replaceState(null, '', url);
  }
  async function loadTask(id) {
    generation.current++; clearTimeout(pollRef.current); setPosting(false); setNotice('');
    const current = generation.current;
    try { const next = await api(`/api/tasks/${encodeURIComponent(id)}`); if (current !== generation.current) return; taskRef.current = null; saveTask(next); setSidebar(false); const last = [...(next.messages || [])].reverse().find(m => m.from === 'user'); lastOperation.current = last ? { message: last.text, bot: BOTS[last.to] ? last.to : 'main', kind: ['chat', 'followup', 'revise', 'focus'].includes(last.kind) ? last.kind : 'chat' } : null; }
    catch (error) { if (current === generation.current) {
      if(error.status===404){
        setSessions(previous=>{const updated=previous.filter(item=>item.id!==id);localStorage.setItem('yanjian-sessions',JSON.stringify(updated));return updated;});
        if(localStorage.getItem('yanjian-last-task')===id)localStorage.removeItem('yanjian-last-task');
        const url=new URL(location.href);if(url.searchParams.get('task')===id){url.searchParams.delete('task');history.replaceState(null,'',url);}
        taskRef.current=null;setTask(null);setSelectedMemoryId(null);
        setNotice('当前服务已找不到这次研究，可能已在重启或重新部署后失效。浏览器中的旧入口不包含研究内容，可以新建研究继续。');
        refreshMemories();
      }else setNotice(error.message);
    } }
  }
  useEffect(() => {
    let active = true;
    api('/api/config').then(configuration => { if (!active) return; setConfig(configuration); if(configuration.researchStorage)setResearchStorage(configuration.researchStorage); setDataSources(configuration.dataSources || null); }).catch(error => active && setNotice(error.message));
    const saved = new URLSearchParams(location.search).get('task') || localStorage.getItem('yanjian-last-task');
    if (saved) loadTask(saved);
    return () => { active = false; generation.current++; clearTimeout(pollRef.current); };
  }, []);
  useEffect(() => {
    if ((task?.status !== 'running' && task?.storage?.status !== 'saving' && task?.memoryStatus !== 'saving') || posting) return;
    const current = generation.current, id = task.id, revision = task.revision;
    let active = true;
    async function poll() {
      try { const next = await api(`/api/tasks/${encodeURIComponent(id)}`); if (!active || current !== generation.current || taskRef.current?.id !== id || Number(next.revision) < revision) return; saveTask(next); setNotice(''); if (next.status === 'running' || next.storage?.status === 'saving' || next.memoryStatus === 'saving') pollRef.current = setTimeout(poll, 1000); }
      catch (error) { if (active && current === generation.current) { setNotice(`连接暂时中断，已保留当前结果。${error.message}`); pollRef.current = setTimeout(poll, 2000); } }
    }
    pollRef.current = setTimeout(poll, 1000);
    return () => { active = false; clearTimeout(pollRef.current); };
  }, [task?.id, task?.revision, task?.status, task?.storage?.status, task?.memoryStatus, posting]);
  useEffect(() => { const escape = event => { if (event.key === 'Escape') { setEvidenceView(null); setConnectionOpen(false); setSidebar(false); setMenu(false); setToolsOpen(false); } }; document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape); }, []);
  useEffect(() => {
    const shortcuts = event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); newTask(); } };
    document.addEventListener('keydown', shortcuts); return () => document.removeEventListener('keydown', shortcuts);
  }, []);
  useEffect(() => {
    if (!sidebar || !window.matchMedia('(max-width: 760px)').matches) return;
    const previous = document.activeElement;
    sidebarRef.current?.querySelector('button')?.focus();
    const trap = event => {
      if (event.key !== 'Tab') return;
      const items = [...sidebarRef.current.querySelectorAll('button:not(:disabled)')].filter(el => el.getClientRects().length);
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (previous?.isConnected && (sidebarRef.current?.contains(document.activeElement) || document.activeElement === document.body)) previous.focus(); };
  }, [sidebar]);
  useEffect(() => { if (task?.result) focusAnchor.current?.scrollIntoView({ block: 'start', behavior: 'auto' }); }, [task?.id, task?.result?.revision]);
  function newTask() { setSelectedMemoryId(null); generation.current++; clearTimeout(pollRef.current); taskRef.current = null; setTask(null); setPosting(false); setInput(''); setComposing('chat'); setNotice(''); setSidebar(false); lastOperation.current = null; pending.current = null; localStorage.removeItem('yanjian-last-task'); const url = new URL(location.href); url.searchParams.delete('task'); history.replaceState(null, '', url); inputRef.current?.focus(); }
  async function submit(message = input, kind = composing, simulateFailure = false, targetBot = 'main') {
    if (!message.trim() || posting) return;
    const selectedEntry=!taskRef.current&&memories.find(entry=>entry.id===selectedMemoryId&&(message.includes(entry.companyCode)||message.includes(entry.companyName)));
    if(selectedEntry&&!researchResumeScope(selectedEntry)&&(!/(?:19|20)\d{2}/.test(message)||!/年报|年度|一季度|二季度|三季度|四季度|[1-4]季度|Q[1-4]|半年|上半年|前三季度|全年/i.test(message))){setNotice('这条旧记录没有可确认的报告期，请在问题中补充年份和年报或季度，避免自动换成最新期间。');return;}
    if (!config?.model?.available) { setNotice('模型尚未连接，暂时不能开始新研究。你仍可查看已完成实例。'); return; }
    generation.current++; const current = generation.current; clearTimeout(pollRef.current); setPosting(true); setNotice(''); setToolsOpen(false); setMenu(false);
    const existing = taskRef.current;
    const key = JSON.stringify({ id: existing?.id, message: message.trim(), bot: targetBot, kind, simulateFailure, mode, selectedMemoryId });
    const operationId = pending.current?.key === key ? pending.current.id : crypto.randomUUID(); pending.current = { key, id: operationId };
    const operation = { message: message.trim(), bot: targetBot, kind, simulateFailure, operationId }; lastOperation.current = operation;
    try { const next = existing ? kind === 'focus' ? await api(`/api/tasks/${encodeURIComponent(existing.id)}/focus`, { text: message.trim(), expectedRevision: existing.revision, expectedFocusVersion: existing.focus?.version || 0, operationId }) : await api(`/api/tasks/${encodeURIComponent(existing.id)}/messages`, operation) : await api('/api/tasks', { input: operation.message, mode, operationId, memoryId:memories.find(entry=>entry.id===selectedMemoryId&&(message.includes(entry.companyCode)||message.includes(entry.companyName)))?.id||null }); if (current !== generation.current) return; saveTask(next); pending.current = null; setInput(''); setComposing('chat'); return true; }
    catch (error) { if (current === generation.current) { if (error.task) saveTask(error.task); setNotice(`${error.message} 输入已保留，再次发送将重试同一操作。`); } return false; }
    finally { if (current === generation.current) setPosting(false); }
  }
  async function writeTask(suffix, data) { const id = taskRef.current?.id; try { const next = await api(`/api/tasks/${encodeURIComponent(id)}/${suffix}`, data); if (taskRef.current?.id === id) saveTask(next); return next; } catch (error) { if (error.task && taskRef.current?.id === id) saveTask(error.task); if (error.status === 409) { try { const fresh = await api(`/api/tasks/${encodeURIComponent(id)}`); if (taskRef.current?.id === id) saveTask(fresh); } catch {} } throw error; } }
  async function finishResearch() { try { await writeTask('finish', { analysisRevision: task.result.revision }); } catch (error) { setNotice(error.message); } }
  function revise() { if (window.matchMedia('(max-width: 1279px)').matches) setContextOpen(false); setComposing('revise'); setInput(task?.input || ''); setToolsOpen(false); setMenu(false); requestAnimationFrame(() => inputRef.current?.focus()); }
  async function retry() {
    if (taskRef.current?.lastOperation) { try { setPosting(true); await writeTask('retry', { expectedRevision: taskRef.current.revision, operationId: crypto.randomUUID() }); setNotice(''); } catch(error) { setNotice(error.message); } finally { setPosting(false); } return; }
    const operation = lastOperation.current || { message: task.input, kind: 'revise', bot: 'main' }; pending.current = null; submit(operation.message, operation.kind, false, operation.bot || 'main'); }
  async function stopResearch() { try { await writeTask('stop', { expectedRevision: taskRef.current.revision }); setNotice(''); } catch(error) { setNotice(error.message); } }
  async function retryPersist() { try { await writeTask('persist', {}); setNotice(''); } catch(error) { setNotice(error.message); } }
  async function supplementReport(file) {
    const existing = taskRef.current;
    if (!existing || posting || existing.status === 'running') return;
    const current = ++generation.current; clearTimeout(pollRef.current); setPosting(true); setNotice('');
    try {
      let next;
      if (file) {
        const query = new URLSearchParams({ filename: file.name, expectedRevision: String(existing.revision), operationId: crypto.randomUUID() });
        const response = await fetch(`/api/tasks/${existing.id}/documents?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
        next = await response.json();
        if (!response.ok) { const error = new Error(next.error || '财报上传未完成。'); error.task = next.task; throw error; }
      } else next = await api(`/api/tasks/${existing.id}/supplement`, { expectedRevision: existing.revision, operationId: crypto.randomUUID() });
      if (current === generation.current) { saveTask(next); setNotice('已开始核对原始财报，完成后会更新当前分析。'); }
    } catch (error) { if (current === generation.current) { if (error.task) saveTask(error.task); setNotice(error.message); } }
    finally { if (current === generation.current) setPosting(false); }
  }
  function openEvidence(id, evidence = task?.evidence || []) { evidenceOpener.current = document.activeElement; setConnectionOpen(false); setEvidenceView({ id, evidence }); }
  function openConnection() { connectionOpener.current = document.activeElement; setEvidenceView(null); setMenu(false); setConnectionOpen(true); }
  async function refreshModelConfiguration() {
    try { const configuration = await api('/api/config'); setConfig(configuration); if(configuration.researchStorage)setResearchStorage(configuration.researchStorage); setDataSources(configuration.dataSources || null); }
    catch { setNotice('模型配置已操作，请刷新页面读取最新状态。'); }
  }
  async function refreshConnections() {
    setConnectionBusy(true);
    try { const next = await api('/api/data-sources'); setDataSources(next.dataSources || next); setConnectionCheck(null); }
    catch (error) { setConnectionCheck({ ok: false, message: error.message }); }
    finally { setConnectionBusy(false); }
  }
  async function checkConnection() {
    setConnectionBusy(true); setConnectionCheck(null);
    try { const next = await api('/api/data-sources/fuyao/check', {}); setConnectionCheck(next); }
    catch (error) { setConnectionCheck({ ok: false, message: error.message }); }
    finally { setConnectionBusy(false); }
  }
  const activeDataSource = task ? task.dataSource || 'fuyao' : 'fuyao';
  const sourceName = activeDataSource === 'fuyao' ? '扶摇 MCP' : '历史来源（已停用）';
  const fuyaoConfigured = dataSources?.fuyao?.configured === true;
  const connectionLabel = connectionCheck?.ok ? '连接已验证' : fuyaoConfigured ? '已配置 · 待验证' : '未配置';
  const available = config?.model?.available, running = task?.status === 'running';
  const turns = task ? taskTurns(task) : [];
  const needsClarification = task?.status === 'needs_clarification';
  const starters = config?.starterQuestions?.length ? config.starterQuestions : FALLBACK_STARTERS;
  const followupQuestion = task?.nextQuestion || DEFAULT_FOLLOWUP;
    function fillStarter(starter = starters[0]) { if (!starter?.input) return; setInput(starter.input); setComposing('chat'); setToolsOpen(false); inputRef.current?.focus(); }
  function selectCandidate(candidate) { setInput(`我选择候选公司${candidate.name || ''}（${candidate.thscode}），沿用刚才待澄清的问题和期间。`); setComposing('chat'); inputRef.current?.focus(); }
  const work = task?.messages?.filter(message => Number(message.revision) === Number(task.revision) && message.from !== 'user' && message.to !== 'user') || [];
  function openPanel(view) { setPanelView(view); setContextOpen(panelView !== view || !contextOpen); setMenu(false); }
  function askAboutWork(message, role) {
    const question = `关于${role}在第 ${message.revision} 版研究中的这条记录：\n“${message.text.slice(0, 700)}${message.text.length > 700 ? '…' : ''}”\n\n请解释它对当前问题的影响，以及仍需要核实什么。`;
    setInput(previous => previous.trim() ? `${previous}\n\n${question}` : question);
    setComposing('chat');
    if (window.matchMedia('(max-width: 1279px)').matches) setContextOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  const renderTurn = turn => {
    const answer = turn.result && <Message className="assistant-turn"><Avatar /><MessageContent className="assistant-body"><div className="assistant-name">研究助手</div><DecisionAnswer Markdown={Markdown} result={turn.result} task={task} evidence={turn.evidence || []} onEvidence={id => openEvidence(id, turn.evidence || [])} onManageMemory={manageMemories} onDisableMemory={() => toggleTaskMemory(false)} onAsk={question => { setInput(question); setComposing('chat'); inputRef.current?.focus(); }} stale={turn.revision < task.revision && turn.revision === Number(task.result?.revision)} /><AnswerActions result={turn.result} onEvidence={() => openEvidence(null, turn.evidence || [])} onNotice={setNotice} /></MessageContent></Message>;
    return <React.Fragment key={turn.revision}>
      {turn.messages.filter(message => message.from === 'user' && !(message.kind === 'focus' && turn.revision === task.revision)).map(message => <div className="user-turn" key={message.id}><Message><MessageContent className="user-message"><Markdown>{message.text}</Markdown></MessageContent></Message>{['revise', 'focus'].includes(message.kind) && <span className="user-turn-meta"><Pencil size={11} />{message.kind === 'focus' ? '关注点已调整' : '问题已修改'} · 第 {turn.revision} 版</span>}</div>)}
      {turn.result ? turn.result.revision !== task.result?.revision ? <details className="past-analysis"><summary>历史分析 · 第 {turn.revision} 版</summary>{answer}</details> : answer : turn.messages.filter(message => (message.kind === 'answer' || (message.kind === 'clarification' && !(needsClarification && turn.revision === Number(task.revision)))) && message.to === 'user').map(message => <Message className="assistant-turn" key={message.id}><Avatar /><MessageContent className="assistant-body"><div className="assistant-name">研究助手</div><Markdown>{message.text}</Markdown></MessageContent></Message>)}
    </React.Fragment>;
  };
  const ActiveIcon = BOTS.main.icon;
  return <TooltipProvider delayDuration={250}><div className="app-shell">
    {sidebar && <button className="mobile-scrim" aria-label="关闭侧栏" onClick={() => setSidebar(false)} />}
    <aside ref={sidebarRef} className={`sidebar ${sidebar ? 'is-open' : ''}`} aria-label="研究导航" role={sidebar ? 'dialog' : undefined} aria-modal={sidebar ? true : undefined}>
      <div className="sidebar-brand"><span className="brand-symbol"><Sparkles size={19} /></span><span>见微<span className="brand-en">Jianwei</span></span><button className="icon-button sidebar-close" aria-label="收起侧栏" onClick={() => setSidebar(false)}><PanelLeftClose size={17} /></button></div>
      <button className="new-chat" onClick={newTask}><Plus size={17} />新的研究<span>⌘ K</span></button>
      <div className="sidebar-section-label">你的研究</div>
      <nav className="session-list" aria-label="研究会话">{sessions.length ? sessions.map(session => <button className={`session ${session.id === task?.id ? 'active' : ''}`} key={session.id} title={session.title} onClick={() => loadTask(session.id)}><MessageSquare size={15} /><span className="session-copy"><span>{session.title}</span>{session.isDemo && <small>演示</small>}</span></button>) : <p className="empty-sessions">从一个问题开始，<br />研究会保存在这里。</p>}</nav>
      <button className="sidebar-memory" onClick={() => { setSidebar(false); manageMemories(); }}><Brain size={17} /><span>研究记忆</span><ChevronRight size={14} /></button>
      <div className="sidebar-bottom"><span className="user-avatar">你</span><div><strong>个人研究空间</strong><span>{sourceName}</span></div><span className="connection-dot" title={available ? '模型可用' : '模型未连接'} /></div>
    </aside>
    <div className="research-layout">
    <main className="main-shell">
      <header className="topbar"><div className="topbar-start"><button className="icon-button mobile-sidebar" onClick={() => setSidebar(true)} aria-label="打开侧栏"><PanelLeft size={19} /></button><span className="workspace-title">投资研究</span><ChevronRight size={13} className="muted" /><span className="topbar-task">{task ? task.researchScope?.name || shortTitle(task.input) : '新的对话'}</span></div><div className="topbar-actions"><button className="data-source-toggle model-api-entry" onClick={openConnection} aria-label="配置模型 API"><Bot size={14} /><span>模型 API</span></button><button className={`data-source-toggle ${activeDataSource === 'fuyao' && !fuyaoConfigured ? 'needs-config' : ''}`} onClick={openConnection} aria-label={`数据连接：${sourceName}${activeDataSource === 'fuyao' ? `，${connectionLabel}` : ''}`}><span className="source-status-dot" /><span>{sourceName}</span></button>{task && <button className="source-toggle" aria-label="查看研究依据" onClick={() => openEvidence(null)}><BookOpen size={15} /><span>依据</span>{task.evidence?.length > 0 && <small>{task.evidence.length}</small>}</button>}<WorkspaceMenu open={menu} onOpenChange={setMenu} task={task} posting={posting} running={running} mode={mode} onMode={setMode} onMemories={manageMemories} onConnection={openConnection} onRevise={revise} onSimulate={() => submit(followupQuestion, 'followup', true)} /></div></header>
      <ResearchNavigation task={task} panelView={panelView} contextOpen={contextOpen} onPanel={openPanel} />
      <ChatContainerRoot key={task?.id || 'new'} id="research-conversation" aria-label="与研究助手的对话" initial={false} resize="instant" className={`conversation-scroll ${!task ? 'is-empty' : ''}`}><ChatContainerContent className="conversation-flow">
        <div className="conversation-inner">
          {!task ? <div className="welcome"><div className="welcome-mark"><Sparkles size={28} strokeWidth={1.5} /></div><p className="eyebrow">你的个人投资研究空间</p><h1>{memories.some(entry=>!entry.disabled)?'这次想接着弄清什么？':'你想弄清楚什么？'}</h1><p className="welcome-description">带来一个新问题，或接着上次没弄清的地方继续。<br />从资料到解释，逐步形成自己的判断。</p><MemoryHome memories={memories} loading={memoryLoading} error={memoryError} storage={researchStorage} onRefresh={refreshMemories} onContinue={continueMemory} onManage={manageMemories} /><p className="starter-heading">也可以从一个问题开始</p><div className="starter-grid">{starters.map((starter, index) => <button className="starter-card" key={starter.input || index} onClick={() => fillStarter(starter)}><strong>{starter.title}</strong><div className="starter-footer"><span>{starter.description}</span><ArrowUpRight size={17} /></div></button>)}</div></div> : <>
            {task.isEvaluation && <div className="saved-example-note">验收会话 · 记录用于功能检查，不代表真实用户的投资立场</div>}

            {task.status !== 'complete' && <RunStatus task={task} posting={posting} onRetry={retry} onPersist={retryPersist} onEvidence={items => openEvidence(null, items)} />}
            <div ref={focusAnchor} className="answer-anchor" />
            <>{turns.some(turn => turn.revision < Number(task.result?.revision || task.revision)) && <details className="research-history"><summary>之前的研究与关注调整</summary>{turns.filter(turn => turn.revision < Number(task.result?.revision || task.revision)).map(renderTurn)}</details>}{turns.filter(turn => turn.revision >= Number(task.result?.revision || task.revision)).map(renderTurn)}</>
            {task.status === 'complete' && <RunStatus task={task} posting={posting} onRetry={retry} onPersist={retryPersist} onEvidence={items => openEvidence(null, items)} />}
            {(running || posting) && <div className="research-progress"><span className="progress-orb" /><div><strong>{posting ? '正在提交问题' : '正在查证你的问题'}</strong><p>{posting ? '正在创建本次研究操作…' : work.at(-1)?.text?.slice(0, 90) || '查证与核验完成后，结果会显示在这里。'}</p><span>你仍可以修改问题</span></div></div>}
            {needsClarification && <article className="assistant-turn clarification-turn"><Avatar /><div className="assistant-body"><div className="assistant-name">研究助手</div><Markdown>{task.clarification || '请补充想研究的 A 股公司名称或代码，以及报告年份、期间。我会保留你的原问题继续查证。'}</Markdown>{!!task.candidates?.length && <div className="company-candidates">{task.candidates.map(candidate => <button key={candidate.thscode} onClick={() => selectCandidate(candidate)}><span>{candidate.name || '选择公司'}</span><small>{candidate.thscode}</small><ArrowUpRight size={13} /></button>)}</div>}<p className="clarification-hint">直接在下方补充即可，原问题会保留。</p></div></article>}
            {!needsClarification && task.error && <div className="failure-card" role="alert"><CircleAlert size={18} /><div><strong>这次研究未能完成</strong><p>{txt(task.error?.message || task.error)}</p><small>{task.errorInfo?.recovery || (task.result ? '上一版有效结果已保留；成功取得的新增资料会单独保存在检查点。' : '目前尚未取得可用分析。')}</small>{!['invalid_arguments','parameter_conflict','empty_result','storage_error'].includes(task.errorInfo?.category) && <button onClick={retry} disabled={posting || running || !available}><RotateCcw size={13} />重试当前操作</button>}</div></div>}
            {!running && !posting && !needsClarification && task.status === 'complete' && task.result?.revision === task.revision && <div className="decision-actions-area">
              {task.researchClosure?.analysisRevision === task.result.revision ? <p className="research-ended">本轮研究已结束；不记录看法也可以。需要时可继续提问。</p> : <>
                {task.result.nextAction?.kind === 'query' && task.result.nextAction?.reason && <p className="action-reason">{task.result.nextAction.reason}</p>}
                <div className="followup-actions decision-actions">{task.canFollowup && <button className="decision-primary" onClick={() => submit(followupQuestion, 'followup')} disabled={!available}><Search size={14} />核查这一项<ArrowRight size={14} /></button>}<button onClick={finishResearch}>结束本轮研究</button></div>
              </>}
            </div>}
            {task.result && <DisclosurePanel task={task} busy={posting || running} onSearch={() => supplementReport()} onUpload={supplementReport} />}
            {task.result && <UserView key={`view-${task.id}`} task={task} Markdown={Markdown} onWrite={data => writeTask('view', data)} />}

          </>}
          <div ref={bottomRef} />
        </div>
      </ChatContainerContent><ChatContainerScrollButton /></ChatContainerRoot>
      <div className="composer-area">{notice && <div className="connection-notice" role="alert"><CircleAlert size={14} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="关闭提示"><X size={13} /></button></div>}<form onSubmit={event => { event.preventDefault(); submit(); }}><PromptInput className={`composer ${composing === 'revise' ? 'is-revising' : ''}`} value={input} onValueChange={setInput} maxHeight={180} isLoading={posting || running}>{composing === 'revise' && <div className="revising-label"><Pencil size={12} />修改问题 · 新版本将重新查证<button type="button" onClick={() => { setComposing('chat'); setInput(''); }}><X size={13} /></button></div>}<PromptInputTextarea ref={inputRef} aria-label={composing === 'revise' ? '修改研究问题' : '向研究助手提问'} placeholder={composing === 'revise' ? '修改你想研究的对象、期间或判断…' : needsClarification ? '补充公司名称或代码、年份和报告期间…' : task ? '继续追问本次研究，或补充相关信息…' : '输入公司、报告期间和疑问，或粘贴想核查的观点…'} rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} /><PromptInputActions className="composer-bottom"><div className="composer-left"><div className={`gooey-actions ${toolsOpen ? 'expanded' : ''}`}><Liquid blur={6} contrast={18} fill="#eef0eb" filterPadding={140} style={{ width: 140, height: 31, position: 'absolute', left: 0, top: 0 }} shadow="0 1px 3px rgba(20,40,30,.04)"><Liquid.Item style={{ position: 'absolute', left: 0, top: 0 }} x={toolsOpen ? 48 : 0} y={0} transition="bouncy"><button type="button" className={`round-btn aux-action ${toolsOpen ? 'visible' : ''}`} tabIndex={toolsOpen ? 0 : -1} aria-label="查看已取得的依据" title="查看依据" data-label="查看依据" onClick={() => { openEvidence(null); setToolsOpen(false); }}><BookOpen size={16} /></button></Liquid.Item><Liquid.Item style={{ position: 'absolute', left: 0, top: 0 }} x={toolsOpen ? 94 : 0} y={0} transition="bouncy" delay={35}><button type="button" className={`round-btn aux-action ${toolsOpen ? 'visible' : ''}`} tabIndex={toolsOpen ? 0 : -1} aria-label={task ? '修改研究问题' : '填入研究问题'} title={task ? '修改问题' : '填入问题'} data-label={task ? '修改问题' : '填入问题'} onClick={() => task ? revise() : fillStarter()}><Pencil size={15} /></button></Liquid.Item><Liquid.Item style={{ position: 'absolute', left: 0, top: 0 }} x={0} y={0} transition="bouncy"><button type="button" className={`round-btn add-action ${toolsOpen ? 'open' : ''}`} aria-expanded={toolsOpen} aria-label="展开辅助操作" onClick={() => setToolsOpen(!toolsOpen)}><Plus size={18} /></button></Liquid.Item></Liquid></div><span className={`composer-mode ${toolsOpen ? 'hidden' : ''}`}><ActiveIcon size={12} />{BOTS.main.name}</span></div><div className="composer-submit-actions">{running && <button type="button" className="stop-research" onClick={stopResearch} aria-label="停止研究"><Square size={12} fill="currentColor" />停止</button>}<button type="submit" className="send-button" aria-label="发送问题" disabled={!input.trim() || posting}>{posting ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={18} />}</button></div></PromptInputActions></PromptInput></form><div className="composer-caption"><span className={`availability ${available ? 'connected' : ''}`} />{available ? `${sourceName}${task?.evidence?.some(item => item.provider === 'disclosure-pdf') ? ' + 原始财报' : ''} · 基于取得的证据回答` : '连接模型后可执行研究'}<span className="caption-separator">·</span>重要判断请核对原始资料</div></div>
    </main>
    <ResearchContext task={task} storage={researchStorage} panelView={panelView} onPanelView={setPanelView} bots={BOTS} Markdown={Markdown} onAskWork={askAboutWork} onFocusConversation={() => inputRef.current?.focus()} open={contextOpen && !!task} onClose={() => setContextOpen(false)} onManageMemory={manageMemories} onDisableMemory={() => toggleTaskMemory(false)} onEnableMemory={() => toggleTaskMemory(true)} onApplyFocus={text => submit(text, 'focus', false, 'main')} onRevise={revise} posting={posting} />
    </div>
    <MemoryManager storage={researchStorage} open={memoryOpen} entries={memories} loading={memoryLoading} error={memoryError} onClose={()=>setMemoryOpen(false)} onRefresh={refreshMemories} onUpdate={updateMemory} onRemove={removeMemory} />
    <DetailSheet open={connectionOpen} onClose={() => setConnectionOpen(false)} title="模型 API 与数据连接" description="模型负责分析，数据来源提供财报；分别配置和验证。" eyebrow="CONNECTIONS" footer="凭证保存在本机服务端，验证和研究会调用所选服务" closeLabel="关闭模型与数据连接面板" opener={connectionOpener} className="connection-drawer"><div className="drawer-content"><ModelConnection onChanged={refreshModelConfiguration} disabled={running || posting} /><section className="connection-card"><div className="connection-card-title"><h3>扶摇 MCP</h3><span className={`connection-status ${connectionCheck?.ok ? 'verified' : ''}`}>{connectionLabel}</span></div><p>{connectionCheck?.ok ? '已完成服务握手并发现可用工具。具体公司的财务数据将在研究时查询。' : dataSources?.fuyao?.message || (fuyaoConfigured ? '本机已配置凭证，可检查服务连接和可用工具。' : '尚未配置本机凭证。请在项目的 .env.local 中填写 FUYAO_API_KEY，再刷新状态。')}</p>{!fuyaoConfigured && <p>请在本机项目的 .env.local 中填写 FUYAO_API_KEY，保存后刷新配置状态。</p>}{!fuyaoConfigured && <a className="source-link" href="https://fuyao.aicubes.cn/admin" target="_blank" rel="noreferrer">管理扶摇 API Key<ExternalLink size={12} /></a>}<div className="connection-actions"><button onClick={refreshConnections} disabled={connectionBusy}><RotateCcw size={13} />刷新配置状态</button><button className="primary" onClick={checkConnection} disabled={connectionBusy}>{connectionBusy ? <LoaderCircle size={13} className="spin" /> : <ShieldCheck size={13} />}验证连接与工具</button></div>{connectionCheck && <div className={`connection-check ${connectionCheck.ok ? 'success' : 'error'}`} role="status"><strong>{connectionCheck.ok ? '验证成功' : '尚未验证通过'}</strong><p>{connectionCheck.message || (connectionCheck.ok ? '已完成服务握手和工具发现；尚未查询具体公司的财务数据。' : '请检查本机配置后重试。')}</p>{connectionCheck.ok && connectionCheck.toolCount != null && <small>可用工具：{connectionCheck.toolCount}</small>}{connectionCheck.checkedAt && <small>验证时间：{new Date(connectionCheck.checkedAt).toLocaleString('zh-CN')}</small>}</div>}<p className="connection-footnote">凭证仅保存在本机服务端，界面不会读取或展示密钥。</p></section><section className="connection-card muted-connection"><h3>iFinD MCP</h3><p>需要另行配置 iFinD MCP 个人密钥，当前未接入其数据查询。</p></section></div></DetailSheet>
    <DetailSheet open={!!evidenceView} onClose={() => setEvidenceView(null)} title={`研究依据${evidenceView ? ` · ${evidenceView.evidence.length}` : ''}`} description="仅展示本次实际取得的资料。点击原始来源可自行核对。" eyebrow="SOURCES" footer="事实、推断与未知，应当可以区分" closeLabel="关闭依据面板" opener={evidenceOpener}><div className="drawer-content">{evidenceView?.evidence.length ? evidenceView.evidence.map(item => <article className={`evidence-card ${item.id === evidenceView.id ? 'highlighted' : ''}`} key={item.id} ref={node => { if (node && item.id === evidenceView.id) node.scrollIntoView({ block: 'nearest' }); }}><span className="evidence-tag"><FileText size={11} />{item.id}</span><h3>{item.title}</h3><div className="evidence-meta">{item.period && <span>{item.period}</span>}{item.unit && <span>{item.unit}</span>}</div><Markdown>{item.provider === 'disclosure-pdf' ? item.id.startsWith('DOC-NOTES-') ? '从同一份已核验财报读取与经营现金流相关的逐字摘录。下方保留页码；摘录不代表完整附注，项目金额不自动证明变动原因或回款质量。' : '已从原始合并现金流量表提取本期与上年同期的流入、流出、销售收款、采购付款及净额，并核对公司、报告期、单位和收支勾稽关系。展开下方引文可逐项核对。' : item.text}</Markdown>{item.locator && <p className="source-locator">{item.provider === 'disclosure-pdf' ? `原文定位：PDF 第 ${[...new Set((item.citations || []).map(citation => citation.page))].join('、')} 页` : item.locator}</p>}{item.citations?.length > 0 && <details className="document-citations"><summary>核对提取的原文与页码</summary>{item.citations.map((citation, index) => <div key={index}><a href={`${safeUrl(item.sourceUrl)}#page=${citation.page}`} target="_blank" rel="noreferrer">PDF 第 {citation.page} 页</a><blockquote>{citation.quote}</blockquote></div>)}</details>}{safeUrl(item.sourceUrl) && <a className="source-link" href={item.sourceUrl} target="_blank" rel="noreferrer">{item.provider === 'fuyao-mcp' ? '查看数据接口与字段定义' : item.provider === 'disclosure-pdf' ? '打开原始 PDF' : '查看原始披露'}<ExternalLink size={12} /></a>}</article>) : <div className="role-empty"><BookOpen size={26} /><p>还没有取得研究依据</p><span>完成资料查证后，会在这里显示来源与原文。</span></div>}</div></DetailSheet>
  </div></TooltipProvider>;
}
