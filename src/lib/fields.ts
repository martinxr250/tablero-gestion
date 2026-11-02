import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { BoardField, FieldType, FieldValue } from "./types";

export const FIELD_TYPES: { value: FieldType; label: string; hint: string }[] = [
  { value: "text", label: "Texto", hint: "Cliente, versión, enlace…" },
  { value: "number", label: "Número", hint: "Horas, cantidad…" },
  { value: "currency", label: "Moneda", hint: "Presupuesto, costo estimado…" },
  { value: "date", label: "Fecha", hint: "Entrega, lanzamiento…" },
  { value: "checkbox", label: "Casilla", hint: "Sí o no: facturado, aprobado…" },
  { value: "select", label: "Lista de opciones", hint: "Una opción entre varias" },
];

const number = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

/** Texto para mostrar un valor de campo; "" si está vacío. */
export function fieldDisplay(field: BoardField, value: FieldValue | undefined): string {
  if (value === undefined || value === null || value === "") return "";
  switch (field.type) {
    case "checkbox":
      return value ? "Sí" : "";
    case "select":
      return field.config.options?.find((o) => o.id === value)?.name ?? "";
    case "currency":
      return `${field.config.currency ?? ""} ${number.format(Number(value))}`.trim();
    case "number":
      return number.format(Number(value));
    case "date":
      return format(new Date(`${value}T12:00:00`), "d MMM yyyy", { locale: es });
    default:
      return String(value);
  }
}
