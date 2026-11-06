"use client";

import { Download } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/primitives";
import type { UseCases } from "@/lib/design";

// Diagrama de casos de uso UML dibujado a mano en SVG: actores principales a la izquierda,
// secundarios a la derecha, casos de uso dentro del límite del sistema, include/extend punteados.

const RX = 112;
const RY = 30;
const ROW = 84;

function wrap(text: string, max = 24) {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > max && line) {
      out.push(line);
      line = w;
    } else line = `${line} ${w}`.trim();
  }
  if (line) out.push(line);
  if (out.length > 2) return [out[0]!, `${out.slice(1).join(" ").slice(0, max - 1)}…`];
  return out;
}

function Actor({ x, y, name }: { x: number; y: number; name: string }) {
  return (
    <g>
      <circle cx={x} cy={y - 34} r={10} className="fill-card stroke-foreground" strokeWidth={1.6} />
      <line x1={x} y1={y - 24} x2={x} y2={y + 2} className="stroke-foreground" strokeWidth={1.6} />
      <line x1={x - 16} y1={y - 14} x2={x + 16} y2={y - 14} className="stroke-foreground" strokeWidth={1.6} />
      <line x1={x} y1={y + 2} x2={x - 13} y2={y + 22} className="stroke-foreground" strokeWidth={1.6} />
      <line x1={x} y1={y + 2} x2={x + 13} y2={y + 22} className="stroke-foreground" strokeWidth={1.6} />
      {wrap(name, 16).map((l, i) => (
        <text key={i} x={x} y={y + 40 + i * 15} textAnchor="middle" className="fill-foreground text-[12px] font-medium">
          {l}
        </text>
      ))}
    </g>
  );
}

export function UseCaseDiagram({ data, title }: { data: UseCases; title: string }) {
  const ref = useRef<SVGSVGElement>(null);
  // Orden que reduce cruces: primero los casos de los actores principales (en el orden de los
  // actores), y hacia la derecha los que usan actores secundarios.
  const primaryIdx = new Map(data.actors.filter((x) => x.kind === "primary").map((x, i) => [x.id, i]));
  const score = (u: UseCases["useCases"][number]) => {
    const idx = u.actors.map((a) => primaryIdx.get(a)).filter((x): x is number => x !== undefined);
    const secondary = u.actors.length ? (u.actors.length - idx.length) / u.actors.length : 0;
    return secondary * 100 + (idx.length ? idx.reduce((s, x) => s + x, 0) / idx.length : 50);
  };
  const cases = [...data.useCases].sort((a, b) => score(a) - score(b));
  const cols = cases.length > 7 ? 2 : 1;
  const perCol = Math.ceil(cases.length / cols);
  const left = data.actors.filter((a) => a.kind === "primary");
  const right = data.actors.filter((a) => a.kind !== "primary");
  const sysX = 170;
  const colW = RX * 2 + 60;
  const sysW = cols * colW + 40;
  const width = sysX + sysW + (right.length ? 170 : 40);
  const height = Math.max(perCol * ROW + 90, Math.max(left.length, right.length) * 120 + 60);
  const pos = new Map(
    cases.map((u, i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      const offset = (height - 40 - perCol * ROW) / 2;
      return [u.id, { x: sysX + 20 + col * colW + colW / 2, y: 60 + offset + row * ROW + ROW / 2 }];
    }),
  );
  const actorPos = new Map<string, { x: number; y: number; side: "l" | "r" }>();
  const place = (list: typeof left, x: number, side: "l" | "r") =>
    list.forEach((a, i) => actorPos.set(a.id, { x, y: ((i + 1) * height) / (list.length + 1), side }));
  place(left, 70, "l");
  place(right, width - 75, "r");

  /** Punto del borde de la elipse en dirección a (tx, ty). */
  const edge = (cx: number, cy: number, tx: number, ty: number) => {
    const a = Math.atan2(ty - cy, tx - cx);
    return { x: cx + RX * Math.cos(a), y: cy + RY * Math.sin(a) };
  };

  const download = () => {
    if (!ref.current) return;
    // Los colores vienen de clases CSS: se copian como atributos para que el archivo se vea igual.
    const clone = ref.current.cloneNode(true) as SVGSVGElement;
    const src = ref.current.querySelectorAll("*");
    clone.querySelectorAll("*").forEach((el, i) => {
      const cs = getComputedStyle(src[i]!);
      for (const k of ["fill", "stroke", "font-size", "font-weight", "font-style", "font-family", "opacity"]) el.setAttribute(k, cs.getPropertyValue(k));
    });
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
    Object.assign(document.createElement("a"), { href: url, download: `${title || "casos-de-uso"}.svg` }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-2xl border bg-card">
      <div className="flex items-center border-b px-3 py-1.5">
        <span className="flex-1 text-xs text-muted-foreground">Diagrama de casos de uso</span>
        <Button size="icon-sm" variant="ghost" aria-label="Descargar SVG" onClick={download}>
          <Download />
        </Button>
      </div>
      <div className="overflow-x-auto p-3 scroll-thin">
        <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="mx-auto max-w-none" role="img" aria-label={`Diagrama de casos de uso: ${title}`}>
          <defs>
            <marker id="uc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10" fill="none" className="stroke-muted-foreground" strokeWidth={1.5} />
            </marker>
          </defs>
          <rect x={sysX} y={16} width={sysW} height={height - 32} rx={22} className="fill-muted/40 stroke-border" strokeWidth={1.5} />
          <text x={sysX + 18} y={40} className="fill-muted-foreground text-[12px] font-semibold tracking-wide uppercase">
            {title}
          </text>
          {/* Asociaciones actor — caso de uso */}
          {cases.flatMap((u) =>
            u.actors.map((aid) => {
              const a = actorPos.get(aid);
              const p = pos.get(u.id);
              if (!a || !p) return null;
              const from = { x: a.x + (a.side === "l" ? 22 : -22), y: a.y - 12 };
              const to = edge(p.x, p.y, from.x, from.y);
              return <line key={`${u.id}-${aid}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="stroke-muted-foreground/70" strokeWidth={1.3} />;
            }),
          )}
          {/* include / extend */}
          {cases.flatMap((u) =>
            (
              [
                ...u.includes.map((t) => ({ from: u.id, to: t, label: "«include»" })),
                ...u.extends.map((t) => ({ from: u.id, to: t, label: "«extend»" })),
              ] as const
            ).map((r) => {
              const a = pos.get(r.from);
              const b = pos.get(r.to);
              if (!a || !b) return null;
              const sameCol = Math.abs(a.x - b.x) < 5;
              const s = sameCol ? { x: a.x + RX * 0.75, y: a.y + (b.y > a.y ? RY * 0.66 : -RY * 0.66) } : edge(a.x, a.y, b.x, b.y);
              const e = sameCol ? { x: b.x + RX * 0.75, y: b.y + (b.y > a.y ? -RY * 0.66 : RY * 0.66) } : edge(b.x, b.y, a.x, a.y);
              const cx = sameCol ? a.x + RX + 46 : (s.x + e.x) / 2;
              const cy = (s.y + e.y) / 2;
              return (
                <g key={`${r.from}-${r.to}-${r.label}`}>
                  <path d={`M ${s.x} ${s.y} Q ${cx} ${cy} ${e.x} ${e.y}`} fill="none" className="stroke-muted-foreground" strokeWidth={1.2} strokeDasharray="5 4" markerEnd="url(#uc-arrow)" />
                  <text x={sameCol ? cx - 6 : cx} y={cy - 4} textAnchor="middle" className="fill-muted-foreground text-[10px] italic">
                    {r.label}
                  </text>
                </g>
              );
            }),
          )}
          {cases.map((u) => {
            const p = pos.get(u.id)!;
            const lines = wrap(u.name);
            return (
              <g key={u.id}>
                <title>{`${u.code} ${u.name}: ${u.goal}`}</title>
                <ellipse cx={p.x} cy={p.y} rx={RX} ry={RY} className="fill-card stroke-[var(--ai-via)]" strokeWidth={1.6} />
                <text x={p.x} y={p.y - (lines.length - 1) * 7 - 6} textAnchor="middle" className="fill-muted-foreground text-[9.5px] font-semibold">
                  {u.code}
                </text>
                {lines.map((l, i) => (
                  <text key={i} x={p.x} y={p.y + 7 + i * 14 - (lines.length - 1) * 7} textAnchor="middle" className="fill-foreground text-[12px]">
                    {l}
                  </text>
                ))}
              </g>
            );
          })}
          {[...left, ...right].map((a) => {
            const p = actorPos.get(a.id)!;
            return <Actor key={a.id} x={p.x} y={p.y} name={a.name} />;
          })}
        </svg>
      </div>
    </div>
  );
}
