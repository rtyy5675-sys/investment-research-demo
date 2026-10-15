import React, { useState, useRef } from 'react';
import { Pencil, ArrowRight, ChevronRight, LoaderCircle, FileText, Check } from 'lucide-react';
import { Source, SourceTrigger, SourceContent } from './components/prompt-kit/source';
import { auditAmountText } from '../lib/financial-math.mjs';
import { legacyEvidenceActivity } from '../lib/research-continuity.mjs';
import { FinancialVisual } from './FinancialVisual.jsx';
import { MemoryInline } from './PersonalMemory.jsx';

function AnalysisText({ children, Markdown }) {
  const checked = auditAmountText(children);
  return <><Markdown>{checked.text}</Markdown>{checked.issues.map((issue, i) => <p className="calculation-note" key={i}>{issue.message}</p>)}</>;
}

export function FocusPanel({ focus, originalQuestion, onApply, onRevise, disabled, supported }) {
  const [editing, setEditing] = useState(false), [value, setValue] = useState(''), [error, setError] = useState('');
  const editButton = useRef(null);
  const open = () => { setValue(focus?.text || originalQuestion); setEditing(true); setError(''); };
  async function apply(event) { event.preventDefault(); if (await onApply(value)) setEditing(false); else setError('未能更新关注点，输入已保留。请查看提示后重试。'); }
  return <section className="focus-panel" aria-label="本轮关注"><div className="focus-heading"><h2>本轮关注</h2><span>{focus?.source === 'third_party' ? '转述的他人观点' : focus?.source === 'user' ? '由你明确' : '问题理解 · 可修改'}</span>{!editing && <button ref={editButton} onClick={supported ? open : onRevise} disabled={disabled}><Pencil size={13} />{supported ? '修改关注点' : '修改研究问题'}</button>}</div>{editing ? <form onSubmit={apply}><label htmlFor="research-focus">你现在最想弄清楚什么？</label><textarea id="research-focus" value={value} onChange={event => setValue(event.target.value)} maxLength={3000} autoFocus rows={3} /><p className="field-help">仅调整本轮关注，不覆盖长期默认；保留当前公司与报告期，复用适用的资料。换公司或期间请<button type="button" onClick={() => { setEditing(false); onRevise(); }}>修改研究问题</button>。</p>{error && <p className="inline-error" role="alert">{error}</p>}<div className="compact-actions"><button className="decision-primary" type="submit" disabled={disabled || !value.trim()}>围绕这个重点重新分析<ArrowRight size={13} /></button><button type="button" onClick={() => { setEditing(false); requestAnimationFrame(() => editButton.current?.focus()); }} disabled={disabled}>取消</button></div></form> : <p>{focus?.text || originalQuestion}</p>}</section>;
}

const supportLabels = { supports: '支持该主张', contradicts: '与该主张相反', insufficient: '证据不足', supported: '证据支持', limited: '支持有限', unresolved: '仍待核实' };
export function DecisionAnswer({ result, task, evidence, onEvidence, onAsk, onManageMemory, onDisableMemory, stale, Markdown }) {
  const analyses = result.analyses || (result.facts || []).map((fact, index) => ({ question: `依据 ${index + 1}`, answer: fact.text || fact, evidenceIds: fact.evidenceIds || [] }));
  const key = result.keyCondition || (result.gaps?.[0] ? { question: result.gaps[0].text, nextCheck: result.gaps[0].nextCheck, whyItMatters: '' } : null);
  const other = result.otherConditions || (result.gaps || []).slice(1).map(gap => ({ question: gap.text, nextCheck: gap.nextCheck }));
  const activity = legacyEvidenceActivity(task, result, evidence);
  const progress = result.progress;
  return <div className="answer-content decision-answer">
    <div className="analysis-status"><FileText size={13} /><span>{activity ? `本轮新增 ${activity.fetchedIds.length} 项 · 沿用 ${activity.reusedIds.length} 项${activity.checkpointIds.length ? ` · 恢复检查点 ${activity.checkpointIds.length} 项` : ''} · 报表查询 ${activity.financialAttempts} 次${activity.documentAttempts ? ` · 原文取证 ${activity.documentAttempts} 次` : ''}` : `本版引用 ${evidence.length} 项资料 · 取证轮次未记录`}</span><small>第 {result.revision} 版</small></div>
    {stale && <p className="stale-note">保留上一版分析，尚未按新问题或新关注完成更新。</p>}
    {!stale && <MemoryInline task={task} revision={result.revision} onManage={onManageMemory} onDisable={onDisableMemory} busy={task?.status === 'running'} />}
    {result.summary && <section className="answer-summary"><span className="summary-label">{result.continuation?.priorQuestion ? '接着上次的问题' : '这次能判断什么'}</span><AnalysisText Markdown={Markdown}>{progress?.change || result.summary}</AnalysisText></section>}
    {progress && <section className={`research-update ${progress.status}`} aria-label="本轮研究进展"><div><span className="update-state">{progress.status === 'blocked' ? '关键问题仍被阻塞' : progress.status === 'answered' ? '本题已回答' : '已有推进，仍待查证'}</span></div>{progress.remainingQuestion && <p><strong>仍未解决：</strong>{progress.remainingQuestion}</p>}{progress.blocker && <p className="update-blocker">{progress.blocker}</p>}{progress.status === 'blocked' && key?.whyItMatters && <p><strong>下一步的价值：</strong>{key.whyItMatters}</p>}</section>}
    <FinancialVisual key={result.revision} result={result} evidence={evidence} onEvidence={onEvidence} onAsk={onAsk} />
    <details className="analysis-evidence-details" open={progress?.status !== 'blocked'}><summary>查看依据与解释</summary>
    {analyses.slice(0, 3).map((item, index) => <section className="analysis-item" key={index}><div className="analysis-item-heading"><h4>{item.question}</h4></div>{item.claim && ['user_claim','system_hypothesis'].includes(item.intent) && <div className="analysis-claim"><span>{item.intent === 'user_claim' ? '你的断言原话' : 'AI 暂拟检验假设'}：{item.claim}</span>{item.support && <span className={`support-label ${item.support}`}>{supportLabels[item.support]}</span>}</div>}<AnalysisText Markdown={Markdown}>{item.answer}</AnalysisText>{!!item.evidenceIds?.length && <div className="analysis-sources">{item.evidenceIds.map(id => { const source = evidence.find(entry => entry.id === id); return <Source key={id} href={source?.sourceUrl} onOpen={() => onEvidence(id)}><SourceTrigger label={source?.title?.replace(/^.*扶摇 MCP\s*/, '') || '查看依据'} title={source?.title} aria-label={`查看依据：${source?.title || id}`} /><SourceContent title={source?.title || '研究依据'} description={<>{source?.period}<br />{source?.unit}<span className="source-hover-note">点击核对原始记录与数据口径</span></>} /></Source>; })}</div>}</section>)}
    {analyses.length > 3 && <details className="decision-details"><summary>其他分析 · {analyses.length - 3} 项</summary>{analyses.slice(3).map((item, i) => <div key={i}><AnalysisText Markdown={Markdown}>{item.answer}</AnalysisText>{item.evidenceIds.map(id => <button key={id} onClick={() => onEvidence(id)}>查看对应依据</button>)}</div>)}</details>}
    </details>
    {!!key?.question && <details className="decision-details key-condition"><summary>为什么下一步值得查这一项</summary><h4>{key.question}</h4>{key.whyItMatters && <Markdown>{key.whyItMatters}</Markdown>}{key.nextCheck && <p className="condition-check">所需资料：{key.nextCheck}</p>}</details>}
    {!!other.length && <details className="decision-details"><summary>其他未决条件 · {other.length} 项</summary>{other.map((condition, i) => <div key={i}><h4>{condition.question}</h4><Markdown>{condition.whyItMatters}</Markdown><p>{condition.nextCheck}</p></div>)}</details>}
    <details className="decision-details source-detail"><summary>资料范围与口径</summary><Markdown>{result.scope}</Markdown>{activity?.sources.map(item => <p className="evidence-origin" key={item.id}>{evidence.find(e => e.id === item.id)?.title || item.id} · {({fetched:'本轮新查询',reused:'沿用此前资料',checkpoint:'恢复的取证检查点',unknown:'取证轮次未记录'})[item.origin]}{item.queriedAt && ` · 取数于 ${new Date(item.queriedAt).toLocaleString('zh-CN')}`}</p>)}{!result.contractVersion && <p className="legacy-contract-note">这是旧版分析，未记录疑问与主张的归属，因此不展示支持／反对标签；继续研究会按新合同生成。</p>}<button onClick={() => onEvidence(null)}>查看全部原始依据<ChevronRight size={12} /></button></details>
  </div>;
}

export function UserView({ task, onWrite, Markdown }) {
  const view = task.userView || { version: 0, draft: null, confirmations: [] };
  const confirmed = view.confirmations.at(-1);
  const [editing, setEditing] = useState(false), [value, setValue] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function write(action) {
    setBusy(true); setError('');
    try { await onWrite({ action, text: value, expectedVersion: view.version, analysisRevision: task.result.revision, operationId: crypto.randomUUID() }); setEditing(false); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  function edit(text = '') { setValue(text); setEditing(true); setError(''); }
  return <section className="user-view" aria-label="我的看法"><div className="view-heading"><div><h2>我的看法</h2><span>{view.draft ? '草稿 · 尚未确认' : confirmed ? '已确认记录' : '未记录 · 可选'}</span></div>{!editing && !view.draft && <button disabled={busy} onClick={() => edit(confirmed?.text || '')}><Pencil size={13} />{confirmed ? '修改我的看法' : '记录我的看法'}</button>}</div>
    {!editing && !view.draft && !confirmed && <p className="view-empty">可以先不作结论，也可以用自己的话留下一条研究记录。</p>}
    {confirmed && <div className="confirmed-view"><span><Check size={12} />你的确认记录 · 对应第 {confirmed.analysisRevision} 版分析</span><Markdown>{confirmed.text}</Markdown>{confirmed.analysisRevision !== task.result.revision && <p className="view-version-note">已有新版分析；这条记录仍对应原版本，未被自动修改。</p>}</div>}
    {view.draft && !editing && <div className="view-draft"><strong>待确认的原话</strong><Markdown>{view.draft.text}</Markdown><p className="field-help">对应第 {view.draft.analysisRevision} 版分析。确认后才记为你的看法。</p><div className="compact-actions"><button className="decision-primary" disabled={busy || task.status !== 'complete'} onClick={() => write('confirm')}>{busy && <LoaderCircle size={13} className="spin" />}确认保存这条看法</button><button disabled={busy} onClick={() => edit(view.draft.text)}>修改草稿</button><button disabled={busy} onClick={() => write('discard')}>放弃草稿</button></div></div>}
    {editing && <form onSubmit={event => { event.preventDefault(); write('draft'); }}><label htmlFor="my-view">你现在怎么看？</label><textarea id="my-view" rows={3} autoFocus maxLength={3000} value={value} onChange={event => setValue(event.target.value)} /><p className="field-help">按你的原话保存，不替你补全立场或理由。保存草稿后仍需确认。</p><div className="compact-actions"><button className="decision-primary" type="submit" disabled={busy || !value.trim()}>{busy && <LoaderCircle size={13} className="spin" />}保存草稿</button><button type="button" disabled={busy} onClick={() => setEditing(false)}>取消</button></div></form>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {view.confirmations.length > 1 && <details className="decision-details"><summary>之前的确认记录 · {view.confirmations.length - 1} 条</summary>{view.confirmations.slice(0, -1).reverse().map(record => <div key={record.id}><span>对应第 {record.analysisRevision} 版分析</span><Markdown>{record.text}</Markdown></div>)}</details>}
  </section>;
}
