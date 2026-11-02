import { expect, test } from "@playwright/test";
import { newSession, seedBoard } from "./helpers";

// Escenarios end-to-end con sesiones simultáneas e independientes (un contexto de navegador por persona).

test("dos personas de la misma organización ven los cambios de la otra en el tablero", async ({ browser }) => {
  const ana = await newSession(browser, "Ana E2E");
  const beto = await newSession(browser, "Beto E2E");
  const s = await seedBoard(ana, "Tablero compartido");
  const inv = await ana.api("POST", `/boards/${s.boardId}/invitations`, { email: beto.email, role: "editor" });
  expect(inv.status).toBe(201);
  // Beto acepta la invitación desde el enlace del correo, en su propia sesión.
  const { readdirSync, readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const dir = path.join(process.cwd(), ".data", "mail");
  const mail = readdirSync(dir).sort().map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8"))).filter((m: { to: string }) => m.to === beto.email).at(-1);
  const token = decodeURIComponent(mail.text.match(/\/invite\?token=([A-Za-z0-9_%-]+)/)[1]);
  expect((await beto.api("POST", "/invitations/accept", { token })).status).toBe(200);

  await Promise.all([ana.page.goto(`/b/${s.boardId}`), beto.page.goto(`/b/${s.boardId}`)]);
  // Ambos ven el tablero cargado (la primera columna de la plantilla).
  await expect(ana.page.getByRole("region", { name: "Por hacer" })).toBeVisible();
  await expect(beto.page.getByRole("region", { name: "Por hacer" })).toBeVisible();

  // Ana crea una tarjeta desde la interfaz.
  await ana.page.getByRole("button", { name: /Agregar tarjeta/ }).first().click();
  await ana.page.getByLabel("Título de la nueva tarjeta").fill("Creada por Ana");
  await ana.page.getByLabel("Título de la nueva tarjeta").press("Enter");
  await expect(ana.page.getByRole("button", { name: "Creada por Ana" })).toBeVisible();

  // Beto la ve sin recargar (sondeo de cambios), y su edición llega a Ana.
  await expect(beto.page.getByRole("button", { name: "Creada por Ana" })).toBeVisible();
  const card = (await ana.api("GET", `/boards/${s.boardId}`)).body.cards.find((c: { title: string }) => c.title === "Creada por Ana");
  expect((await beto.api("PATCH", `/cards/${card.id}`, { title: "Editada por Beto" })).status).toBe(200);
  await expect(ana.page.getByRole("button", { name: "Editada por Beto" })).toBeVisible();

  await ana.context.close();
  await beto.context.close();
});

test("una persona de otra organización no ve el tablero aunque tenga el enlace ni llamando a la API", async ({ browser }) => {
  const ana = await newSession(browser, "Ana Privada");
  const ajena = await newSession(browser, "Persona Ajena");
  const s = await seedBoard(ana, "Tablero privado");
  await ajena.page.goto(`/b/${s.boardId}`);
  await expect(ajena.page.getByText("El tablero no existe o no tenés acceso.")).toBeVisible();
  expect((await ajena.api("GET", `/boards/${s.boardId}`)).status).toBe(404);
  expect((await ajena.api("POST", `/lists/${s.lists[0]!.id}/cards`, { title: "Intrusa" })).status).toBe(404);
  const cards = (await ana.api("GET", `/boards/${s.boardId}`)).body.cards;
  expect(cards.some((c: { title: string }) => c.title === "Intrusa")).toBe(false);
  await ana.context.close();
  await ajena.context.close();
});

test("en el celular el tablero y la tarjeta se usan sin desbordar la página", async ({ browser }) => {
  const ana = await newSession(browser, "Ana Móvil", { viewport: { width: 375, height: 812 } });
  const s = await seedBoard(ana, "Tablero móvil");
  const id = (await ana.api("POST", `/lists/${s.lists[0]!.id}/cards`, { title: "Tarea con un título bastante largo para revisar cómo se corta en pantallas chicas" })).body.id;
  await ana.page.goto(`/b/${s.boardId}`);
  await expect(ana.page.getByText(/Tarea con un título bastante largo/)).toBeVisible();
  // La página no se desplaza a lo ancho: el desplazamiento horizontal queda dentro del tablero.
  const overflow = await ana.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await ana.page.goto(`/b/${s.boardId}?card=${id}`);
  const dialog = ana.page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(375);
  await ana.context.close();
});
