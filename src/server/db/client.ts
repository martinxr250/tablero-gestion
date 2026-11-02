import "server-only";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../core/env";
import * as schema from "./schema";

type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __faroSql?: postgres.Sql; __faroDb?: Db };

function getDb(): Db {
  if (!globalForDb.__faroDb) {
    // prepare:false es obligatorio con el pooler de Supabase en modo transacción.
    globalForDb.__faroSql = postgres(env().DATABASE_URL, {
      prepare: false,
      max: env().NODE_ENV === "production" ? 3 : 10,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
    globalForDb.__faroDb = drizzle(globalForDb.__faroSql, { schema });
  }
  return globalForDb.__faroDb;
}

/**
 * Ejecuta `fn` en una transacción como el usuario `userId`: rol app_rw (sujeto a RLS)
 * y app.user_id configurado. Toda operación iniciada por un usuario debe pasar por acá.
 */
export function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    await tx.execute(sql`set local role app_rw`);
    return fn(tx);
  });
}

/**
 * Transacción de sistema (dueño del esquema, sin RLS). Reservada para flujos sin usuario
 * autenticado o de bootstrap: login/registro, aceptar invitaciones, crear organización, cron.
 */
export function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(fn);
}

export async function closeDb() {
  await globalForDb.__faroSql?.end({ timeout: 5 });
  globalForDb.__faroSql = undefined;
  globalForDb.__faroDb = undefined;
}
