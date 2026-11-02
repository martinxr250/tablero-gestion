export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what = "Recurso") => new AppError(404, "not_found", `${what} no encontrado`);
export const forbidden = (message = "No tenés permiso para esta acción") => new AppError(403, "forbidden", message);
export const unauthorized = (code = "unauthorized", message = "Sesión no válida o expirada") =>
  new AppError(401, code, message);
export const badRequest = (message: string, details?: unknown) => new AppError(400, "bad_request", message, details);
export const conflict = (message: string, code = "conflict") => new AppError(409, code, message);
export const tooManyRequests = (retryAfterSec: number) =>
  new AppError(429, "rate_limited", "Demasiados intentos. Probá de nuevo en un rato.", undefined, {
    "Retry-After": String(retryAfterSec),
  });
