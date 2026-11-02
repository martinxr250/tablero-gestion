// Aplica las migraciones SQL de db/migrations en orden, una transacción por archivo.
// Registra nombre y checksum: si una migración ya aplicada cambia, falla en vez de seguir.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL (o MIGRATION_DATABASE_URL).");
  process.exit(1);
}

const dir = path.join(process.cwd(), "db", "migrations");
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

async function main() {
  await sql`create schema if not exists app`;
  await sql`
    create table if not exists app.schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`;
  await sql`alter table app.schema_migrations enable row level security`;

  const applied = new Map(
    (await sql<{ name: string; checksum: string }[]>`select name, checksum from app.schema_migrations`).map(
      (r) => [r.name, r.checksum],
    ),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const content = await readFile(path.join(dir, file), "utf8");
    const checksum = createHash("sha256").update(content).digest("hex");
    const previous = applied.get(file);
    if (previous) {
      if (previous !== checksum) throw new Error(`La migración ${file} cambió después de aplicarse.`);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`insert into app.schema_migrations (name, checksum) values (${file}, ${checksum})`;
    });
    console.log(`✓ ${file}`);
  }
  console.log("Migraciones al día.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
