import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { E2E_DATABASE_URL } from "../playwright.config";

/** Base aislada para E2E: se crea si no existe y se aplican las migraciones. */
export default async function globalSetup() {
  const url = new URL(E2E_DATABASE_URL);
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes("e2e")) throw new Error("La base de E2E debe llamarse *e2e*");
  const admin = postgres({ ...parse(url), database: "postgres", max: 1 });
  const [exists] = await admin`select 1 from pg_database where datname = ${name}`;
  if (!exists) await admin.unsafe(`create database ${name}`);
  await admin.end();
  execFileSync("node", ["--import", "tsx", "scripts/migrate.ts"], { stdio: "inherit", env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, MIGRATION_DATABASE_URL: E2E_DATABASE_URL } });
  // Corridas repetidas registran varias personas desde la misma IP: se reinician los límites
  // (solo en esta base aislada; el límite real sigue activo en la app).
  const db = postgres(E2E_DATABASE_URL, { max: 1 });
  await db`delete from app.rate_limits`;
  await db.end();
}

function parse(url: URL) {
  return { host: url.hostname, port: Number(url.port || 5432), username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
}
