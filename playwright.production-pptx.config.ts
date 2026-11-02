import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// Fresh browser contexts import synthetic files locally; no cloud work is opened.
export default defineConfig({
  ...config,
  testMatch: [
    "pptx.spec.ts",
    "surveys-entry.spec.ts",
    "worksheets-entry.spec.ts",
  ],
  outputDir: "test-results-production-pptx",
  webServer: undefined,
  use: {
    ...config.use,
    // Scope trust to the managed proxy CA for this disposable test browser.
    // curl verifies the production response against system trust separately.
    launchOptions: {
      ...config.use?.launchOptions,
      args: [
        ...(config.use?.launchOptions?.args ?? []),
        ...(process.env.VHSLIDE_PROXY_CA_SPKI
          ? [
              `--ignore-certificate-errors-spki-list=${process.env.VHSLIDE_PROXY_CA_SPKI}`,
            ]
          : []),
      ],
    },
    baseURL: "https://vhslide.overdozer1124.workers.dev",
    ...(process.env.HTTPS_PROXY
      ? { proxy: { server: process.env.HTTPS_PROXY } }
      : {}),
  },
});
