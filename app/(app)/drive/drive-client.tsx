"use client";

import { DriveCommentsPanel } from "@/components/drive/drive-comments-panel";
import { DriveFolderTree } from "@/components/drive/drive-folder-tree";
import { DriveList } from "@/components/drive/drive-list";
import { SimpleEditor } from "@/components/drive/simple-editor";
import { DriveTemplatePicker } from "@/components/drive/drive-template-picker";
import { Panel } from "@/components/ui/panel";
import { requestDriveJson, type JsonFetchResult } from "@/lib/drive/client";
import type {
  DriveBootstrapPayload,
  DriveFolderPayload,
  DriveFolderTreeNode,
  DriveHomePayload,
  DriveNodeDetail,
  DriveNodeSummary,
  DriveSection,
  DriveSpace,
  DriveTemplate,
} from "@/lib/drive/types";
import {
  Clock3,
  FileText,
  FolderPlus,
  Home,
  Search,
  Shield,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

const SECTION_ITEMS: Array<{
  id: DriveSection;
  label: string;
  icon: typeof Home;
}> = [
  { id: "home", label: "Home", icon: Home },
  { id: "my-drive", label: "My Drive", icon: FileText },
  { id: "shared", label: "Shared", icon: Users },
  { id: "favorites", label: "Favorites", icon: Star },
  { id: "trash", label: "Trash", icon: Trash2 },
];

function formatUpdated(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function flattenFolders(
  rootValue: string,
  label: string,
  nodes: DriveFolderTreeNode[],
  depth = 0
): Array<{ id: string; label: string }> {
  const rows =
    depth === 0
      ? [{ id: rootValue, label }]
      : [];

  for (const node of nodes) {
    rows.push({
      id: `folder:${node.id}`,
      label: `${"  ".repeat(depth)}${node.title}`,
    });
    rows.push(...flattenFolders(rootValue, label, node.children, depth + 1));
  }

  return rows;
}

function getDriveErrorMessage<T>(
  result: JsonFetchResult<T>,
  fallback: string
) {
  const payload = result.data;
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error.trim()
  ) {
    return payload.error.trim();
  }

  const rawText = result.rawText.trim();
  return rawText || fallback;
}

export function DriveClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const section = (searchParams.get("section") as DriveSection | null) ?? "home";
  const folderId = searchParams.get("folder");
  const docId = searchParams.get("doc");
  const query = searchParams.get("q") ?? "";

  const [spaces, setSpaces] = useState<DriveSpace[]>([]);
  const [tree, setTree] = useState<{ personal: DriveFolderTreeNode[]; shared: DriveFolderTreeNode[] }>({
    personal: [],
    shared: [],
  });
  const [home, setHome] = useState<DriveHomePayload | null>(null);
  const [folderPayload, setFolderPayload] = useState<DriveFolderPayload | null>(null);
  const [searchResults, setSearchResults] = useState<DriveNodeSummary[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DriveNodeDetail | null>(null);
  const [templates, setTemplates] = useState<DriveTemplate[] | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [moveNode, setMoveNode] = useState<DriveNodeSummary | null>(null);
  const [moveTargetId, setMoveTargetId] = useState<string>("");
  const [selectedText, setSelectedText] = useState("");
  const [saveState, setSaveState] = useState("Saved");
  const [searchInput, setSearchInput] = useState(query);
  const [loadingCenter, setLoadingCenter] = useState(true);
  const [createDocumentPending, setCreateDocumentPending] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [pendingNewDocId, setPendingNewDocId] = useState<string | null>(null);

  const updateRoute = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      Object.entries(patch).forEach(([key, value]) => {
        if (value === null || value === "") {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      });
      router.push(`${pathname}?${next.toString()}`);
    },
    [pathname, router, searchParams]
  );

  const loadDrive = useCallback(async () => {
    setLoadingCenter(true);
    if (docId) {
      setSelectedText("");
      setSelectedDoc((current) => (current?.id === docId ? current : null));
    }
    const params = new URLSearchParams({
      section,
    });
    if (folderId) params.set("folderId", folderId);
    if (docId) params.set("docId", docId);
    if (query.trim()) params.set("q", query.trim());

    try {
      const result = await requestDriveJson<DriveBootstrapPayload>(
        `/api/drive/bootstrap?${params.toString()}`
      );

      if (result.ok && result.data) {
        if (docId && !result.data.selectedDoc) {
          setHome(null);
          setSearchResults([]);
          setSelectedDoc(null);
          setFolderPayload({ folder: null, breadcrumbs: [], items: [] });
          setDriveError(
            pendingNewDocId === docId
              ? "The new document was created, but it could not be opened automatically."
              : "This document could not be opened."
          );
          setPendingNewDocId(null);
          setLoadingCenter(false);
          updateRoute({ doc: null });
          return;
        }

        setSpaces(result.data.spaces || []);
        setTree(result.data.tree || { personal: [], shared: [] });
        setHome(result.data.home);
        setFolderPayload(result.data.folderPayload);
        setSearchResults(result.data.searchResults || []);
        setSelectedDoc(result.data.selectedDoc);

        if (docId && result.data.selectedDoc && pendingNewDocId === result.data.selectedDoc.id) {
          window.setTimeout(() => {
            setPendingNewDocId((current) =>
              current === result.data?.selectedDoc?.id ? null : current
            );
          }, 0);
        }
      } else {
        setHome(null);
        setSearchResults([]);
        setSelectedDoc(null);
        setFolderPayload({ folder: null, breadcrumbs: [], items: [] });

        if (docId) {
          setDriveError(
            getDriveErrorMessage(result, "Unable to open this document right now.")
          );
          setPendingNewDocId(null);
          setLoadingCenter(false);
          updateRoute({ doc: null });
          return;
        }
      }
    } catch {
      setHome(null);
      setSearchResults([]);
      setSelectedDoc(null);
      setFolderPayload({ folder: null, breadcrumbs: [], items: [] });

      if (docId) {
        setDriveError("Unable to open this document right now.");
        setPendingNewDocId(null);
        setLoadingCenter(false);
        updateRoute({ doc: null });
        return;
      }
    }

    setLoadingCenter(false);
  }, [docId, folderId, pendingNewDocId, query, section, updateRoute]);

  useEffect(() => {
    void loadDrive();
  }, [loadDrive]);

  useEffect(() => {
    setSearchInput(query);
  }, [query]);

  const personalSpace = spaces.find((space) => space.kind === "personal");
  const sharedSpace = spaces.find((space) => space.kind === "shared");

  const resolveTargetSpaceId = useCallback(
    async (targetSection: "my-drive" | "shared") => {
      const existingSpaceId =
        targetSection === "shared" ? sharedSpace?.id ?? null : personalSpace?.id ?? null;

      if (existingSpaceId) {
        return existingSpaceId;
      }

      const result = await requestDriveJson<DriveBootstrapPayload>(
        `/api/drive/bootstrap?section=${encodeURIComponent(targetSection)}`
      );

      if (!result.ok || !result.data?.spaces?.length) {
        return null;
      }

      setSpaces(result.data.spaces);
      setTree(result.data.tree || { personal: [], shared: [] });
      return (
        result.data.spaces.find((space) =>
          targetSection === "shared" ? space.kind === "shared" : space.kind === "personal"
        )?.id ?? null
      );
    },
    [personalSpace?.id, sharedSpace?.id]
  );

  const allMoveTargets = useMemo(
    () => [
      ...flattenFolders(`space:${personalSpace?.id ?? ""}`, "My Drive root", tree.personal),
      ...flattenFolders(`space:${sharedSpace?.id ?? ""}`, "Shared root", tree.shared),
    ],
    [personalSpace?.id, sharedSpace?.id, tree.personal, tree.shared]
  );

  const openTemplatePicker = useCallback(async () => {
    if (templates) {
      setTemplatesOpen(true);
      return;
    }

    setTemplatesLoading(true);
    try {
      const result = await requestDriveJson<{ templates?: DriveTemplate[] }>(
        "/api/drive/templates"
      );

      if (!result.ok && !result.data?.templates?.length) {
        setDriveError(getDriveErrorMessage(result, "Unable to load templates right now."));
        return;
      }

      setDriveError(null);
      setTemplates(result.data?.templates || []);
      setTemplatesOpen(true);
    } finally {
      setTemplatesLoading(false);
    }
  }, [templates]);

  const openSection = useCallback(
    (nextSection: DriveSection) => {
      setDriveError(null);
      updateRoute({
        section: nextSection,
        folder: null,
        doc: null,
        q: null,
      });
    },
    [updateRoute]
  );

  const openFolder = useCallback(
    (nextSection: DriveSection, nextFolderId: string) => {
      setDriveError(null);
      updateRoute({
        section: nextSection,
        folder: nextFolderId,
        doc: null,
        q: null,
      });
    },
    [updateRoute]
  );

  const openItem = useCallback(
    (item: DriveNodeSummary) => {
      setDriveError(null);
      const nextSection = item.visibility === "organization" ? "shared" : "my-drive";
      if (item.type === "folder") {
        openFolder(nextSection, item.id);
      } else {
        updateRoute({
          section: nextSection,
          doc: item.id,
          folder: item.parentId,
          q: null,
        });
      }
    },
    [openFolder, updateRoute]
  );

  const createNode = useCallback(
    async (type: "page" | "folder") => {
      const targetSection = section === "shared" ? "shared" : "my-drive";
      const isPage = type === "page";

      if (isPage) {
        setCreateDocumentPending(true);
      }

      setDriveError(null);

      try {
        const spaceId = await resolveTargetSpaceId(targetSection);
        if (!spaceId) {
          setDriveError("Drive is still getting ready. Please try creating the document again.");
          return;
        }

        const result = await requestDriveJson<{
          node?: DriveNodeSummary;
          error?: string;
        }>("/api/drive/nodes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            space_id: spaceId,
            parent_id: folderId,
            type,
          }),
        });

        if (!result.ok || !result.data?.node?.id) {
          setDriveError(
            getDriveErrorMessage(result, `Unable to create ${isPage ? "the document" : "the folder"}.`)
          );
          return;
        }

        if (isPage) {
          setSelectedText("");
          setPendingNewDocId(result.data.node.id);
          updateRoute({
            section: targetSection,
            doc: result.data.node.id,
            q: null,
          });
        } else {
          await loadDrive();
        }
      } catch {
        setDriveError(`Unable to create ${isPage ? "the document" : "the folder"}.`);
      } finally {
        if (isPage) {
          setCreateDocumentPending(false);
        }
      }
    },
    [
      folderId,
      loadDrive,
      resolveTargetSpaceId,
      section,
      updateRoute,
    ]
  );

  const createFromTemplate = useCallback(
    async (templateId: string) => {
      const spaceId =
        section === "shared" ? sharedSpace?.id : personalSpace?.id;
      if (!spaceId) return;

      const res = await fetch("/api/drive/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          spaceId,
          parentId: folderId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) return;

      setTemplatesOpen(false);
      updateRoute({
        section: section === "shared" ? "shared" : "my-drive",
        doc: data.node.id,
        q: null,
      });
    },
    [
      folderId,
      personalSpace?.id,
      section,
      sharedSpace?.id,
      updateRoute,
    ]
  );

  const saveDocument = useCallback(
    async (content: Record<string, unknown>) => {
      if (!selectedDoc) return;
      const res = await fetch(`/api/drive/nodes/${selectedDoc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setSelectedDoc(data.node);
      }
    },
    [selectedDoc]
  );

  const renameNode = useCallback(
    async (node: DriveNodeSummary) => {
      const title = window.prompt("Rename document", node.title)?.trim();
      if (!title || title === node.title) return;
      await fetch(`/api/drive/nodes/${node.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (selectedDoc?.id === node.id) {
        setSelectedDoc((current) => (current ? { ...current, title } : current));
      }
      await loadDrive();
    },
    [loadDrive, selectedDoc?.id]
  );

  const toggleFavorite = useCallback(
    async (node: DriveNodeSummary, favorite: boolean) => {
      await fetch("/api/drive/nodes/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: node.id, favorite }),
      });
      if (selectedDoc?.id === node.id) {
        setSelectedDoc((current) =>
          current ? { ...current, isFavorite: favorite } : current
        );
      }
      await loadDrive();
    },
    [loadDrive, selectedDoc?.id]
  );

  const duplicateNode = useCallback(
    async (node: DriveNodeSummary) => {
      await fetch("/api/drive/nodes/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: node.id }),
      });
      await loadDrive();
    },
    [loadDrive]
  );

  const deleteNode = useCallback(
    async (node: DriveNodeSummary) => {
      await fetch(`/api/drive/nodes/${node.id}`, { method: "DELETE" });
      if (selectedDoc?.id === node.id) {
        updateRoute({ doc: null });
      } else {
        await loadDrive();
      }
    },
    [loadDrive, selectedDoc?.id, updateRoute]
  );

  const restoreNode = useCallback(
    async (node: DriveNodeSummary) => {
      await fetch("/api/drive/nodes/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: node.id }),
      });
      await loadDrive();
    },
    [loadDrive]
  );

  const confirmMove = useCallback(async () => {
    if (!moveNode) return;
    const parentId = moveTargetId.startsWith("folder:")
      ? moveTargetId.replace("folder:", "")
      : null;
    const targetSpaceId = moveTargetId.startsWith("space:")
      ? moveTargetId.replace("space:", "")
      : null;
    await fetch("/api/drive/nodes/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeId: moveNode.id,
        parentId,
        targetSpaceId,
      }),
    });
    setMoveNode(null);
    setMoveTargetId("");
    await loadDrive();
  }, [loadDrive, moveNode, moveTargetId]);

  const updateVisibility = useCallback(
    async (nextVisibility: "private" | "organization") => {
      if (!selectedDoc) return;
      if (
        nextVisibility === "organization" &&
        selectedDoc.visibility !== "organization" &&
        !window.confirm(
          "Share this document with everyone in the organization?"
        )
      ) {
        return;
      }

      const res = await fetch(`/api/drive/nodes/${selectedDoc.id}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: nextVisibility }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setSelectedDoc(data.node);
        void loadDrive();
      }
    },
    [loadDrive, selectedDoc]
  );

  const saveAsTemplate = useCallback(async () => {
    if (!selectedDoc) return;
    const name = window.prompt("Template name", selectedDoc.title)?.trim();
    if (!name) return;
    await fetch("/api/drive/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceNodeId: selectedDoc.id,
        name,
      }),
    });
    setTemplates(null);
  }, [selectedDoc]);

  const renderHomeRail = (title: string, items: DriveNodeSummary[]) => (
    <Panel className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <span className="text-xs text-muted-foreground">{items.length} items</span>
      </div>
      <div className="space-y-2">
        {items.length ? (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition hover:bg-muted"
              onClick={() => openItem(item)}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                <p className="mt-1 text-xs text-muted-foreground capitalize">
                  {item.visibility} · {item.owner.name}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {formatUpdated(item.updatedAt)}
              </span>
            </button>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">Nothing here yet.</p>
        )}
      </div>
    </Panel>
  );

  return (
    <div className="animate-fade-in">
      <DriveTemplatePicker
        open={templatesOpen}
        templates={templates ?? []}
        onClose={() => setTemplatesOpen(false)}
        onSelect={createFromTemplate}
      />

      {moveNode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-[calc(var(--radius)+0.25rem)] border border-border bg-background p-6 shadow-2xl">
            <p className="label-eyebrow">Move</p>
            <h3 className="mt-2 text-lg font-medium text-foreground">{moveNode.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose a destination folder, or keep it at the root.
            </p>
            <select
              value={moveTargetId}
              onChange={(event) => setMoveTargetId(event.target.value)}
              className="input-minimal mt-4"
            >
              {allMoveTargets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </select>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-outline"
                onClick={() => {
                  setMoveNode(null);
                  setMoveTargetId("");
                }}
              >
                Cancel
              </button>
              <button type="button" className="btn-solid" onClick={confirmMove}>
                Move
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        <Panel className="h-[calc(100vh-9rem)] overflow-hidden p-0">
          <div className="border-b border-border px-4 py-4">
            <p className="label-eyebrow">Drive</p>
            <h1 className="mt-2 text-2xl font-medium text-foreground">Documents</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              A clean workspace for writing, organizing, and sharing internal knowledge.
            </p>
          </div>

          <div className="border-b border-border px-4 py-4">
            <button
              type="button"
              className="btn-solid w-full"
              onClick={() => createNode("page")}
              disabled={createDocumentPending}
            >
              {createDocumentPending ? "Creating..." : "New document"}
            </button>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" className="btn-outline" onClick={() => createNode("folder")}>
                <FolderPlus className="h-4 w-4" />
                Folder
              </button>
              <button
                type="button"
                className="btn-outline"
                onClick={openTemplatePicker}
                disabled={templatesLoading}
              >
                {templatesLoading ? "Loading..." : "Template"}
              </button>
            </div>
          </div>

          <div className="space-y-5 overflow-y-auto px-3 py-4">
            <nav className="space-y-1">
              {SECTION_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = section === item.id && !query && !docId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm transition ${
                      active
                        ? "bg-blue-subtle text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    onClick={() => openSection(item.id)}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div>
              <p className="px-3 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                My Drive
              </p>
              <div className="mt-2">
                <DriveFolderTree
                  nodes={tree.personal}
                  activeFolderId={section === "my-drive" ? folderId : null}
                  onSelect={(id) => openFolder("my-drive", id)}
                />
              </div>
            </div>

            <div>
              <p className="px-3 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Shared
              </p>
              <div className="mt-2">
                <DriveFolderTree
                  nodes={tree.shared}
                  activeFolderId={section === "shared" ? folderId : null}
                  onSelect={(id) => openFolder("shared", id)}
                />
              </div>
            </div>
          </div>
        </Panel>

        <div className="min-w-0 space-y-5">
          <Panel className="p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="label-eyebrow">Workspace</p>
                <h2 className="mt-2 text-2xl font-medium text-foreground">
                  {docId
                    ? "Document"
                    : query
                      ? "Search"
                      : section === "home"
                        ? "Drive Home"
                        : SECTION_ITEMS.find((item) => item.id === section)?.label}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {docId
                    ? "Focused writing with clear visibility, favorites, and comments."
                    : "Search, organize, and keep your documents usable every day."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative min-w-[260px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        updateRoute({
                          q: searchInput.trim() || null,
                          doc: null,
                        });
                      }
                    }}
                    className="input-minimal pl-9"
                    placeholder="Search documents and folders"
                  />
                </div>
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() =>
                    updateRoute({
                      q: searchInput.trim() || null,
                      doc: null,
                    })
                  }
                >
                  Search
                </button>
              </div>
            </div>
          </Panel>

          {driveError ? (
            <Panel className="border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-900">
              <div className="flex items-start justify-between gap-4">
                <p>{driveError}</p>
                <button
                  type="button"
                  className="text-xs font-medium text-rose-700 hover:text-rose-900"
                  onClick={() => setDriveError(null)}
                >
                  Dismiss
                </button>
              </div>
            </Panel>
          ) : null}

          {loadingCenter ? (
            <Panel className="p-10 text-sm text-muted-foreground">Loading Drive…</Panel>
          ) : selectedDoc ? (
            <Panel className="overflow-hidden p-0">
              <div className="border-b border-border px-6 py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {selectedDoc.breadcrumbs.map((crumb) => (
                        <button
                          key={crumb.id}
                          type="button"
                          className="hover:text-foreground"
                          onClick={() =>
                            openFolder(
                              selectedDoc.visibility === "organization" ? "shared" : "my-drive",
                              crumb.id
                            )
                          }
                        >
                          {crumb.title}
                        </button>
                      ))}
                    </div>
                    <input
                      value={selectedDoc.title}
                      onChange={(event) =>
                        setSelectedDoc((current) =>
                          current ? { ...current, title: event.target.value } : current
                        )
                      }
                      onBlur={async () => {
                        if (!selectedDoc) return;
                        await fetch(`/api/drive/nodes/${selectedDoc.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ title: selectedDoc.title }),
                        });
                        void loadDrive();
                      }}
                      className="w-full border-0 bg-transparent text-3xl font-medium tracking-tight text-foreground outline-none"
                    />
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                          selectedDoc.visibility === "private"
                            ? "bg-card text-foreground border border-border"
                            : "border border-border text-muted-foreground"
                        }`}
                        onClick={() => updateVisibility("private")}
                      >
                        <Shield className="mr-1 inline h-3.5 w-3.5" />
                        Private
                      </button>
                      <button
                        type="button"
                        className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                          selectedDoc.visibility === "organization"
                            ? "bg-blue-subtle text-foreground"
                            : "border border-border text-muted-foreground"
                        }`}
                        onClick={() => updateVisibility("organization")}
                      >
                        <Users className="mr-1 inline h-3.5 w-3.5" />
                        Organization
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() =>
                          toggleFavorite(selectedDoc, !selectedDoc.isFavorite)
                        }
                      >
                        <Star className="mr-1 inline h-3.5 w-3.5" />
                        {selectedDoc.isFavorite ? "Favorited" : "Favorite"}
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={saveAsTemplate}
                      >
                        Save as template
                      </button>
                    </div>
                  </div>

                  <div className="w-full max-w-xs rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">{saveState}</p>
                    <p className="mt-1">Last edited by {selectedDoc.lastEditedBy}</p>
                    <p className="mt-1">{formatUpdated(selectedDoc.updatedAt)}</p>
                  </div>
                </div>
              </div>
              <div className="px-6 py-6">
                <SimpleEditor
                  initialContent={selectedDoc.content}
                  onSave={saveDocument}
                  onSelectionTextChange={setSelectedText}
                  onStatusChange={setSaveState}
                  autoFocusToken={
                    pendingNewDocId && pendingNewDocId === selectedDoc.id
                      ? pendingNewDocId
                      : null
                  }
                />
              </div>
            </Panel>
          ) : query ? (
            <DriveList
              items={searchResults}
              onOpen={openItem}
              onFavorite={toggleFavorite}
              onRename={renameNode}
              onDuplicate={duplicateNode}
              onMove={(node) => {
                setMoveNode(node);
                setMoveTargetId(
                  node.parentId
                    ? `folder:${node.parentId}`
                    : `space:${node.visibility === "organization" ? sharedSpace?.id ?? "" : personalSpace?.id ?? ""}`
                );
              }}
              onDelete={deleteNode}
              onRestore={restoreNode}
            />
          ) : section === "home" ? (
            <div className="space-y-5">
              <Panel className="p-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="label-eyebrow">Quick Create</p>
                    <h3 className="mt-2 text-xl font-medium text-foreground">
                      Get straight into writing
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-solid"
                      onClick={() => createNode("page")}
                      disabled={createDocumentPending}
                    >
                      {createDocumentPending ? "Creating..." : "New document"}
                    </button>
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={openTemplatePicker}
                      disabled={templatesLoading}
                    >
                      {templatesLoading ? "Loading..." : "Use template"}
                    </button>
                  </div>
                </div>
              </Panel>
              <div className="grid gap-5 xl:grid-cols-2">
                {renderHomeRail("Recently edited", home?.recent ?? [])}
                {renderHomeRail("Favorites", home?.favorites ?? [])}
                {renderHomeRail("Drafts", home?.drafts ?? [])}
                {renderHomeRail("Shared documents", home?.shared ?? [])}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {folderPayload?.breadcrumbs?.length ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <button
                    type="button"
                    className="hover:text-foreground"
                    onClick={() => openSection(section)}
                  >
                    Root
                  </button>
                  {folderPayload.breadcrumbs.map((crumb) => (
                    <button
                      key={crumb.id}
                      type="button"
                      className="hover:text-foreground"
                      onClick={() => openFolder(section, crumb.id)}
                    >
                      / {crumb.title}
                    </button>
                  ))}
                  {folderPayload.folder ? (
                    <span className="text-foreground">/ {folderPayload.folder.title}</span>
                  ) : null}
                </div>
              ) : null}
              <DriveList
                items={folderPayload?.items ?? []}
                onOpen={openItem}
                onFavorite={toggleFavorite}
                onRename={renameNode}
                onDuplicate={duplicateNode}
                onMove={(node) => {
                  setMoveNode(node);
                  setMoveTargetId(
                    node.parentId
                      ? `folder:${node.parentId}`
                      : `space:${node.visibility === "organization" ? sharedSpace?.id ?? "" : personalSpace?.id ?? ""}`
                  );
                }}
                onDelete={deleteNode}
                onRestore={restoreNode}
                isTrash={section === "trash"}
              />
            </div>
          )}
        </div>

        <Panel className="h-[calc(100vh-9rem)] overflow-hidden p-0">
          {selectedDoc ? (
            <div className="flex h-full flex-col">
              <div className="grid grid-cols-2 border-b border-border">
                <div className="border-r border-border px-4 py-4">
                  <p className="text-sm font-medium text-foreground">Document info</p>
                  <div className="mt-4 space-y-4 text-sm text-muted-foreground">
                    <div>
                      <p className="label-eyebrow">Visibility</p>
                      <p className="mt-2 capitalize text-foreground">{selectedDoc.visibility}</p>
                    </div>
                    <div>
                      <p className="label-eyebrow">Owner</p>
                      <p className="mt-2 text-foreground">{selectedDoc.owner.name}</p>
                    </div>
                    <div>
                      <p className="label-eyebrow">Last edited</p>
                      <p className="mt-2 text-foreground">{formatUpdated(selectedDoc.updatedAt)}</p>
                    </div>
                  </div>
                </div>
                <div className="px-4 py-4">
                  <p className="text-sm font-medium text-foreground">Activity</p>
                  <div className="mt-4 rounded-2xl bg-muted/40 p-4 text-sm text-muted-foreground">
                    <Clock3 className="mb-2 h-4 w-4" />
                    Last edited by {selectedDoc.lastEditedBy} on{" "}
                    {formatUpdated(selectedDoc.updatedAt)}.
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <DriveCommentsPanel nodeId={selectedDoc.id} selectedText={selectedText} />
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
              Open a document to see comments, activity, and sharing details.
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
