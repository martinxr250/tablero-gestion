import "server-only";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { route } from "../api/router";
import { audit } from "../core/audit";
import { randomToken, sha256 } from "../core/crypto";
import { badRequest, conflict, forbidden, notFound } from "../core/errors";
import { uuidv7 } from "../core/ids";
import { withSystem, withUser, type Tx } from "../db/client";
import {
  auditLogs,
  boardMembers,
  boards,
  invitations,
  organizationMembers,
  organizations,
  users,
  workspaceMembers,
  workspaces,
  type OrgRole,
} from "../db/schema";
import { sendMail } from "../email/mailer";
import { invitationMail } from "../email/templates";
import { orgAccess, orgRoleAtLeast } from "./access";
import { emailSchema } from "./auth";

const orgNameSchema = z.string().trim().min(1, "Ingresá un nombre").max(80);

export type InvitationScope =
  | { scope: "org"; role: "admin" | "member" | "guest" }
  | { scope: "workspace"; workspaceId: string; role: "admin" | "member" | "viewer" }
  | { scope: "board"; boardId: string; role: "admin" | "editor" | "commenter" | "viewer" };

/** Crea una invitación (token hasheado, vence en 7 días) y envía el correo. */
export async function createInvitation(
  tx: Tx,
  input: { orgId: string; email: string; inviter: { id: string; name: string }; targetName: string } & InvitationScope,
) {
  const [existingUser] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
  if (existingUser) {
    let already = false;
    if (input.scope === "org") {
      already = (await tx.select().from(organizationMembers).where(and(eq(organizationMembers.orgId, input.orgId), eq(organizationMembers.userId, existingUser.id)))).length > 0;
    } else if (input.scope === "workspace") {
      already = (await tx.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, existingUser.id)))).length > 0;
    } else {
      already = (await tx.select().from(boardMembers).where(and(eq(boardMembers.boardId, input.boardId), eq(boardMembers.userId, existingUser.id)))).length > 0;
    }
    if (already) throw conflict("Esa persona ya es miembro");
  }
  const token = randomToken(32);
  const id = uuidv7();
  await tx.insert(invitations).values({
    id,
    orgId: input.orgId,
    scope: input.scope,
    workspaceId: input.scope === "workspace" ? input.workspaceId : null,
    boardId: input.scope === "board" ? input.boardId : null,
    email: input.email,
    role: input.role,
    tokenHash: sha256(token),
    invitedBy: input.inviter.id,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
  });
  return { id, mail: { to: input.email, ...invitationMail(input.inviter.name, input.targetName, token) } };
}

async function findValidInvitation(tx: Tx, token: string) {
  const [inv] = await tx
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.tokenHash, sha256(token)),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    );
  if (!inv) throw badRequest("La invitación no es válida, ya se usó o venció");
  const [org] = await tx.select().from(organizations).where(and(eq(organizations.id, inv.orgId), isNull(organizations.deletedAt)));
  if (!org) throw badRequest("La invitación no es válida, ya se usó o venció");
  return { inv, org };
}

export const orgRoutes = [
  route({
    method: "POST",
    path: "/orgs",
    summary: "Crear una organización (con un espacio de trabajo inicial)",
    tag: "Organizaciones",
    status: 201,
    rateLimit: [{ name: "create-org", by: "user", limit: 10, windowSec: 3600 }],
    body: z.object({ name: orgNameSchema }),
    handler: async ({ me, body, audit: actx }) => {
      const orgId = uuidv7();
      const workspaceId = uuidv7();
      // Bootstrap: aún no hay membresía, por eso se crea en transacción de sistema.
      await withSystem(async (tx) => {
        await tx.insert(organizations).values({ id: orgId, name: body.name, createdBy: me.id });
        await tx.insert(organizationMembers).values({ orgId, userId: me.id, role: "owner" });
        await tx.insert(workspaces).values({ id: workspaceId, orgId, name: "General", color: "indigo", createdBy: me.id });
        await tx.insert(workspaceMembers).values({ orgId, workspaceId, userId: me.id, role: "admin" });
        await audit(tx, actx, "org.created", { orgId, targetType: "org", targetId: orgId });
      });
      return { id: orgId, workspaceId };
    },
  }),

  route({
    method: "GET",
    path: "/orgs/:orgId",
    summary: "Detalle de una organización",
    tag: "Organizaciones",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        const role = await orgAccess(tx, me.id, params.orgId);
        const [org] = await tx.select().from(organizations).where(eq(organizations.id, params.orgId));
        if (!org) throw notFound("Organización");
        const [{ members }] = await tx
          .select({ members: sql<number>`count(*)::int` })
          .from(organizationMembers)
          .where(eq(organizationMembers.orgId, params.orgId));
        return { id: org.id, name: org.name, createdAt: org.createdAt, role, members };
      }),
  }),

  route({
    method: "PATCH",
    path: "/orgs/:orgId",
    summary: "Renombrar una organización",
    tag: "Organizaciones",
    body: z.object({ name: orgNameSchema }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        await orgAccess(tx, me.id, params.orgId, "admin");
        await tx.update(organizations).set({ name: body.name }).where(eq(organizations.id, params.orgId));
        await audit(tx, actx, "org.renamed", { orgId: params.orgId, targetType: "org", targetId: params.orgId });
        return { ok: true };
      }),
  }),

  route({
    method: "DELETE",
    path: "/orgs/:orgId",
    summary: "Eliminar una organización (se purga a los 30 días)",
    tag: "Organizaciones",
    body: z.object({ confirmName: z.string() }),
    handler: async ({ me, params, body, audit: actx }) => {
      await withUser(me.id, async (tx) => {
        await orgAccess(tx, me.id, params.orgId, "owner");
        const [org] = await tx.select().from(organizations).where(eq(organizations.id, params.orgId));
        if (!org || org.name !== body.confirmName) throw badRequest("El nombre de confirmación no coincide");
      });
      // La baja lógica deja la organización fuera de RLS, por eso se marca como sistema tras autorizar.
      await withSystem(async (tx) => {
        await tx.update(organizations).set({ deletedAt: new Date() }).where(eq(organizations.id, params.orgId));
        await audit(tx, actx, "org.deleted", { orgId: params.orgId, targetType: "org", targetId: params.orgId });
      });
      return undefined;
    },
  }),

  route({
    method: "GET",
    path: "/orgs/:orgId/members",
    summary: "Miembros de la organización",
    tag: "Organizaciones",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        await orgAccess(tx, me.id, params.orgId, "member");
        const rows = await tx
          .select({
            userId: users.id,
            name: users.name,
            email: users.email,
            hasAvatar: sql<boolean>`${users.avatarKey} is not null`,
            role: organizationMembers.role,
            joinedAt: organizationMembers.createdAt,
          })
          .from(organizationMembers)
          .innerJoin(users, eq(users.id, organizationMembers.userId))
          .where(eq(organizationMembers.orgId, params.orgId))
          .orderBy(users.name);
        return { members: rows };
      }),
  }),

  route({
    method: "PATCH",
    path: "/orgs/:orgId/members/:userId",
    summary: "Cambiar el rol de un miembro",
    tag: "Organizaciones",
    body: z.object({ role: z.enum(["owner", "admin", "member", "guest"]) }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const myRole = await orgAccess(tx, me.id, params.orgId, "admin");
        const [target] = await tx
          .select()
          .from(organizationMembers)
          .where(and(eq(organizationMembers.orgId, params.orgId), eq(organizationMembers.userId, params.userId)))
          .for("update");
        if (!target) throw notFound("Miembro");
        if ((target.role === "owner" || body.role === "owner") && myRole !== "owner") {
          throw forbidden("Solo un dueño puede asignar o quitar el rol de dueño");
        }
        if (target.role === "owner" && body.role !== "owner") await assertAnotherOwner(tx, params.orgId);
        await tx
          .update(organizationMembers)
          .set({ role: body.role })
          .where(and(eq(organizationMembers.orgId, params.orgId), eq(organizationMembers.userId, params.userId)));
        if (body.role === "guest") {
          // Un invitado solo accede a tableros puntuales: pierde las membresías de espacios.
          await tx
            .delete(workspaceMembers)
            .where(and(eq(workspaceMembers.orgId, params.orgId), eq(workspaceMembers.userId, params.userId)));
        }
        await audit(tx, actx, "member.role_changed", {
          orgId: params.orgId,
          targetType: "user",
          targetId: params.userId,
          data: { from: target.role, to: body.role },
        });
        return { ok: true };
      }),
  }),

  route({
    method: "DELETE",
    path: "/orgs/:orgId/members/:userId",
    summary: "Quitar a un miembro (o salir de la organización)",
    tag: "Organizaciones",
    handler: async ({ me, params, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const self = params.userId === me.id;
        const myRole = await orgAccess(tx, me.id, params.orgId, self ? "guest" : "admin");
        const [target] = await tx
          .select()
          .from(organizationMembers)
          .where(and(eq(organizationMembers.orgId, params.orgId), eq(organizationMembers.userId, params.userId)));
        if (!target) throw notFound("Miembro");
        if (target.role === "owner") {
          if (!self && myRole !== "owner") throw forbidden("Solo un dueño puede quitar a otro dueño");
          await assertAnotherOwner(tx, params.orgId);
        }
        await audit(tx, actx, self ? "member.left" : "member.removed", {
          orgId: params.orgId,
          targetType: "user",
          targetId: params.userId,
        });
        // Las FKs compuestas eliminan en cascada espacios, tableros, asignaciones y notificaciones.
        await tx
          .delete(organizationMembers)
          .where(and(eq(organizationMembers.orgId, params.orgId), eq(organizationMembers.userId, params.userId)));
        return undefined;
      }),
  }),

  route({
    method: "POST",
    path: "/orgs/:orgId/invitations",
    summary: "Invitar a alguien a la organización",
    tag: "Invitaciones",
    status: 201,
    rateLimit: [{ name: "invite", by: "user", limit: 30, windowSec: 3600 }],
    body: z.object({ email: emailSchema, role: z.enum(["admin", "member", "guest"]) }),
    handler: async ({ me, params, body, audit: actx }) => {
      const { id, mail } = await withUser(me.id, async (tx) => {
        await orgAccess(tx, me.id, params.orgId, "admin");
        const [org] = await tx.select().from(organizations).where(eq(organizations.id, params.orgId));
        const created = await createInvitation(tx, {
          orgId: params.orgId,
          email: body.email,
          inviter: me,
          targetName: org!.name,
          scope: "org",
          role: body.role,
        });
        await audit(tx, actx, "invitation.created", {
          orgId: params.orgId,
          targetType: "invitation",
          targetId: created.id,
          data: { scope: "org", role: body.role },
        });
        return created;
      });
      await sendMail(mail);
      return { id };
    },
  }),

  route({
    method: "GET",
    path: "/orgs/:orgId/invitations",
    summary: "Invitaciones pendientes de la organización",
    tag: "Invitaciones",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        await orgAccess(tx, me.id, params.orgId, "admin");
        const rows = await tx
          .select({
            id: invitations.id,
            email: invitations.email,
            scope: invitations.scope,
            role: invitations.role,
            workspaceId: invitations.workspaceId,
            workspaceName: workspaces.name,
            boardId: invitations.boardId,
            boardName: boards.name,
            createdAt: invitations.createdAt,
            expiresAt: invitations.expiresAt,
          })
          .from(invitations)
          .leftJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
          .leftJoin(boards, eq(boards.id, invitations.boardId))
          .where(
            and(
              eq(invitations.orgId, params.orgId),
              isNull(invitations.acceptedAt),
              isNull(invitations.revokedAt),
              gt(invitations.expiresAt, new Date()),
            ),
          )
          .orderBy(desc(invitations.createdAt));
        return { invitations: rows };
      }),
  }),

  route({
    method: "DELETE",
    path: "/invitations/:invitationId",
    summary: "Revocar una invitación",
    tag: "Invitaciones",
    handler: async ({ me, params, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const [inv] = await tx.select().from(invitations).where(eq(invitations.id, params.invitationId));
        if (!inv) throw notFound("Invitación");
        const orgRole = await orgAccess(tx, me.id, inv.orgId);
        let allowed = orgRoleAtLeast(orgRole, "admin") || inv.invitedBy === me.id;
        if (!allowed && inv.scope === "workspace" && inv.workspaceId) {
          const [w] = await tx
            .select()
            .from(workspaceMembers)
            .where(and(eq(workspaceMembers.workspaceId, inv.workspaceId), eq(workspaceMembers.userId, me.id)));
          allowed = w?.role === "admin";
        }
        if (!allowed && inv.scope === "board" && inv.boardId) {
          const [b] = await tx
            .select()
            .from(boardMembers)
            .where(and(eq(boardMembers.boardId, inv.boardId), eq(boardMembers.userId, me.id)));
          allowed = b?.role === "admin";
        }
        if (!allowed) throw forbidden();
        await tx.update(invitations).set({ revokedAt: new Date() }).where(eq(invitations.id, inv.id));
        await audit(tx, actx, "invitation.revoked", { orgId: inv.orgId, targetType: "invitation", targetId: inv.id });
        return undefined;
      }),
  }),

  route({
    method: "POST",
    path: "/invitations/lookup",
    summary: "Ver los datos de una invitación antes de aceptarla",
    tag: "Invitaciones",
    rateLimit: [{ name: "invite-lookup", by: "user", limit: 30, windowSec: 900 }],
    body: z.object({ token: z.string().min(10).max(200) }),
    handler: async ({ me, body }) =>
      withSystem(async (tx) => {
        const { inv, org } = await findValidInvitation(tx, body.token);
        const [inviter] = inv.invitedBy ? await tx.select({ name: users.name }).from(users).where(eq(users.id, inv.invitedBy)) : [];
        let target = org.name;
        if (inv.workspaceId) target = (await tx.select().from(workspaces).where(eq(workspaces.id, inv.workspaceId)))[0]?.name ?? target;
        if (inv.boardId) target = (await tx.select().from(boards).where(eq(boards.id, inv.boardId)))[0]?.name ?? target;
        const emailMatches = inv.email.toLowerCase() === me.email.toLowerCase();
        return {
          orgName: org.name,
          target,
          scope: inv.scope,
          role: inv.role,
          inviterName: inviter?.name ?? null,
          emailMatches,
          // Solo se revela el correo invitado si coincide con la sesión.
          invitedEmail: emailMatches ? inv.email : null,
        };
      }),
  }),

  route({
    method: "POST",
    path: "/invitations/accept",
    summary: "Aceptar una invitación (el correo debe coincidir con la sesión)",
    tag: "Invitaciones",
    rateLimit: [{ name: "invite-accept", by: "user", limit: 20, windowSec: 900 }],
    body: z.object({ token: z.string().min(10).max(200) }),
    handler: async ({ me, body, audit: actx }) =>
      withSystem(async (tx) => {
        const { inv } = await findValidInvitation(tx, body.token);
        if (inv.email.toLowerCase() !== me.email.toLowerCase()) {
          throw forbidden("Esta invitación es para otro correo. Iniciá sesión con la cuenta invitada.");
        }
        const [current] = await tx
          .select()
          .from(organizationMembers)
          .where(and(eq(organizationMembers.orgId, inv.orgId), eq(organizationMembers.userId, me.id)));
        const desiredOrgRole: OrgRole = inv.scope === "org" ? (inv.role as OrgRole) : inv.scope === "workspace" ? "member" : "guest";
        if (!current) {
          await tx.insert(organizationMembers).values({ orgId: inv.orgId, userId: me.id, role: desiredOrgRole });
        } else if (!orgRoleAtLeast(current.role, desiredOrgRole) && current.role !== "owner") {
          await tx
            .update(organizationMembers)
            .set({ role: desiredOrgRole })
            .where(and(eq(organizationMembers.orgId, inv.orgId), eq(organizationMembers.userId, me.id)));
        }
        if (inv.scope === "workspace" && inv.workspaceId) {
          await tx
            .insert(workspaceMembers)
            .values({ orgId: inv.orgId, workspaceId: inv.workspaceId, userId: me.id, role: inv.role as "admin" | "member" | "viewer" })
            .onConflictDoUpdate({ target: [workspaceMembers.workspaceId, workspaceMembers.userId], set: { role: inv.role as "admin" } });
        }
        if (inv.scope === "board" && inv.boardId) {
          await tx
            .insert(boardMembers)
            .values({ orgId: inv.orgId, boardId: inv.boardId, userId: me.id, role: inv.role as "viewer" })
            .onConflictDoUpdate({ target: [boardMembers.boardId, boardMembers.userId], set: { role: inv.role as "viewer" } });
        }
        await tx.update(invitations).set({ acceptedAt: new Date(), acceptedBy: me.id }).where(eq(invitations.id, inv.id));
        await audit(tx, actx, "invitation.accepted", {
          orgId: inv.orgId,
          targetType: "invitation",
          targetId: inv.id,
          data: { scope: inv.scope, role: inv.role },
        });
        return { orgId: inv.orgId, workspaceId: inv.workspaceId, boardId: inv.boardId };
      }),
  }),

  route({
    method: "GET",
    path: "/orgs/:orgId/audit",
    summary: "Registro de auditoría de la organización (dueños y administradores)",
    tag: "Organizaciones",
    query: z.object({ before: z.coerce.number().int().positive().optional() }),
    handler: async ({ me, params, query }) =>
      withUser(me.id, async (tx) => {
        await orgAccess(tx, me.id, params.orgId, "admin");
        const rows = await tx
          .select({
            id: auditLogs.id,
            action: auditLogs.action,
            actorId: auditLogs.actorId,
            actorName: users.name,
            targetType: auditLogs.targetType,
            targetId: auditLogs.targetId,
            data: auditLogs.data,
            createdAt: auditLogs.createdAt,
          })
          .from(auditLogs)
          .leftJoin(users, eq(users.id, auditLogs.actorId))
          .where(and(eq(auditLogs.orgId, params.orgId), query.before ? lt(auditLogs.id, query.before) : undefined))
          .orderBy(desc(auditLogs.id))
          .limit(50);
        return { entries: rows, nextBefore: rows.length === 50 ? rows[rows.length - 1]!.id : null };
      }),
  }),
];

async function assertAnotherOwner(tx: Tx, orgId: string) {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.role, "owner")));
  if (n < 2) throw conflict("La organización tiene que conservar al menos un dueño", "last_owner");
}
