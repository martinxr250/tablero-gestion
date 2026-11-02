import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withSystem } from "@/server/db/client";
import { Client, mailsTo, newUser, tokenFromLastMail, totp } from "../helpers";

describe("registro, verificación e inicio de sesión", () => {
  it("no permite iniciar sesión sin verificar el correo", async () => {
    const c = new Client();
    const email = `noverif-${Date.now()}@example.test`;
    expect((await c.post("/auth/register", { email, name: "Ana", password: "una-clave-larga-y-segura" })).status).toBe(202);
    const r = await c.post("/auth/login", { email, password: "una-clave-larga-y-segura" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("email_not_verified");
  });

  it("responde igual si el correo ya existe (sin enumeración) y avisa por correo", async () => {
    const u = await newUser();
    const c = new Client();
    const r = await c.post("/auth/register", { email: u.email, name: "Otro", password: "otra-clave-bien-larga" });
    expect(r.status).toBe(202);
    expect(mailsTo(u.email).some((m) => m.subject.includes("Intento de registro"))).toBe(true);
  });

  it("rechaza contraseñas débiles", async () => {
    const r = await new Client().post("/auth/register", { email: `weak-${Date.now()}@example.test`, name: "X", password: "password123" });
    expect(r.status).toBe(400);
  });

  it("usa un error genérico para usuario inexistente o contraseña incorrecta", async () => {
    const u = await newUser();
    const a = await new Client().post("/auth/login", { email: u.email, password: "incorrecta-1234" });
    const b = await new Client().post("/auth/login", { email: "nadie@example.test", password: "incorrecta-1234" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it("bloquea la cuenta tras 5 intentos fallidos", async () => {
    const u = await newUser();
    const c = new Client();
    for (let i = 0; i < 5; i++) await c.post("/auth/login", { email: u.email, password: `mal-${i}-xxxxxxx` });
    const r = await c.post("/auth/login", { email: u.email, password: u.password });
    expect(r.status).toBe(423);
  });

  it("las cookies de sesión son HttpOnly y SameSite", async () => {
    const u = await newUser();
    const c = new Client();
    const r = await c.req("POST", "/auth/login", { email: u.email, password: u.password });
    const cookies = r.headers.getSetCookie().join("\n");
    expect(cookies).toMatch(/faro_at=.+HttpOnly; SameSite=Lax/);
    expect(cookies).toMatch(/faro_rt=.+HttpOnly; SameSite=Lax/);
    expect(r.body).not.toHaveProperty("accessToken");
  });
});

describe("sesiones", () => {
  it("rota el refresh token y detecta su reutilización", async () => {
    const u = await newUser();
    const oldRefresh = [...u.cookies].find(([k]) => k.endsWith("faro_rt"))![1];
    expect((await u.post("/auth/refresh")).status).toBe(204);
    const newRefresh = [...u.cookies].find(([k]) => k.endsWith("faro_rt"))![1];
    expect(newRefresh).not.toBe(oldRefresh);

    // Fuera de la ventana de gracia, reutilizar el refresh viejo revoca la sesión.
    await withSystem((tx) => tx.execute(sql`update app.sessions set rotated_at = now() - interval '1 minute' where user_id = ${u.id}`));
    const attacker = new Client();
    attacker.cookies.set("faro_rt", oldRefresh);
    expect((await attacker.post("/auth/refresh")).status).toBe(401);
    expect((await u.get("/me")).status).toBe(401);
  });

  it("revoca inmediatamente el access token al cerrar sesión", async () => {
    const u = await newUser();
    const stolen = new Client();
    stolen.cookies = new Map(u.cookies);
    expect((await u.post("/auth/logout")).status).toBe(204);
    expect((await stolen.get("/me")).status).toBe(401);
  });

  it("cerrar todas las sesiones invalida las otras", async () => {
    const u = await newUser();
    const other = new Client();
    await other.post("/auth/login", { email: u.email, password: u.password });
    expect((await other.get("/me")).status).toBe(200);
    expect((await u.post("/auth/logout-all")).status).toBe(204);
    expect((await other.get("/me")).status).toBe(401);
  });

  it("restablecer la contraseña revoca las sesiones abiertas", async () => {
    const u = await newUser();
    await new Client().post("/auth/forgot-password", { email: u.email });
    const token = tokenFromLastMail(u.email, "reset-password");
    const r = await new Client().post("/auth/reset-password", { token, password: "nueva-clave-mucho-mejor" });
    expect(r.status).toBe(200);
    expect((await u.get("/me")).status).toBe(401);
    // el token es de un solo uso
    expect((await new Client().post("/auth/reset-password", { token, password: "otra-clave-mucho-mejor" })).status).toBe(400);
    expect((await new Client().post("/auth/login", { email: u.email, password: "nueva-clave-mucho-mejor" })).status).toBe(200);
  });
});

describe("MFA (TOTP)", () => {
  it("exige el segundo factor y acepta códigos de recuperación una sola vez", async () => {
    const u = await newUser();
    const setup = await u.post("/me/mfa/setup");
    expect(setup.status).toBe(200);
    const enable = await u.post("/me/mfa/enable", { code: await totp(setup.body.secret) });
    expect(enable.status).toBe(200);
    const codes: string[] = enable.body.recoveryCodes;
    expect(codes).toHaveLength(10);

    const c = new Client();
    const step1 = await c.post("/auth/login", { email: u.email, password: u.password });
    expect(step1.body.status).toBe("mfa_required");
    expect((await c.get("/me")).status).toBe(401);
    expect((await c.post("/auth/mfa", { code: "000000" })).status).toBe(401);
    expect((await c.post("/auth/mfa", { code: await totp(setup.body.secret) })).status).toBe(200);
    expect((await c.get("/me")).status).toBe(200);

    const d = new Client();
    await d.post("/auth/login", { email: u.email, password: u.password });
    expect((await d.post("/auth/mfa", { code: codes[0] })).status).toBe(200);
    const e = new Client();
    await e.post("/auth/login", { email: u.email, password: u.password });
    expect((await e.post("/auth/mfa", { code: codes[0] })).status).toBe(401);
  });
});

describe("protecciones del router", () => {
  it("rechaza mutaciones sin Origin o de otro origen (CSRF)", async () => {
    const u = await newUser();
    expect((await u.req("POST", "/orgs", { name: "X" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await u.req("POST", "/orgs", { name: "X" }, { origin: null })).status).toBe(403);
  });

  it("no expone rutas inexistentes ni ids mal formados", async () => {
    const u = await newUser();
    expect((await u.get("/boards/not-a-uuid")).status).toBe(404);
    expect((await u.get("/nope")).status).toBe(404);
  });

  it("valida la entrada con mensajes claros", async () => {
    const u = await newUser();
    const r = await u.post("/orgs", { name: "" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("validation_error");
  });

  it("el cron exige el secreto", async () => {
    const c = new Client();
    expect((await c.get("/cron/daily")).status).toBe(401);
    const ok = await c.req("GET", "/cron/daily", undefined, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(ok.status).toBe(200);
  });

  it("publica el documento OpenAPI", async () => {
    const r = await new Client().get("/openapi.json");
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.paths).length).toBeGreaterThan(50);
  });
});
