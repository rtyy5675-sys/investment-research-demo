/**
 * Adapted from prompt-kit by Julien Thibeaut. MIT License.
 * Upstream: https://github.com/ibelick/prompt-kit
 * Commit: 5a9496635cc0e1bf7679fe2a9e35d9b36b99c08a
 * Local changes documented in docs/research/promptkit-integration-notes.md.
 * Full license: ./LICENCE.md
 */
import type React from "react"
import { Avatar as AvatarPrimitive } from "radix-ui"
import ReactMarkdown from "react-markdown"
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type MessageProps = React.HTMLAttributes<HTMLDivElement>

const Message = ({ children, className, ...props }: MessageProps) => (
  <div className={cn("flex min-w-0 gap-3", className)} {...props}>{children}</div>
)

export type MessageAvatarProps = {
  src?: string
  alt: string
  fallback?: React.ReactNode
  delayMs?: number
  className?: string
}

const MessageAvatar = ({ src, alt, fallback, delayMs, className }: MessageAvatarProps) => (
  <AvatarPrimitive.Root className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm", className)}>
    {src && <AvatarPrimitive.Image src={src} alt={alt} className="h-full w-full rounded-full object-cover" />}
    <AvatarPrimitive.Fallback delayMs={delayMs} aria-label={alt}>{fallback}</AvatarPrimitive.Fallback>
  </AvatarPrimitive.Root>
)

export type MessageContentProps = React.HTMLAttributes<HTMLDivElement> & {
  markdown?: boolean
  renderMarkdown?: (text: string) => React.ReactNode
}

const MessageContent = ({ children, markdown = false, renderMarkdown, className, ...props }: MessageContentProps) => {
  const classNames = cn("min-w-0 rounded-lg p-2 text-foreground bg-secondary break-words whitespace-normal", className)
  return <div className={classNames} {...props}>
    {markdown && typeof children === "string"
      ? (renderMarkdown ? renderMarkdown(children) : <ReactMarkdown>{children}</ReactMarkdown>)
      : children}
  </div>
}

export type MessageActionsProps = React.HTMLAttributes<HTMLDivElement>
const MessageActions = ({ children, className, ...props }: MessageActionsProps) => (
  <div className={cn("text-muted-foreground flex items-center gap-2", className)} {...props}>{children}</div>
)

export type MessageActionProps = React.ComponentProps<typeof Tooltip> & {
  className?: string
  tooltip: React.ReactNode
  children: React.ReactNode
  side?: "top" | "bottom" | "left" | "right"
}
const MessageAction = ({ tooltip, children, className, side = "top", ...props }: MessageActionProps) => (
  <TooltipProvider><Tooltip {...props}>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent side={side} className={className}>{tooltip}</TooltipContent>
  </Tooltip></TooltipProvider>
)

export { Message, MessageAvatar, MessageContent, MessageActions, MessageAction }
