import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { route } from "../api/router";
import { badRequest } from "../core/errors";
import { withUser, type Tx } from "../db/client";
import { boardCapacity } from "../db/schema";
import { boardAccess } from "./access";

// Indicadores determinísticos del tablero (sin IA). Cada resultado trae su explicación y,
// si faltan datos, lo dice en lugar de inventar un valor.

type Board = { id: string; name: string };
export type RiskLevel = "low" | "medium" | "high" | "insufficient";
type Ref = { id: string; title: string };
export type Risk = { severity: 1 | 2 | 3; problem: string; project: string; tasks: Ref[]; cause: string; impact: string; action: string };

const DAY = 86_400_000;
const today = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);

/** Riesgo de una etapa: puntos restantes contra días restantes y ritmo (histórico o capacidad). */
export async function sprintRisk(tx: Tx, boardId: string) {
  const sprintRows = await tx.execute<{
    id: string; name: string; status: string; starts_on: string; ends_on: string; capacity_points: string | null;
    remaining: string | null; estimated: number; unestimated: number; open: number; blocked: number; overdue: number;
  }>(sql`
    select s.id, s.name, s.status, s.starts_on::text, s.ends_on::text, s.capacity_points,
      sum(c.estimate_points) filter (where c.completed_at is null) as remaining,
      count(c.id) filter (where c.estimate_points is not null)::int as estimated,
      count(c.id) filter (where c.estimate_points is null and c.completed_at is null)::int as unestimated,
      count(c.id) filter (where c.completed_at is null)::int as open,
      count(c.id) filter (where c.completed_at is null and exists (
        select 1 from app.card_relations r join app.cards b on b.id = r.from_card_id
        where r.to_card_id = c.id and r.type = 'blocks' and b.completed_at is null and b.archived_at is null))::int as blocked,
      count(c.id) filter (where c.completed_at is null and c.due_at < now())::int as overdue
    from app.sprints s
    left join app.cards c on c.sprint_id = s.id and c.archived_at is null
    where s.board_id = ${boardId} and s.status in ('active', 'planned')
    group by s.id order by s.starts_on`);
  // Ritmo histórico: puntos terminados por día en etapas cerradas.
  const [hist] = await tx.execute<{ per_day: string | null; n: number }>(sql`
    select avg(done / greatest(1, ends_on - starts_on + 1)) as per_day, count(*)::int as n from (
      select s.starts_on, s.ends_on, coalesce(sum(c.estimate_points) filter (where c.completed_at is not null), 0) as done
      from app.sprints s left join app.cards c on c.sprint_id = s.id
      where s.board_id = ${boardId} and s.status = 'closed' group by s.id) x where done > 0`);
  const histPerDay = hist && hist.n > 0 && hist.per_day ? Number(hist.per_day) : null;

  return sprintRows.map((s) => {
    const reasons: string[] = [];
    const start = new Date(`${s.starts_on}T00:00:00Z`);
    const end = new Date(`${s.ends_on}T00:00:00Z`);
    const now = today();
    const length = Math.max(1, days(start, end) + 1);
    const left = Math.max(0, days(now < start ? start : now, end) + 1);
    const remaining = Number(s.remaining ?? 0);
    let level: RiskLevel = "low";
    let basis: string;
    let perDay: number | null = null;
    if (histPerDay) {
      perDay = histPerDay;
      basis = `ritmo histórico de ${hist!.n} etapa(s) cerrada(s) (${histPerDay.toFixed(1)} pts/día)`;
    } else if (s.capacity_points !== null) {
      perDay = Number(s.capacity_points) / length;
      basis = `capacidad de la etapa (${Number(s.capacity_points)} pts en ${length} días)`;
    } else {
      basis = "sin historial ni capacidad cargada";
    }
    if (s.estimated === 0 && s.open > 0) {
      level = "insufficient";
      reasons.push("Ninguna tarea tiene estimación: no se puede calcular el riesgo.");
    } else if (perDay === null) {
      level = "insufficient";
      reasons.push("Falta la capacidad de la etapa o etapas cerradas para conocer el ritmo del equipo.");
    } else if (remaining > 0) {
      const doable = perDay * left;
      const ratio = doable > 0 ? remaining / doable : Infinity;
      level = ratio > 1.1 ? "high" : ratio > 0.8 ? "medium" : "low";
      reasons.push(left === 0 ? `Terminó el plazo y quedan ${remaining} pts.` : `Quedan ${remaining} pts y, según el ${basis}, en ${left} día(s) se completarían unos ${doable.toFixed(0)}.`);
    } else {
      reasons.push("No quedan puntos pendientes.");
    }
    if (s.blocked > 0) {
      reasons.push(`${s.blocked} tarea(s) bloqueada(s).`);
      if (level === "low") level = "medium";
    }
    if (s.overdue > 0) reasons.push(`${s.overdue} tarea(s) vencida(s).`);
    if (s.unestimated > 0 && level !== "insufficient") reasons.push(`${s.unestimated} tarea(s) sin estimar: el riesgo real puede ser mayor.`);
    return { id: s.id, name: s.name, status: s.status, endsOn: s.ends_on, level, reasons, remainingPoints: remaining, daysLeft: left };
  });
}

export async function boardSignals(tx: Tx, board: Board) {
  const [summary] = await tx.execute<{ total: number; done: number; overdue: number; blocked: number }>(sql`
    select count(*)::int as total,
      count(*) filter (where c.completed_at is not null)::int as done,
      count(*) filter (where c.completed_at is null and c.due_at < now())::int as overdue,
      count(*) filter (where c.completed_at is null and exists (
        select 1 from app.card_relations r join app.cards b on b.id = r.from_card_id
        where r.to_card_id = c.id and r.type = 'blocks' and b.completed_at is null and b.archived_at is null))::int as blocked
    from app.cards c where c.board_id = ${board.id} and c.archived_at is null`);

  // Salud de las entregas a partir de datos reales de GitHub y QA.
  const [health] = await tx.execute<Record<string, number>>(sql`
    with pr as (
      select d.card_id, bool_or(d.state = 'open') as open, bool_or(d.state = 'open' and coalesce(d.review_status, '') <> 'approved') as waiting,
        bool_or(d.checks_status = 'failure' and not d.merged) as failing, bool_or(d.merged) as merged
      from app.card_dev_refs d join app.cards c on c.id = d.card_id
      where c.board_id = ${board.id} and d.kind = 'pr' and not d.draft group by d.card_id
    )
    select
      count(*) filter (where pr.open and c.completed_at is null)::int as "withOpenPr",
      count(*) filter (where pr.waiting and c.completed_at is null)::int as "waitingReview",
      count(*) filter (where pr.failing and c.completed_at is null)::int as "checksFailing",
      count(*) filter (where pr.merged and c.completed_at is null)::int as "merged",
      (select count(*)::int from app.cards q where q.board_id = ${board.id} and q.archived_at is null and q.completed_at is null and q.qa_status = 'pending') as "readyForQa",
      (select count(*)::int from app.cards q where q.board_id = ${board.id} and q.archived_at is null and q.completed_at is null and q.qa_status = 'approved') as "approved",
      (select count(*)::int from app.cards q where q.board_id = ${board.id} and q.completed_at > now() - interval '30 days') as "completed30d"
    from pr join app.cards c on c.id = pr.card_id`);

  // Dependencias: cadenas, críticas y ciclos (datos anteriores a la validación).
  const deps = await tx.execute<{ id: string; title: string; depth: number; dependents: number; in_cycle: boolean }>(sql`
    with recursive open_blocks as (
      select r.from_card_id as a, r.to_card_id as b from app.card_relations r
      join app.cards x on x.id = r.from_card_id join app.cards y on y.id = r.to_card_id
      where r.type = 'blocks' and x.completed_at is null and y.completed_at is null and x.archived_at is null and y.archived_at is null
        and (x.board_id = ${board.id} or y.board_id = ${board.id})
    ), walk(start, node, depth, path) as (
      select b, a, 1, array[b, a] from open_blocks
      union all
      select w.start, o.a, w.depth + 1, w.path || o.a from walk w join open_blocks o on o.b = w.node
      where w.depth < 20 and not (o.a = any(w.path[2:]))
    )
    select c.id, c.title,
      coalesce((select max(depth) from walk where start = c.id), 0)::int as depth,
      (select count(*)::int from open_blocks where a = c.id) as dependents,
      exists (select 1 from walk w join open_blocks o on o.b = w.node and o.a = w.start where w.start = c.id) as in_cycle
    from app.cards c where c.board_id = ${board.id} and c.archived_at is null and c.completed_at is null
      and (exists (select 1 from open_blocks where a = c.id) or exists (select 1 from open_blocks where b = c.id))`);
  const chains = deps.filter((d) => d.depth >= 2).sort((a, b) => b.depth - a.depth);
  const critical = deps.filter((d) => d.dependents >= 2).sort((a, b) => b.dependents - a.dependents);
  const cycles = deps.filter((d) => d.in_cycle);

  const sprints = await sprintRisk(tx, board.id);

  // Sobrecarga: puntos abiertos (etapa activa, o todo lo abierto si no hay) contra capacidad.
  const load = await tx.execute<{ user_id: string; name: string; points: string | null; unestimated: number; capacity: string | null }>(sql`
    with scope as (
      select c.* from app.cards c
      where c.board_id = ${board.id} and c.archived_at is null and c.completed_at is null
        and (not exists (select 1 from app.sprints s where s.board_id = ${board.id} and s.status = 'active')
          or c.sprint_id = (select s.id from app.sprints s where s.board_id = ${board.id} and s.status = 'active'))
    )
    select r.user_id, u.name, sum(sc.estimate_points) as points,
      count(sc.id) filter (where sc.estimate_points is null)::int as unestimated, bc.points as capacity
    from app.board_roles(${board.id}) r
    join app.users u on u.id = r.user_id
    left join scope sc on sc.owner_id = r.user_id
    left join app.board_capacity bc on bc.board_id = ${board.id} and bc.user_id = r.user_id
    group by r.user_id, u.name, bc.points order by u.name`);
  const people = load.map((p) => {
    const points = Number(p.points ?? 0);
    const capacity = p.capacity === null ? null : Number(p.capacity);
    const ratio = capacity ? points / capacity : null;
    return {
      userId: p.user_id,
      name: p.name,
      points,
      unestimated: p.unestimated,
      capacity,
      status: capacity === null ? "unknown" : ratio! > 1 ? "over" : ratio! > 0.85 ? "near" : "ok",
    };
  });

  // Riesgos priorizados con causa, impacto y acción recomendada.
  const risks: Risk[] = [];
  for (const s of sprints.filter((x) => x.level === "high")) {
    risks.push({ severity: 3, problem: `La etapa "${s.name}" corre riesgo alto de retraso`, project: board.name, tasks: [], cause: s.reasons.join(" "), impact: `Termina el ${s.endsOn}.`, action: "Reducir el alcance, sumar capacidad o mover tareas a la próxima etapa." });
  }
  for (const c of cycles.slice(0, 5)) {
    risks.push({ severity: 3, problem: "Dependencia circular", project: board.name, tasks: [{ id: c.id, title: c.title }], cause: "Las tareas se bloquean entre sí y ninguna puede terminar.", impact: "Bloqueo permanente.", action: "Quitar una de las relaciones del ciclo." });
  }
  for (const c of critical.slice(0, 5)) {
    risks.push({ severity: 2, problem: `Tarea crítica: bloquea a ${c.dependents} tareas`, project: board.name, tasks: [{ id: c.id, title: c.title }], cause: "Varias tareas esperan que esta termine.", impact: `${c.dependents} tareas detenidas.`, action: "Priorizarla y asignarle responsable." });
  }
  const failing = await tx.execute<{ id: string; title: string; number: string }>(sql`
    select c.id, c.title, d.external_id as number from app.card_dev_refs d join app.cards c on c.id = d.card_id
    where c.board_id = ${board.id} and d.kind = 'pr' and d.checks_status = 'failure' and not d.merged and c.completed_at is null limit 10`);
  if (failing.length) {
    risks.push({ severity: 2, problem: `${failing.length} pull request(s) con CI fallida`, project: board.name, tasks: failing.map((f) => ({ id: f.id, title: `${f.title} (#${f.number})` })), cause: "Los checks automáticos no pasan.", impact: "No se pueden aprobar ni fusionar.", action: "Revisar los checks en GitHub y corregir." });
  }
  const stale = await tx.execute<{ id: string; title: string; number: string }>(sql`
    select c.id, c.title, d.external_id as number from app.card_dev_refs d join app.cards c on c.id = d.card_id
    where c.board_id = ${board.id} and d.kind = 'pr' and d.state = 'open' and not d.draft
      and coalesce(d.review_status, '') not in ('approved', 'changes_requested') and d.remote_updated_at < now() - interval '2 days' limit 10`);
  if (stale.length) {
    risks.push({ severity: 1, problem: `${stale.length} pull request(s) esperan revisión hace más de 2 días`, project: board.name, tasks: stale.map((f) => ({ id: f.id, title: `${f.title} (#${f.number})` })), cause: "Nadie revisó todavía.", impact: "El código queda detenido.", action: "Asignar quién revisa." });
  }
  for (const p of people.filter((x) => x.status === "over")) {
    risks.push({ severity: 2, problem: `${p.name} está sobrecargado`, project: board.name, tasks: [], cause: `${p.points} pts asignados con capacidad de ${p.capacity} pts${p.unestimated ? ` (más ${p.unestimated} sin estimar)` : ""}.`, impact: "Sus tareas pueden atrasarse.", action: "Redistribuir tareas o ajustar la capacidad." });
  }
  const overdue = await tx.execute<{ id: string; title: string }>(sql`
    select id, title from app.cards where board_id = ${board.id} and archived_at is null and completed_at is null and due_at < now() order by due_at limit 10`);
  if (overdue.length) {
    risks.push({ severity: 1, problem: `${summary!.overdue} tarea(s) vencida(s)`, project: board.name, tasks: overdue, cause: "Pasó la fecha de vencimiento.", impact: "Posible retraso de la entrega.", action: "Replanificar fechas o reasignar." });
  }
  risks.sort((a, b) => b.severity - a.severity);

  return {
    summary: {
      total: summary!.total,
      done: summary!.done,
      overdue: summary!.overdue,
      blocked: summary!.blocked,
      pendingDelivery: (health?.merged ?? 0) + (health?.approved ?? 0),
      openReviews: health?.waitingReview ?? 0,
      sprintsAtRisk: sprints.filter((s) => s.level === "high" || s.level === "medium").length,
    },
    health: {
      withOpenPr: health?.withOpenPr ?? 0,
      waitingReview: health?.waitingReview ?? 0,
      checksFailing: health?.checksFailing ?? 0,
      merged: health?.merged ?? 0,
      readyForQa: health?.readyForQa ?? 0,
      approved: health?.approved ?? 0,
      completed30d: health?.completed30d ?? 0,
    },
    dependencies: {
      chains: chains.slice(0, 10).map((c) => ({ id: c.id, title: c.title, depth: c.depth })),
      critical: critical.slice(0, 10).map((c) => ({ id: c.id, title: c.title, dependents: c.dependents })),
      cycles: cycles.map((c) => ({ id: c.id, title: c.title })),
    },
    sprints,
    people,
    risks,
  };
}

export const signalRoutes = [
  route({
    method: "PUT",
    path: "/boards/:boardId/capacity/:userId",
    summary: "Capacidad por etapa de un integrante (puntos). null la quita.",
    tag: "Planificación",
    body: z.object({ points: z.number().min(0).max(10000).nullable() }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, actx, params.boardId, "manage");
        const [member] = await tx.execute<{ user_id: string }>(sql`select user_id from app.board_roles(${board.id}) where user_id = ${params.userId}`);
        if (!member) throw badRequest("La persona no tiene acceso al tablero");
        const key = and(eq(boardCapacity.boardId, board.id), eq(boardCapacity.userId, params.userId));
        if (body.points === null) await tx.delete(boardCapacity).where(key);
        else
          await tx
            .insert(boardCapacity)
            .values({ orgId: board.orgId, boardId: board.id, userId: params.userId, points: body.points })
            .onConflictDoUpdate({ target: [boardCapacity.boardId, boardCapacity.userId], set: { points: body.points, updatedAt: new Date() } });
        return { points: body.points };
      }),
  }),
];
