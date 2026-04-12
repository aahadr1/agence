"use client";

import type { DriveFolderTreeNode } from "@/lib/drive/types";
import { ChevronRight, Folder } from "lucide-react";
import { useState } from "react";

export function DriveFolderTree({
  nodes,
  activeFolderId,
  onSelect,
}: {
  nodes: DriveFolderTreeNode[];
  activeFolderId: string | null;
  onSelect: (folderId: string) => void;
}) {
  return (
    <div className="space-y-1">
      {nodes.map((node) => (
        <DriveFolderTreeItem
          key={node.id}
          node={node}
          activeFolderId={activeFolderId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function DriveFolderTreeItem({
  node,
  activeFolderId,
  onSelect,
}: {
  node: DriveFolderTreeNode;
  activeFolderId: string | null;
  onSelect: (folderId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const isActive = node.id === activeFolderId;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setOpen((value) => !value)}
          disabled={!hasChildren}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition ${open ? "rotate-90" : ""} ${!hasChildren ? "opacity-0" : ""}`}
          />
        </button>
        <button
          type="button"
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm transition ${
            isActive
              ? "bg-blue-subtle text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          onClick={() => onSelect(node.id)}
        >
          <Folder className="h-4 w-4 shrink-0" />
          <span className="truncate">{node.title}</span>
        </button>
      </div>
      {hasChildren && open ? (
        <div className="ml-5 mt-1 border-l border-border pl-2">
          <DriveFolderTree
            nodes={node.children}
            activeFolderId={activeFolderId}
            onSelect={onSelect}
          />
        </div>
      ) : null}
    </div>
  );
}
