import { defineConfig } from "@playwright/test";
import config from "./playwright.cloud.config.ts";
process.env.VHSLIDE_TEST_BACKEND = "cloudflare";
export default defineConfig({
  ...config,
  outputDir: "test-results-cloudflare",
  webServer: {
    command: "node tests/cloudflare/browser-server.ts",
    url: "http://127.0.0.1:3187/healthz",
    reuseExistingServer: false,
  },
});
