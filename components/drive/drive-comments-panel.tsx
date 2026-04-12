"use client";

import { requestDriveJson } from "@/lib/drive/client";
import type { DriveCommentThread } from "@/lib/drive/types";
import { MessageSquarePlus, Reply, CheckCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export function DriveCommentsPanel({
  nodeId,
  selectedText,
}: {
  nodeId: string;
  selectedText: string;
}) {
  const [threads, setThreads] = useState<DriveCommentThread[]>([]);
  const [body, setBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [loading, setLoading] = useState(true);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const result = await requestDriveJson<{ threads: DriveCommentThread[] }>(
        `/api/drive/comments?nodeId=${encodeURIComponent(nodeId)}`
      );
      if (result.ok && result.data) {
        setThreads(result.data.threads || []);
      }
    } finally {
      setLoading(false);
    }
  }, [nodeId]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadThreads();
    });
  }, [loadThreads]);

  async function submitComment() {
    const text = body.trim();
    if (!text) return;
    const prefix = selectedText ? `Selection: "${selectedText}"\n\n` : "";
    const result = await requestDriveJson<{ threads: DriveCommentThread[] }>(
      "/api/drive/comments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId,
          body: `${prefix}${text}`,
        }),
      }
    );
    if (result.ok && result.data) {
      setThreads(result.data.threads || []);
      setBody("");
    }
  }

  async function submitReply(parentCommentId: string) {
    const text = replyBody.trim();
    if (!text) return;
    const result = await requestDriveJson<{ threads: DriveCommentThread[] }>(
      "/api/drive/comments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId,
          parentCommentId,
          body: text,
        }),
      }
    );
    if (result.ok && result.data) {
      setThreads(result.data.threads || []);
      setReplyBody("");
      setReplyingTo(null);
    }
  }

  async function toggleResolved(threadId: string, resolved: boolean) {
    const result = await requestDriveJson<{ threads: DriveCommentThread[] }>(
      `/api/drive/comments/${threadId}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved }),
      }
    );
    if (result.ok && result.data) {
      setThreads(result.data.threads || []);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-4">
        <p className="text-sm font-medium text-foreground">Comments</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Start a review thread or reply inline.
        </p>
      </div>
      <div className="border-b border-border px-4 py-4">
        {selectedText ? (
          <p className="mb-2 rounded-xl bg-blue-subtle px-3 py-2 text-xs text-foreground">
            Selected: {selectedText}
          </p>
        ) : null}
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className="input-minimal min-h-24 resize-none"
          placeholder="Add a comment"
        />
        <button type="button" className="btn-solid mt-3 w-full" onClick={submitComment}>
          <MessageSquarePlus className="h-4 w-4" />
          Add comment
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading comments…</p>
        ) : threads.length ? (
          threads.map((thread) => (
            <div key={thread.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{thread.author.name}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {thread.body}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => toggleResolved(thread.id, !thread.resolved)}
                >
                  <CheckCheck className="mr-1 inline h-3.5 w-3.5" />
                  {thread.resolved ? "Reopen" : "Resolve"}
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {thread.replies.map((reply) => (
                  <div
                    key={reply.id}
                    className="rounded-xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
                  >
                    <p className="font-medium text-foreground">{reply.author.name}</p>
                    <p className="mt-1 whitespace-pre-wrap">{reply.body}</p>
                  </div>
                ))}
              </div>
              {replyingTo === thread.id ? (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={replyBody}
                    onChange={(event) => setReplyBody(event.target.value)}
                    className="input-minimal min-h-20 resize-none"
                    placeholder="Reply to this thread"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-solid flex-1"
                      onClick={() => submitReply(thread.id)}
                    >
                      Send reply
                    </button>
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={() => {
                        setReplyingTo(null);
                        setReplyBody("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setReplyingTo(thread.id)}
                >
                  <Reply className="h-3.5 w-3.5" />
                  Reply
                </button>
              )}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            No comments yet. Select text in the editor and leave the first note.
          </p>
        )}
      </div>
    </div>
  );
}
