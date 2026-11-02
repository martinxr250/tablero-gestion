import { env } from "../core/env";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, intro: string, cta?: { label: string; url: string }, outro?: string) {
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5fb;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1d2133">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;padding:32px">
<tr><td style="font-weight:700;font-size:18px;color:#4338ca">Tableros</td></tr>
<tr><td style="padding-top:16px;font-size:20px;font-weight:600">${esc(title)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.5">${esc(intro)}</td></tr>
${cta ? `<tr><td style="padding-top:24px"><a href="${esc(cta.url)}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block">${esc(cta.label)}</a></td></tr>` : ""}
${outro ? `<tr><td style="padding-top:20px;font-size:13px;color:#6b7085;line-height:1.5">${esc(outro)}</td></tr>` : ""}
</table></td></tr></table></body></html>`;
  const text = [title, "", intro, cta ? `\n${cta.label}: ${cta.url}` : "", outro ? `\n${outro}` : ""].join("\n");
  return { html, text };
}

const url = (p: string) => new URL(p, env().APP_URL).toString();

export function verifyEmailMail(name: string, token: string) {
  return {
    subject: "Confirmá tu correo en Tableros",
    ...layout(`Hola ${name}`, "Confirmá tu dirección de correo para empezar a usar Tableros.", {
      label: "Confirmar correo",
      url: url(`/verify-email?token=${encodeURIComponent(token)}`),
    }, "El enlace vence en 24 horas. Si no creaste una cuenta, ignorá este mensaje."),
  };
}

export function resetPasswordMail(name: string, token: string) {
  return {
    subject: "Restablecer tu contraseña de Tableros",
    ...layout(`Hola ${name}`, "Recibimos un pedido para restablecer tu contraseña.", {
      label: "Elegir nueva contraseña",
      url: url(`/reset-password?token=${encodeURIComponent(token)}`),
    }, "El enlace vence en 30 minutos. Si no lo pediste, ignorá este mensaje: tu contraseña no cambia."),
  };
}

export function passwordChangedMail(name: string) {
  return {
    subject: "Tu contraseña de Tableros cambió",
    ...layout(`Hola ${name}`, "La contraseña de tu cuenta se cambió y se cerraron las demás sesiones.", undefined,
      "Si no fuiste vos, restablecé la contraseña de inmediato desde la pantalla de inicio de sesión."),
  };
}

export function invitationMail(inviter: string, target: string, token: string) {
  return {
    subject: `${inviter} te invitó a ${target} en Tableros`,
    ...layout("Tenés una invitación", `${inviter} te invitó a colaborar en "${target}".`, {
      label: "Ver invitación",
      url: url(`/invite?token=${encodeURIComponent(token)}`),
    }, "La invitación vence en 7 días. Tenés que entrar con este mismo correo para aceptarla."),
  };
}

export function registerAttemptMail(name: string) {
  return {
    subject: "Intento de registro con tu correo",
    ...layout(`Hola ${name}`, "Alguien intentó crear una cuenta en Tableros con tu correo, que ya está registrado.", {
      label: "Iniciar sesión",
      url: url("/login"),
    }, "Si fuiste vos y no recordás la contraseña, usá \"Olvidé mi contraseña\"."),
  };
}
