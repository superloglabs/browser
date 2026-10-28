import { playwright } from "@vitest/browser-playwright";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@superlog/browser": fileURLToPath(new URL("./packages/browser/src/index.ts", import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          browser: {
            enabled: true,
            headless: true,
            instances: [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }],
            provider: playwright(),
          },
          include: ["packages/browser/src/**/*.test.{ts,tsx}", "packages/react/src/**/*.test.{ts,tsx}"],
          name: "browser",
        },
      },
      {
        extends: true,
        test: { environment: "node", include: ["packages/sourcemaps/src/**/*.test.ts"], name: "node" },
      },
    ],
  },
});
