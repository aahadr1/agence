"use client";

import { LeadList } from "@/lib/types";
import { ListPlus, Plus, X } from "lucide-react";
import { useState } from "react";

interface SelectBarProps {
  selectedCount: number;
  lists: LeadList[];
  onAddToList: (listId: string) => void;
  onCreateListWithSelected: (name: string) => void;
  onClearSelection: () => void;
  onExportSelected: () => void;
}

export function SelectBar({
  selectedCount,
  lists,
  onAddToList,
  onCreateListWithSelected,
  onClearSelection,
  onExportSelected: _onExportSelected,
}: SelectBarProps) {
  void _onExportSelected;
  const [showDropdown, setShowDropdown] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [showNewInput, setShowNewInput] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <div className="animate-fade-in fixed bottom-6 left-4 right-4 z-50 flex items-center gap-3 border border-border bg-card px-4 py-3 shadow-sm sm:left-1/2 sm:right-auto sm:w-auto sm:-translate-x-1/2 sm:px-5">
      <span className="font-mono text-xs tabular-nums text-foreground">
        {selectedCount} selected
      </span>

      <div className="h-4 w-px bg-black/[0.1]" />

      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setShowDropdown(!showDropdown);
            setShowNewInput(false);
          }}
          className="btn-solid py-2 text-xs"
        >
          <ListPlus className="h-3.5 w-3.5" strokeWidth={1.25} />
          Add to list
        </button>

        {showDropdown ? (
          <div className="absolute bottom-full left-0 mb-2 w-64 space-y-0 border border-border bg-card p-1 shadow-sm">
            {lists.map((list) => (
              <button
                key={list.id}
                type="button"
                onClick={() => {
                  onAddToList(list.id);
                  setShowDropdown(false);
                }}
                className="w-full px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary/60"
              >
                {list.name}
              </button>
            ))}

            {showNewInput ? (
              <div className="flex gap-2 border-t border-border p-2">
                <input
                  type="text"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="List name"
                  className="input-minimal flex-1 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newListName.trim()) {
                      onCreateListWithSelected(newListName.trim());
                      setNewListName("");
                      setShowDropdown(false);
                      setShowNewInput(false);
                    }
                  }}
                  autoFocus
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowNewInput(true)}
                className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-xs font-medium text-foreground hover:bg-secondary/40"
              >
                <Plus className="h-3 w-3" strokeWidth={1.25} />
                New list
              </button>
            )}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onClearSelection}
        className="p-2 text-muted-foreground transition-colors hover:text-foreground"
        title="Clear"
      >
        <X className="h-4 w-4" strokeWidth={1.25} />
      </button>
    </div>
  );
}
