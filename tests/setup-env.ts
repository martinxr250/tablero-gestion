import { generateKeyPairSync, randomBytes } from "node:crypto";

// Entorno de test aislado: base faro_test, correo y archivos en disco, claves efímeras.
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const b64 = (s: string) => Buffer.from(s).toString("base64");

Object.assign(process.env, {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/faro_test",
  JWT_PRIVATE_KEY: b64(privateKey.export({ type: "pkcs8", format: "pem" }).toString()),
  JWT_PUBLIC_KEY: b64(publicKey.export({ type: "spki", format: "pem" }).toString()),
  JWT_KID: "test",
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  IP_HASH_SECRET: randomBytes(32).toString("base64url"),
  CRON_SECRET: randomBytes(32).toString("base64url"),
  STORAGE_DRIVER: "local",
  MAIL_DRIVER: "file",
});
