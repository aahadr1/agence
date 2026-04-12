"use client";

import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Underline from "@tiptap/extension-underline";
import { Node } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Columns2,
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Link2,
  List,
  ListOrdered,
  Minus,
  Plus,
  Quote,
  Rows2,
  TableProperties,
  TextQuote,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type JSONDoc = Record<string, unknown>;

function ToolbarButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`inline-flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground transition ${
        active
          ? "border-blue bg-blue-subtle text-foreground"
          : "border-transparent hover:border-border hover:bg-muted/40 hover:text-foreground"
      }`}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-type": "callout" }, 0];
  },
});

export function SimpleEditor({
  initialContent,
  onSave,
  readOnly = false,
  onSelectionTextChange,
  onStatusChange,
  autoFocusToken,
}: {
  initialContent: JSONDoc | null;
  onSave: (json: JSONDoc) => void | Promise<void>;
  readOnly?: boolean;
  onSelectionTextChange?: (text: string) => void;
  onStatusChange?: (status: string) => void;
  autoFocusToken?: string | null;
}) {
  const [saveState, setSaveState] = useState("Saved");
  const [slashQuery, setSlashQuery] = useState("");
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashRect, setSlashRect] = useState<{ top: number; left: number } | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const isSyncingRef = useRef(false);
  const autoFocusRef = useRef<string | null>(null);

  const updateSaveState = useCallback(
    (value: string) => {
      setSaveState(value);
      onStatusChange?.(value);
    },
    [onStatusChange]
  );

  const handleSelectionChange = useCallback(
    (nextEditor: NonNullable<ReturnType<typeof useEditor>>) => {
      const { from, to } = nextEditor.state.selection;
      const text = nextEditor.state.doc.textBetween(from, to, " ").trim();
      onSelectionTextChange?.(text);
    },
    [onSelectionTextChange]
  );

  const queueSave = useCallback(
    (nextEditor: NonNullable<ReturnType<typeof useEditor>>) => {
      if (readOnly || isSyncingRef.current) return;
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
      updateSaveState("Saving...");
      saveTimeoutRef.current = window.setTimeout(async () => {
        try {
          await onSave(nextEditor.getJSON() as JSONDoc);
          updateSaveState("Saved");
        } catch {
          updateSaveState("Save failed");
        }
      }, 900);
    },
    [onSave, readOnly, updateSaveState]
  );

  const updateSlashMenu = useCallback(
    (nextEditor: NonNullable<ReturnType<typeof useEditor>>) => {
      if (readOnly) return;

      const { from, to } = nextEditor.state.selection;
      if (from !== to) {
        setSlashOpen(false);
        return;
      }

      const { $from } = nextEditor.state.selection;
      const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
      const match = textBefore.match(/\/([a-z0-9-]*)$/i);
      if (!match) {
        setSlashOpen(false);
        return;
      }

      const coords = nextEditor.view.coordsAtPos(from);
      setSlashRect({
        top: coords.bottom + window.scrollY + 8,
        left: coords.left + window.scrollX,
      });
      setSlashQuery(match[1] ?? "");
      setSlashOpen(true);
    },
    [readOnly]
  );

  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: readOnly,
        autolink: true,
        linkOnPaste: true,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Callout,
      Placeholder.configure({ placeholder: "Écrivez votre page…" }),
    ],
    content: initialContent || { type: "doc", content: [{ type: "paragraph" }] },
    immediatelyRender: false,
    onSelectionUpdate({ editor: nextEditor }) {
      handleSelectionChange(nextEditor);
      updateSlashMenu(nextEditor);
    },
    onUpdate({ editor: nextEditor }) {
      handleSelectionChange(nextEditor);
      updateSlashMenu(nextEditor);
      queueSave(nextEditor);
    },
  });

  useEffect(() => {
    if (editor && initialContent) {
      isSyncingRef.current = true;
      editor.commands.setContent(initialContent);
      window.setTimeout(() => {
        updateSaveState("Saved");
        isSyncingRef.current = false;
      }, 0);
    }
  }, [editor, initialContent, updateSaveState]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!editor || readOnly || !autoFocusToken) return;
    if (autoFocusRef.current === autoFocusToken) return;

    autoFocusRef.current = autoFocusToken;
    const timeoutId = window.setTimeout(() => {
      editor.commands.focus("start");
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [autoFocusToken, editor, readOnly]);

  const promptForLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Enter a URL", previousUrl || "https://");

    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  const commands = useMemo(
    () =>
      [
        {
          key: "paragraph",
          label: "Paragraph",
          search: ["paragraph", "text"],
          action: () => editor?.chain().focus().setParagraph().run(),
        },
        {
          key: "h1",
          label: "Heading 1",
          search: ["heading", "title", "h1"],
          action: () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
        },
        {
          key: "h2",
          label: "Heading 2",
          search: ["heading", "subtitle", "h2"],
          action: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
        },
        {
          key: "h3",
          label: "Heading 3",
          search: ["heading", "h3"],
          action: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
        },
        {
          key: "bullet",
          label: "Bullet list",
          search: ["bullet", "list"],
          action: () => editor?.chain().focus().toggleBulletList().run(),
        },
        {
          key: "numbered",
          label: "Numbered list",
          search: ["number", "ordered", "list"],
          action: () => editor?.chain().focus().toggleOrderedList().run(),
        },
        {
          key: "checklist",
          label: "Checklist",
          search: ["task", "check", "todo"],
          action: () => editor?.chain().focus().toggleTaskList().run(),
        },
        {
          key: "quote",
          label: "Quote",
          search: ["quote"],
          action: () => editor?.chain().focus().toggleBlockquote().run(),
        },
        {
          key: "divider",
          label: "Divider",
          search: ["divider", "line"],
          action: () => editor?.chain().focus().setHorizontalRule().run(),
        },
        {
          key: "table",
          label: "Table",
          search: ["table", "grid"],
          action: () =>
            editor
              ?.chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run(),
        },
        {
          key: "callout",
          label: "Callout",
          search: ["callout", "note"],
          action: () =>
            editor
              ?.chain()
              .focus()
              .insertContent({
                type: "callout",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Callout" }] }],
              })
              .run(),
        },
        {
          key: "code",
          label: "Code block",
          search: ["code", "snippet"],
          action: () => editor?.chain().focus().toggleCodeBlock().run(),
        },
      ].filter((item) => item.label.toLowerCase().includes(slashQuery.toLowerCase()) || item.search.some((term) => term.includes(slashQuery.toLowerCase()))),
    [editor, slashQuery]
  );

  const applySlashCommand = useCallback(
    (action: () => void) => {
      if (!editor) return;
      const { from } = editor.state.selection;
      const { $from } = editor.state.selection;
      const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
      const match = textBefore.match(/\/([a-z0-9-]*)$/i);
      if (!match) return;

      editor
        .chain()
        .focus()
        .deleteRange({
          from: from - match[0].length,
          to: from,
        })
        .run();

      action();
      setSlashOpen(false);
    },
    [editor]
  );

  return (
    <div className="space-y-3">
      {!readOnly && editor ? (
        <div className="flex flex-wrap items-center gap-1 rounded-[var(--radius)] border border-border bg-card px-2 py-2">
          <ToolbarButton
            label="Undo"
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Bold"
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <span className="text-sm font-semibold">B</span>
          </ToolbarButton>
          <ToolbarButton
            label="Italic"
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <span className="text-sm italic">I</span>
          </ToolbarButton>
          <ToolbarButton
            label="Underline"
            active={editor.isActive("underline")}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <span className="text-sm underline">U</span>
          </ToolbarButton>
          <ToolbarButton
            label="Strike"
            active={editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <span className="text-sm line-through">S</span>
          </ToolbarButton>
          <ToolbarButton
            label="Inline code"
            active={editor.isActive("code")}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <Code2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Link"
            active={editor.isActive("link")}
            onClick={promptForLink}
          >
            <Link2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Heading 1"
            active={editor.isActive("heading", { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          >
            <Heading1 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Heading 2"
            active={editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Heading 3"
            active={editor.isActive("heading", { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            <Heading3 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Bullet list"
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Numbered list"
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Checklist"
            active={editor.isActive("taskList")}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          >
            <CheckSquare className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Quote"
            active={editor.isActive("blockquote")}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Code block"
            active={editor.isActive("codeBlock")}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          >
            <Code2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Callout"
            active={editor.isActive("callout")}
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertContent({
                  type: "callout",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Callout" }] }],
                })
                .run()
            }
          >
            <TextQuote className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Divider"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            <Minus className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Table"
            active={editor.isActive("table")}
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
          >
            <TableProperties className="h-4 w-4" />
          </ToolbarButton>
          {editor.isActive("table") ? (
            <>
              <ToolbarButton
                label="Add row"
                onClick={() => editor.chain().focus().addRowAfter().run()}
              >
                <Rows2 className="h-4 w-4" />
              </ToolbarButton>
              <ToolbarButton
                label="Add column"
                onClick={() => editor.chain().focus().addColumnAfter().run()}
              >
                <Columns2 className="h-4 w-4" />
              </ToolbarButton>
              <ToolbarButton
                label="Delete row"
                onClick={() => editor.chain().focus().deleteRow().run()}
              >
                <Minus className="h-4 w-4" />
              </ToolbarButton>
              <ToolbarButton
                label="Delete column"
                onClick={() => editor.chain().focus().deleteColumn().run()}
              >
                <Plus className="h-4 w-4 rotate-45" />
              </ToolbarButton>
            </>
          ) : null}
          <div className="ml-auto text-xs text-muted-foreground">{saveState}</div>
        </div>
      ) : null}
      <EditorContent
        editor={editor}
        className="drive-editor prose max-w-none min-h-[360px] rounded-[var(--radius)] border border-border bg-card px-6 py-5 text-sm text-foreground shadow-sm transition focus-within:border-blue [&_.ProseMirror]:min-h-[320px] [&_.ProseMirror]:outline-none"
      />
      {!readOnly && slashOpen && slashRect && commands.length ? (
        <div
          className="fixed z-50 w-64 rounded-2xl border border-border bg-card p-2 shadow-2xl"
          style={{ top: slashRect.top, left: slashRect.left }}
        >
          <p className="px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Insert
          </p>
          <div className="space-y-1">
            {commands.map((command) => (
              <button
                key={command.key}
                type="button"
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                onClick={() => applySlashCommand(command.action)}
              >
                <span>{command.label}</span>
                <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  /
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
