import { playwright } from "@vitest/browser-playwright";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@superlog/browser": fileURLToPath(new URL("./packages/browser/src/index.ts", import.meta.url)) },
  },
  test: {
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }],
      provider: playwright(),
    },
    include: ["packages/*/src/**/*.test.{ts,tsx}"],
  },
});
