import "server-only";
import type { Tx } from "../db/client";
import { auditLogs } from "../db/schema";

export type AuditContext = { actorId: string | null; ipHash?: string; userAgent?: string };

/** Registro de seguridad append-only. `data` nunca debe contener secretos (se valida por convención y logger). */
export async function audit(
  tx: Tx,
  ctx: AuditContext,
  action: string,
  opts: { orgId?: string | null; targetType?: string; targetId?: string; data?: Record<string, unknown> } = {},
) {
  await tx.insert(auditLogs).values({
    orgId: opts.orgId ?? null,
    actorId: ctx.actorId,
    action,
    targetType: opts.targetType,
    targetId: opts.targetId,
    ipHash: ctx.ipHash,
    userAgent: ctx.userAgent?.slice(0, 300),
    data: opts.data ?? {},
  });
}
