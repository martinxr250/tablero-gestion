// Genera las capturas de docs/screenshots a partir de la app corriendo en local.
// Uso: SHOT_EMAIL=... SHOT_PASSWORD=... SHOT_BOARD=<id> pnpm tsx scripts/screenshots.mts
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.SHOT_BASE ?? "http://localhost:3000";
const { SHOT_EMAIL: email, SHOT_PASSWORD: password, SHOT_BOARD: boardId } = process.env;
if (!email || !password || !boardId) {
  console.error("Definí SHOT_EMAIL, SHOT_PASSWORD y SHOT_BOARD.");
  process.exit(1);
}
const out = (name: string) => `docs/screenshots/${name}.png`;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  // Oculta el indicador de desarrollo de Next.js.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForTimeout(600);
}

const browser = await chromium.launch();
for (const scheme of ["light", "dark"] as const) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await settle(page);
  if (scheme === "light") await page.screenshot({ path: out("login") });
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/dashboard");
  await page.evaluate((s) => localStorage.setItem("theme", s), scheme);

  await page.goto(`${BASE}/b/${boardId}`);
  await settle(page);
  await page.screenshot({ path: out(scheme === "light" ? "board" : "board-dark") });

  if (scheme === "light") {
    await page.getByRole("button", { name: "Diseñar piezas para Instagram" }).click();
    await page.getByRole("dialog").waitFor();
    await settle(page);
    await page.screenshot({ path: out("card") });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Actividad" }).click();
    await page.getByRole("dialog").waitFor();
    await settle(page);
    await page.screenshot({ path: out("activity") });
    await page.keyboard.press("Escape");

    await page.goto(`${BASE}/dashboard`);
    await settle(page);
    await page.screenshot({ path: out("dashboard") });

    await page.goto(`${BASE}/search?assigneeId=me`);
    await settle(page);
    await page.screenshot({ path: out("search") });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/b/${boardId}`);
    await settle(page);
    await page.screenshot({ path: out("mobile") });
  }
  await ctx.close();
}
await browser.close();
console.log("Capturas listas en docs/screenshots/");
