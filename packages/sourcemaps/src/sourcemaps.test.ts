import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { injectDebugIds, uploadSourceMaps } from "./index.js";

const source = `export function renderTotal(cart) {\n  return cart.total.toFixed(2);\n}\nexport function loadCart(id) {\n  return renderTotal({ a: { total: 1 } }[id]);\n}\n`;

async function builtApp(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "superlog-sourcemaps-"));
  await mkdir(join(directory, "src"));
  await writeFile(join(directory, "src", "cart.js"), source);
  await build({
    bundle: true,
    entryNames: "assets/[name]-[hash]",
    entryPoints: [join(directory, "src", "cart.js")],
    format: "esm",
    minify: true,
    outdir: join(directory, "dist"),
    sourcemap: true,
  });
  return join(directory, "dist");
}

describe("injectDebugIds", () => {
  it("tags each script and its map with one debug ID and keeps positions valid", async () => {
    const dist = await builtApp();
    const [script] = (await readdir(join(dist, "assets"))).filter((name) => name.endsWith(".js"));
    const scriptPath = join(dist, "assets", script!);
    const before = await readFile(scriptPath, "utf8");
    const column = before.indexOf(".total");

    const [tagged, ...rest] = await injectDebugIds(dist);
    expect(rest).toEqual([]);
    expect(tagged?.file).toBe(`assets/${script}`);

    const after = await readFile(scriptPath, "utf8");
    const map = JSON.parse(await readFile(`${scriptPath}.map`, "utf8"));
    expect(map.debugId).toBe(tagged?.debugId);
    expect(after).toContain(`//# debugId=${tagged?.debugId}`);
    expect(after).toContain(`__superlogDebugIds`);
    // The sourceMappingURL comment stays last, and code before it is unchanged.
    expect(after.trimEnd().split("\n").at(-1)).toMatch(/^\/\/# sourceMappingURL=/);
    expect(after.startsWith(before.slice(0, before.lastIndexOf("//# sourceMappingURL")))).toBe(true);
    const position = originalPositionFor(new TraceMap(map), { column, line: 1 });
    expect(position).toMatchObject({ line: 2, source: expect.stringContaining("src/cart.js") });
  });

  it("changes nothing when run again", async () => {
    const dist = await builtApp();
    const [first] = await injectDebugIds(dist);
    const snapshot = await readFile(join(dist, first!.file), "utf8");
    const [second] = await injectDebugIds(dist);

    expect(second?.debugId).toBe(first?.debugId);
    expect(await readFile(join(dist, first!.file), "utf8")).toBe(snapshot);
  });

  it("registers the debug ID under a stack from the file when it runs", async () => {
    const dist = await builtApp();
    const [tagged] = await injectDebugIds(dist);
    const code = await readFile(join(dist, tagged!.file), "utf8");
    const registration = code.split("\n").find((line) => line.includes("__superlogDebugIds"))!;
    const scope: { __superlogDebugIds?: Record<string, string>; Error: ErrorConstructor } = { Error };
    new Function("globalThis", registration)(scope);

    expect(Object.values(scope.__superlogDebugIds ?? {})).toEqual([tagged?.debugId]);
  });
});

describe("uploadSourceMaps", () => {
  const servers: { close: () => void }[] = [];
  afterEach(() => servers.splice(0).forEach((server) => server.close()));

  it("uploads each map under its debug ID with the file and release", async () => {
    const received: { authorization?: string; body: string; url: string }[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        received.push({ authorization: request.headers.authorization, body, url: request.url ?? "" });
        response.writeHead(request.url?.includes("fail") ? 500 : 201).end("{}");
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    const dist = await builtApp();
    const files = await injectDebugIds(dist);

    const result = await uploadSourceMaps(files, { apiKey: "sk_test", deleteAfterUpload: true, release: "1.4.2", url: `http://127.0.0.1:${port}` });

    expect(result).toEqual({ failed: [], uploaded: 1 });
    expect(received[0]?.authorization).toBe("Bearer sk_test");
    expect(received[0]?.url).toBe(`/api/v1/source-maps/${files[0]?.debugId}?file=${encodeURIComponent(files[0]!.file)}&release=1.4.2`);
    expect(JSON.parse(received[0]!.body).debugId).toBe(files[0]?.debugId);
    await expect(readFile(files[0]!.mapPath)).rejects.toThrow();
  });
});
