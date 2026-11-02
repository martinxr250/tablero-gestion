# Evolución: Planificación → Desarrollo → Revisión → Aprobación → Entrega

Documento de trabajo de la evolución "Gestión inteligente de proyectos y entregas".
Regla aplicada: **reutilizar → extender → mejorar → crear**.

## Fase 1 · Auditoría (estado verificado en el código)

| Requerimiento | Estado | Dónde está hoy |
|---|---|---|
| Mi trabajo (vista global) | **EXTENDER** | `src/server/modules/work.ts` (`GET /me/work`), `src/components/work/my-work.tsx`, ruta `/work` en la navegación. Agrupa por vencimiento; faltan secciones por estado (en progreso, bloqueadas, esperando revisión, completadas), etapa, revisión pendiente, orden y agrupación. |
| Vincular repositorio a tablero | **EXISTENTE** | `board_repos` (uno por tablero), `vcs_connections` con token cifrado AES-GCM, `/boards/:id/repo`. Se usa token personal *fine-grained*; ver "GitHub App" en limitaciones. |
| Tarjeta ↔ issue | **EXTENDER** | `card_issue_links` + `createIssueForCard`. Falta **vincular un issue existente** por número. |
| Tarjeta ↔ PR / rama / commit | **EXTENDER** | `card_dev_refs` (kind pr/branch/commit, checks, revisión, merge). Hoy solo vínculo automático por `#N` del issue o rama `N-algo`. Falta **vínculo manual de PR** y desvincular. |
| Webhooks firmados, HMAC, idempotencia | **EXISTENTE** | `/webhooks/github/:boardRepoId`, `webhook_deliveries` (deduplicación por `X-GitHub-Delivery`). |
| Eventos fuera de orden | **MEJORAR** | Issues: protegido por huella (`synced_hash`). PRs: `syncPull` sobrescribe sin comparar `remote_updated_at`. |
| Bucles de sincronización y conflictos | **EXISTENTE** | huellas local/remota, `pending_push`, `conflict`, `/cards/:id/issue/resolve`. |
| Reconciliación periódica/manual | **EXISTENTE** | `syncRepo` (`/boards/:id/repo/sync` y sondeo). |
| `check_run` y revisión solicitada | **MEJORAR** | Solo `check_suite`; `pull_request_review` se procesa pero no avisa a nadie. |
| Estado de desarrollo en la tarjeta | **EXTENDER** | `src/components/board/dev-panel.tsx` muestra PRs; faltan resumen (aprobado / fusionado / checks), vínculo manual y aclarar que fusionado ≠ desplegado. |
| QA antes de terminar | **EXISTENTE** | `boards.qa_required/qa_list_id/done_list_id`, `cards.qa_status`, `assertCanComplete`, `/cards/:id/qa`. |
| Reglas configurables de cierre | **NUEVA (extiende QA)** | Se agrega `boards.completion_rules` y se evalúa dentro del mismo `assertCanComplete`. |
| Estado de entrega | **NUEVA (derivada)** | Se calcula; no se guarda ni reemplaza las columnas Kanban. |
| Dependencias y bloqueo | **EXTENDER** | `card_relations` tipo `blocks`, indicador `blocked` en tarjetas. Falta evitar **ciclos**, bloqueos en cadena y tareas críticas. |
| Riesgo de etapas | **NUEVA** | Etapas (`sprints`) con capacidad ya existen; falta el cálculo explicado. |
| Capacidad por persona | **NUEVA** | No existe; se agrega tabla `board_capacity`. |
| Panel del líder | **EXTENDER** | `src/server/modules/insights.ts` + `views/insights-view.tsx` (carga, PRs en revisión, bloqueadas, QA, etapa activa). |
| Notificaciones | **EXTENDER** | `notify()` en `shared.ts`, tabla `notifications`, campana. Sin preferencias ni deduplicación. |
| Historial de actividad | **EXISTENTE** | `activity_logs` por tablero y tarjeta, `audit_logs`. |

## Fase 2 · Diseño técnico

### Migración `0009_delivery.sql` (aditiva, sin borrar datos)
- `boards.completion_rules jsonb default '{}'`: por regla `off | warn | block`.
- `board_capacity (org_id, board_id, user_id, points)`: capacidad por integrante y por etapa, con RLS por organización.
- `card_dev_refs.linked_manually boolean default false`: distingue vínculos manuales de automáticos.
- `notifications.dedupe_key` + índice único parcial `(user_id, dedupe_key)`: avisos sin duplicados.
- `notification_settings (user_id, muted text[])`: preferencias, con RLS propia de cada persona.

### Reglas de cierre (servidor)
`evaluateCompletion` en `src/server/modules/delivery.ts`. Reglas: subtareas, dependencias,
checklists, PR aprobado, CI exitosa, PR fusionado y QA (esta última sigue usando `qa_required`).
- Las reglas de GitHub **solo aplican si la tarjeta tiene PR vinculados**: los tableros
  administrativos no las sufren.
- Si la última sincronización del repositorio falló, las reglas de GitHub bajan a
  **advertencia** con la explicación, para no bloquear por una caída temporal de GitHub.
- Completar una tarjeta (PATCH, aprobar QA o mover a la lista final) evalúa las reglas y
  responde `409 completion_blocked` con el detalle. La transición queda en auditoría con
  las reglas evaluadas.

### Estado de entrega (derivado)
Terminada > Bloqueada > Lista para entrega (QA aprobada o PR fusionado sin bloqueos) >
En revisión (QA pendiente o PR abierto) > En desarrollo (rama o PR) > Pendiente.
Un PR fusionado **no** marca la tarea como terminada.

### Fuente de verdad por campo (sin cambios)
- Título, descripción, estado abierto/cerrado, etiquetas y responsable: bidireccional, con huellas y conflictos.
- PR, rama, checks, revisión y merge: **GitHub** (solo lectura en Tableros).
- Prioridad, etapa, puntos y campos personalizados: **Tableros** (no se sincronizan).

### Indicadores (sin IA, explicados)
- Bloqueo en cadena: profundidad de la cadena de `blocks` sin resolver.
- Críticas: tareas abiertas que bloquean a 2 o más.
- Ciclos: se rechazan al crear la relación y se informan si ya existían.
- Riesgo de etapa: puntos restantes contra días restantes y ritmo histórico de etapas
  cerradas, o capacidad si no hay historial. Sin estimaciones muestra "Información insuficiente".
- Sobrecarga: puntos abiertos en la etapa activa contra capacidad configurada. Las tareas
  sin estimación se cuentan aparte.

### Avisos nuevos
`card.blocked`, `dependency.resolved`, `pr.review_requested`, `ci.failed`, `sprint.risk`
(más los existentes `card.assigned`, `qa.requested` y `qa.rejected`). Todos deduplicados
y desactivables desde Ajustes. No se envían correos por eventos de sincronización.
