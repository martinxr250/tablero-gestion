import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { env } from "../core/env";
import { withSystem } from "../db/client";

export interface ObjectStorage {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  remove(keys: string[]): Promise<void>;
}

const KEY_RE = /^[a-zA-Z0-9/_-]+$/;
function assertKey(key: string) {
  if (!KEY_RE.test(key) || key.includes("..")) throw new Error("Clave de almacenamiento inválida");
}

/** Solo desarrollo y tests: guarda en .data/uploads (fuera de /public). */
class LocalStorage implements ObjectStorage {
  private root = path.join(process.cwd(), ".data", "uploads");
  async put(key: string, data: Uint8Array) {
    assertKey(key);
    const file = path.join(this.root, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, { mode: 0o600 });
  }
  async get(key: string) {
    assertKey(key);
    return new Uint8Array(await readFile(path.join(this.root, key)));
  }
  async remove(keys: string[]) {
    for (const key of keys) {
      assertKey(key);
      await rm(path.join(this.root, key), { force: true });
    }
  }
}

/** Supabase Storage (bucket privado) vía REST, solo desde el servidor con la service key. */
class SupabaseStorage implements ObjectStorage {
  private base: string;
  private bucket: string;
  private key: string;
  constructor() {
    const e = env();
    this.base = `${e.SUPABASE_URL!.replace(/\/$/, "")}/storage/v1`;
    this.bucket = e.SUPABASE_BUCKET;
    this.key = e.SUPABASE_SERVICE_ROLE_KEY!;
  }
  private headers(extra: Record<string, string> = {}) {
    const h: Record<string, string> = { apikey: this.key, ...extra };
    // Las claves legacy (JWT) también van como Bearer; las nuevas sb_secret_ solo en apikey.
    if (this.key.startsWith("eyJ")) h.Authorization = `Bearer ${this.key}`;
    return h;
  }
  async put(key: string, data: Uint8Array, contentType: string) {
    assertKey(key);
    const res = await fetch(`${this.base}/object/${this.bucket}/${key}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": contentType, "x-upsert": "false", "Cache-Control": "private, max-age=0" }),
      body: Buffer.from(data),
    });
    if (!res.ok) throw new Error(`Storage put falló (${res.status})`);
  }
  async get(key: string) {
    assertKey(key);
    const res = await fetch(`${this.base}/object/authenticated/${this.bucket}/${key}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Storage get falló (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async remove(keys: string[]) {
    if (keys.length === 0) return;
    keys.forEach(assertKey);
    const res = await fetch(`${this.base}/object/${this.bucket}`, {
      method: "DELETE",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: keys }),
    });
    if (!res.ok) throw new Error(`Storage delete falló (${res.status})`);
  }
}

/** Dentro de Postgres (tabla app.file_blobs): suficiente para equipos chicos y sin claves extra. */
class DatabaseStorage implements ObjectStorage {
  async put(key: string, data: Uint8Array, contentType: string) {
    assertKey(key);
    await withSystem((tx) => tx.execute(sql`insert into app.file_blobs (key, content_type, data) values (${key}, ${contentType}, ${Buffer.from(data)})`));
  }
  async get(key: string) {
    assertKey(key);
    const rows = await withSystem((tx) => tx.execute<{ data: Buffer }>(sql`select data from app.file_blobs where key = ${key}`));
    const row = rows[0];
    if (!row) throw new Error("Storage get falló (404)");
    return new Uint8Array(row.data);
  }
  async remove(keys: string[]) {
    if (keys.length === 0) return;
    keys.forEach(assertKey);
    await withSystem((tx) => tx.execute(sql`delete from app.file_blobs where key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`));
  }
}

let instance: ObjectStorage | undefined;
export function storage(): ObjectStorage {
  const driver = env().STORAGE_DRIVER;
  instance ??= driver === "supabase" ? new SupabaseStorage() : driver === "database" ? new DatabaseStorage() : new LocalStorage();
  return instance;
}
