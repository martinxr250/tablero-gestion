"use client";

import { AlertTriangle, Download, Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Dialog } from "@/components/ui/overlay";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

let ready: Promise<typeof import("mermaid").default> | null = null;
let theme: "dark" | "light" | null = null;

/** Mermaid se carga solo cuando hace falta (es pesado) y en modo estricto (sin scripts ni HTML libre). */
async function loadMermaid(dark: boolean) {
  ready ??= import("mermaid").then((m) => m.default);
  const mermaid = await ready;
  const want = dark ? "dark" : "light";
  if (theme !== want) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "base",
      fontFamily: "inherit",
      themeVariables: dark
        ? { primaryColor: "#2e2a4f", primaryBorderColor: "#8b7cf6", primaryTextColor: "#ece9ff", lineColor: "#8f8aa8", fontSize: "14px" }
        : { primaryColor: "#f3f1ff", primaryBorderColor: "#7c6cf0", primaryTextColor: "#1e1b4b", lineColor: "#6b6889", secondaryColor: "#fdf2f8", tertiaryColor: "#f8fafc", fontSize: "14px" },
      // Tamaño natural (no ajustado al contenedor): el zoom y la pantalla completa permiten recorrerlo.
      flowchart: { curve: "basis", padding: 14, htmlLabels: true, useMaxWidth: false },
      sequence: { actorMargin: 60, mirrorActors: false, useMaxWidth: false },
      er: { layoutDirection: "TB", useMaxWidth: false },
    });
    theme = want;
  }
  return mermaid;
}

const isDark = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");

/** Diagrama Mermaid con zoom, pantalla completa y descarga en SVG. */
export function MermaidDiagram({ source, title, className }: { source: string; title: string; className?: string }) {
  const rid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null = ajustado al ancho disponible; un número = zoom elegido.
  const [zoom, setZoom] = useState<number | null>(null);
  const [boxW, setBoxW] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [dark, setDark] = useState(isDark);
  const seq = useRef(0);

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setBoxW(e!.contentRect.width));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const obs = new MutationObserver(() => setDark(isDark()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const n = ++seq.current;
    if (!source.trim()) return;
    const t = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid(dark);
        const { svg: out } = await mermaid.render(`mmd${rid}${n}`, source);
        if (n === seq.current) {
          setSvg(out);
          setError(null);
        }
      } catch (e) {
        if (n === seq.current) setError(e instanceof Error ? e.message.split("\n").slice(0, 3).join(" ") : "No se pudo dibujar el diagrama");
        document.getElementById(`dmmd${rid}${n}`)?.remove();
      }
    }, 250);
    return () => clearTimeout(t);
  }, [source, dark, rid]);

  const vb = svg ? /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg) : null;
  const natural = vb ? { w: Number(vb[1]), h: Number(vb[2]) } : null;
  // Ajustado al ancho, pero nunca tan chico que no se lea: más grande, se recorre con scroll.
  const fit = natural && boxW ? Math.min(1, Math.max(0.55, (boxW - 32) / natural.w)) : 1;
  const scale = zoom ?? fit;
  const setScale = (f: (z: number) => number) => setZoom(+Math.min(3, Math.max(0.2, f(scale))).toFixed(2));

  const download = () => {
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${title.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "diagrama"}.svg` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const canvas = (big: boolean) =>
    svg ? (
      <div className={cn("overflow-auto scroll-thin", big ? "max-h-[78vh]" : "max-h-[640px]")}>
        <div
          className="mx-auto w-fit p-4 [&_svg]:h-auto [&_svg]:max-w-none"
          style={{ ["--w" as string]: natural ? `${Math.round(natural.w * (big ? Math.max(scale, fit) : scale))}px` : "auto" }}
          // El SVG lo genera Mermaid en modo estricto a partir de texto sin HTML ejecutable.
          dangerouslySetInnerHTML={{ __html: svg.replace(/<svg /, '<svg style="width:var(--w)" ') }}
        />
      </div>
    ) : null;

  return (
    <div ref={box} className={cn("rounded-2xl border bg-card", className)}>
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        <span className="flex-1 text-xs text-muted-foreground">Diagrama</span>
        <Button size="icon-sm" variant="ghost" aria-label="Alejar" onClick={() => setScale((z) => z - 0.15)}>
          <Minus />
        </Button>
        <button className="w-12 rounded-md text-xs tabular-nums text-muted-foreground hover:bg-muted" onClick={() => setZoom(zoom === null ? 1 : null)} title={zoom === null ? "Tamaño real" : "Ajustar al ancho"}>
          {Math.round(scale * 100)}%
        </button>
        <Button size="icon-sm" variant="ghost" aria-label="Acercar" onClick={() => setScale((z) => z + 0.15)}>
          <Plus />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Pantalla completa" onClick={() => setFull(true)} disabled={!svg}>
          <Maximize2 />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Descargar SVG" onClick={download} disabled={!svg}>
          <Download />
        </Button>
      </div>
      {!source.trim() ? (
        <p className="p-6 text-center text-sm text-muted-foreground">Escribí el diagrama en Mermaid para verlo acá.</p>
      ) : error ? (
        <div className="flex items-start gap-2 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium">El diagrama tiene un error de sintaxis</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{error}</p>
          </div>
        </div>
      ) : svg ? (
        canvas(false)
      ) : (
        <div className="ai-skeleton m-6 h-48 rounded-2xl" />
      )}
      {full && (
        <Dialog open onOpenChange={setFull} title={title} wide className="sm:max-w-[95vw]">
          {canvas(true)}
        </Dialog>
      )}
    </div>
  );
}
