import { describe, expect, it } from "vitest";
import { PASSWORD_RULES, passwordContainsEmail } from "@/lib/password-policy";
import { passwordSchema } from "@/server/auth/password-policy";

describe("contraseñas compartidas entre registro y servidor", () => {
  it("acepta el mínimo de ocho caracteres con mayúscula, minúscula y número", () => {
    expect(passwordSchema.safeParse("Roca7sol").success).toBe(true);
  });
  it.each(["Roca7so", "roca7sol", "ROCA7SOL", "Rocasdel", "Password1", "A1aaaaaa"])("rechaza requisitos ausentes o claves débiles: %s", (value) => {
    expect(passwordSchema.safeParse(value).success).toBe(false);
    expect(PASSWORD_RULES.every((rule) => rule.test(value))).toBe(false);
  });
  it("admite mayúsculas y minúsculas con acentos", () => {
    expect(passwordSchema.safeParse("Árbol7té").success).toBe(true);
  });
  it("respeta el límite superior", () => {
    expect(passwordSchema.safeParse("Roca7sol" + "x".repeat(120)).success).toBe(true);
    expect(passwordSchema.safeParse("Roca7sol" + "x".repeat(121)).success).toBe(false);
  });
  it("detecta el correo sin distinguir mayúsculas y respeta locales cortos", () => {
    expect(passwordContainsEmail("EquipoCARLOS7", " carlos@example.com ")).toBe(true);
    expect(passwordContainsEmail("Roca7sol", "ana@example.com")).toBe(false);
  });
  it.each(["Roca7sol", "Árbol7té", "Password1", "roca7sol", "Rocasdel", "A1aaaaaa"])("coinciden los indicadores de interfaz y el servidor para %s", (value) => {
    expect(PASSWORD_RULES.every((rule) => rule.test(value))).toBe(passwordSchema.safeParse(value).success);
  });
});
