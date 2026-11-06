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
import { planningRoutes } from "../modules/planning";
import { shareRoutes } from "../modules/share";
import { fieldRoutes } from "../modules/fields";
import { workRoutes } from "../modules/work";
import { mirrorRoutes } from "../modules/mirrors";
import { deliveryRoutes } from "../modules/delivery";
import { signalRoutes } from "../modules/signals";
import { notificationSettingsRoutes } from "../modules/notification-settings";
import { boardFileRoutes } from "../modules/board-files";
import { aiRoutes } from "../modules/ai";
import { designRoutes } from "../modules/design";
import { assistantRoutes } from "../modules/assistant";

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
  ...planningRoutes,
  ...shareRoutes,
  ...fieldRoutes,
  ...workRoutes,
  ...mirrorRoutes,
  ...deliveryRoutes,
  ...signalRoutes,
  ...notificationSettingsRoutes,
  ...boardFileRoutes,
  ...aiRoutes,
  ...designRoutes,
  ...assistantRoutes,
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
