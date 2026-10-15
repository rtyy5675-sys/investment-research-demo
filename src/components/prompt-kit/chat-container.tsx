/**
 * Adapted from prompt-kit by Julien Thibeaut. MIT License.
 * Upstream: https://github.com/ibelick/prompt-kit
 * Commit: 5a9496635cc0e1bf7679fe2a9e35d9b36b99c08a
 * Local changes documented in docs/research/promptkit-integration-notes.md.
 * Full license: ./LICENCE.md
 */
"use client"

import { cn } from "@/lib/utils"
import type React from "react"
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom"
import { ArrowDown } from "lucide-react"
import { Button } from "@/components/ui/button"

export type ChatContainerRootProps = {
  children: React.ReactNode
  className?: string
} & Omit<React.ComponentProps<typeof StickToBottom>, "children" | "className">

export type ChatContainerContentProps = {
  children: React.ReactNode
  className?: string
} & React.HTMLAttributes<HTMLDivElement>

export type ChatContainerScrollAnchorProps = {
  className?: string
  ref?: React.RefObject<HTMLDivElement>
} & React.HTMLAttributes<HTMLDivElement>

function ChatContainerRoot({
  children,
  className,
  ...props
}: ChatContainerRootProps) {
  return (
    <StickToBottom
      className={cn("flex overflow-y-auto", className)}
      resize="instant"
      initial="instant"
      role="log"
      {...props}
    >
      {children}
    </StickToBottom>
  )
}

function ChatContainerContent({
  children,
  className,
  ...props
}: ChatContainerContentProps) {
  return (
    <StickToBottom.Content
      className={cn("flex w-full flex-col", className)}
      {...props}
    >
      {children}
    </StickToBottom.Content>
  )
}

function ChatContainerScrollAnchor({
  className,
  ...props
}: ChatContainerScrollAnchorProps) {
  return (
    <div
      className={cn("h-px w-full shrink-0 scroll-mt-4", className)}
      aria-hidden="true"
      {...props}
    />
  )
}

function ChatContainerScrollButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()
  if (isAtBottom) return null
  return <Button type="button" variant="outline" size="icon-sm" className="chat-scroll-bottom" aria-label="回到对话底部" onClick={() => scrollToBottom({ animation: "instant" })}><ArrowDown size={15} /></Button>
}

export { ChatContainerRoot, ChatContainerContent, ChatContainerScrollAnchor, ChatContainerScrollButton }
