import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { route } from "../api/router";
import { audit } from "../core/audit";
import { badRequest, conflict, forbidden, notFound } from "../core/errors";
import { uuidv7 } from "../core/ids";
import { withUser } from "../db/client";
import { boards, myBoards, myWorkspaces, organizationMembers, users, workspaceMembers, workspaces } from "../db/schema";
import { sendMail } from "../email/mailer";
import { orgAccess, orgRoleAtLeast, workspaceAccess } from "./access";
import { emailSchema } from "./auth";
import { createInvitation } from "./orgs";
import { colorSchema } from "./shared";

const wsBody = z.object({
  name: z.string().trim().min(1, "Ingresá un nombre").max(80),
  description: z.string().trim().max(500).optional().nullable(),
  color: colorSchema.default("indigo"),
});

export const workspaceRoutes = [
  route({
    method: "GET",
    path: "/orgs/:orgId/workspaces",
    summary: "Espacios de trabajo visibles y sus tableros accesibles",
    tag: "Espacios de trabajo",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        const orgRole = await orgAccess(tx, me.id, params.orgId);
        const boardRows = await tx
          .select({
            id: boards.id,
            workspaceId: boards.workspaceId,
            name: boards.name,
            color: boards.color,
            visibility: boards.visibility,
            role: myBoards.role,
          })
          .from(myBoards)
          .innerJoin(boards, eq(boards.id, myBoards.boardId))
          .where(and(eq(myBoards.orgId, params.orgId), isNull(boards.archivedAt)))
          .orderBy(asc(boards.name));
        const wsRoles = await tx.select().from(myWorkspaces).where(eq(myWorkspaces.orgId, params.orgId));
        const visibleIds = new Set([...wsRoles.map((w) => w.workspaceId), ...boardRows.map((b) => b.workspaceId)]);
        const wsRows = visibleIds.size
          ? await tx
              .select()
              .from(workspaces)
              .where(and(inArray(workspaces.id, [...visibleIds]), isNull(workspaces.archivedAt)))
              .orderBy(asc(workspaces.name))
          : [];
        const roleOf = new Map(wsRoles.map((w) => [w.workspaceId, w.role]));
        return {
          orgRole,
          workspaces: wsRows.map((w) => ({
            id: w.id,
            name: w.name,
            description: w.description,
            color: w.color,
            role: roleOf.get(w.id) ?? null,
            boards: boardRows.filter((b) => b.workspaceId === w.id),
          })),
        };
      }),
  }),

  route({
    method: "POST",
    path: "/orgs/:orgId/workspaces",
    summary: "Crear un espacio de trabajo",
    tag: "Espacios de trabajo",
    status: 201,
    body: wsBody,
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        await orgAccess(tx, me.id, params.orgId, "member");
        const id = uuidv7();
        await tx.insert(workspaces).values({ id, orgId: params.orgId, name: body.name, description: body.description, color: body.color, createdBy: me.id });
        await tx.insert(workspaceMembers).values({ orgId: params.orgId, workspaceId: id, userId: me.id, role: "admin" });
        await audit(tx, actx, "workspace.created", { orgId: params.orgId, targetType: "workspace", targetId: id });
        return { id };
      }),
  }),

  route({
    method: "GET",
    path: "/workspaces/:workspaceId",
    summary: "Detalle de un espacio de trabajo",
    tag: "Espacios de trabajo",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        const { workspace, role, orgRole } = await workspaceAccess(tx, me.id, params.workspaceId, "view");
        const boardRows = await tx
          .select({
            id: boards.id,
            name: boards.name,
            description: boards.description,
            color: boards.color,
            visibility: boards.visibility,
            archivedAt: boards.archivedAt,
            role: myBoards.role,
          })
          .from(myBoards)
          .innerJoin(boards, eq(boards.id, myBoards.boardId))
          .where(eq(myBoards.workspaceId, params.workspaceId))
          .orderBy(asc(boards.name));
        return {
          workspace: { id: workspace.id, orgId: workspace.orgId, name: workspace.name, description: workspace.description, color: workspace.color },
          role,
          orgRole,
          boards: boardRows,
        };
      }),
  }),

  route({
    method: "PATCH",
    path: "/workspaces/:workspaceId",
    summary: "Editar un espacio de trabajo",
    tag: "Espacios de trabajo",
    body: wsBody.partial(),
    handler: async ({ me, params, body }) =>
      withUser(me.id, async (tx) => {
        await workspaceAccess(tx, me.id, params.workspaceId, "manage");
        await tx.update(workspaces).set(body).where(eq(workspaces.id, params.workspaceId));
        return { ok: true };
      }),
  }),

  route({
    method: "DELETE",
    path: "/workspaces/:workspaceId",
    summary: "Eliminar un espacio de trabajo y todos sus tableros",
    tag: "Espacios de trabajo",
    body: z.object({ confirmName: z.string() }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { workspace } = await workspaceAccess(tx, me.id, params.workspaceId, "manage");
        if (workspace.name !== body.confirmName) throw badRequest("El nombre de confirmación no coincide");
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(workspaces)
          .where(and(eq(workspaces.orgId, workspace.orgId), isNull(workspaces.archivedAt)));
        if (n <= 1) throw conflict("La organización necesita al menos un espacio de trabajo");
        await audit(tx, actx, "workspace.deleted", {
          orgId: workspace.orgId,
          targetType: "workspace",
          targetId: workspace.id,
          data: { name: workspace.name },
        });
        await tx.delete(workspaces).where(eq(workspaces.id, workspace.id));
        return undefined;
      }),
  }),

  route({
    method: "GET",
    path: "/workspaces/:workspaceId/members",
    summary: "Miembros del espacio de trabajo",
    tag: "Espacios de trabajo",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        const { role } = await workspaceAccess(tx, me.id, params.workspaceId, "view");
        if (!role) throw forbidden();
        const rows = await tx
          .select({
            userId: users.id,
            name: users.name,
            email: users.email,
            hasAvatar: sql<boolean>`${users.avatarKey} is not null`,
            role: workspaceMembers.role,
          })
          .from(workspaceMembers)
          .innerJoin(users, eq(users.id, workspaceMembers.userId))
          .where(eq(workspaceMembers.workspaceId, params.workspaceId))
          .orderBy(users.name);
        return { members: rows };
      }),
  }),

  route({
    method: "PUT",
    path: "/workspaces/:workspaceId/members/:userId",
    summary: "Agregar un miembro de la organización al espacio o cambiar su rol",
    tag: "Espacios de trabajo",
    body: z.object({ role: z.enum(["admin", "member", "viewer"]) }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { workspace } = await workspaceAccess(tx, me.id, params.workspaceId, "manage");
        const [target] = await tx
          .select()
          .from(organizationMembers)
          .where(and(eq(organizationMembers.orgId, workspace.orgId), eq(organizationMembers.userId, params.userId)));
        if (!target) throw notFound("Miembro");
        if (!orgRoleAtLeast(target.role, "member")) {
          throw badRequest("Los invitados solo acceden a tableros puntuales. Cambiá su rol en la organización primero.");
        }
        await tx
          .insert(workspaceMembers)
          .values({ orgId: workspace.orgId, workspaceId: workspace.id, userId: params.userId, role: body.role })
          .onConflictDoUpdate({ target: [workspaceMembers.workspaceId, workspaceMembers.userId], set: { role: body.role } });
        await audit(tx, actx, "workspace.member_set", {
          orgId: workspace.orgId,
          targetType: "user",
          targetId: params.userId,
          data: { workspaceId: workspace.id, role: body.role },
        });
        return { ok: true };
      }),
  }),

  route({
    method: "DELETE",
    path: "/workspaces/:workspaceId/members/:userId",
    summary: "Quitar a alguien del espacio de trabajo",
    tag: "Espacios de trabajo",
    handler: async ({ me, params, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const self = params.userId === me.id;
        const { workspace } = await workspaceAccess(tx, me.id, params.workspaceId, self ? "view" : "manage");
        const admins = await tx
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.role, "admin")));
        if (admins.length === 1 && admins[0]!.userId === params.userId) {
          throw conflict("El espacio necesita al menos un administrador");
        }
        await tx
          .delete(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, params.userId)));
        await audit(tx, actx, "workspace.member_removed", {
          orgId: workspace.orgId,
          targetType: "user",
          targetId: params.userId,
          data: { workspaceId: workspace.id },
        });
        return undefined;
      }),
  }),

  route({
    method: "POST",
    path: "/workspaces/:workspaceId/invitations",
    summary: "Invitar por correo a un espacio de trabajo",
    tag: "Invitaciones",
    status: 201,
    rateLimit: [{ name: "invite", by: "user", limit: 30, windowSec: 3600 }],
    body: z.object({ email: emailSchema, role: z.enum(["admin", "member", "viewer"]) }),
    handler: async ({ me, params, body, audit: actx }) => {
      const { id, mail } = await withUser(me.id, async (tx) => {
        const { workspace } = await workspaceAccess(tx, me.id, params.workspaceId, "manage");
        const created = await createInvitation(tx, {
          orgId: workspace.orgId,
          email: body.email,
          inviter: me,
          targetName: workspace.name,
          scope: "workspace",
          workspaceId: workspace.id,
          role: body.role,
        });
        await audit(tx, actx, "invitation.created", {
          orgId: workspace.orgId,
          targetType: "invitation",
          targetId: created.id,
          data: { scope: "workspace", role: body.role },
        });
        return created;
      });
      await sendMail(mail);
      return { id };
    },
  }),
];
