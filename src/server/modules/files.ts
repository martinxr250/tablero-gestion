import "server-only";
import { fileTypeFromBuffer } from "file-type";
import { createHash } from "node:crypto";
import { env } from "../core/env";
import { AppError, badRequest } from "../core/errors";
import { logger } from "../core/logger";

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 1024 * 1024;

const BINARY_ALLOWED = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
]);
const TEXT_EXT: Record<string, string> = { txt: "text/plain", csv: "text/csv", md: "text/markdown" };
export const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
/** Tipos que se pueden ver en el navegador sin descargarlos. */
export const PREVIEW_TYPES = new Set([...IMAGE_TYPES, "application/pdf"]);

/** Nombre seguro: sin rutas, sin caracteres de control, longitud acotada. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "archivo";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  if (!cleaned) return "archivo";
  if (cleaned.length <= 150) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 ? cleaned.slice(dot).slice(0, 10) : "";
  return cleaned.slice(0, 150 - ext.length) + ext;
}

function isUtf8Text(bytes: Uint8Array) {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export type ValidatedFile = { bytes: Uint8Array; mime: string; name: string; size: number; sha256: string };

/** Valida tipo por contenido (magic bytes), no por la extensión ni el Content-Type del cliente. */
export async function validateUpload(file: FormDataEntryValue | null, opts: { maxBytes: number; imagesOnly?: boolean }): Promise<ValidatedFile> {
  if (!file || typeof file === "string") throw badRequest("Adjuntá un archivo");
  if (file.size === 0) throw badRequest("El archivo está vacío");
  if (file.size > opts.maxBytes) {
    throw new AppError(413, "payload_too_large", `El archivo supera el máximo de ${Math.round(opts.maxBytes / 1024 / 1024)} MB`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = safeFileName(file.name);
  const detected = await fileTypeFromBuffer(bytes);
  let mime: string | undefined;
  if (detected && BINARY_ALLOWED.has(detected.mime)) mime = detected.mime;
  if (!detected) {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (TEXT_EXT[ext] && isUtf8Text(bytes)) mime = TEXT_EXT[ext];
  }
  if (!mime || (opts.imagesOnly && !IMAGE_TYPES.has(mime))) {
    throw new AppError(415, "unsupported_file_type", "Tipo de archivo no permitido");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await malwareCheck(sha256);
  return { bytes, mime, name, size: bytes.length, sha256 };
}

/**
 * Consulta opcional del hash en VirusTotal (no sube el archivo, solo el SHA-256).
 * Si no hay API key configurada, se omite; los demás controles siguen aplicando.
 */
async function malwareCheck(sha256: string) {
  const key = env().VIRUSTOTAL_API_KEY;
  if (!key) return;
  try {
    const res = await fetch(`https://www.virustotal.com/api/v3/files/${sha256}`, {
      headers: { "x-apikey": key },
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 404) return;
    if (!res.ok) return;
    const data = (await res.json()) as { data?: { attributes?: { last_analysis_stats?: { malicious?: number } } } };
    if ((data.data?.attributes?.last_analysis_stats?.malicious ?? 0) > 0) {
      throw new AppError(422, "malware_detected", "El archivo fue identificado como malicioso");
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn("malware_check_unavailable", { err });
  }
}

export function downloadResponse(bytes: Uint8Array, mime: string, fileName: string, inline: boolean) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "X-Content-Type-Options": "nosniff",
      // Los PDF se ven con el visor del navegador, que no funciona dentro de "sandbox":
      // se les niega todo recurso externo y que se incrusten en otros sitios.
      "Content-Security-Policy":
        inline && mime === "application/pdf"
          ? "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'"
          : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
