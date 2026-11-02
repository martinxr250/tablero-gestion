import { describe, expect, it } from "vitest";
import { docToMarkdown, markdownToDoc } from "@/server/integrations/markdown";
import { referencedIssues } from "@/server/integrations/provider";
import { sanitizeRichText } from "@/server/modules/richtext";

describe("Markdown ↔ texto enriquecido", () => {
  it("ida y vuelta conserva estructura y formato", () => {
    const md = "## Objetivo\n\nTexto con **negrita**, _cursiva_ y [enlace](https://example.com).\n\n- uno\n- dos\n\n```\ncodigo()\n```";
    const doc = markdownToDoc(md);
    expect(() => sanitizeRichText(doc)).not.toThrow();
    expect(docToMarkdown(doc)).toBe(md);
  });

  it("descarta enlaces peligrosos al importar", () => {
    const doc = markdownToDoc("[clic](javascript:alert(1))");
    expect(JSON.stringify(doc)).not.toContain("javascript");
  });

  it("devuelve null para descripciones vacías", () => {
    expect(markdownToDoc("   \n\n")).toBeNull();
    expect(docToMarkdown(null)).toBe("");
  });
});

describe("referencias de PRs a issues", () => {
  it("detecta #n en título y cuerpo, y el número al inicio de la rama", () => {
    expect(referencedIssues({ title: "Fix #12", body: "Closes #3, ver también abc#9", branch: "45-login" }).sort((a, b) => a - b)).toEqual([3, 12, 45]);
    expect(referencedIssues({ title: "Sin referencias", body: "color #fff no", branch: "feature/7_x" })).toEqual([7]);
  });
});
