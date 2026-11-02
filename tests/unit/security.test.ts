import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/server/core/crypto";
import { canBoard } from "@/server/modules/access";
import { extractMentions } from "@/server/modules/cards";
import { safeFileName } from "@/server/modules/files";
import { sanitizeRichText } from "@/server/modules/richtext";
import { passwordSchema } from "@/server/auth/password-policy";

describe("utilidades de seguridad", () => {
  it("cifra y descifra con AES-GCM y detecta manipulación", () => {
    const enc = encrypt("secreto");
    expect(decrypt(enc)).toBe("secreto");
    const parts = enc.split(".");
    parts[3] = Buffer.from("otro").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });

  it("sanea nombres de archivo", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("..\\win\\a<b>.txt")).toBe("ab.txt");
    expect(safeFileName("\u0000")).toBe("archivo");
    expect(safeFileName("a".repeat(300) + ".pdf").length).toBe(150);
  });

  it("valida el texto enriquecido con lista blanca", () => {
    expect(() => sanitizeRichText({ type: "doc", content: [{ type: "script" }] })).toThrow();
    expect(() => sanitizeRichText({ type: "doc", content: [{ type: "image", attrs: { src: "x" } }] })).toThrow();
    const { json, text } = sanitizeRichText({
      type: "doc",
      content: [{ type: "heading", attrs: { level: 9, onclick: "x" }, content: [{ type: "text", text: "Título" }] }],
    });
    expect(json).toEqual({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Título" }] }] });
    expect(text).toBe("Título");
  });

  it("extrae menciones", () => {
    const id = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    expect(extractMentions(`hola @[Ana](${id}) y @[Ana](${id})`)).toEqual([id]);
    expect(extractMentions("sin menciones @Ana")).toEqual([]);
  });

  it("matriz de permisos de tablero", () => {
    expect(canBoard("viewer", "view")).toBe(true);
    expect(canBoard("viewer", "comment")).toBe(false);
    expect(canBoard("commenter", "comment")).toBe(true);
    expect(canBoard("commenter", "edit")).toBe(false);
    expect(canBoard("editor", "edit")).toBe(true);
    expect(canBoard("editor", "manage")).toBe(false);
    expect(canBoard("admin", "manage")).toBe(true);
    expect(canBoard(null, "view")).toBe(false);
  });

  it("política de contraseñas", () => {
    expect(passwordSchema.safeParse("corta").success).toBe(false);
    expect(passwordSchema.safeParse("password123").success).toBe(false);
    expect(passwordSchema.safeParse("aaaaaaaaaaaa").success).toBe(false);
    expect(passwordSchema.safeParse("Caballo-bateria-grapa7").success).toBe(true);
  });
});
