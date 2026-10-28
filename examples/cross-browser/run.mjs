// Throws the same bug in Chromium, Firefox, and WebKit from a minified,
// content-hashed bundle tagged with debug IDs, and writes the exception logs
// each browser sends together with the bundle's source map.
import { build } from "esbuild";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { injectDebugIds } from "../../packages/sourcemaps/dist/index.js";

const output = process.argv[2] ?? "cross-browser.json";
const dist = await mkdtemp(join(tmpdir(), "superlog-cross-browser-"));
await build({
  alias: { "@superlog/browser": new URL("../../packages/browser/dist/index.js", import.meta.url).pathname },
  bundle: true,
  entryNames: "assets/[name]-[hash]",
  entryPoints: [new URL("./sdk.js", import.meta.url).pathname, new URL("./app.js", import.meta.url).pathname],
  format: "esm",
  minify: true,
  nodePaths: [new URL("../../packages/browser/node_modules", import.meta.url).pathname],
  outdir: dist,
  platform: "browser",
  sourcemap: "linked",
  sourceRoot: "",
  target: "es2020",
});
const files = await injectDebugIds(dist);
const tagged = files.find((file) => file.file.startsWith("assets/app-"));
const sdk = files.find((file) => file.file.startsWith("assets/sdk-"));
const scripts = Object.fromEntries(await Promise.all(files.map(async (file) => [`/${file.file}`, await readFile(join(dist, file.file), "utf8")])));
const html = `<!doctype html><button id="pay">Pay</button><script type="module" src="/${sdk.file}"></script><script type="module" src="/${tagged.file}"></script>`;

const records = [];
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  const page = await browser.newPage();
  await page.route("https://app.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ body: html, contentType: "text/html" });
    if (scripts[path]) return route.fulfill({ body: scripts[path], contentType: "text/javascript" });
    return route.fulfill({ status: 404 });
  });
  await page.route("https://intake.test/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ headers: { "access-control-allow-headers": "authorization,content-type", "access-control-allow-origin": "*" }, status: 204 });
    }
    const body = JSON.parse(route.request().postData() ?? "{}");
    for (const rl of body.resourceLogs ?? []) for (const sl of rl.scopeLogs) for (const lr of sl.logRecords) {
      if (lr.eventName !== "exception") continue;
      const attributes = Object.fromEntries(lr.attributes.map((a) => [a.key, a.value.stringValue ?? a.value.boolValue ?? a.value.intValue]));
      records.push({ attributes, authorization: route.request().headers().authorization, browser: name });
    }
    return route.fulfill({ headers: { "access-control-allow-origin": "*" }, status: 200 });
  });
  await page.goto("https://app.test/");
  await page.click("#pay");
  await page.evaluate(() => window.reportHandled());
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(1500);
  await browser.close();
}
const map = JSON.parse(await readFile(tagged.mapPath, "utf8"));
await writeFile(output, JSON.stringify({ debugId: tagged.debugId, file: tagged.file, map, records }, null, 2));
console.log(`${records.length} exceptions from ${new Set(records.map((r) => r.browser)).size} browsers; debug ID ${tagged.debugId}`);
