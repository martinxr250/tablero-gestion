# Tableros

Plataforma de gestión de proyectos y tareas con tableros Kanban: organizaciones, espacios de trabajo, tableros, tarjetas con checklists, comentarios con menciones, adjuntos, notificaciones, actividad, dashboard y búsqueda. Pensada para correr **gratis** en **Vercel (Hobby) + Supabase (Free)**.

- **Stack:** Next.js 16 (App Router) · TypeScript · Postgres (Supabase) · Drizzle ORM · shadcn/ui (Radix) · lucide-react · TanStack Query · dnd-kit · TipTap.
- **Sin claves en el navegador:** el front solo habla con `/api/v1`; la base, el storage y el correo se usan desde el servidor.
- **Autenticación propia con JWT** (Ed25519) en cookies `HttpOnly`, refresh token rotativo con detección de reutilización, MFA TOTP opcional.

## Arquitectura

```
Navegador (React, sin secretos)
   │ cookies HttpOnly (__Host-faro_at / __Host-faro_rt)
   ▼
proxy.ts ── CSP con nonce + headers de seguridad
   ▼
Next.js (monolito modular)
   ├─ app/(auth), app/(app)        UI
   └─ app/api/v1/[...path]          API única → src/server/api/router.ts
          CSRF (Origin) · auth JWT + sesión · rate limit · Zod · errores seguros · OpenAPI
          └─ src/server/modules/*   auth · me · orgs · workspaces · boards · cards · insights · cron
   ▼
Postgres (esquema app, RLS)   Supabase Storage (bucket privado)   SMTP   Vercel Cron
```

### Aislamiento multi‑tenant (defensa en capas)

1. El tenant se deriva **del recurso**, nunca de lo que manda el cliente.
2. `authorize` central (`src/server/modules/access.ts`) con matriz rol → acción.
3. Cada request corre en una transacción con `SET LOCAL ROLE app_rw` + `app.user_id`: **Row‑Level Security** filtra por organización aunque una consulta olvide hacerlo.
4. **FKs compuestas** `(org_id, id)`: un hijo no puede apuntar a un padre de otra organización.
5. El rol efectivo en un tablero lo resuelve una única función SQL (`app.resolve_board_role`).
6. Tests BOLA/IDOR sobre más de 30 endpoints (`tests/integration/tenancy.test.ts`).

### Roles

| | Dueño | Admin | Miembro | Invitado |
|---|---|---|---|---|
| Organización | todo, eliminar | miembros, invitaciones, auditoría | crear espacios y tableros | solo tableros puntuales |

Tablero: **Administrador** (configura, miembros) · **Editor** (listas y tarjetas) · **Comentarista** · **Lector**. Dueños y admins de la organización acceden a todo (queda auditado).

## Desarrollo local

Requisitos: Node 22+, pnpm, Docker.

```bash
pnpm install
pnpm run setup:dev   # genera .env.local con claves nuevas, levanta Postgres y migra
pnpm dev
```

En desarrollo los correos (verificación, invitaciones, reset) se guardan como JSON en `.data/mail/` y los adjuntos en `.data/uploads/`.

```bash
pnpm test        # 50+ tests de integración contra Postgres real (base faro_test)
pnpm lint && pnpm typecheck && pnpm build
```

La documentación de la API está en `/docs/api` (y el OpenAPI en `/api/v1/openapi.json`).

## Despliegue gratis (Vercel + Supabase)

1. **Supabase**: creá un proyecto (plan Free). En *Project Settings → Database* copiá:
   - la cadena del **pooler en modo transacción** (puerto 6543) → `DATABASE_URL`
   - la conexión **directa** (puerto 5432) → `MIGRATION_DATABASE_URL`
2. **Migraciones** (desde tu máquina):
   ```bash
   MIGRATION_DATABASE_URL="postgres://..." pnpm db:migrate
   ```
   Las tablas viven en el esquema `app`, que la Data API de Supabase **no expone**.
3. **Storage**: copiá la *service role / secret key* y creá el bucket privado:
   ```bash
   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... pnpm storage:setup
   ```
4. **Claves**: generá un juego nuevo (no reutilices las de desarrollo):
   ```bash
   pnpm tsx scripts/setup-env.ts .env.production.local
   ```
5. **Correo**: con Gmail, activá la verificación en dos pasos y creá una *contraseña de aplicación*; usala en `SMTP_PASS` (`MAIL_DRIVER=smtp`).
6. **Vercel**: importá el repo y cargá las variables de `.env.example` (`APP_URL` con `https://`, `STORAGE_DRIVER=supabase`, `MAIL_DRIVER=smtp`, `CRON_SECRET`). El cron diario (`vercel.json`) envía avisos de vencimiento y aplica la retención.

> El plan Hobby de Vercel es para uso no comercial. Un proyecto gratuito de Supabase se pausa tras 7 días sin actividad.

## Seguridad

- Argon2id (OWASP), bloqueo tras 5 intentos, respuestas genéricas (sin enumeración de cuentas).
- Access JWT de 10 min + refresh opaco de 14 días, rotado en cada uso; reutilizarlo revoca la sesión. Revocación inmediata (cerrar sesión, cambiar contraseña).
- CSRF: `SameSite=Lax` + validación de `Origin` en toda mutación. CSP estricta con nonce.
- Validación con Zod en todas las entradas; texto enriquecido guardado como JSON con lista blanca (sin HTML).
- Adjuntos: tipo validado por contenido (magic bytes), máx. 4 MB, nombres saneados, bucket privado, descarga solo con permiso y `Content-Disposition: attachment` + `nosniff` + `sandbox`. Consulta opcional del hash en VirusTotal.
- Auditoría append-only (login, MFA, roles, invitaciones, accesos administrativos); los logs redactan contraseñas, tokens y cookies.
- Retención: archivados 90 días, organizaciones eliminadas 30 días, auditoría 1 año.
- CI: lint, tipos, tests, build, Gitleaks, Semgrep, OSV-Scanner y `pnpm audit` (bloquea high/critical).

### Riesgos aceptados

- Sin escaneo antimalware completo de archivos (no hay un servicio gratuito que no exponga el archivo); se mitiga con lista blanca de tipos, validación por contenido y descarga forzada.
- La actualización “en tiempo real” es por sondeo cada 4 s (Vercel no mantiene WebSockets y se evitó exponer claves de Supabase Realtime en el navegador).
