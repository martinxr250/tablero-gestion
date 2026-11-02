import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

// Recrea la base de test desde cero y aplica las mismas migraciones que producción.
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/faro_test";
  const admin = postgres(url.replace(/\/[^/]+$/, "/postgres"), { max: 1, onnotice: () => {} });
  const dbName = new URL(url).pathname.slice(1);
  await admin.unsafe(`drop database if exists ${dbName} with (force)`);
  await admin.unsafe(`create database ${dbName}`);
  await admin.end();
  execFileSync("npx", ["tsx", "scripts/migrate.ts"], { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
  rmSync(path.join(process.cwd(), ".data", "mail"), { recursive: true, force: true });
}
