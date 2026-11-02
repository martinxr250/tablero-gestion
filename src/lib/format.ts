import { differenceInCalendarDays, format, formatDistanceToNowStrict, isPast } from "date-fns";
import { es } from "date-fns/locale";

export const fmtDate = (d: string | Date) => format(new Date(d), "d MMM yyyy", { locale: es });
export const fmtDateTime = (d: string | Date) => format(new Date(d), "d MMM yyyy, HH:mm", { locale: es });
export const fmtShort = (d: string | Date) => format(new Date(d), "d MMM", { locale: es });
export const ago = (d: string | Date) => `hace ${formatDistanceToNowStrict(new Date(d), { locale: es })}`;

export function dueState(due: string | Date | null, completed: boolean): "none" | "done" | "overdue" | "soon" | "later" {
  if (!due) return "none";
  if (completed) return "done";
  const d = new Date(due);
  if (isPast(d)) return "overdue";
  return differenceInCalendarDays(d, new Date()) <= 2 ? "soon" : "later";
}

/** Valor para <input type="datetime-local"> en hora local. */
export function toLocalInput(d: string | Date | null) {
  if (!d) return "";
  const date = new Date(d);
  const off = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - off).toISOString().slice(0, 16);
}
