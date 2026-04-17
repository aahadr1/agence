"use client";

import type { TimelineEvent, Approval } from "./types";
import { UserEvent } from "./events/user-event";
import { AssistantEvent } from "./events/assistant-event";
import { ReflectionEvent } from "./events/reflection-event";
import { NudgeEvent } from "./events/nudge-event";
import { ThinkingEvent } from "./events/thinking-event";
import { ToolEvent } from "./events/tool-event";
import { ApprovalEvent } from "./events/approval-event";
import { ErrorEvent } from "./events/error-event";
import { PlanEvent } from "./events/plan-event";

interface Props {
  event: TimelineEvent;
  approvals: Approval[];
  onRespondApproval: (id: string, decision: "approve" | "reject") => void;
  last?: boolean;
}

export function StreamEvent({
  event,
  approvals,
  onRespondApproval,
  last,
}: Props) {
  switch (event.kind) {
    case "user":
      return <UserEvent content={event.content} />;
    case "assistant":
      return (
        <AssistantEvent
          content={event.content}
          metadata={event.metadata}
          last={last}
        />
      );
    case "plan":
      return <PlanEvent content={event.content} />;
    case "reflection":
      return (
        <ReflectionEvent
          iteration={event.iteration}
          observation={event.observation}
          conclusion={event.conclusion}
          next_action={event.next_action}
        />
      );
    case "nudge":
      return <NudgeEvent content={event.content} reason={event.reason} />;
    case "thinking":
      return <ThinkingEvent content={event.content} />;
    case "tool":
      return (
        <ToolEvent
          content={event.content}
          tool={event.tool}
          status={event.status}
        />
      );
    case "approval_request":
      return (
        <ApprovalEvent
          content={event.content}
          approvalId={event.approval_id}
          details={event.details}
          risk={event.risk}
          approvals={approvals}
          onRespond={onRespondApproval}
        />
      );
    case "approval_response":
      // Already summarized inside the matching approval_request card
      return null;
    case "error":
      return <ErrorEvent content={event.content} />;
    default:
      return null;
  }
}
