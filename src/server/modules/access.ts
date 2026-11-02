import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { audit, type AuditContext } from "../core/audit";
import { forbidden, notFound } from "../core/errors";
import type { Tx } from "../db/client";
import {
  boards,
  cards,
  myBoards,
  myWorkspaces,
  organizationMembers,
  workspaces,
  type BoardRole,
  type OrgRole,
  type WorkspaceRole,
} from "../db/schema";

export type BoardAction = "view" | "comment" | "edit" | "manage";

/** Matriz de permisos de tablero (rol efectivo → acciones). El rol lo resuelve la DB. */
const BOARD_MATRIX: Record<BoardAction, BoardRole[]> = {
  view: ["viewer", "commenter", "editor", "admin"],
  comment: ["commenter", "editor", "admin"],
  edit: ["editor", "admin"],
  manage: ["admin"],
};

export const canBoard = (role: BoardRole | null | undefined, action: BoardAction) =>
  !!role && BOARD_MATRIX[action].includes(role);

const ORG_RANK: Record<OrgRole, number> = { guest: 0, member: 1, admin: 2, owner: 3 };
export const orgRoleAtLeast = (role: OrgRole, min: OrgRole) => ORG_RANK[role] >= ORG_RANK[min];

export async function orgAccess(tx: Tx, userId: string, orgId: string, min: OrgRole = "guest") {
  const [m] = await tx
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)));
  if (!m) throw notFound("Organización");
  if (!orgRoleAtLeast(m.role, min)) throw forbidden();
  return m.role;
}

export type WorkspaceAccess = {
  workspace: typeof workspaces.$inferSelect;
  role: WorkspaceRole | null; // null: solo accede a tableros puntuales (invitado de tablero)
  orgRole: OrgRole;
};

export async function workspaceAccess(
  tx: Tx,
  userId: string,
  workspaceId: string,
  need: "view" | "create_board" | "manage",
): Promise<WorkspaceAccess> {
  const [row] = await tx
    .select({ workspace: workspaces, role: myWorkspaces.role, orgRole: organizationMembers.role })
    .from(workspaces)
    .innerJoin(organizationMembers, and(eq(organizationMembers.orgId, workspaces.orgId), eq(organizationMembers.userId, userId)))
    .leftJoin(myWorkspaces, eq(myWorkspaces.workspaceId, workspaces.id))
    .where(eq(workspaces.id, workspaceId));
  if (!row) throw notFound("Espacio de trabajo");
  const role = row.role ?? null;
  if (!role) {
    const [b] = await tx.select({ id: myBoards.boardId }).from(myBoards).where(eq(myBoards.workspaceId, workspaceId)).limit(1);
    if (!b) throw notFound("Espacio de trabajo");
  }
  if (need === "create_board" && role !== "admin" && role !== "member") throw forbidden();
  if (need === "manage" && role !== "admin") throw forbidden();
  return { workspace: row.workspace, role, orgRole: row.orgRole };
}

export type BoardAccess = { board: typeof boards.$inferSelect; role: BoardRole; viaOverride: boolean };

export async function boardAccess(
  tx: Tx,
  actx: AuditContext,
  boardId: string,
  action: BoardAction,
  opts: { allowArchived?: boolean } = {},
): Promise<BoardAccess> {
  const [row] = await tx
    .select({ board: boards, role: myBoards.role, viaOverride: myBoards.viaOverride })
    .from(boards)
    .innerJoin(myBoards, eq(myBoards.boardId, boards.id))
    .where(eq(boards.id, boardId));
  if (!row) throw notFound("Tablero");
  if (row.board.archivedAt && !opts.allowArchived && action !== "manage" && action !== "view") {
    throw forbidden("El tablero está archivado");
  }
  if (!canBoard(row.role, action)) throw forbidden();
  if (row.viaOverride && action !== "view") {
    // Acceso administrativo a un tablero del que no es miembro: queda auditado.
    await audit(tx, actx, "admin.board_override", {
      orgId: row.board.orgId,
      targetType: "board",
      targetId: boardId,
      data: { action },
    });
  }
  return row;
}

export async function cardAccess(tx: Tx, actx: AuditContext, cardId: string, action: BoardAction) {
  const [card] = await tx.select().from(cards).where(eq(cards.id, cardId));
  if (!card) throw notFound("Tarjeta");
  const access = await boardAccess(tx, actx, card.boardId, action);
  return { card, ...access };
}

/** IDs de usuarios con acceso al tablero (para validar responsables, menciones e invitados). */
export async function boardUserRoles(tx: Tx, boardId: string) {
  const { sql } = await import("drizzle-orm");
  const rows = await tx.execute<{ user_id: string; role: BoardRole }>(sql`select user_id, role from app.board_roles(${boardId})`);
  return new Map(rows.map((r) => [r.user_id, r.role]));
}

export const activeOnly = <T extends { archivedAt: unknown }>(t: T) => isNull(t.archivedAt as never);
