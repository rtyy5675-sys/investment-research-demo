import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, FileText, MessageSquare, CornerDownLeft } from 'lucide-react';
import './collaboration-log.css';

export function CollaborationLog({ task, bots, Markdown, onAsk }) {
  const [scope, setScope] = useState('current');
  const scroll = useRef(null), follow = useRef(true);
  // Only stored work messages belong here; final answers stay in the main conversation.
  const messages = (task.messages || []).filter(message =>
    (scope === 'all' || Number(message.revision) === Number(task.revision)) &&
    !['answer', 'clarification'].includes(message.kind) &&
    ((message.from !== 'user' && message.to !== 'user') ||
      (message.from === 'user' && ['research', 'verify'].includes(message.to)))
  );
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages.length, task.revision, scope]);
  const label = role => role === 'user' ? '你' : bots[role]?.name || (role === 'tool' ? '资料工具' : role === 'system' ? '系统' : '资料工具');
  return <div className="collaboration-panel">
    <p className="collaboration-caption">这里是本次研究实际产生的工作消息。结论与追问仍在主对话中进行。</p>
    <div className="work-filter" role="group" aria-label="协作记录范围">
      <button type="button" className={scope === 'current' ? 'selected' : ''} aria-pressed={scope === 'current'} onClick={() => { follow.current = true; setScope('current'); }}>本轮</button>
      <button type="button" className={scope === 'all' ? 'selected' : ''} aria-pressed={scope === 'all'} onClick={() => { follow.current = true; setScope('all'); }}>全部</button>
      <span>第 {task.revision} 版 · {messages.length} 条</span>
    </div>
    <div ref={scroll} className="collaboration-messages" role="log" aria-label="Bot 协作消息" onScroll={event => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60; }}>
      {messages.length ? messages.map(message => {
        const role = label(message.from);
        const Icon = bots[message.from]?.icon || MessageSquare;
        return <article key={message.id} className={`collaboration-message ${message.from === 'user' ? 'from-user' : ''} ${message.kind === 'superseded' ? 'superseded' : ''}`}>
          <div className="collaboration-meta"><span className="collaboration-avatar"><Icon size={13} /></span><strong>{role}</strong>{message.to && <><ArrowRight size={10} /><span>{label(message.to)}</span></>}<small>第 {message.revision} 版</small></div>
          <div className="collaboration-bubble">{message.kind === 'tool_result' ? <details className="tool-record"><summary><FileText size={13} />查询与返回记录</summary><Markdown>{message.text}</Markdown></details> : <Markdown>{message.text}</Markdown>}
            {message.kind === 'superseded' ? <span className="collaboration-stale">已失效，不作为当前结论</span> : message.text && <button type="button" className="collaboration-ask" onClick={() => onAsk(message, role)}><CornerDownLeft size={11} />在主对话中追问</button>}
          </div>
        </article>;
      }) : <div className="collaboration-empty"><MessageSquare size={23} /><strong>还没有协作记录</strong><p>查证与核验产生的消息会出现在这里，不会模拟额外的 Bot 对话。</p></div>}
    </div>
  </div>;
}
