"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ColorPicker } from "@/components/ui/color-picker";
import { Badge, Button, Field, Input, Select } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { asColor, CHIP, type ColorName } from "@/lib/colors";
import { FIELD_TYPES } from "@/lib/fields";
import type { BoardData, BoardField, FieldType } from "@/lib/types";

type Option = { id?: string; name: string; color: ColorName };

function OptionsEditor({ options, onChange }: { options: Option[]; onChange: (o: Option[]) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<ColorName>("sky");
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-1.5">
        {options.map((o, i) => (
          <li key={o.id ?? `${o.name}-${i}`}>
            <Badge className={`${CHIP[o.color]} gap-1 px-2.5 py-1 text-xs`}>
              {o.name}
              <button type="button" aria-label={`Quitar ${o.name}`} onClick={() => onChange(options.filter((_, j) => j !== i))}>
                <X className="size-3" />
              </button>
            </Badge>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-9 w-44" placeholder="Nueva opción" aria-label="Nueva opción" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <ColorPicker value={color} onChange={setColor} />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!name.trim()}
          onClick={() => {
            onChange([...options, { name: name.trim(), color }]);
            setName("");
          }}
        >
          <Plus /> Agregar
        </Button>
      </div>
    </div>
  );
}

function FieldForm({ initial, boardId, onDone }: { initial?: BoardField; boardId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<FieldType>(initial?.type ?? "text");
  const [currency, setCurrency] = useState(initial?.config.currency ?? "ARS");
  const [options, setOptions] = useState<Option[]>((initial?.config.options ?? []).map((o) => ({ ...o, color: asColor(o.color) })));
  const save = useMutation({
    mutationFn: () => {
      const config = type === "select" ? { options } : type === "currency" ? { currency } : undefined;
      return initial
        ? api(`/fields/${initial.id}`, { method: "PATCH", body: { name, config } })
        : api(`/boards/${boardId}/fields`, { method: "POST", body: { name, type, config } });
    },
    onSuccess: () => {
      toast.success(initial ? "Campo actualizado" : "Campo creado");
      onDone();
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["board", boardId] }),
  });
  return (
    <form
      className="space-y-3 rounded-2xl border p-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre" htmlFor="field-name">
          <Input id="field-name" autoFocus maxLength={40} placeholder="Ej.: Cliente, Presupuesto" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Tipo" htmlFor="field-type" hint={initial ? "El tipo no se puede cambiar." : FIELD_TYPES.find((t) => t.value === type)?.hint}>
          <Select id="field-type" disabled={!!initial} value={type} onChange={(e) => setType(e.target.value as FieldType)}>
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {type === "currency" && (
        <Field label="Moneda (código de 3 letras)" htmlFor="field-currency">
          <Input id="field-currency" className="w-28 uppercase" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </Field>
      )}
      {type === "select" && <OptionsEditor options={options} onChange={setOptions} />}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={save.isPending} disabled={!name.trim() || (type === "select" && options.length === 0) || (type === "currency" && !/^[A-Z]{3}$/.test(currency))}>
          {initial ? "Guardar" : "Crear campo"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** Campos personalizados del tablero: alta, edición, orden y si se muestran en el frente de la tarjeta. */
export function FieldsSettings({ data }: { data: BoardData }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["board", data.board.id] });
  const patch = useMutation({ mutationFn: (v: { id: string; body: Record<string, unknown> }) => api(`/fields/${v.id}`, { method: "PATCH", body: v.body }), onSettled: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api(`/fields/${id}`, { method: "DELETE" }), onSettled: refresh });
  const fields = data.fields;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Agregá datos propios a las tarjetas de este tablero, como cliente, presupuesto, versión o costo estimado.</p>
      <ul className="space-y-2">
        {fields.map((f, i) =>
          editing === f.id ? (
            <li key={f.id}>
              <FieldForm initial={f} boardId={data.board.id} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={f.id} className="flex items-center gap-2 rounded-xl border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.name}</p>
                <p className="text-xs text-muted-foreground">
                  {FIELD_TYPES.find((t) => t.value === f.type)?.label}
                  {f.type === "currency" && ` · ${f.config.currency}`}
                  {f.type === "select" && ` · ${f.config.options?.map((o) => o.name).join(", ")}`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={f.showOnCard ? `Ocultar ${f.name} del frente de la tarjeta` : `Mostrar ${f.name} en el frente de la tarjeta`}
                title={f.showOnCard ? "Se muestra en la tarjeta" : "Solo dentro de la tarjeta"}
                onClick={() => patch.mutate({ id: f.id, body: { showOnCard: !f.showOnCard } })}
              >
                {f.showOnCard ? <Eye /> : <EyeOff className="text-muted-foreground" />}
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Subir ${f.name}`} disabled={i === 0} onClick={() => patch.mutate({ id: f.id, body: { afterFieldId: fields[i - 2]?.id ?? null } })}>
                <ArrowUp />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Bajar ${f.name}`} disabled={i === fields.length - 1} onClick={() => patch.mutate({ id: f.id, body: { afterFieldId: fields[i + 1]!.id } })}>
                <ArrowDown />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Editar ${f.name}`} onClick={() => setEditing(f.id)}>
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Eliminar ${f.name}`} onClick={() => confirm(`¿Eliminar el campo "${f.name}" y todos sus valores?`) && remove.mutate(f.id)}>
                <Trash2 className="text-destructive" />
              </Button>
            </li>
          ),
        )}
        {fields.length === 0 && editing !== "new" && <li className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Todavía no hay campos.</li>}
      </ul>
      {editing === "new" ? (
        <FieldForm boardId={data.board.id} onDone={() => setEditing(null)} />
      ) : (
        <Button variant="secondary" onClick={() => setEditing("new")} disabled={fields.length >= 30}>
          <Plus /> Nuevo campo
        </Button>
      )}
    </div>
  );
}
