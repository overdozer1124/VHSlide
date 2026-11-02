import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// Fresh browser contexts import synthetic files locally; no cloud work is opened.
export default defineConfig({
  ...config,
  testMatch: "pptx.spec.ts",
  outputDir: "test-results-production-pptx",
  webServer: undefined,
  use: {
    ...config.use,
    baseURL: "https://vhslide.overdozer1124.workers.dev",
    ...(process.env.HTTPS_PROXY
      ? { proxy: { server: process.env.HTTPS_PROXY } }
      : {}),
  },
});
