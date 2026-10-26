import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/cloud",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results-cloud",
  // Multi-account workflows include many batched sync steps; per-assertion timeouts stay unchanged.
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3187",
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "cloud-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "cloud-touch",
      use: { ...devices["iPad (gen 7)"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "node tests/cloud/server.ts",
    url: "http://127.0.0.1:3187/healthz",
    reuseExistingServer: false,
  },
});
