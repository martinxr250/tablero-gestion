import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import { env } from "../core/env";
import { AppError } from "../core/errors";
import { uuidv7 } from "../core/ids";
import { logger } from "../core/logger";
import { withSystem } from "../db/client";
import { aiUsage } from "../db/schema";

// Toda llamada a Claude pasa por acá: solo en el servidor, con tope mensual por organización,
// respuesta validada por esquema y registro de consumo. La clave nunca llega al navegador.

let client: Anthropic | null = null;
export function aiClient() {
  const key = env().ANTHROPIC_API_KEY;
  if (!key) throw new AppError(503, "ai_not_configured", "La IA no está configurada en este servidor.");
  client ??= new Anthropic({ apiKey: key, maxRetries: 2, timeout: 55_000 });
  return client;
}

export const aiEnabled = () => !!env().ANTHROPIC_API_KEY;

export type AiInput = Anthropic.Beta.BetaContentBlockParam;
type Context = { orgId: string; userId: string; boardId?: string | null; feature: string };

/** Tokens usados por la organización en el mes en curso. */
export async function monthlyUsage(orgId: string) {
  const [r] = await withSystem((tx) =>
    tx.execute<{ used: string | null }>(sql`
      select sum(input_tokens + output_tokens) as used from app.ai_usage
      where org_id = ${orgId} and created_at >= date_trunc('month', now())`),
  );
  return Number(r?.used ?? 0);
}

/**
 * Pide a Claude una respuesta con forma fija (esquema Zod). Effort bajo por defecto: son
 * tareas de extracción y resumen, donde más razonamiento no mejora el resultado.
 */
export async function generate<T extends z.ZodType>(
  ctx: Context,
  opts: { system: string; content: AiInput[]; schema: T; effort?: "low" | "medium" | "high"; maxTokens?: number },
): Promise<z.infer<T>> {
  const limit = env().AI_MONTHLY_TOKENS;
  if ((await monthlyUsage(ctx.orgId)) >= limit) {
    throw new AppError(429, "ai_quota_exceeded", "La organización alcanzó el límite mensual de uso de IA.");
  }
  const model = env().AI_MODEL;
  let response;
  try {
    response = await aiClient().beta.messages.parse({
      model,
      max_tokens: opts.maxTokens ?? 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      output_config: { effort: opts.effort ?? "low", format: betaZodOutputFormat(opts.schema) },
      messages: [{ role: "user", content: opts.content }],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) throw new AppError(429, "ai_busy", "La IA está ocupada. Probá de nuevo en un momento.");
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      logger.error("ai_auth_failed", { err });
      throw new AppError(503, "ai_not_configured", "La clave de IA no es válida. Avisale a quien administra el sistema.");
    }
    if (err instanceof Anthropic.BadRequestError) {
      logger.warn("ai_bad_request", { err });
      throw new AppError(422, "ai_bad_input", "La IA no pudo procesar este contenido (puede ser un archivo dañado o demasiado grande).");
    }
    if (err instanceof Anthropic.APIError) {
      logger.error("ai_api_error", { status: err.status, err });
      throw new AppError(502, "ai_unavailable", "La IA no está disponible en este momento. Probá de nuevo más tarde.");
    }
    throw err;
  }

  await withSystem((tx) =>
    tx.insert(aiUsage).values({
      id: uuidv7(),
      orgId: ctx.orgId,
      userId: ctx.userId,
      boardId: ctx.boardId ?? null,
      feature: ctx.feature,
      model: response.model,
      inputTokens: (response.usage.input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens ?? 0,
    }),
  );

  if (response.stop_reason === "refusal") {
    throw new AppError(422, "ai_refused", "La IA no puede ayudar con este contenido.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new AppError(502, "ai_incomplete", "La respuesta de la IA quedó incompleta. Probá con menos contenido.");
  }
  return response.parsed_output as z.infer<T>;
}
