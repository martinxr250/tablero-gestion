import { dispatch } from "@/server/api/router";
import { compiledRoutes } from "@/server/api";

// Punto de entrada único de la API: autenticación, CSRF, rate limit y validación centralizados.
export const dynamic = "force-dynamic";
// Las funciones de IA leen documentos y pueden tardar más que una consulta común.
// Hasta 5 minutos: la generación de documentos de diseño y el asistente pueden tardar.
export const maxDuration = 300;

const handle = (req: Request) => dispatch(req, compiledRoutes);

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
