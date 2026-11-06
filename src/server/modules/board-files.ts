import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { route } from "../api/router";
import { audit } from "../core/audit";
import { forbidden, notFound } from "../core/errors";
import { uuidv7 } from "../core/ids";
import { withUser } from "../db/client";
import { boardFiles, users } from "../db/schema";
import { storage } from "../storage/storage";
import { AI_READABLE } from "../ai/content";
import { boardAccess } from "./access";
import { downloadResponse, IMAGE_TYPES, MAX_ATTACHMENT_BYTES, PREVIEW_TYPES, validateUpload } from "./files";
import { logActivity } from "./shared";

const MAX_FILES_PER_BOARD = 200;

/** Archivo del tablero visible para la persona (mismo acceso que el tablero). */
export async function boardFileFor(userId: string, fileId: string, action: "view" | "edit") {
  return withUser(userId, async (tx) => {
    if (!z.uuid().safeParse(fileId).success) throw notFound("Archivo");
    const [file] = await tx.select().from(boardFiles).where(eq(boardFiles.id, fileId));
    if (!file) throw notFound("Archivo");
    const access = await boardAccess(tx, { actorId: userId }, file.boardId, action);
    return { file, ...access };
  });
}

export const boardFileRoutes = [
  route({
    method: "GET",
    path: "/boards/:boardId/files",
    summary: "Archivos del tablero (PDF, imágenes, documentos)",
    tag: "Archivos",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, { actorId: me.id }, params.boardId, "view", { allowArchived: true });
        const rows = await tx
          .select({ file: boardFiles, uploader: users.name })
          .from(boardFiles)
          .leftJoin(users, eq(users.id, boardFiles.uploaderId))
          .where(eq(boardFiles.boardId, board.id))
          .orderBy(desc(boardFiles.createdAt));
        return {
          files: rows.map(({ file: f, uploader }) => ({
            id: f.id,
            fileName: f.fileName,
            mime: f.mime,
            sizeBytes: f.sizeBytes,
            uploaderName: uploader,
            createdAt: f.createdAt,
            isImage: IMAGE_TYPES.has(f.mime),
            canPreview: PREVIEW_TYPES.has(f.mime),
            aiReadable: AI_READABLE.has(f.mime),
            aiSummary: f.aiSummary,
            aiSummaryAt: f.aiSummaryAt,
          })),
        };
      }),
  }),

  route({
    method: "POST",
    path: "/boards/:boardId/files",
    summary: "Subir un archivo al tablero (máx. 4 MB; tipo validado por contenido)",
    tag: "Archivos",
    status: 201,
    multipart: true,
    rateLimit: [{ name: "upload", by: "user", limit: 30, windowSec: 3600 }],
    handler: async ({ me, params, form, audit: actx }) => {
      // Primero se autoriza; recién después se lee el archivo.
      const { board } = await withUser(me.id, (tx) => boardAccess(tx, actx, params.boardId, "edit"));
      const count = await withUser(me.id, (tx) => tx.$count(boardFiles, eq(boardFiles.boardId, board.id)));
      if (count >= MAX_FILES_PER_BOARD) throw forbidden(`El tablero ya tiene ${MAX_FILES_PER_BOARD} archivos`);
      const file = await validateUpload(form?.get("file") ?? null, { maxBytes: MAX_ATTACHMENT_BYTES });
      const id = uuidv7();
      const key = `${board.orgId}/boards/${board.id}/${id}`;
      await storage().put(key, file.bytes, file.mime);
      try {
        await withUser(me.id, async (tx) => {
          await boardAccess(tx, actx, board.id, "edit");
          await tx.insert(boardFiles).values({ id, orgId: board.orgId, boardId: board.id, uploaderId: me.id, storageKey: key, fileName: file.name, mime: file.mime, sizeBytes: file.size, sha256: file.sha256 });
          await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "board_file.added", data: { file: file.name } });
        });
      } catch (err) {
        await storage().remove([key]).catch(() => {});
        throw err;
      }
      return { id, aiReadable: AI_READABLE.has(file.mime) };
    },
  }),

  route({
    method: "GET",
    path: "/board-files/:fileId/download",
    summary: "Descargar o ver un archivo del tablero",
    tag: "Archivos",
    query: z.object({ inline: z.enum(["1"]).optional() }),
    handler: async ({ me, params, query }) => {
      const { file } = await boardFileFor(me.id, params.fileId, "view");
      const bytes = await storage().get(file.storageKey);
      return downloadResponse(bytes, file.mime, file.fileName, query.inline === "1" && PREVIEW_TYPES.has(file.mime));
    },
  }),

  route({
    method: "DELETE",
    path: "/board-files/:fileId",
    summary: "Eliminar un archivo del tablero",
    tag: "Archivos",
    handler: async ({ me, params, audit: actx }) => {
      const { file, board } = await boardFileFor(me.id, params.fileId, "edit");
      await withUser(me.id, async (tx) => {
        await tx.delete(boardFiles).where(and(eq(boardFiles.id, file.id), eq(boardFiles.boardId, board.id)));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "board_file.deleted", data: { file: file.fileName } });
        await audit(tx, actx, "board_file.deleted", { orgId: board.orgId, targetType: "board", targetId: board.id, data: { file: file.fileName } });
      });
      // El objeto en el almacenamiento lo borra la tarea diaria (disparador board_files_gc).
      return undefined;
    },
  }),
];
