import { Check, Minus, X } from "lucide-react";
import { PASSWORD_RULES, passwordContainsEmail } from "@/lib/password-policy";

export function PasswordRequirements({ password, confirmation, email, id = "password-requirements" }: { password: string; confirmation: string; email?: string; id?: string }) {
  const rules = [
    ...PASSWORD_RULES.map((rule) => ({ id: rule.id, label: rule.label, valid: rule.test(password), active: !!password })),
    ...(email !== undefined ? [{ id: "email", label: "No incluye tu correo", valid: !passwordContainsEmail(password, email), active: !!password && !!email }] : []),
    { id: "confirmation", label: "Contraseñas iguales", valid: !!password && password === confirmation, active: !!confirmation },
  ];
  return <div id={id} className="password-requirements"><p className="password-requirements-title">Requisitos de tu contraseña</p><ul className="password-rules">{rules.map((rule) => {
    const state = !rule.active ? "pending" : rule.valid ? "valid" : "invalid";
    const Icon = state === "valid" ? Check : state === "invalid" ? X : Minus;
    return <li key={rule.id} className="password-rule" data-state={state}><span className="password-rule-icon"><Icon aria-hidden /></span><span><span className="sr-only">{state === "valid" ? "Cumplido: " : state === "invalid" ? "Falta: " : "Pendiente: "}</span>{rule.label}</span></li>;
  })}</ul></div>;
}
