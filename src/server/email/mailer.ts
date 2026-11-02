import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../core/env";
import { uuidv7 } from "../core/ids";
import { logger } from "../core/logger";

export type Mail = { to: string; subject: string; text: string; html: string };

let transport: Transporter | undefined;

/**
 * Envía un correo. Driver "smtp" (producción: p. ej. Gmail con contraseña de aplicación)
 * o "file" (desarrollo/test: escribe el correo en .data/mail para inspeccionarlo).
 */
export async function sendMail(mail: Mail): Promise<void> {
  const e = env();
  if (e.MAIL_DRIVER === "file") {
    const dir = path.join(process.cwd(), ".data", "mail");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${Date.now()}-${uuidv7()}.json`), JSON.stringify(mail, null, 2), { mode: 0o600 });
    return;
  }
  transport ??= nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_PORT === 465,
    auth: { user: e.SMTP_USER, pass: e.SMTP_PASS },
  });
  try {
    await transport.sendMail({ from: e.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
  } catch (err) {
    logger.error("mail_send_failed", { subject: mail.subject, err });
    throw err;
  }
}
