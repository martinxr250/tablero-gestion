import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { route } from "../api/router";
import { audit } from "../core/audit";
import { AppError } from "../core/errors";
import { withUser, type Tx } from "../db/client";
import { boardRepos, boards, type CompletionRules, type RuleLevel } from "../db/schema";
import { boardAccess, cardAccess } from "./access";

type Board = typeof boards.$inferSelect;
type CardRow = { id: string; boardId: string; qaStatus: string; title: string };

export const RULES = [
  { key: "subtasks", label: "Subtareas completadas", github: false },
  { key: "dependencies", label: "Dependencias resueltas", github: false },
  { key: "checklists", label: "Checklists terminados", github: false },
  { key: "prApproved", label: "Pull request aprobado", github: true },
  { key: "ciPassing", label: "Checks de CI exitosos", github: true },
  { key: "prMerged", label: "Pull request fusionado", github: true },
] as const;
type RuleKey = (typeof RULES)[number]["key"];

export type RuleResult = { key: RuleKey | "qa"; label: string; level: RuleLevel; ok: boolean; detail: string };

type Facts = {
  subtasks_open: number;
  blockers_open: number;
  checklist_open: number;
  prs_total: number;
  prs_open: number;
  prs_approved: number;
  prs_changes: number;
  prs_merged: number;
  checks_failed: number;
  checks_pending: number;
  checks_ok: number;
};

/** Datos de la tarjeta que necesitan las reglas, en una sola consulta. */
async function completionFacts(tx: Tx, cardId: string) {
  const [f] = await tx.execute<Facts>(sql`
    select
      (select count(*)::int from app.cards s where s.parent_id = ${cardId} and s.archived_at is null and s.completed_at is null) as subtasks_open,
      (select count(*)::int from app.card_relations r join app.cards b on b.id = r.from_card_id
         where r.to_card_id = ${cardId} and r.type = 'blocks' and b.completed_at is null and b.archived_at is null) as blockers_open,
      (select count(*)::int from app.checklist_items i join app.checklists k on k.id = i.checklist_id
         where k.card_id = ${cardId} and i.done_at is null) as checklist_open,
      (select count(*)::int from app.card_dev_refs d where d.card_id = ${cardId} and d.kind = 'pr') as prs_total,
      (select count(*)::int from app.card_dev_refs d where d.card_id = ${cardId} and d.kind = 'pr' and d.state = 'open') as prs_open,
      (select count(*)::int from app.card_dev_refs d where d.card_id = ${cardId} and d.kind = 'pr' and (d.review_status = 'approved' or d.merged)) as prs_approved,
      (select count(*)::int from app.card_dev_refs d where d.card_id = ${cardId} and d.kind = 'pr' and d.review_status = 'changes_requested' and not d.merged) as prs_changes,
      (select count(*)::int from app.card_dev_refs d where d.card_id = ${cardId} and d.kind = 'pr' and d.merged) as prs_merged,
      (select count(*)::int from app.card_dev_refs d where d.card_id = ${cardId} and d.kind = 'pr' and d.checks_status = 'failure') as checks_failed,
      (select count(*)::int from app.card_dev_refs d where d.card_id = ${cardId} and d.kind = 'pr' and d.checks_status = 'pending') as checks_pending,
      (select count(*)::int from app.card_dev_refs d where d.card_id = ${cardId} and d.kind = 'pr' and d.checks_status = 'success') as checks_ok`);
  return f!;
}

/**
 * Evalúa las reglas de cierre del tablero sobre una tarjeta. Las reglas de GitHub solo
 * aplican si la tarjeta tiene PR vinculados; si la última sincronización falló, pasan a
 * advertencia para no bloquear por una caída temporal de GitHub.
 */
export async function evaluateCompletion(tx: Tx, board: Board, card: CardRow): Promise<RuleResult[]> {
  const rules: CompletionRules = board.completionRules ?? {};
  const f = await completionFacts(tx, card.id);
  const [repo] = await tx.select({ error: boardRepos.lastSyncError }).from(boardRepos).where(eq(boardRepos.boardId, board.id));
  const githubDown = !!repo?.error;
  const out: RuleResult[] = [];

  if (board.qaRequired) {
    out.push({ key: "qa", label: "Aprobación de control de calidad", level: "block", ok: card.qaStatus === "approved", detail: card.qaStatus === "rejected" ? "QA la rechazó" : "Falta la aprobación de QA" });
  }
  for (const rule of RULES) {
    let level = rules[rule.key] ?? "off";
    if (level === "off") continue;
    if (rule.github && f.prs_total === 0) continue; // no aplica: la tarea no tiene código vinculado
    if (rule.github && githubDown && level === "block") level = "warn";
    let ok = true;
    let detail = "";
    switch (rule.key) {
      case "subtasks":
        ok = f.subtasks_open === 0;
        detail = `${f.subtasks_open} subtarea(s) sin terminar`;
        break;
      case "dependencies":
        ok = f.blockers_open === 0;
        detail = `Depende de ${f.blockers_open} tarea(s) sin terminar`;
        break;
      case "checklists":
        ok = f.checklist_open === 0;
        detail = `${f.checklist_open} ítem(s) de checklist pendientes`;
        break;
      case "prApproved":
        ok = f.prs_approved === f.prs_total && f.prs_changes === 0;
        detail = f.prs_changes ? "Hay cambios solicitados en la revisión" : "Hay pull requests sin aprobar";
        break;
      case "ciPassing":
        ok = f.checks_failed === 0 && f.checks_pending === 0 && f.checks_ok > 0;
        detail = f.checks_failed ? `${f.checks_failed} pull request(s) con checks fallidos` : f.checks_pending ? "Hay checks en curso" : "No hay resultados de checks";
        break;
      case "prMerged":
        ok = f.prs_merged === f.prs_total;
        detail = `${f.prs_total - f.prs_merged} pull request(s) sin fusionar`;
        break;
    }
    if (rule.github && githubDown && !ok) detail += " (la última sincronización con GitHub falló: no se pudo verificar)";
    out.push({ key: rule.key, label: rule.label, level, ok, detail: ok ? "" : detail });
  }
  return out;
}

/** Corta el cierre si hay reglas bloqueantes incumplidas (409 con el detalle). */
export async function assertCompletion(tx: Tx, board: Board, card: CardRow) {
  const results = await evaluateCompletion(tx, board, card);
  const failing = results.filter((r) => !r.ok && r.level === "block");
  if (failing.length) {
    const qaOnly = failing.length === 1 && failing[0]!.key === "qa";
    throw new AppError(
      409,
      qaOnly ? "qa_required" : "completion_blocked",
      qaOnly ? "Esta tarea necesita la aprobación de control de calidad antes de terminarse." : `No se puede terminar todavía: ${failing.map((r) => r.detail).join("; ")}.`,
      failing.map((r) => ({ path: r.key, message: r.detail })),
    );
  }
  return results;
}

/** Estado de entrega derivado (no reemplaza las columnas del tablero). */
export type DeliveryStatus = "pending" | "in_development" | "in_review" | "ready" | "done" | "blocked";
export function deliveryStatus(c: {
  completed: boolean;
  blocked: boolean;
  qaStatus: string;
  prsOpen: number;
  prsMerged: number;
  hasBranch: boolean;
  reviewPending: boolean;
}): DeliveryStatus {
  if (c.completed) return "done";
  if (c.blocked) return "blocked";
  if (c.qaStatus === "approved" || (c.prsMerged > 0 && c.prsOpen === 0)) return "ready";
  if (c.qaStatus === "pending" || c.reviewPending) return "in_review";
  if (c.prsOpen > 0 || c.hasBranch) return "in_development";
  return "pending";
}

const levelSchema = z.enum(["off", "warn", "block"]);

export const deliveryRoutes = [
  route({
    method: "GET",
    path: "/cards/:cardId/completion",
    summary: "Condiciones para completar la tarjeta según las reglas del tablero",
    tag: "Entrega",
    handler: async ({ me, params, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { card, board } = await cardAccess(tx, actx, params.cardId, "view");
        const results = await evaluateCompletion(tx, board, card);
        return { results, canComplete: results.every((r) => r.ok || r.level !== "block") };
      }),
  }),

  route({
    method: "PUT",
    path: "/boards/:boardId/completion-rules",
    summary: "Configurar las reglas para completar tarjetas (solo administradores)",
    tag: "Entrega",
    body: z.object(Object.fromEntries(RULES.map((r) => [r.key, levelSchema.optional()])) as Record<RuleKey, z.ZodOptional<typeof levelSchema>>),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, actx, params.boardId, "manage");
        const rules = Object.fromEntries(Object.entries(body).filter(([, v]) => v && v !== "off")) as CompletionRules;
        await tx.update(boards).set({ completionRules: rules }).where(and(eq(boards.id, board.id)));
        await audit(tx, actx, "board.completion_rules", { orgId: board.orgId, targetType: "board", targetId: board.id, data: rules });
        return { rules };
      }),
  }),
];
