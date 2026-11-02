import "server-only";
import { hash, verify } from "@node-rs/argon2";

// Parámetros Argon2id recomendados por OWASP (m=19 MiB, t=2, p=1).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 as const };

export const hashPassword = (password: string) => hash(password, OPTIONS);

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  try {
    return await verify(hashValue, password);
  } catch {
    return false;
  }
}

// Hash fijo para igualar tiempos cuando el usuario no existe (evita enumeración por timing).
let dummy: Promise<string> | undefined;
export async function burnPasswordCheck(password: string) {
  dummy ??= hashPassword("faro-dummy-password-for-timing");
  await verifyPassword(await dummy, password);
}
