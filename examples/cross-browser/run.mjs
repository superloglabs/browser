// Throws the same bug in Chromium, Firefox, and WebKit from a minified,
// content-hashed bundle and prints the exception logs each browser sends.
import { build } from "esbuild";
import { chromium, firefox, webkit } from "playwright";

const bundle = await build({
  bundle: true,
  entryPoints: [new URL("./app.js", import.meta.url).pathname],
  format: "esm",
  minify: true,
  nodePaths: [new URL("../../packages/browser/node_modules", import.meta.url).pathname],
  alias: { "@superlog/browser": new URL("../../packages/browser/dist/index.js", import.meta.url).pathname },
  platform: "browser",
  target: "es2020",
  write: false,
});
const script = bundle.outputFiles[0].text;
const html = '<!doctype html><button id="pay">Pay</button><script type="module" src="/assets/index-B9xK3d2a.js"></script>';

const records = [];
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  const page = await browser.newPage();
  await page.route("https://app.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ body: html, contentType: "text/html" });
    if (path.startsWith("/assets/")) return route.fulfill({ body: script, contentType: "text/javascript" });
    return route.fulfill({ status: 404 });
  });
  await page.route("https://intake.test/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ headers: { "access-control-allow-headers": "authorization,content-type", "access-control-allow-origin": "*" }, status: 204 });
    }
    const body = JSON.parse(route.request().postData() ?? "{}");
    for (const rl of body.resourceLogs ?? []) for (const sl of rl.scopeLogs) for (const lr of sl.logRecords) {
      if (lr.eventName !== "exception") continue;
      const attrs = Object.fromEntries(lr.attributes.map((a) => [a.key, a.value.stringValue ?? a.value.boolValue ?? a.value.intValue]));
      records.push({ attributes: attrs, authorization: route.request().headers().authorization, browser: name, severityNumber: lr.severityNumber });
    }
    return route.fulfill({ headers: { "access-control-allow-origin": "*" }, status: 200 });
  });
  await page.goto("https://app.test/");
  await page.click("#pay");
  await page.evaluate(() => window.reportHandled());
  // Hiding the page flushes what is queued, as a closing tab would.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(1500);
  await browser.close();
}
console.log(JSON.stringify(records));
