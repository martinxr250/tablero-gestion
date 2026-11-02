import "server-only";
import { z } from "zod";
import { cookieNames, readCookie } from "../auth/cookies";
import { verifyAccessToken } from "../auth/jwt";
import { loadSessionUser, type SessionUser } from "../auth/session";
import type { AuditContext } from "../core/audit";
import { hashIp } from "../core/crypto";
import { env } from "../core/env";
import { AppError, badRequest, forbidden, notFound, unauthorized } from "../core/errors";
import { UUID_RE, uuidv7 } from "../core/ids";
import { logger } from "../core/logger";
import { rateLimit } from "../core/rate-limit";

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
/** none: público · user: sesión + email verificado · user-unverified: sesión aunque no haya verificado. */
/** webhook: sin sesión ni Origin; el handler valida la firma sobre el cuerpo crudo (rawBody). */
export type AuthMode = "none" | "user" | "user-unverified" | "cron" | "webhook";

export interface RouteContext<TBody, TQuery> {
  req: Request;
  params: Record<string, string>;
  body: TBody;
  query: TQuery;
  form: FormData | null;
  rawBody: string | null;
  user: SessionUser | null;
  /** Usuario autenticado (lanza 401 si la ruta es pública y no hay sesión). */
  readonly me: SessionUser;
  ip: string;
  ipHash: string;
  userAgent: string;
  requestId: string;
  audit: AuditContext;
  setCookies: string[];
}

type RateRule = { name: string; by: "ip" | "user"; limit: number; windowSec: number };

export interface RouteDef {
  method: Method;
  path: string;
  summary: string;
  tag: string;
  auth: AuthMode;
  body?: z.ZodType;
  query?: z.ZodType;
  multipart?: boolean;
  rawBody?: boolean;
  status?: number;
  rateLimit?: RateRule[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (ctx: RouteContext<any, any>) => Promise<unknown>;
}

export function route<TBody extends z.ZodType | undefined = undefined, TQuery extends z.ZodType | undefined = undefined>(def: {
  method: Method;
  path: string;
  summary: string;
  tag: string;
  auth?: AuthMode;
  body?: TBody;
  query?: TQuery;
  multipart?: boolean;
  rawBody?: boolean;
  status?: number;
  rateLimit?: RateRule[];
  handler: (
    ctx: RouteContext<TBody extends z.ZodType ? z.output<TBody> : undefined, TQuery extends z.ZodType ? z.output<TQuery> : undefined>,
  ) => Promise<unknown>;
}): RouteDef {
  return { ...def, auth: def.auth ?? "user" };
}

const MAX_JSON_BYTES = 128 * 1024;
const MAX_MULTIPART_BYTES = 4.4 * 1024 * 1024; // límite de cuerpo de Vercel: 4.5 MB

type Compiled = { def: RouteDef; regex: RegExp; keys: string[] };

export function compile(routes: RouteDef[]): Compiled[] {
  return routes.map((def) => {
    const keys: string[] = [];
    const pattern = def.path.replace(/:([a-zA-Z]+)/g, (_, k: string) => {
      keys.push(k);
      return "([^/]+)";
    });
    return { def, regex: new RegExp(`^${pattern}$`), keys };
  });
}

function clientIp(req: Request): string {
  const h = req.headers;
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1";
}

function checkOrigin(req: Request) {
  const expected = new URL(env().APP_URL).origin;
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin !== expected) throw forbidden("Origen no permitido");
    return;
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") throw forbidden("Origen no permitido");
  if (!site) throw forbidden("Origen no permitido");
}

function json(status: number, data: unknown, headers: Headers) {
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(data === undefined ? null : JSON.stringify(data), { status, headers });
}

function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  if (typeof e?.code === "string") return e.code;
  if (typeof e?.cause?.code === "string") return e.cause.code;
  return undefined;
}

function toErrorResponse(err: unknown, requestId: string, headers: Headers): Response {
  if (err instanceof AppError) {
    for (const [k, v] of Object.entries(err.headers ?? {})) headers.set(k, v);
    return json(err.status, { error: { code: err.code, message: err.message, details: err.details, requestId } }, headers);
  }
  if (err instanceof z.ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return json(400, { error: { code: "validation_error", message: "Datos inválidos", details, requestId } }, headers);
  }
  const code = pgErrorCode(err);
  if (code === "23505") return json(409, { error: { code: "conflict", message: "Ya existe un registro con esos datos", requestId } }, headers);
  if (code === "23503") return json(400, { error: { code: "invalid_reference", message: "Referencia inválida", requestId } }, headers);
  if (code === "23514") return json(400, { error: { code: "validation_error", message: "Datos inválidos", requestId } }, headers);
  if (code === "42501") return json(404, { error: { code: "not_found", message: "Recurso no encontrado", requestId } }, headers);
  logger.error("unhandled_error", { requestId, err });
  return json(500, { error: { code: "internal_error", message: "Ocurrió un error inesperado", requestId } }, headers);
}

async function authenticate(req: Request): Promise<{ user: SessionUser | null; reason?: "expired" | "invalid" | "missing" }> {
  const token = readCookie(req.headers.get("cookie"), cookieNames().access);
  if (!token) return { user: null, reason: "missing" };
  const r = await verifyAccessToken(token);
  if (!r.ok) return { user: null, reason: r.reason };
  const user = await loadSessionUser(r.value.userId, r.value.sessionId);
  return user ? { user } : { user: null, reason: "invalid" };
}

function parseQuery(url: URL) {
  const out: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

async function readJson(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  const text = await req.text();
  if (!text) return undefined;
  if (!type.includes("application/json")) throw new AppError(415, "unsupported_media_type", "Se esperaba JSON");
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw new AppError(413, "payload_too_large", "El cuerpo es demasiado grande");
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest("JSON mal formado");
  }
}

export async function dispatch(req: Request, compiled: Compiled[], basePath = "/api/v1"): Promise<Response> {
  const requestId = uuidv7();
  const headers = new Headers({ "Cache-Control": "no-store", "X-Request-Id": requestId });
  const url = new URL(req.url);
  const path = url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) || "/" : url.pathname;
  const method = req.method.toUpperCase();

  try {
    let match: { c: Compiled; m: RegExpExecArray } | undefined;
    let pathMatched = false;
    for (const c of compiled) {
      const m = c.regex.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (c.def.method === method) {
        match = { c, m };
        break;
      }
    }
    if (!match) {
      if (pathMatched) throw new AppError(405, "method_not_allowed", "Método no permitido");
      throw notFound("Ruta");
    }
    const { def, keys } = match.c;
    const params: Record<string, string> = {};
    keys.forEach((k, i) => {
      const value = decodeURIComponent(match.m[i + 1] ?? "");
      if ((k === "id" || k.endsWith("Id")) && !UUID_RE.test(value)) throw notFound();
      params[k] = value;
    });

    const ip = clientIp(req);
    const ipHash = hashIp(ip);
    const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 300);

    if (def.auth === "cron") {
      const secret = env().CRON_SECRET;
      const header = req.headers.get("authorization") ?? "";
      const { safeEqual } = await import("../core/crypto");
      if (!secret || !safeEqual(header, `Bearer ${secret}`)) throw unauthorized();
    } else if (method !== "GET" && def.auth !== "webhook") {
      checkOrigin(req);
    }

    let user: SessionUser | null = null;
    if (def.auth === "user" || def.auth === "user-unverified") {
      const r = await authenticate(req);
      if (!r.user) {
        throw r.reason === "expired" ? unauthorized("token_expired", "La sesión expiró") : unauthorized("unauthenticated", "Iniciá sesión para continuar");
      }
      user = r.user;
      if (def.auth === "user" && !user.emailVerified) {
        throw new AppError(403, "email_not_verified", "Verificá tu correo para continuar");
      }
    }

    await rateLimit(user ? `api:u:${user.id}` : `api:ip:${ipHash}`, user ? 600 : 300, 60);
    for (const rule of def.rateLimit ?? []) {
      const subject = rule.by === "user" && user ? user.id : ipHash;
      await rateLimit(`${rule.name}:${rule.by}:${subject}`, rule.limit, rule.windowSec);
    }

    let body: unknown;
    let form: FormData | null = null;
    let rawBody: string | null = null;
    if (def.rawBody) {
      rawBody = await req.text();
      if (Buffer.byteLength(rawBody) > 1024 * 1024) throw new AppError(413, "payload_too_large", "El cuerpo es demasiado grande");
    } else if (def.multipart) {
      const len = Number(req.headers.get("content-length") ?? "0");
      if (!len || len > MAX_MULTIPART_BYTES) throw new AppError(413, "payload_too_large", "El archivo supera el máximo de 4 MB");
      form = await req.formData();
    } else if (method !== "GET") {
      // DELETE también puede traer cuerpo (confirmar nombre o contraseña antes de borrar).
      body = await readJson(req);
    }
    if (def.body) body = def.body.parse(body ?? {});
    const query = def.query ? def.query.parse(parseQuery(url)) : undefined;

    const setCookies: string[] = [];
    const ctx: RouteContext<unknown, unknown> = {
      req,
      params,
      body,
      query,
      form,
      rawBody,
      user,
      get me() {
        if (!user) throw unauthorized("unauthenticated", "Iniciá sesión para continuar");
        return user;
      },
      ip,
      ipHash,
      userAgent,
      requestId,
      audit: { actorId: user?.id ?? null, ipHash, userAgent },
      setCookies,
    };

    const result = await def.handler(ctx);
    if (result instanceof Response) {
      headers.forEach((v, k) => result.headers.set(k, v));
      for (const c of setCookies) result.headers.append("Set-Cookie", c);
      return result;
    }
    for (const c of setCookies) headers.append("Set-Cookie", c);
    if (result === undefined) return new Response(null, { status: 204, headers });
    return json(def.status ?? 200, result, headers);
  } catch (err) {
    return toErrorResponse(err, requestId, headers);
  }
}

/** Documento OpenAPI 3.1 generado a partir de las mismas definiciones que validan las requests. */
export function buildOpenApi(routes: RouteDef[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const p = r.path.replace(/:([a-zA-Z]+)/g, "{$1}");
    const parameters: unknown[] = [...r.path.matchAll(/:([a-zA-Z]+)/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" },
    }));
    if (r.query) {
      const js = z.toJSONSchema(r.query, { io: "input", unrepresentable: "any" }) as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      for (const [name, schema] of Object.entries(js.properties ?? {})) {
        parameters.push({ name, in: "query", required: js.required?.includes(name) ?? false, schema });
      }
    }
    const op: Record<string, unknown> = {
      summary: r.summary,
      tags: [r.tag],
      parameters,
      security: r.auth === "none" || r.auth === "webhook" ? [] : r.auth === "cron" ? [{ cronSecret: [] }] : [{ cookieAuth: [] }],
      responses: {
        [String(r.status ?? 200)]: { description: "OK" },
        "4XX": { $ref: "#/components/responses/Error" },
      },
    };
    if (r.body) {
      op.requestBody = {
        required: true,
        content: { "application/json": { schema: z.toJSONSchema(r.body, { io: "input", unrepresentable: "any" }) } },
      };
    }
    if (r.multipart) {
      op.requestBody = {
        required: true,
        content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } } },
      };
    }
    paths[p] ??= {};
    paths[p][r.method.toLowerCase()] = op;
  }
  return {
    openapi: "3.1.0",
    info: { title: "Tableros API", version: "1.0.0", description: "API de la plataforma Tableros. Todas las mutaciones exigen el mismo origen." },
    servers: [{ url: "/api/v1" }],
    components: {
      securitySchemes: {
        cookieAuth: { type: "apiKey", in: "cookie", name: "__Host-faro_at" },
        cronSecret: { type: "http", scheme: "bearer" },
      },
      responses: {
        Error: {
          description: "Error",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  error: {
                    type: "object",
                    properties: { code: { type: "string" }, message: { type: "string" }, details: {}, requestId: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    paths,
  };
}
