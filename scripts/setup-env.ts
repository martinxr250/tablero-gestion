// Genera .env.local para desarrollo con claves nuevas (Ed25519 para JWT, AES-256 para MFA).
// No sobrescribe un archivo existente.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const target = process.argv[2] ?? ".env.local";
if (existsSync(target)) {
  console.log(`${target} ya existe; no se modifica.`);
  process.exit(0);
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const b64 = (s: string) => Buffer.from(s).toString("base64");
const priv = b64(privateKey.export({ type: "pkcs8", format: "pem" }).toString());
const pub = b64(publicKey.export({ type: "spki", format: "pem" }).toString());

const content = `# Generado por scripts/setup-env.ts — NO subir a git.
APP_URL=http://localhost:3000
DATABASE_URL=postgres://postgres:postgres@localhost:54329/faro
JWT_PRIVATE_KEY=${priv}
JWT_PUBLIC_KEY=${pub}
JWT_KID=dev-${randomBytes(4).toString("hex")}
ENCRYPTION_KEY=${randomBytes(32).toString("base64")}
IP_HASH_SECRET=${randomBytes(32).toString("base64url")}
CRON_SECRET=${randomBytes(32).toString("base64url")}
STORAGE_DRIVER=local
MAIL_DRIVER=file
MAIL_FROM="Tableros <no-reply@localhost>"
`;
writeFileSync(target, content, { mode: 0o600 });
console.log(`✓ ${target} creado.`);
