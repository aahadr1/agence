"use client";

import { Panel } from "@/components/ui/panel";
import { LeadList } from "@/lib/types";
import {
  List,
  Plus,
  Trash2,
  Download,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

interface ListPanelProps {
  lists: LeadList[];
  activeListId: string | null;
  onSelectList: (id: string) => void;
  onCreateList: (name: string) => void;
  onDeleteList: (id: string) => void;
  onExportList: (id: string) => void;
  onExpandList: (id: string) => void;
}

export function ListPanel({
  lists,
  activeListId,
  onSelectList,
  onCreateList,
  onDeleteList,
  onExportList,
  onExpandList,
}: ListPanelProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");

  const handleCreate = () => {
    if (newName.trim()) {
      onCreateList(newName.trim());
      setNewName("");
      setShowCreate(false);
    }
  };

  return (
    <Panel padding="sm" className="rounded-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="label-eyebrow flex items-center gap-2">
          <List className="h-3.5 w-3.5" strokeWidth={1.25} />
          Lists
        </h3>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="p-1 text-muted-foreground hover:text-foreground"
          title="New list"
        >
          <Plus className="h-4 w-4" strokeWidth={1.25} />
        </button>
      </div>

      {showCreate ? (
        <div className="mb-4 flex gap-2 border-b border-border pb-4">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name"
            className="input-minimal flex-1 text-xs"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <button type="button" onClick={handleCreate} className="btn-solid text-xs">
            Add
          </button>
        </div>
      ) : null}

      {lists.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No lists yet. Search for leads, select them, and add to a list.
        </p>
      ) : (
        <div className="divide-y divide-border border border-border">
          {lists.map((list) => (
            <div
              key={list.id}
              className={`group relative transition-colors ${
                activeListId === list.id ? "bg-secondary/50" : "hover:bg-secondary/30"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectList(list.id)}
                className="w-full p-3 text-left"
              >
                <p className="font-medium text-foreground text-sm truncate pr-16">
                  {list.name}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-muted-foreground">
                    {list.keywords?.length || 0} keywords
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(list.updated_at).toLocaleDateString()}
                  </span>
                </div>
              </button>

              {/* Actions — visible on hover or when active */}
              <div className={`absolute right-2 top-2 flex items-center gap-0.5 ${
                activeListId === list.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              } transition-opacity`}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpandList(list.id);
                  }}
                  className="p-1.5 text-muted-foreground hover:text-foreground"
                  title="Expand list"
                >
                  <Sparkles className="h-3 w-3" strokeWidth={1.25} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExportList(list.id);
                  }}
                  className="p-1.5 text-muted-foreground hover:text-foreground"
                  title="Export CSV"
                >
                  <Download className="h-3 w-3" strokeWidth={1.25} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteList(list.id);
                  }}
                  className="p-1.5 text-destructive hover:opacity-80"
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3" strokeWidth={1.25} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
