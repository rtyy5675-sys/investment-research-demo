/**
 * Adapted from prompt-kit by Julien Thibeaut. MIT License.
 * Upstream: https://github.com/ibelick/prompt-kit
 * Commit: 5a9496635cc0e1bf7679fe2a9e35d9b36b99c08a
 * Local changes documented in docs/research/promptkit-integration-notes.md.
 * Full license: ./LICENCE.md
 */
"use client"

import type React from "react"
import { createContext, useContext, useState } from "react"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"

const SourceContext = createContext<{ href?: string; domain: string; onOpen?: () => void; onPreview: () => void } | null>(null)
function useSourceContext() {
  const context = useContext(SourceContext)
  if (!context) throw new Error("Source.* must be used inside <Source>")
  return context
}
function safeHttp(href?: string) {
  try { const url = new URL(href || ""); return /^https?:$/.test(url.protocol) ? url.href : undefined }
  catch { return undefined }
}

export type SourceProps = {
  href?: string
  onOpen?: () => void
  children: React.ReactNode
}
export function Source({ href, onOpen, children }: SourceProps) {
  const [open, setOpen] = useState(false)
  const [suppressed, setSuppressed] = useState(false)
  const safeHref = safeHttp(href)
  const domain = safeHref ? new URL(safeHref).hostname : "研究依据"
  const openDetails = onOpen ? () => { setSuppressed(true); setOpen(false); onOpen() } : undefined
  return <SourceContext.Provider value={{ href: safeHref, domain, onOpen: openDetails, onPreview: () => setSuppressed(false) }}>
    <HoverCard open={open && !suppressed} onOpenChange={setOpen} openDelay={150} closeDelay={0}>{children}</HoverCard>
  </SourceContext.Provider>
}

export type SourceTriggerProps = {
  label?: string | number
  className?: string
  title?: string
  "aria-label"?: string
}
export function SourceTrigger({ label, className, ...props }: SourceTriggerProps) {
  const { href, domain, onOpen, onPreview } = useSourceContext()
  const text = label ?? domain.replace("www.", "")
  const classes = cn("bg-muted text-muted-foreground hover:bg-secondary hover:text-foreground inline-flex min-h-7 max-w-64 items-center gap-1 overflow-hidden rounded-md px-2 py-1 text-xs no-underline transition-colors focus-visible:outline-2 focus-visible:outline-ring", className)
  const child = onOpen || !href
    ? <button type="button" className={classes} onPointerEnter={onPreview} onClick={onOpen} {...props}><span className="truncate">{text}</span></button>
    : <a href={href} target="_blank" rel="noopener noreferrer" className={classes} onPointerEnter={onPreview} {...props}><span className="truncate">{text}</span></a>
  return <HoverCardTrigger asChild>{child}</HoverCardTrigger>
}

export type SourceContentProps = {
  title: string
  description?: React.ReactNode
  className?: string
}
export function SourceContent({ title, description, className }: SourceContentProps) {
  const { href, domain, onOpen } = useSourceContext()
  return <HoverCardContent className={cn("w-80 max-w-[calc(100vw-2rem)] p-4 shadow-sm", className)}>
    <div className="flex flex-col gap-2">
      <div className="text-muted-foreground truncate text-xs">{domain.replace("www.", "")}</div>
      <div className="text-sm font-medium leading-6">{title}</div>
      {description && <div className="text-muted-foreground text-sm leading-6">{description}</div>}
      {onOpen ? <button type="button" className="mt-1 self-start text-sm underline underline-offset-4" onClick={onOpen}>查看依据详情</button>
        : href && <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1 self-start text-sm underline underline-offset-4">打开来源</a>}
    </div>
  </HoverCardContent>
}
