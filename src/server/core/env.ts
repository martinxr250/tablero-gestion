import "server-only";
import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url(),
    DATABASE_URL: z.string().min(1),
    JWT_PRIVATE_KEY: z.string().min(1),
    JWT_PUBLIC_KEY: z.string().min(1),
    JWT_KID: z.string().min(1).default("k1"),
    ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "Debe ser 32 bytes en base64"),
    IP_HASH_SECRET: z.string().min(32),
    CRON_SECRET: z.string().min(32).optional(),
    STORAGE_DRIVER: z.enum(["supabase", "database", "local"]).default("local"),
    SUPABASE_URL: z.url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    SUPABASE_BUCKET: z.string().default("faro-files"),
    MAIL_DRIVER: z.enum(["smtp", "file"]).default("file"),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(465),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().default("Tableros <no-reply@localhost>"),
    VIRUSTOTAL_API_KEY: z.string().optional(),
  })
  .superRefine((e, ctx) => {
    if (e.STORAGE_DRIVER === "supabase" && (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY)) {
      ctx.addIssue({ code: "custom", message: "STORAGE_DRIVER=supabase requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY" });
    }
    if (e.MAIL_DRIVER === "smtp" && (!e.SMTP_HOST || !e.SMTP_USER || !e.SMTP_PASS)) {
      ctx.addIssue({ code: "custom", message: "MAIL_DRIVER=smtp requiere SMTP_HOST, SMTP_USER y SMTP_PASS" });
    }
    if (e.NODE_ENV === "production") {
      if (e.STORAGE_DRIVER === "local") ctx.addIssue({ code: "custom", message: "En producción STORAGE_DRIVER debe ser supabase o database" });
      if (e.MAIL_DRIVER !== "smtp") ctx.addIssue({ code: "custom", message: "En producción MAIL_DRIVER debe ser smtp" });
      if (!e.CRON_SECRET) ctx.addIssue({ code: "custom", message: "En producción CRON_SECRET es obligatorio" });
      if (!e.APP_URL.startsWith("https://")) ctx.addIssue({ code: "custom", message: "En producción APP_URL debe ser https" });
    }
  });

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;

// Se valida en el primer uso (no en build) y falla con un mensaje sin valores sensibles.
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`).join("; ");
    throw new Error(`Configuración inválida: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProd = () => env().NODE_ENV === "production";
