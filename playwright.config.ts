import { defineConfig, devices } from "@playwright/test";

// E2E con navegadores reales y varias sesiones a la vez. Servidor propio (puerto 3100) con base
// aislada `faro_e2e`: nunca usa datos reales ni credenciales personales.
const PORT = 3100;
export const E2E_URL = `http://localhost:${PORT}`;
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/faro_e2e";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: E2E_URL, trace: "retain-on-failure", locale: "es-AR" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `${E2E_URL}/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      APP_URL: E2E_URL,
      DATABASE_URL: E2E_DATABASE_URL,
      NEXT_DIST_DIR: ".next-e2e",
      STORAGE_DRIVER: "database",
      MAIL_DRIVER: "file",
    },
  },
});
