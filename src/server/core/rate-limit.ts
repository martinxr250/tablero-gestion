import "server-only";
import { sql } from "drizzle-orm";
import { withSystem } from "../db/client";
import { tooManyRequests } from "./errors";

/** Ventana fija en Postgres (sin servicios extra). Lanza 429 si se supera el límite. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<void> {
  const rows = await withSystem((tx) =>
    tx.execute<{ count: number; window_start: string }>(sql`
      insert into app.rate_limits as r (key, window_start, count)
      values (${key}, to_timestamp(floor(extract(epoch from now()) / ${windowSec}) * ${windowSec}), 1)
      on conflict (key) do update set
        count = case when r.window_start = excluded.window_start then r.count + 1 else 1 end,
        window_start = excluded.window_start
      returning count, window_start`),
  );
  const row = rows[0];
  if (row && row.count > limit) {
    const reset = new Date(row.window_start).getTime() + windowSec * 1000;
    throw tooManyRequests(Math.max(1, Math.ceil((reset - Date.now()) / 1000)));
  }
}
