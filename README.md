<div align="center">

<img src="public/icon.svg" width="72" alt="Logo de Tableros" />

# Tableros

**Gestión de proyectos y tareas con tableros Kanban, pensada para equipos chicos.**

Organizá el trabajo en columnas, asigná responsables y fechas, conversá en cada tarea y seguí el avance del equipo desde un solo lugar. Con IA que lee tus documentos, responde sobre el tablero y verifica si el código cumple lo que pide cada tarea.

![Next.js](https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-3ecf8e?logo=supabase&logoColor=white)
![shadcn/ui](https://img.shields.io/badge/UI-shadcn%2Fui-111?logo=shadcnui)
![Claude](https://img.shields.io/badge/IA-Claude-d97757)
![Tests](https://img.shields.io/badge/tests-212-5b4ee6)

</div>

![Tablero Kanban](docs/screenshots/board.png)

## ¿Qué es?

Tableros es una aplicación web para organizar proyectos con el método Kanban. Cada equipo tiene su **organización**, la divide en **espacios de trabajo** (por área o cliente) y dentro de cada uno arma **tableros** con columnas y tarjetas. Cada tarjeta concentra todo lo que hace falta para avanzar: responsable, fecha, prioridad, checklist, archivos y la conversación del equipo.

Además de tableros, trae **Mi trabajo** (todas tus tareas en un lugar), un **Panel del líder** con riesgos calculados, integración con **GitHub y GitLab**, también con repos privados (issues, PRs/MRs, checks y despliegues), un **Asistente IA** que actúa con tus permisos y un **Estudio de software** que diseña un sistema desde cero y lo convierte en tablero.

Está construida como un producto completo: autenticación propia, permisos por rol, aislamiento de datos entre organizaciones, auditoría, modo claro y oscuro, diseño responsive y accesibilidad por teclado. Corre de forma **gratuita** sobre Vercel + Supabase.

## Capturas

| Inicio | Detalle de tarjeta |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Tarjeta](docs/screenshots/card.png) |

| Actividad del tablero | Búsqueda con filtros |
|---|---|
| ![Actividad](docs/screenshots/activity.png) | ![Búsqueda](docs/screenshots/search.png) |

| Modo oscuro | Celular | Inicio de sesión |
|---|---|---|
| ![Modo oscuro](docs/screenshots/board-dark.png) | <img src="docs/screenshots/mobile.png" width="220" alt="Vista en celular" /> | ![Login](docs/screenshots/login.png) |

## Funcionalidades

**Tableros Kanban**
- Columnas y tarjetas con arrastrar y soltar (mouse y teclado), reordenamiento de columnas y colores por lista.
- Filtros por persona, etiqueta, prioridad y vencimiento; barra de progreso del tablero.
- Archivado y restauración de listas y tarjetas.
- Vistas de **tablero, lista, calendario, etapas, panel del líder y archivos**.
- **Campos personalizados** (texto, número, moneda, fecha, casilla, lista de opciones), **plantillas** de tablero, carga masiva de tareas y exportación a CSV.
- **Tarjetas espejo:** una misma tarea en varios tableros con la información sincronizada.
- **Enlaces para compartir** el tablero en solo lectura, sin cuenta.

**Tarjetas**
- Descripción con texto enriquecido, prioridad, responsable, colaboradores, etiquetas y fecha de vencimiento.
- Checklists con progreso, archivos adjuntos (imágenes, PDF, Office, texto), relaciones entre tareas (bloquea, relacionada, duplica).
- Comentarios con **@menciones** e historial completo de cambios.
- Subtareas, tareas recurrentes, seguimiento, duplicado y control de calidad (aprobar o rechazar).
- **Reglas de cierre** por tablero: por ejemplo, no completar con subtareas, checklist o PRs pendientes.

**Colaboración**
- Organizaciones, espacios de trabajo y tableros con roles y **invitaciones por correo**.
- Notificaciones internas (asignaciones, menciones, comentarios, vencimientos próximos).
- Actualización casi en tiempo real: los cambios de otras personas aparecen solos y se resaltan.
- Panel de actividad por tablero y registro de auditoría por organización.

**Planificación y seguimiento**
- **Mi trabajo:** tus tareas de todos los tableros agrupadas por estado, un planificador y una bandeja personal de notas rápidas que se convierten en tarjetas.
- **Etapas** (sprints) con estimación en puntos, capacidad por persona y riesgo de retraso según el ritmo histórico.
- **Panel del líder:** riesgos calculados con datos reales (cada uno con causa, impacto y acción recomendada), carga contra capacidad, dependencias críticas y salud de las entregas.
- Inicio con tareas pendientes, vencidas, por vencer y completadas, gráfico de ritmo semanal, tableros activos y actividad reciente.
- Búsqueda global (⌘K) y búsqueda avanzada por organización, espacio, tablero, persona, estado, prioridad y fecha.

**Inteligencia artificial (Claude)**
- **Tareas desde documentos:** subís un PDF, imagen o texto (o lo pegás) y la IA propone tareas con prioridad, fecha, responsable y subtareas; nada se crea sin tu revisión.
- **Explicar una tarjeta:** resume la tarea, sus comentarios y adjuntos, marca riesgos y sugiere subtareas y checklist para agregar con un clic.
- **Preguntale al tablero:** respuestas en lenguaje natural con enlaces a las tarjetas, solo con lo que cada persona puede ver.
- **Resumen del líder:** el estado del tablero en un minuto, escrito a partir de los indicadores (no lee descripciones ni comentarios).
- **¿Cumple el PR lo que pide la tarjeta?:** lee los cambios del PR vinculado y verifica cada requisito de la tarjeta (descripción, checklist, subtareas) con evidencia y archivos; avisa si el PR cambió después de verificarlo.
- **Asistente IA:** conversación que consulta y propone cambios (crear, mover, asignar, comentar…); cada cambio se muestra y se ejecuta solo si lo confirmás, con tus permisos.
- **Resúmenes de archivos** del tablero, guardados para todo el equipo.
- Tope mensual de consumo por organización y registro de uso.

**Estudio de software**
- Desde una idea, la IA genera visión, requisitos, casos de uso, diagramas (Mermaid), arquitectura y plan del proyecto; cada documento se puede editar a mano o pedirle cambios a la IA.
- El plan se convierte en un tablero con una etapa por fase y tareas estimadas. Exportación completa en Markdown.

**Cuenta y seguridad**
- Registro con verificación de correo, recuperación de contraseña, verificación en dos pasos (TOTP) con códigos de recuperación.
- Gestión de sesiones abiertas, cambio de contraseña y eliminación de cuenta.

## Integración con GitHub y GitLab

Cada tablero puede vincularse a un repositorio de **GitHub** o a un proyecto de **GitLab** (gitlab.com o un GitLab propio), **públicos o privados**. Una organización puede tener cuentas de los dos proveedores a la vez.

- **Conexión segura** con un token guardado cifrado que nunca llega al navegador: en GitHub, un token *fine-grained*; en GitLab, un token personal, de proyecto o de grupo con alcance `api` (rol Developer o más; Maintainer para el webhook). El token es lo que da acceso a los repos privados.
- **Importación** de los issues abiertos como tarjetas y creación de issues desde cualquier tarjeta.
- **Sincronización bidireccional** de título, descripción (Markdown ↔ texto enriquecido), etiquetas, prioridad (como etiqueta `prioridad: …`), responsable y estado. Mover una tarjeta a la lista de terminado cierra el issue.
- **Sin ecos ni pisadas:** cada vínculo guarda la huella local y remota del último estado; si ambos lados cambiaron, la tarjeta muestra el conflicto y una persona decide.
- **Desarrollo en la tarjeta:** pull requests o merge requests que mencionan el issue (título, descripción o rama `12-…`), con estado, revisión o aprobación y resultado de los checks o del pipeline.
- **Cerrar un issue no completa la tarjeta:** se puede mover a una columna de revisión; la decisión final queda en el tablero.
- **Despliegues:** GitHub Deployments (por ejemplo, de Vercel) o despliegues de GitLab CI/CD (con el *tier* del entorno) vinculados a las tarjetas por evidencia; la tarjeta muestra si su código llegó a producción. Fusionado no cuenta como desplegado.
- **Verificación con IA** de cada PR o MR contra lo que pide la tarjeta (ver *Inteligencia artificial*).
- **Webhooks** deduplicados en producción: firmados con HMAC SHA-256 en GitHub y con token secreto en GitLab. En local, sincronización por sondeo al abrir el tablero y cada 2 minutos.
- **GitLab propio:** la app solo llama a gitlab.com y a los hosts que el administrador habilita en `GITLAB_HOSTS` (siempre HTTPS, sin seguir redirecciones), para que una dirección cargada por un usuario no apunte a la red interna.

## Casos de uso

- **Equipo de marketing** que planifica una campaña: columnas *Por hacer / En curso / Revisión / Hecho*, piezas con fecha de entrega, checklist de entregables y archivos adjuntos.
- **Grupo de amigos o estudio chico** que organiza un proyecto en común: cada uno ve sus tareas en el inicio y recibe aviso cuando lo mencionan o algo está por vencer.
- **Freelancer con clientes**: un espacio de trabajo por cliente y tableros privados; el cliente entra como **invitado** y solo ve su tablero.
- **Equipo de desarrollo** que lleva un backlog: prioridades, relaciones de bloqueo entre tareas y búsqueda por etiqueta o responsable.
- **Coordinación de un evento**: fechas de vencimiento, recordatorios automáticos y el historial de quién cambió qué.

## Roles y permisos

| Organización | Puede |
|---|---|
| **Dueño** | Todo, incluido eliminar la organización y nombrar otros dueños |
| **Administrador** | Gestionar miembros, invitaciones, espacios y ver la auditoría |
| **Miembro** | Crear espacios y tableros, trabajar en los tableros a los que accede |
| **Invitado** | Solo los tableros a los que lo agregan |

En cada tablero: **Administrador** (configura y gestiona miembros) · **Editor** (crea y mueve tarjetas) · **Comentarista** (comenta) · **Lector** (solo ve). Todos los permisos se validan en el servidor.

## Tecnologías

| Capa | Tecnología |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router) + TypeScript estricto |
| Interfaz | [shadcn/ui](https://ui.shadcn.com) (Radix) · Tailwind CSS v4 · [lucide-react](https://lucide.dev) · Plus Jakarta Sans |
| Interacción | [dnd-kit](https://dndkit.com) (drag & drop accesible) · [TipTap](https://tiptap.dev) (texto enriquecido) · [Recharts](https://recharts.org) · cmdk · [Mermaid](https://mermaid.js.org) |
| IA | [Claude](https://www.anthropic.com/claude) (Sonnet 5.5) con el SDK de Anthropic · salidas estructuradas validadas con Zod · herramientas con confirmación |
| Datos en cliente | TanStack Query |
| Base de datos | PostgreSQL ([Supabase](https://supabase.com)) · [Drizzle ORM](https://orm.drizzle.team) · migraciones SQL versionadas |
| Autenticación | JWT propio con [jose](https://github.com/panva/jose) (Ed25519) · Argon2id · TOTP (otplib) |
| Validación | Zod |
| Archivos | Supabase Storage (bucket privado) |
| Correo | SMTP (Nodemailer) |
| Tests | Vitest (integración contra Postgres real) · Playwright |
| CI/CD | GitHub Actions · Gitleaks · Semgrep · OSV-Scanner · Dependabot · Vercel |

## Arquitectura

```
Navegador (React, sin claves ni secretos)
   │  cookies HttpOnly
   ▼
proxy.ts ── CSP con nonce y headers de seguridad
   ▼
Next.js — monolito modular
   ├─ app/(auth), app/(app)          pantallas
   └─ app/api/v1/[...path]            API única → src/server/api/router.ts
          CSRF · autenticación · rate limit · validación · errores seguros
          └─ src/server/modules/*    auth · organizaciones · espacios · tableros · tarjetas · planificación
                                     mi trabajo · señales · entregas · integraciones · IA · asistente · estudio · cron
   ▼
PostgreSQL (esquema app + RLS)   Storage privado   SMTP   Vercel Cron   GitHub / GitLab API   Claude API
```

- **El navegador solo habla con la API propia.** La base de datos, el almacenamiento y el correo se usan exclusivamente desde el servidor.
- **Aislamiento entre organizaciones en capas:** autorización central, *Row-Level Security* de Postgres (cada request corre con un rol sin privilegios y el usuario en contexto) y claves foráneas compuestas por organización.
- **Una sola fuente de verdad para los permisos:** el rol efectivo en cada tablero lo resuelve una función SQL.

## Seguridad

- Contraseñas con Argon2id, bloqueo temporal tras intentos fallidos y mensajes que no revelan si una cuenta existe.
- Access token de 10 minutos y refresh token rotativo; reutilizar uno viejo revoca la sesión. Cerrar sesión o cambiar la contraseña invalida los tokens al instante.
- Protección CSRF (cookies `SameSite` + validación de `Origin`), CSP estricta, validación de toda entrada y texto enriquecido con lista blanca (sin HTML).
- Adjuntos validados por su contenido real, con tamaño máximo, nombres saneados, almacenamiento privado y descarga solo con permiso.
- Auditoría inmutable de eventos sensibles; los logs nunca guardan contraseñas, tokens ni cookies.
- **IA:** la clave vive solo en el servidor; los documentos, PRs y comentarios se tratan como datos (no como instrucciones); las respuestas se validan por esquema y se recortan; el asistente nunca cambia nada sin confirmación y actúa con los permisos de la persona; hay tope mensual por organización.
- Políticas de retención automáticas y CI que bloquea vulnerabilidades altas o críticas.

## Empezar en local

Requisitos: Node 22+, pnpm y Docker.

```bash
pnpm install
pnpm run setup:dev   # genera .env.local con claves nuevas, levanta Postgres y migra
pnpm dev             # http://localhost:3000
```

Para activar la IA, agregá `ANTHROPIC_API_KEY` a `.env.local` (sin clave, la app funciona igual y oculta esas funciones).

En desarrollo los correos (verificación, invitaciones, recuperación) se guardan en `.data/mail/` y los adjuntos en `.data/uploads/`.

```bash
pnpm test                    # tests de integración y unitarios (auth, aislamiento, permisos, kanban, GitHub, GitLab, IA…)
pnpm lint && pnpm typecheck && pnpm build
```

Las capturas de este README se regeneran con `scripts/screenshots.mts`.
