"use client";

import { Check } from "lucide-react";
import { COLOR_LABEL, COLORS, SWATCH, type ColorName } from "@/lib/colors";
import { cn } from "@/lib/utils";

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: ColorName) => void }) {
  return (
    <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={COLOR_LABEL[c]}
          title={COLOR_LABEL[c]}
          onClick={() => onChange(c)}
          className={cn("flex h-7 w-7 items-center justify-center rounded-full", SWATCH[c], value === c && "ring-2 ring-offset-2 ring-ring ring-offset-card")}
        >
          {value === c && <Check className="h-4 w-4 text-white" />}
        </button>
      ))}
    </div>
  );
}
