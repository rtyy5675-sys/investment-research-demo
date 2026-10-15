import React from 'react';
import { BookOpen, CircleAlert, FlaskConical, MoreHorizontal, Pencil, ShieldCheck, PanelRight, MessagesSquare, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function WorkspaceMenu({ open, onOpenChange, task, posting, running, mode, onMode, onMemories, onConnection, onRevise, onSimulate }) {
  const navigate = action => { onOpenChange(false); requestAnimationFrame(action); };
  return <DropdownMenu open={open} onOpenChange={onOpenChange}>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="icon-button" aria-label="更多操作"><MoreHorizontal size={20} /></Button></DropdownMenuTrigger>
    <DropdownMenuContent className="workspace-menu" align="end" sideOffset={10}>
      <DropdownMenuLabel>研究空间</DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => navigate(onMemories)}><BookOpen />研究记忆</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => navigate(onConnection)}><ShieldCheck />模型 API 与数据连接</DropdownMenuItem>
      {task && <DropdownMenuItem onSelect={() => navigate(onRevise)}><Pencil />修改当前问题</DropdownMenuItem>}
      <DropdownMenuSeparator />
      <DropdownMenuLabel><FlaskConical size={13} />执行方式</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={mode} onValueChange={onMode}>
        <DropdownMenuRadioItem value="single" disabled={!!task || posting}>分步研究</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="roles" disabled={!!task || posting}>多角色对照</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      {task?.result && <><DropdownMenuSeparator /><DropdownMenuItem disabled={running || posting} onSelect={() => navigate(onSimulate)}><CircleAlert />模拟补查失败</DropdownMenuItem><p className="menu-footnote">用于检验恢复流程，已有结果会保留。</p></>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function ResearchNavigation({ task, panelView, contextOpen, onPanel }) {
  const memoryOff = task?.memoryPolicy?.enabled === false;
  const used = task?.memoryUsed;
  const hasMemory = Array.isArray(used) ? used.length > 0 : !!used && (used.entries ? used.entries.length > 0 : true);
  return <div className="bot-bar research-navigation">
    <div className="research-assistant-label"><Sparkles size={15} /><span>研究助手</span></div>
    {task && <div className="research-panel-actions">
      <Button variant="ghost" size="sm" className={`context-toggle ${contextOpen && panelView === 'collaboration' ? 'selected' : ''}`} onClick={() => onPanel('collaboration')} aria-controls="research-context-panel" aria-expanded={contextOpen && panelView === 'collaboration'}><MessagesSquare size={15} /><span>协作记录</span></Button>
      <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className={`context-toggle ${contextOpen && panelView === 'context' ? 'selected' : ''}`} onClick={() => onPanel('context')} aria-label="研究上下文" aria-controls="research-context-panel" aria-expanded={contextOpen && panelView === 'context'}><PanelRight size={16} /><span>上下文</span>{(memoryOff || hasMemory) && <i className={`context-indicator ${memoryOff ? 'is-off' : 'is-used'}`} />}</Button></TooltipTrigger><TooltipContent side="bottom">{memoryOff ? '本次不沿用记忆' : hasMemory ? '查看本轮关注与沿用的记忆' : '查看研究范围与本轮关注'}</TooltipContent></Tooltip>
    </div>}
  </div>;
}

export function DetailSheet({ open, onClose, title, description, eyebrow, footer, closeLabel, opener, className = '', children }) {
  return <Sheet open={open} onOpenChange={next => !next && onClose()}>
    <SheetContent showCloseButton={false} className={`evidence-drawer ${className}`} aria-label={title} onCloseAutoFocus={event => { if (opener?.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }}>
      <div className="drawer-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<SheetTitle>{title}</SheetTitle></div><Button variant="ghost" size="icon" className="icon-button" onClick={onClose} aria-label={closeLabel}><X size={19} /></Button></div>
      <SheetDescription className="drawer-description">{description}</SheetDescription>
      {children}
      <div className="drawer-footer"><ShieldCheck size={13} />{footer}</div>
    </SheetContent>
  </Sheet>;
}
