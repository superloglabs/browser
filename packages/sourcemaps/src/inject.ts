import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

// A built JavaScript file and its source map, tagged with one debug ID.
export interface TaggedFile {
  debugId: string;
  // The file's path relative to the build directory, as it is served.
  file: string;
  mapPath: string;
}

const DEBUG_ID_COMMENT = /\/\/# debugId=([0-9a-f-]{36})\s*$/m;
const SOURCE_MAP_COMMENT = /\/\/# sourceMappingURL=(\S+)\s*$/m;
const SCRIPT = /\.(?:m?js|cjs)$/;

// Registers the file's debug ID under the stack of an error created in the
// file, so the SDK can tell which file a frame's URL is. It runs when the file
// is evaluated and is wrapped so it can never throw.
function registration(debugId: string): string {
  return `;!function(){try{var g=typeof globalThis!="undefined"?globalThis:typeof window!="undefined"?window:self,s=new g.Error().stack;s&&((g.__superlogDebugIds=g.__superlogDebugIds||{})[s]="${debugId}")}catch(e){}}();`;
}

// The same content always gets the same ID, so rebuilding unchanged code
// does not upload a second copy.
export function debugIdFor(content: string): string {
  const hex = createHash("sha256").update(content).digest("hex");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function scripts(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && SCRIPT.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

function mapPathFor(scriptPath: string, code: string): string | null {
  const reference = code.match(SOURCE_MAP_COMMENT)?.[1];
  if (reference && !reference.startsWith("data:")) return resolve(dirname(scriptPath), reference.split(/[?#]/)[0]!);
  return `${scriptPath}.map`;
}

// Tags every script in the directory that has a source map. The registration
// is added after the code, so the map's line and column positions stay valid.
// Running it again on the same files changes nothing.
export async function injectDebugIds(directory: string): Promise<TaggedFile[]> {
  const root = resolve(directory);
  const tagged: TaggedFile[] = [];
  for (const scriptPath of await scripts(root)) {
    const code = await readFile(scriptPath, "utf8");
    const mapPath = mapPathFor(scriptPath, code);
    if (!mapPath) continue;
    let mapText: string;
    try {
      mapText = await readFile(mapPath, "utf8");
    } catch {
      continue;
    }
    const map = JSON.parse(mapText) as { debugId?: string; debug_id?: string };
    const existing = code.match(DEBUG_ID_COMMENT)?.[1];
    const debugId = existing ?? map.debugId ?? debugIdFor(code);
    if (!existing) {
      const comment = code.match(SOURCE_MAP_COMMENT);
      const tag = `${registration(debugId)}\n//# debugId=${debugId}\n`;
      const updated = comment?.index !== undefined
        ? `${code.slice(0, comment.index)}${tag}${code.slice(comment.index)}`
        : `${code.replace(/\n?$/, "\n")}${tag}`;
      await writeFile(scriptPath, updated);
    }
    if (map.debugId !== debugId) {
      map.debugId = debugId;
      await writeFile(mapPath, JSON.stringify(map));
    }
    tagged.push({ debugId, file: relative(root, scriptPath).split("\\").join("/"), mapPath });
  }
  return tagged;
}
