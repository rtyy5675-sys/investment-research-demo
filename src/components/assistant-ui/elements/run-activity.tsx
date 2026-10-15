// Adapted from assistant-ui (MIT), Copyright (c) 2026 AgentbaseAI Inc.
// Source: assistant-ui/assistant-ui@2bdd534a3d8da45e6c7a9ee6553862b83713059d
// packages/ui/src/components/react/assistant-ui/elements/run-activity.tsx
// Local changes: shared shadcn/Radix Collapsible and product-scoped styles.
// Full license: ../LICENSE
"use client";

import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import "./run-activity.css";

export type RunActivityStatus =
  | "running"
  | "requires-action"
  | "complete"
  | "cancelled"
  | "incomplete"
  | "error";

export type RunActivityEntry = {
  id: string;
  kind: "commentary" | "tool";
  label: string;
  content: ReactNode;
  /** Optional application-owned tool state; never inferred from content. */
  status?: "running" | "error" | "cancelled" | "pending" | "complete";
};

export type RunActivityProps = {
  status: RunActivityStatus;
  statusLabel: string;
  /** Formatted from the caller's persisted run timing. */
  durationLabel?: ReactNode;
  entries: readonly RunActivityEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pending decisions and recovery controls remain outside the disclosure. */
  attention?: ReactNode;
  /** Final-answer content remains outside the disclosure. */
  children?: ReactNode;
  className?: string;
};

export function RunActivity({
  status,
  statusLabel,
  durationLabel,
  entries,
  open,
  onOpenChange,
  attention,
  children,
  className,
}: RunActivityProps) {
  const latestActivity =
    status === "running"
      ? entries.findLast((entry) => entry.label.trim())?.label
      : undefined;

  const summary = (
    <span className="aui-run-summary">
      {statusLabel}
      {durationLabel != null && <> {durationLabel}</>}
    </span>
  );

  return (
    <div
      data-slot="run-activity"
      data-status={status}
      className={cn("aui-run-activity", className)}
    >
      {entries.length > 0 ? (
        <Collapsible open={open} onOpenChange={onOpenChange}>
          <CollapsibleTrigger
            aria-busy={status === "running"}
            className="aui-run-trigger"
          >
            <ChevronRightIcon
              aria-hidden="true"
              className="aui-run-chevron"
            />
            {summary}
          </CollapsibleTrigger>
          <CollapsibleContent className="aui-run-panel">
            <ol className="aui-run-entries">
              {entries.map((entry) => (
                <li key={entry.id} data-activity-kind={entry.kind} data-activity-status={entry.status}>
                  {entry.content}
                </li>
              ))}
            </ol>
          </CollapsibleContent>
          {!open && latestActivity && (
            <p className="aui-run-latest">
              {latestActivity}
            </p>
          )}
        </Collapsible>
      ) : (
        <p className="aui-run-empty">{summary}</p>
      )}
      {/* Announce the settled duration without announcing streaming timer ticks. */}
      <span role="status" aria-atomic="true" className="sr-only">
        {statusLabel}
        {status !== "running" && durationLabel != null && <> {durationLabel}</>}
      </span>
      {attention}
      {children}
    </div>
  );
}
