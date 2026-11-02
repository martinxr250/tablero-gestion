// Clases literales (Tailwind necesita verlas completas) para la paleta de colores del producto.
export const COLORS = ["slate", "red", "orange", "amber", "green", "teal", "sky", "indigo", "violet", "pink"] as const;
export type ColorName = (typeof COLORS)[number];

export const COLOR_LABEL: Record<ColorName, string> = {
  slate: "Gris", red: "Rojo", orange: "Naranja", amber: "Ámbar", green: "Verde",
  teal: "Turquesa", sky: "Celeste", indigo: "Índigo", violet: "Violeta", pink: "Rosa",
};

export const SWATCH: Record<ColorName, string> = {
  slate: "bg-slate-400", red: "bg-red-500", orange: "bg-orange-500", amber: "bg-amber-400", green: "bg-green-500",
  teal: "bg-teal-500", sky: "bg-sky-500", indigo: "bg-indigo-500", violet: "bg-violet-500", pink: "bg-pink-500",
};

export const SWATCH_TEXT: Record<ColorName, string> = {
  slate: "text-slate-500", red: "text-red-500", orange: "text-orange-500", amber: "text-amber-500", green: "text-green-600",
  teal: "text-teal-600", sky: "text-sky-600", indigo: "text-indigo-600", violet: "text-violet-600", pink: "text-pink-500",
};

export const CHIP: Record<ColorName, string> = {
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200",
  red: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-200",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
  green: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-200",
  teal: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-200",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-200",
};


export const asColor = (c: string): ColorName => ((COLORS as readonly string[]).includes(c) ? (c as ColorName) : "slate");

export const PRIORITY: Record<string, { label: string; chip: string; dot: string; flag: string }> = {
  none: { label: "Sin prioridad", chip: "bg-muted text-muted-foreground", dot: "bg-slate-300", flag: "text-muted-foreground" },
  low: { label: "Baja", chip: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300", dot: "bg-emerald-500", flag: "text-emerald-500" },
  medium: { label: "Media", chip: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300", dot: "bg-amber-400", flag: "text-amber-500" },
  high: { label: "Alta", chip: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300", dot: "bg-rose-500", flag: "text-rose-500" },
  urgent: { label: "Urgente", chip: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200", dot: "bg-red-600", flag: "text-red-600" },
};
