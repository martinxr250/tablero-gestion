"use client";

import { useMutation } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { Input, Select } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import type { BoardData, BoardField, CardDetail, FieldValue } from "@/lib/types";

function FieldInput({ field, value, disabled, onSave }: { field: BoardField; value: FieldValue | undefined; disabled: boolean; onSave: (v: FieldValue | null) => void }) {
  const id = `field-${field.id}`;
  const common = { id, disabled, className: "h-9" };
  switch (field.type) {
    case "checkbox":
      return (
        <input
          id={id}
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          disabled={disabled}
          checked={value === true}
          onChange={(e) => onSave(e.target.checked)}
        />
      );
    case "select":
      return (
        <Select {...common} value={typeof value === "string" ? value : ""} onChange={(e) => onSave(e.target.value || null)}>
          <option value="">Sin elegir</option>
          {field.config.options?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      );
    case "date":
      // Se guarda al salir del campo: mientras se escribe el año la fecha pasa por valores intermedios.
      return (
        <Input
          {...common}
          type="date"
          min="1900-01-01"
          max="2999-12-31"
          defaultValue={typeof value === "string" ? value : ""}
          key={String(value)}
          onBlur={(e) => {
            const next = e.target.value || null;
            if (next !== (value ?? null)) onSave(next);
          }}
        />
      );
    default: {
      const numeric = field.type === "number" || field.type === "currency";
      return (
        <div className="flex items-center gap-1.5">
          {field.type === "currency" && <span className="text-xs text-muted-foreground">{field.config.currency}</span>}
          <Input
            {...common}
            type={numeric ? "number" : "text"}
            step={numeric ? "0.01" : undefined}
            maxLength={numeric ? undefined : 500}
            defaultValue={value === undefined ? "" : String(value)}
            key={String(value)}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const next = raw === "" ? null : numeric ? Number(raw) : raw;
              if (next !== (value ?? null)) onSave(next);
            }}
          />
        </div>
      );
    }
  }
}

/** Campos personalizados dentro de la tarjeta. */
export function CardFields({ card, board, canEdit, refresh }: { card: CardDetail; board: BoardData; canEdit: boolean; refresh: () => void }) {
  const save = useMutation({
    mutationFn: (v: { fieldId: string; value: FieldValue | null }) => api(`/cards/${card.id}/fields/${v.fieldId}`, { method: "PUT", body: { value: v.value } }),
    onSettled: refresh,
  });
  if (board.fields.length === 0) return null;
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <SlidersHorizontal className="size-4 text-muted-foreground" /> Campos
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {board.fields.map((f) => (
          <div key={f.id} className={f.type === "checkbox" ? "flex items-center gap-2" : "space-y-1"}>
            <label htmlFor={`field-${f.id}`} className="text-xs font-medium text-muted-foreground">
              {f.name}
            </label>
            <FieldInput field={f} value={card.fieldValues[f.id]} disabled={!canEdit} onSave={(value) => save.mutate({ fieldId: f.id, value })} />
          </div>
        ))}
      </div>
    </section>
  );
}
