"use client";

import type { DriveNodeSummary } from "@/lib/drive/types";
import {
  FileText,
  Folder,
  MoreHorizontal,
  Star,
  StarOff,
  Trash2,
  Copy,
  FolderInput,
} from "lucide-react";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DriveList({
  items,
  onOpen,
  onFavorite,
  onRename,
  onDuplicate,
  onMove,
  onDelete,
  onRestore,
  isTrash = false,
}: {
  items: DriveNodeSummary[];
  onOpen: (item: DriveNodeSummary) => void;
  onFavorite: (item: DriveNodeSummary, next: boolean) => void;
  onRename: (item: DriveNodeSummary) => void;
  onDuplicate: (item: DriveNodeSummary) => void;
  onMove: (item: DriveNodeSummary) => void;
  onDelete: (item: DriveNodeSummary) => void;
  onRestore: (item: DriveNodeSummary) => void;
  isTrash?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
      <div className="grid grid-cols-[minmax(0,2fr)_120px_160px_140px_88px] gap-4 border-b border-border px-5 py-3 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
        <span>Title</span>
        <span>Visibility</span>
        <span>Last updated</span>
        <span>Owner</span>
        <span>Actions</span>
      </div>
      <div>
        {items.length ? (
          items.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-[minmax(0,2fr)_120px_160px_140px_88px] gap-4 border-b border-border px-5 py-3 text-sm last:border-b-0 hover:bg-muted/30"
            >
              <button
                type="button"
                className="flex min-w-0 items-center gap-3 text-left"
                onClick={() => onOpen(item)}
              >
                <span className="rounded-xl bg-muted p-2 text-muted-foreground">
                  {item.type === "folder" ? (
                    <Folder className="h-4 w-4" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                </span>
                <span className="truncate font-medium text-foreground">{item.title}</span>
              </button>
              <span className="inline-flex h-fit w-fit rounded-full bg-blue-subtle px-2.5 py-1 text-xs font-medium capitalize text-foreground">
                {item.visibility}
              </span>
              <span className="text-muted-foreground">{formatTime(item.updatedAt)}</span>
              <span className="truncate text-muted-foreground">{item.owner.name}</span>
              <div className="flex items-center justify-end gap-1">
                {!isTrash ? (
                  <>
                    <button
                      type="button"
                      className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title={item.isFavorite ? "Remove favorite" : "Add favorite"}
                      onClick={() => onFavorite(item, !item.isFavorite)}
                    >
                      {item.isFavorite ? (
                        <Star className="h-4 w-4 fill-current" />
                      ) : (
                        <StarOff className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Rename"
                      onClick={() => onRename(item)}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Duplicate"
                      onClick={() => onDuplicate(item)}
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Move"
                      onClick={() => onMove(item)}
                    >
                      <FolderInput className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
                      title="Delete"
                      onClick={() => onDelete(item)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn-outline !px-3 !py-2 text-xs"
                    onClick={() => onRestore(item)}
                  >
                    Restore
                  </button>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            No items here yet.
          </div>
        )}
      </div>
    </div>
  );
}
