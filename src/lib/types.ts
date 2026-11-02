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

export type Person = { userId: string; name: string; email: string; hasAvatar: boolean; role: string; canReview?: boolean };
export type Label = { id: string; name: string; color: string };
export type FieldType = "text" | "number" | "currency" | "date" | "checkbox" | "select";
export type FieldValue = string | number | boolean;
export type BoardField = {
  id: string;
  name: string;
  type: FieldType;
  config: { options?: { id: string; name: string; color: string }[]; currency?: string };
  showOnCard: boolean;
};
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
  issueNumber: number | null;
  syncAttention: boolean;
  assigneeIds: string[];
  labelIds: string[];
  commentCount: number;
  attachmentCount: number;
  checklistTotal: number;
  checklistDone: number;
  parentId: string | null;
  sprintId: string | null;
  estimatePoints: number | null;
  recurrence: "weekly" | "monthly" | null;
  qaStatus: QaStatus;
  subtaskTotal: number;
  subtaskDone: number;
  blocked: boolean;
  fieldValues: Record<string, FieldValue>;
  /** Presente si es un espejo de una tarjeta de otro tablero (id = id del espejo). */
  mirror?: { cardId: string; boardId: string; boardName: string };
};

export type QaStatus = "none" | "pending" | "approved" | "rejected";

export type Sprint = {
  id: string;
  name: string;
  goal: string | null;
  startsOn: string;
  endsOn: string;
  status: "planned" | "active" | "closed";
  capacityPoints: number | null;
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
    qaRequired: boolean;
    qaListId: string | null;
    doneListId: string | null;
    isTemplate: boolean;
  };
  role: BoardRole;
  canReview: boolean;
  sprints: Sprint[];
  lists: List[];
  cards: CardSummary[];
  labels: Label[];
  fields: BoardField[];
  /** Etiquetas, personas y campos de los tableros originales de los espejos. */
  external: { labels: Label[]; people: Person[]; fields: BoardField[] };
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
  attachments: { id: string; fileName: string; mime: string; sizeBytes: number; uploaderName: string | null; createdAt: string; isImage: boolean; canPreview: boolean }[];
  parent: { id: string; title: string } | null;
  subtasks: { id: string; title: string; done: boolean; ownerId: string | null; listId: string }[];
  sprintId: string | null;
  estimatePoints: number | null;
  recurrence: "weekly" | "monthly" | null;
  qa: { status: QaStatus; by: string | null; at: string | null; note: string | null };
  fieldValues: Record<string, FieldValue>;
  mirrors: { id: string; boardId: string; boardName: string; listName: string }[];
  watcherCount: number;
  watching: boolean;
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
