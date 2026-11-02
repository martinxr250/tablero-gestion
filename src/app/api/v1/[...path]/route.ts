import { dispatch } from "@/server/api/router";
import { compiledRoutes } from "@/server/api";

// Punto de entrada único de la API: autenticación, CSRF, rate limit y validación centralizados.
export const dynamic = "force-dynamic";

const handle = (req: Request) => dispatch(req, compiledRoutes);

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
