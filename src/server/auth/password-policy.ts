import { z } from "zod";

const COMMON = new Set([
  "password", "password1", "password123", "1234567890", "12345678910", "qwertyuiop", "contraseña",
  "contrasena", "contraseña1", "iloveyou12", "abc1234567", "admin12345", "letmein123", "welcome123",
  "passw0rd12", "1q2w3e4r5t", "qwerty1234", "trustno1234", "superman12", "football12",
]);

export const passwordSchema = z
  .string()
  .min(10, "La contraseña debe tener al menos 10 caracteres")
  .max(128, "La contraseña no puede superar 128 caracteres")
  .refine((p) => !COMMON.has(p.toLowerCase()), "Esa contraseña es demasiado común")
  .refine((p) => new Set(p).size >= 5, "La contraseña es demasiado repetitiva");

export function passwordContainsEmail(password: string, email: string) {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return local.length >= 4 && password.toLowerCase().includes(local);
}
