export type OrgRole = "owner" | "admin" | "member" | "guest";
export type BoardRole = "admin" | "editor" | "commenter" | "viewer";
export type WorkspaceRole = "admin" | "member" | "viewer";

export type Me = {
  user: { id: string; email: string; name: string; hasAvatar: boolean; emailVerified: boolean; mfaEnabled: boolean };
  orgs: { id: string; name: string; role: OrgRole }[];
};

export type BoardLink = { id: string; workspaceId: string; name: string; color: string; visibility: string; role: BoardRole };
export type WorkspaceTree = {
  orgRole: OrgRole;
  workspaces: { id: string; name: string; description: string | null; color: string; role: WorkspaceRole | null; boards: BoardLink[] }[];
};

export type Person = { userId: string; name: string; email: string; hasAvatar: boolean; role: string };
export type Label = { id: string; name: string; color: string };
export type List = { id: string; name: string; color: string; position: string };

export type CardSummary = {
  id: string;
  listId: string;
  title: string;
  priority: string;
  ownerId: string | null;
  dueAt: string | null;
  completedAt: string | null;
  position: string;
  updatedAt: string;
  hasDescription: boolean;
  excerpt: string;
  assigneeIds: string[];
  labelIds: string[];
  commentCount: number;
  attachmentCount: number;
  checklistTotal: number;
  checklistDone: number;
};

export type BoardData = {
  board: {
    id: string;
    orgId: string;
    workspaceId: string;
    workspaceName: string;
    name: string;
    description: string | null;
    color: string;
    visibility: "private" | "workspace";
    workspaceAccess: "viewer" | "commenter" | "editor";
    archivedAt: string | null;
  };
  role: BoardRole;
  lists: List[];
  cards: CardSummary[];
  labels: Label[];
  people: Person[];
  cursor: number;
};

export type CardDetail = {
  id: string;
  boardId: string;
  listId: string;
  listName: string;
  title: string;
  description: unknown;
  priority: string;
  ownerId: string | null;
  dueAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  createdByName: string | null;
  updatedAt: string;
  assigneeIds: string[];
  labelIds: string[];
  checklists: { id: string; title: string; items: { id: string; text: string; done: boolean }[] }[];
  attachments: { id: string; fileName: string; mime: string; sizeBytes: number; uploaderName: string | null; createdAt: string; isImage: boolean }[];
  relations: { cardId: string; title: string; boardId: string; boardName: string; type: string; direction: "in" | "out"; completed: boolean }[];
};

export type Activity = {
  id: number;
  action: string;
  cardId: string | null;
  cardTitle?: string | null;
  actorId: string | null;
  actorName: string | null;
  data: Record<string, unknown>;
  createdAt: string;
};

export type Comment = { id: string; authorId: string | null; authorName: string | null; authorHasAvatar: boolean; body: string; createdAt: string; editedAt: string | null };

export type Notification = {
  id: string;
  type: string;
  orgId: string;
  boardId: string | null;
  cardId: string | null;
  actorName: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};
