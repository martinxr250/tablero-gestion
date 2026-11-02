export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const COMMON = new Set([
  "password", "password1", "password123", "1234567890", "12345678910", "qwertyuiop", "contraseña",
  "contrasena", "contraseña1", "iloveyou12", "abc1234567", "admin12345", "letmein123", "welcome123",
  "passw0rd12", "1q2w3e4r5t", "qwerty1234", "trustno1234", "superman12", "football12",
]);

export const PASSWORD_RULES = [
  { id: "length", label: "8 a 128 caracteres", message: "Usá entre 8 y 128 caracteres", test: (p: string) => p.length >= PASSWORD_MIN_LENGTH && p.length <= PASSWORD_MAX_LENGTH },
  { id: "uppercase", label: "Una mayúscula", message: "Agregá al menos una mayúscula", test: (p: string) => /\p{Lu}/u.test(p) },
  { id: "lowercase", label: "Una minúscula", message: "Agregá al menos una minúscula", test: (p: string) => /\p{Ll}/u.test(p) },
  { id: "number", label: "Un número", message: "Agregá al menos un número", test: (p: string) => /[0-9]/.test(p) },
  { id: "common", label: "Sin claves comunes", message: "Esa contraseña es demasiado común", test: (p: string) => !COMMON.has(p.toLowerCase()) },
  { id: "variety", label: "5 caracteres únicos", message: "La contraseña es demasiado repetitiva", test: (p: string) => new Set(p).size >= 5 },
] as const;

export function passwordContainsEmail(password: string, email: string) {
  const local = email.trim().split("@")[0]?.toLowerCase() ?? "";
  return local.length >= 4 && password.toLowerCase().includes(local);
}
