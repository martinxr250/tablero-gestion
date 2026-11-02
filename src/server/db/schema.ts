// Espejo tipado de db/migrations (la fuente de verdad es el SQL).
import { bigint, boolean, date, integer, jsonb, numeric, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const app = pgSchema("app");

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = app.table("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  avatarKey: text("avatar_key"),
  emailVerifiedAt: ts("email_verified_at"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  mfaSecretEnc: text("mfa_secret_enc"),
  mfaPendingSecretEnc: text("mfa_pending_secret_enc"),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: ts("locked_until"),
  passwordChangedAt: ts("password_changed_at").notNull().defaultNow(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
});

export const sessions = app.table("sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  refreshHash: text("refresh_hash").notNull(),
  prevRefreshHash: text("prev_refresh_hash"),
  rotatedAt: ts("rotated_at"),
  userAgent: text("user_agent"),
  ipHash: text("ip_hash"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastUsedAt: ts("last_used_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  revokeReason: text("revoke_reason"),
});

export const mfaRecoveryCodes = app.table("mfa_recovery_codes", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  codeHash: text("code_hash").notNull(),
  usedAt: ts("used_at"),
});

export const authTokens = app.table("auth_tokens", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  type: text("type").$type<"verify_email" | "reset_password">().notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

export type OrgRole = "owner" | "admin" | "member" | "guest";
export type WorkspaceRole = "admin" | "member" | "viewer";
export type BoardRole = "admin" | "editor" | "commenter" | "viewer";
export type Priority = "none" | "low" | "medium" | "high" | "urgent";
export type QaStatus = "none" | "pending" | "approved" | "rejected";

export const organizations = app.table("organizations", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
});

export const organizationMembers = app.table(
  "organization_members",
  {
    orgId: uuid("org_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role").$type<OrgRole>().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const workspaces = app.table("workspaces", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull(),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  archivedAt: ts("archived_at"),
});

export const workspaceMembers = app.table(
  "workspace_members",
  {
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role").$type<WorkspaceRole>().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const boards = app.table("boards", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull(),
  visibility: text("visibility").$type<"private" | "workspace">().notNull(),
  workspaceAccess: text("workspace_access").$type<"viewer" | "commenter" | "editor">().notNull(),
  qaRequired: boolean("qa_required").notNull().default(false),
  qaListId: uuid("qa_list_id"),
  doneListId: uuid("done_list_id"),
  isTemplate: boolean("is_template").notNull().default(false),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  archivedAt: ts("archived_at"),
});

export const boardMembers = app.table(
  "board_members",
  {
    orgId: uuid("org_id").notNull(),
    boardId: uuid("board_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role").$type<BoardRole>().notNull(),
    canReview: boolean("can_review").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.boardId, t.userId] })],
);

export const lists = app.table("lists", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  boardId: uuid("board_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  position: text("position").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  archivedAt: ts("archived_at"),
});

export const cards = app.table("cards", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  boardId: uuid("board_id").notNull(),
  listId: uuid("list_id").notNull(),
  title: text("title").notNull(),
  description: jsonb("description"),
  descriptionText: text("description_text").notNull().default(""),
  priority: text("priority").$type<Priority>().notNull(),
  ownerId: uuid("owner_id"),
  dueAt: ts("due_at"),
  completedAt: ts("completed_at"),
  position: text("position").notNull(),
  archivedAt: ts("archived_at"),
  parentId: uuid("parent_id"),
  sprintId: uuid("sprint_id"),
  estimatePoints: numeric("estimate_points", { precision: 5, scale: 1, mode: "number" }),
  recurrence: text("recurrence").$type<"weekly" | "monthly" | null>(),
  qaStatus: text("qa_status").$type<QaStatus>().notNull().default("none"),
  qaBy: uuid("qa_by"),
  qaAt: ts("qa_at"),
  qaNote: text("qa_note"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const cardAssignees = app.table(
  "card_assignees",
  {
    orgId: uuid("org_id").notNull(),
    cardId: uuid("card_id").notNull(),
    userId: uuid("user_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.userId] })],
);

export const labels = app.table("labels", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  boardId: uuid("board_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const cardLabels = app.table(
  "card_labels",
  {
    orgId: uuid("org_id").notNull(),
    boardId: uuid("board_id").notNull(),
    cardId: uuid("card_id").notNull(),
    labelId: uuid("label_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.labelId] })],
);

export const checklists = app.table("checklists", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  cardId: uuid("card_id").notNull(),
  title: text("title").notNull(),
  position: text("position").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const checklistItems = app.table("checklist_items", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  checklistId: uuid("checklist_id").notNull(),
  text: text("text").notNull(),
  position: text("position").notNull(),
  doneAt: ts("done_at"),
  doneBy: uuid("done_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const cardRelations = app.table(
  "card_relations",
  {
    orgId: uuid("org_id").notNull(),
    fromCardId: uuid("from_card_id").notNull(),
    toCardId: uuid("to_card_id").notNull(),
    type: text("type").$type<"blocks" | "relates" | "duplicates">().notNull(),
    createdBy: uuid("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fromCardId, t.toCardId, t.type] })],
);

export const comments = app.table("comments", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  cardId: uuid("card_id").notNull(),
  authorId: uuid("author_id"),
  body: text("body").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  editedAt: ts("edited_at"),
  deletedAt: ts("deleted_at"),
});

export const commentMentions = app.table(
  "comment_mentions",
  {
    orgId: uuid("org_id").notNull(),
    commentId: uuid("comment_id").notNull(),
    userId: uuid("user_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] })],
);

export const attachments = app.table("attachments", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  cardId: uuid("card_id").notNull(),
  uploaderId: uuid("uploader_id"),
  storageKey: text("storage_key").notNull(),
  fileName: text("file_name").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const notifications = app.table("notifications", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  userId: uuid("user_id").notNull(),
  type: text("type").notNull(),
  actorId: uuid("actor_id"),
  boardId: uuid("board_id"),
  cardId: uuid("card_id"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  readAt: ts("read_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const activityLogs = app.table("activity_logs", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  orgId: uuid("org_id").notNull(),
  boardId: uuid("board_id").notNull(),
  cardId: uuid("card_id"),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const invitations = app.table("invitations", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  scope: text("scope").$type<"org" | "workspace" | "board">().notNull(),
  workspaceId: uuid("workspace_id"),
  boardId: uuid("board_id"),
  email: text("email").notNull(),
  role: text("role").notNull(),
  tokenHash: text("token_hash").notNull(),
  invitedBy: uuid("invited_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  acceptedAt: ts("accepted_at"),
  acceptedBy: uuid("accepted_by"),
  revokedAt: ts("revoked_at"),
});

export const auditLogs = app.table("audit_logs", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  orgId: uuid("org_id"),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const storageGc = app.table("storage_gc", {
  key: text("key").primaryKey(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const myBoards = app.view("my_boards", {
  boardId: uuid("board_id").notNull(),
  orgId: uuid("org_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  role: text("role").$type<BoardRole>().notNull(),
  viaOverride: boolean("via_override").notNull(),
}).existing();

export const myWorkspaces = app.view("my_workspaces", {
  workspaceId: uuid("workspace_id").notNull(),
  orgId: uuid("org_id").notNull(),
  role: text("role").$type<WorkspaceRole>().notNull(),
}).existing();

// ───────────── Integración con proveedores de código ─────────────

export type VcsProvider = "github" | "gitlab";

export type BoardRepoSettings = {
  /** Lista a la que llegan los issues nuevos importados. */
  inboxListId?: string;
  /** Lista que equivale a "terminado": mover ahí cierra el issue. */
  doneListId?: string;
  /** Si el issue se cierra en el proveedor: mover a revisión (no completa la tarjeta). */
  reviewListId?: string;
  /** Crear tarjetas automáticamente para issues nuevos del repo. */
  importNew?: boolean;
  /** Enviar al proveedor los cambios de las tarjetas vinculadas. */
  autoPush?: boolean;
};

export const vcsConnections = app.table("vcs_connections", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  provider: text("provider").$type<VcsProvider>().notNull(),
  apiBaseUrl: text("api_base_url").notNull(),
  tokenEnc: text("token_enc").notNull(),
  accountLogin: text("account_login").notNull(),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const boardRepos = app.table("board_repos", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  boardId: uuid("board_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  provider: text("provider").$type<VcsProvider>().notNull(),
  repoFullName: text("repo_full_name").notNull(),
  repoId: bigint("repo_id", { mode: "number" }).notNull(),
  htmlUrl: text("html_url").notNull(),
  webhookId: bigint("webhook_id", { mode: "number" }),
  webhookSecretEnc: text("webhook_secret_enc"),
  settings: jsonb("settings").$type<BoardRepoSettings>().notNull(),
  lastSyncedAt: ts("last_synced_at"),
  lastSyncError: text("last_sync_error"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const cardIssueLinks = app.table("card_issue_links", {
  cardId: uuid("card_id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  boardRepoId: uuid("board_repo_id").notNull(),
  issueNumber: integer("issue_number").notNull(),
  issueId: bigint("issue_id", { mode: "number" }).notNull(),
  htmlUrl: text("html_url").notNull(),
  remoteState: text("remote_state").$type<"open" | "closed">().notNull(),
  remoteUpdatedAt: ts("remote_updated_at"),
  syncedHash: text("synced_hash"),
  syncedAt: ts("synced_at"),
  pendingPush: boolean("pending_push").notNull().default(false),
  lastError: text("last_error"),
  conflict: jsonb("conflict").$type<Record<string, unknown> | null>(),
});

export const cardDevRefs = app.table("card_dev_refs", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  cardId: uuid("card_id").notNull(),
  kind: text("kind").$type<"pr" | "branch" | "commit">().notNull(),
  externalId: text("external_id").notNull(),
  title: text("title").notNull(),
  state: text("state").notNull(),
  url: text("url").notNull(),
  author: text("author"),
  branch: text("branch"),
  merged: boolean("merged").notNull().default(false),
  draft: boolean("draft").notNull().default(false),
  checksStatus: text("checks_status"),
  reviewStatus: text("review_status"),
  remoteUpdatedAt: ts("remote_updated_at"),
});

export const vcsUserLinks = app.table(
  "vcs_user_links",
  {
    orgId: uuid("org_id").notNull(),
    userId: uuid("user_id").notNull(),
    provider: text("provider").$type<VcsProvider>().notNull(),
    login: text("login").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId, t.provider] })],
);

export const webhookDeliveries = app.table("webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  boardRepoId: uuid("board_repo_id").notNull(),
  event: text("event").notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
});

// ───────────── Planificación ─────────────

export const sprints = app.table("sprints", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  boardId: uuid("board_id").notNull(),
  name: text("name").notNull(),
  goal: text("goal"),
  startsOn: date("starts_on", { mode: "string" }).notNull(),
  endsOn: date("ends_on", { mode: "string" }).notNull(),
  status: text("status").$type<"planned" | "active" | "closed">().notNull(),
  capacityPoints: numeric("capacity_points", { precision: 6, scale: 1, mode: "number" }),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const cardWatchers = app.table(
  "card_watchers",
  {
    orgId: uuid("org_id").notNull(),
    cardId: uuid("card_id").notNull(),
    userId: uuid("user_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.userId] })],
);

export type ShareKind = "public" | "join";
export const boardShareLinks = app.table("board_share_links", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  boardId: uuid("board_id").notNull(),
  kind: text("kind").$type<ShareKind>().notNull(),
  role: text("role").$type<"viewer" | "commenter" | "editor">().notNull().default("viewer"),
  tokenHash: text("token_hash").notNull(),
  tokenEnc: text("token_enc").notNull(),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type FieldType = "text" | "number" | "currency" | "date" | "checkbox" | "select";
export type FieldConfig = { options?: { id: string; name: string; color: string }[]; currency?: string };
export const boardFields = app.table("board_fields", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  boardId: uuid("board_id").notNull(),
  name: text("name").notNull(),
  type: text("type").$type<FieldType>().notNull(),
  config: jsonb("config").$type<FieldConfig>().notNull().default({}),
  showOnCard: boolean("show_on_card").notNull().default(true),
  position: text("position").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const cardFieldValues = app.table(
  "card_field_values",
  {
    orgId: uuid("org_id").notNull(),
    cardId: uuid("card_id").notNull(),
    fieldId: uuid("field_id").notNull(),
    value: jsonb("value").$type<string | number | boolean>().notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.fieldId] })],
);
