import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { route } from "../api/router";
import { audit } from "../core/audit";
import { decrypt, encrypt, randomToken, sha256 } from "../core/crypto";
import { env } from "../core/env";
import { badRequest, notFound } from "../core/errors";
import { uuidv7 } from "../core/ids";
import { withSystem, withUser, type Tx } from "../db/client";
import {
  boardMembers,
  boards,
  boardShareLinks,
  cards,
  checklistItems,
  checklists,
  labels,
  lists,
  myBoards,
  organizationMembers,
  organizations,
  type ShareKind,
} from "../db/schema";
import { boardAccess } from "./access";
import { boardCards, boardPeople } from "./boards";
import { logActivity } from "./shared";

const ROLE_RANK = { viewer: 0, commenter: 1, editor: 2, admin: 3 } as const;
type JoinRole = "viewer" | "commenter" | "editor";

const tokenParam = z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/);
const linkUrl = (kind: ShareKind, token: string) => `${env().APP_URL.replace(/\/$/, "")}/${kind === "public" ? "p" : "join"}/${token}`;

/** Busca un enlace vigente por su token (sin sesión: se compara el hash). */
async function findLink(tx: Tx, token: string, kind: ShareKind) {
  if (!tokenParam.safeParse(token).success) throw notFound("Enlace");
  const [row] = await tx
    .select({ link: boardShareLinks, board: boards })
    .from(boardShareLinks)
    .innerJoin(boards, eq(boards.id, boardShareLinks.boardId))
    .where(and(eq(boardShareLinks.tokenHash, sha256(token)), eq(boardShareLinks.kind, kind)));
  if (!row) throw notFound("Enlace");
  return row;
}

function linkView(row: typeof boardShareLinks.$inferSelect | undefined) {
  if (!row) return { enabled: false as const, url: null, role: null, createdAt: null };
  return { enabled: true as const, url: linkUrl(row.kind, decrypt(row.tokenEnc)), role: row.role, createdAt: row.createdAt };
}

export const shareRoutes = [
  route({
    method: "GET",
    path: "/boards/:boardId/share",
    summary: "Enlaces para compartir el tablero (solo administradores)",
    tag: "Compartir",
    handler: async ({ me, params, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, actx, params.boardId, "manage", { allowArchived: true });
        const rows = await tx.select().from(boardShareLinks).where(eq(boardShareLinks.boardId, board.id));
        return { public: linkView(rows.find((r) => r.kind === "public")), join: linkView(rows.find((r) => r.kind === "join")) };
      }),
  }),

  route({
    method: "PUT",
    path: "/boards/:boardId/share/:kind",
    summary: "Activar, desactivar o regenerar un enlace para compartir",
    tag: "Compartir",
    body: z.object({
      enabled: z.boolean(),
      role: z.enum(["viewer", "commenter", "editor"]).optional(),
      regenerate: z.boolean().optional(),
    }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const kind = z.enum(["public", "join"]).safeParse(params.kind);
        if (!kind.success) throw notFound("Enlace");
        const { board } = await boardAccess(tx, actx, params.boardId, "manage");
        const where = and(eq(boardShareLinks.boardId, board.id), eq(boardShareLinks.kind, kind.data));
        const [current] = await tx.select().from(boardShareLinks).where(where);
        // El enlace público siempre es de solo lectura; el de unirse usa el rol elegido.
        const role: JoinRole = kind.data === "public" ? "viewer" : (body.role ?? current?.role ?? "editor");

        if (!body.enabled) {
          if (current) await tx.delete(boardShareLinks).where(where);
        } else if (!current || body.regenerate) {
          const token = randomToken(24);
          if (current) await tx.delete(boardShareLinks).where(where);
          await tx.insert(boardShareLinks).values({
            id: uuidv7(),
            orgId: board.orgId,
            boardId: board.id,
            kind: kind.data,
            role,
            tokenHash: sha256(token),
            tokenEnc: encrypt(token),
            createdBy: me.id,
          });
        } else if (current.role !== role) {
          await tx.update(boardShareLinks).set({ role }).where(where);
        }

        const action = !body.enabled ? "share.disabled" : body.regenerate ? "share.regenerated" : current ? "share.updated" : "share.enabled";
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action, data: { kind: kind.data, role } });
        await audit(tx, actx, action, { orgId: board.orgId, targetType: "board", targetId: board.id, data: { kind: kind.data, role } });
        const [row] = await tx.select().from(boardShareLinks).where(where);
        return linkView(row);
      }),
  }),

  route({
    method: "GET",
    path: "/public/boards/:token",
    summary: "Tablero compartido por enlace público (solo lectura, sin sesión)",
    tag: "Compartir",
    auth: "none",
    rateLimit: [{ name: "public-board", by: "ip", limit: 120, windowSec: 300 }],
    handler: async ({ params }) =>
      withSystem(async (tx) => {
        const { board } = await findLink(tx, params.token, "public");
        const [listRows, cardRows, labelRows, people] = await Promise.all([
          tx.select().from(lists).where(and(eq(lists.boardId, board.id), isNull(lists.archivedAt))).orderBy(asc(lists.position), asc(lists.id)),
          boardCards(tx, board.id),
          tx.select().from(labels).where(eq(labels.boardId, board.id)).orderBy(asc(labels.name)),
          boardPeople(tx, board.id),
        ]);
        const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, board.orgId));
        // Sin datos internos: ni correos, ni comentarios, ni adjuntos, ni integraciones.
        return {
          board: { name: board.name, description: board.description, color: board.color, orgName: org?.name ?? "", archived: !!board.archivedAt },
          lists: listRows.map((l) => ({ id: l.id, name: l.name, color: l.color, position: l.position })),
          cards: cardRows.map((c) => ({ ...c, issueNumber: null, syncAttention: false, commentCount: 0, attachmentCount: 0 })),
          labels: labelRows.map((l) => ({ id: l.id, name: l.name, color: l.color })),
          people: people.map((p) => ({ userId: p.user_id, name: p.name })),
        };
      }),
  }),

  route({
    method: "GET",
    path: "/public/boards/:token/cards/:cardId",
    summary: "Detalle de una tarjeta de un tablero público (solo lectura)",
    tag: "Compartir",
    auth: "none",
    rateLimit: [{ name: "public-board", by: "ip", limit: 120, windowSec: 300 }],
    handler: async ({ params }) =>
      withSystem(async (tx) => {
        const { board } = await findLink(tx, params.token, "public");
        if (!z.uuid().safeParse(params.cardId).success) throw notFound("Tarjeta");
        const [card] = await tx
          .select()
          .from(cards)
          .where(and(eq(cards.id, params.cardId), eq(cards.boardId, board.id), isNull(cards.archivedAt)));
        if (!card) throw notFound("Tarjeta");
        const lists_ = await tx.select({ name: checklists.title, id: checklists.id }).from(checklists).where(eq(checklists.cardId, card.id)).orderBy(asc(checklists.position));
        const items = lists_.length
          ? await tx
              .select({ checklistId: checklistItems.checklistId, text: checklistItems.text, done: sql<boolean>`${checklistItems.doneAt} is not null` })
              .from(checklistItems)
              .where(inArray(checklistItems.checklistId, lists_.map((l) => l.id)))
              .orderBy(asc(checklistItems.position))
          : [];
        const subtasks = await tx
          .select({ id: cards.id, title: cards.title, done: sql<boolean>`${cards.completedAt} is not null` })
          .from(cards)
          .where(and(eq(cards.parentId, card.id), isNull(cards.archivedAt)))
          .orderBy(asc(cards.position));
        return {
          id: card.id,
          title: card.title,
          description: card.description,
          checklists: lists_.map((l) => ({ title: l.name, items: items.filter((i) => i.checklistId === l.id).map(({ text, done }) => ({ text, done })) })),
          subtasks,
        };
      }),
  }),

  route({
    method: "GET",
    path: "/share/join/:token",
    summary: "Ver a qué tablero lleva un enlace para unirse",
    tag: "Compartir",
    rateLimit: [{ name: "share-join", by: "user", limit: 30, windowSec: 900 }],
    handler: async ({ me, params }) =>
      withSystem(async (tx) => {
        const { link, board } = await findLink(tx, params.token, "join");
        const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, board.orgId));
        const [current] = await withUser(me.id, (utx) => utx.select({ role: myBoards.role }).from(myBoards).where(eq(myBoards.boardId, board.id)));
        return {
          boardId: board.id,
          boardName: board.name,
          orgName: org?.name ?? "",
          role: link.role,
          archived: !!board.archivedAt,
          currentRole: current?.role ?? null,
        };
      }),
  }),

  route({
    method: "POST",
    path: "/share/join/:token",
    summary: "Unirse a un tablero con un enlace (requiere sesión)",
    tag: "Compartir",
    rateLimit: [{ name: "share-join", by: "user", limit: 30, windowSec: 900 }],
    handler: async ({ me, params, audit: actx }) =>
      withSystem(async (tx) => {
        const { link, board } = await findLink(tx, params.token, "join");
        if (board.archivedAt) throw badRequest("El tablero está archivado");
        // Quien no es de la organización entra como invitado: solo ve los tableros a los que se une.
        await tx.insert(organizationMembers).values({ orgId: board.orgId, userId: me.id, role: "guest" }).onConflictDoNothing();
        const [existing] = await tx
          .select()
          .from(boardMembers)
          .where(and(eq(boardMembers.boardId, board.id), eq(boardMembers.userId, me.id)));
        // Nunca baja un rol que ya tenía.
        if (!existing) {
          await tx.insert(boardMembers).values({ orgId: board.orgId, boardId: board.id, userId: me.id, role: link.role });
        } else if (ROLE_RANK[existing.role] < ROLE_RANK[link.role]) {
          await tx.update(boardMembers).set({ role: link.role }).where(and(eq(boardMembers.boardId, board.id), eq(boardMembers.userId, me.id)));
        }
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "share.joined", data: { role: link.role } });
        await audit(tx, actx, "share.joined", { orgId: board.orgId, targetType: "board", targetId: board.id, data: { role: link.role } });
        return { boardId: board.id };
      }),
  }),
];
