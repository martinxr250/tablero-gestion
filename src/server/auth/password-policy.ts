import { z } from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_RULES } from "@/lib/password-policy";
export { passwordContainsEmail } from "@/lib/password-policy";

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, "La contraseña debe tener al menos 8 caracteres")
  .max(PASSWORD_MAX_LENGTH, "La contraseña no puede superar 128 caracteres")
  .superRefine((password, ctx) => {
    for (const rule of PASSWORD_RULES) {
      if (rule.id !== "length" && !rule.test(password)) ctx.addIssue({ code: "custom", message: rule.message });
    }
  });
