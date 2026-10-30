import { defineConfig } from "@playwright/test";
import config from "./playwright.config";
// Freeze browser regressions to production assets; source edits cannot trigger HMR mid-test.
export default defineConfig({
  ...config,
  outputDir: "test-results-preview",
  use: { ...config.use, baseURL: "http://127.0.0.1:5174" },
  webServer: {
    command: "npm run preview -- --port 5174 --strictPort",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
  },
});
