// Crea el bucket PRIVADO de Supabase Storage con límite de tamaño y tipos permitidos.
// Uso: pnpm storage:setup (con SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno).
const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_BUCKET ?? "faro-files";
if (!url || !key) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;

const res = await fetch(`${url}/storage/v1/bucket`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    id: bucket,
    name: bucket,
    public: false,
    file_size_limit: 4 * 1024 * 1024,
    allowed_mime_types: [
      "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "application/zip",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain", "text/csv", "text/markdown",
    ],
  }),
});
const body = await res.text();
if (res.ok) console.log(`✓ Bucket privado "${bucket}" creado.`);
else if (/already exists|Duplicate/i.test(body)) console.log(`El bucket "${bucket}" ya existe.`);
else {
  console.error(`Error ${res.status}: ${body}`);
  process.exit(1);
}

export {};
