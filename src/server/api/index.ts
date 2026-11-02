import "server-only";
import { route, compile, buildOpenApi, type RouteDef } from "./router";
import { authRoutes } from "../modules/auth";
import { meRoutes } from "../modules/me";
import { orgRoutes } from "../modules/orgs";
import { workspaceRoutes } from "../modules/workspaces";
import { boardRoutes } from "../modules/boards";
import { cardRoutes } from "../modules/cards";
import { insightRoutes } from "../modules/insights";
import { cronRoutes } from "../modules/cron";
import { integrationRoutes } from "../modules/integrations";

const domainRoutes: RouteDef[] = [
  ...authRoutes,
  ...meRoutes,
  ...orgRoutes,
  ...workspaceRoutes,
  ...boardRoutes,
  ...cardRoutes,
  ...insightRoutes,
  ...cronRoutes,
  ...integrationRoutes,
];

export const allRoutes: RouteDef[] = [
  ...domainRoutes,
  route({
    method: "GET",
    path: "/openapi.json",
    summary: "Documento OpenAPI de esta API",
    tag: "Sistema",
    auth: "none",
    handler: async () => buildOpenApi(domainRoutes),
  }),
];

export const compiledRoutes = compile(allRoutes);
