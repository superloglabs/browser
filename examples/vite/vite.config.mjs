import { defineConfig } from "vite";
import { superlogSourceMaps } from "../../packages/sourcemaps/dist/vite.js";

export default defineConfig({
  plugins: [superlogSourceMaps({ release: "example", url: process.env.SUPERLOG_URL })],
});
