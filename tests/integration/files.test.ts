import { beforeAll, describe, expect, it } from "vitest";
import { Client, newUser, seedBoard } from "../helpers";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5b0000000049454e44ae426082",
  "hex",
);

describe("adjuntos", () => {
  let owner: Client;
  let s: Awaited<ReturnType<typeof seedBoard>>;
  const upload = (name: string, bytes: Buffer, type = "application/octet-stream") => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(bytes)], name, { type }));
    return owner.req("POST", `/cards/${s.cardId}/attachments`, undefined, { form });
  };

  beforeAll(async () => {
    owner = await newUser("Files");
    s = await seedBoard(owner);
  });

  it("acepta imágenes y las descarga con cabeceras seguras", async () => {
    const r = await upload("../../etc/foto.png", PNG, "image/png");
    expect(r.status).toBe(201);
    const card = (await owner.get(`/cards/${s.cardId}`)).body.card;
    expect(card.attachments[0]).toMatchObject({ fileName: "foto.png", mime: "image/png", isImage: true });
    const d = await owner.req("GET", `/attachments/${r.body.id}/download`);
    expect(d.status).toBe(200);
    expect(d.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(d.headers.get("x-content-type-options")).toBe("nosniff");
    expect(d.headers.get("content-security-policy")).toContain("sandbox");
    const inline = await owner.req("GET", `/attachments/${r.body.id}/download?inline=1`);
    expect(inline.headers.get("content-disposition")).toMatch(/^inline/);
  });

  it("rechaza ejecutables disfrazados y HTML por su contenido real", async () => {
    expect((await upload("foto.png", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 1)]), "image/png")).status).toBe(415);
    expect((await upload("pagina.html", Buffer.from("<html><script>alert(1)</script></html>"), "text/html")).status).toBe(415);
    expect((await upload("dibujo.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), "image/svg+xml")).status).toBe(415);
  });

  it("acepta texto plano válido y rechaza archivos vacíos o demasiado grandes", async () => {
    expect((await upload("notas.md", Buffer.from("# Hola\nTexto"))).status).toBe(201);
    expect((await upload("vacio.txt", Buffer.alloc(0))).status).toBe(400);
    expect((await upload("grande.txt", Buffer.alloc(4 * 1024 * 1024 + 10, 97))).status).toBe(413);
  });

  it("borrar un adjunto agenda la eliminación del objeto", async () => {
    const id = (await upload("otro.png", PNG, "image/png")).body.id;
    expect((await owner.del(`/attachments/${id}`)).status).toBe(204);
    expect((await owner.req("GET", `/attachments/${id}/download`)).status).toBe(404);
  });
});
