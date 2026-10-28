// Gzipped size of what an application ships for each setup.
import { build } from "esbuild";
import { gzipSync } from "node:zlib";

const entries = {
  "init only": 'import { init } from "@superlog/browser"; init({ service: "app", ingestKey: "k" });',
  "init + react": 'import { init } from "@superlog/browser"; import { ErrorBoundary, instrumentRouter } from "@superlog/react"; init({ service: "app" }); console.log(ErrorBoundary, instrumentRouter);',
};

for (const [name, contents] of Object.entries(entries)) {
  const result = await build({
    bundle: true,
    external: ["react", "react/jsx-runtime"],
    format: "esm",
    minify: true,
    platform: "browser",
    stdin: { contents, resolveDir: "packages/react", sourcefile: "entry.js" },
    target: "es2020",
    write: false,
  });
  const code = result.outputFiles[0].contents;
  console.log(`${name}: ${(code.length / 1024).toFixed(1)} KB minified, ${(gzipSync(code).length / 1024).toFixed(1)} KB gzipped`);
}
