import React, { useEffect, useState } from 'react';
import { RotateCcw, CircleAlert, Search, FileText, SlidersHorizontal } from 'lucide-react';
import { RunActivity } from './components/assistant-ui/elements/run-activity';

const stages = { disclosure_search: '检索原始财报', disclosure_download: '取得财报 PDF', disclosure_extract: '核对现金流分项', 'disclosure-extract': '提取原文与页码', starting: '准备研究', security_lookup: '确认研究对象', financial_tools: '取得财务资料', 'research-plan': '规划取证', 'research-memory-plan': '接续研究取证', 'research-check': '检查证据口径', 'research-answer': '组织解释', 'research-answer-format-repair': '修复回答格式', 'research-final-check': '核验最终回答', research: '规划取证', verify: '检查证据口径', main: '组织解释', 'single-plan': '规划取证', 'single-check': '检查证据口径', 'single-answer': '组织解释' };
const statuses = { running: 'running', complete: 'complete', cancelled: 'cancelled', needs_clarification: 'requires-action', failed: 'error', partial: 'incomplete', budget_exhausted: 'incomplete' };
const labels = { complete: '运行记录', cancelled: '本轮已停止', needs_clarification: '等待补充研究范围', failed: '本轮未能完成', partial: '本轮有未完成的部分', budget_exhausted: '已到本轮执行上限' };
export function RunStatus({ task, posting, onRetry, onPersist, onEvidence }) {
  const [, tick] = useState(0);
  const [open, setOpen] = useState(false);
  const running = task.status === 'running', execution = task.execution;
  useEffect(() => { if (!running) return; const timer = setInterval(() => tick(value => value + 1), 1000); return () => clearInterval(timer); }, [running]);
  useEffect(() => { setOpen(false); }, [task.id, task.revision]);
  const elapsed = execution ? Math.max(0, Math.floor(((execution.endedAt ? Date.parse(execution.endedAt) : Date.now()) - Date.parse(execution.startedAt)) / 1000)) : null;
  const entries = (task.messages || []).filter(message => Number(message.revision) === Number(task.revision) && message.from !== 'user' && message.to !== 'user').map(message => {
    const tool = message.kind === 'tool_result';
    const label = message.kind === 'plan' ? '取证计划 · 非执行结果' : tool ? '资料查询记录' : message.from === 'verify' ? '核验记录' : message.from === 'research' ? '研究记录' : '研究任务';
    const Icon = tool ? Search : FileText;
    return { id: message.id, kind: tool ? 'tool' : 'commentary', label: message.text?.slice(0, 90) || label, content: <div><div className="aui-run-entry-label"><Icon />{label}<span className="activity-revision">第 {message.revision} 版</span></div><p className="aui-run-entry-meta">{message.text}</p></div> };
  });
  if (execution) entries.push({ id: `usage-${task.id}-${task.revision}`, kind: 'commentary', label: '调用与用量', content: <div className="run-metrics"><div className="aui-run-entry-label"><SlidersHorizontal />调用与用量</div><p>模型调用 {execution.used.modelCalls}/{execution.limits.modelCalls} · 本轮数据工具调用 {execution.used.toolCalls}/{execution.limits.toolCalls}</p><p className="run-count-note">仅统计本轮数据工具调用，含证券检索与失败重试；连接握手不计入。沿用资料不重复计数。</p><p>已报告 Token {execution.used.knownTokens.toLocaleString()} · 用量未知 {execution.used.unknownUsageCalls} 次</p><p>结束原因：{execution.endReason || '执行中'}。用量以供应商报告为准，费用尚未估算。</p>{task.contextSummary?.truncation?.occurred && <p>上下文已做有标记的裁剪，可从完整记录定位原消息。</p>}<a href={`/api/tasks/${encodeURIComponent(task.id)}/trace`} target="_blank" rel="noreferrer">打开完整 Trace JSON</a></div> });
  return <section className="run-status" aria-label="本轮执行状态">
    <RunActivity status={statuses[task.status] || 'incomplete'} statusLabel={running ? stages[execution?.stage] || '正在执行研究' : labels[task.status] || '本轮工作记录'} durationLabel={elapsed !== null ? `· ${elapsed} 秒` : undefined} entries={entries} open={open} onOpenChange={setOpen} attention={<>
      {task.storage?.status === 'error' && <div className="storage-alert" role="alert"><CircleAlert size={15} /><div><strong>当前内容尚未保存到本机</strong><p>{task.storage.message}</p><button disabled={posting} onClick={onPersist}><RotateCcw size={12} />重试保存</button></div></div>}
      {running && execution && <p className="run-current">本轮最多 {Math.round(execution.limits.durationMs / 1000)} 秒，可随时停止。</p>}
      {task.status === 'cancelled' && <div className="run-stopped"><p>{task.lastOperation ? '已取得的资料和上一版结果保留。可以继续提问，或恢复本次操作。' : '研究背景已修改，旧操作不再重放。原结果保留，请发送当前想研究的问题。'}</p>{task.lastOperation && <button disabled={posting} onClick={onRetry}>恢复本次操作</button>}</div>}
      {!!task.checkpoint?.evidence?.length && ['cancelled', 'partial', 'failed', 'budget_exhausted'].includes(task.status) && <p className="checkpoint-note">已保留 {task.checkpoint.evidence.length} 项取证检查点；重试仅复用同公司、同期间的资料。<button onClick={() => onEvidence(task.checkpoint.evidence)}>查看已取得资料</button></p>}
    </>} />
  </section>;
}
