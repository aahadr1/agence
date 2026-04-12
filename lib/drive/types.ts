export type DriveSection =
  | "home"
  | "my-drive"
  | "shared"
  | "favorites"
  | "trash";

export type DriveNodeType = "folder" | "page";

export type DriveVisibility = "private" | "organization";

export type DriveSpaceKind = "personal" | "shared";

export type DriveTemplateKind = "built_in" | "saved";

export type DriveDocJson = Record<string, unknown>;

export type DriveSpace = {
  id: string;
  kind: DriveSpaceKind;
  name: string;
  owner_user_id: string | null;
};

export type DriveFolderTreeNode = {
  id: string;
  title: string;
  spaceId: string;
  children: DriveFolderTreeNode[];
};

export type DriveOwner = {
  id: string | null;
  name: string;
};

export type DriveBreadcrumb = {
  id: string;
  title: string;
};

export type DriveNodeSummary = {
  id: string;
  title: string;
  type: DriveNodeType;
  parentId: string | null;
  spaceId: string;
  visibility: DriveVisibility;
  isFavorite: boolean;
  updatedAt: string;
  deletedAt: string | null;
  owner: DriveOwner;
};

export type DriveNodeDetail = DriveNodeSummary & {
  content: DriveDocJson | null;
  breadcrumbs: DriveBreadcrumb[];
  lastEditedBy: string;
};

export type DriveComment = {
  id: string;
  nodeId: string;
  parentCommentId: string | null;
  author: DriveOwner;
  body: string;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
};

export type DriveCommentThread = {
  id: string;
  body: string;
  author: DriveOwner;
  createdAt: string;
  resolved: boolean;
  resolvedAt: string | null;
  replies: DriveComment[];
};

export type DriveTemplate = {
  id: string;
  kind: DriveTemplateKind;
  name: string;
  description: string;
  content: DriveDocJson;
};

export type DriveHomePayload = {
  recent: DriveNodeSummary[];
  favorites: DriveNodeSummary[];
  drafts: DriveNodeSummary[];
  shared: DriveNodeSummary[];
  templates: DriveTemplate[];
};

export type DriveFolderPayload = {
  folder: DriveNodeSummary | null;
  breadcrumbs: DriveBreadcrumb[];
  items: DriveNodeSummary[];
};

export type DriveSearchResult = DriveNodeSummary & {
  location: string;
};

export type DriveBootstrapPayload = {
  spaces: DriveSpace[];
  tree: {
    personal: DriveFolderTreeNode[];
    shared: DriveFolderTreeNode[];
  };
  home: DriveHomePayload | null;
  folderPayload: DriveFolderPayload | null;
  searchResults: DriveSearchResult[];
  selectedDoc: DriveNodeDetail | null;
};
