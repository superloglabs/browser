// Finds the debug IDs of the files in a stack, so the backend can match each
// frame to the source map uploaded for that exact file. @superlog/sourcemaps
// adds a registration to every built file that stores the file's debug ID
// under the stack of an error created in it.

const URL_IN_FRAME = /((?:https?|file|[a-z-]+-extension):\/\/[^\s()]+?):\d+:\d+/;

declare global {
  var __superlogDebugIds: Record<string, string> | undefined;
}

const seen = new Set<string>();
const byUrl = new Map<string, string>();

function refresh(): void {
  const registry = globalThis.__superlogDebugIds;
  if (!registry) return;
  for (const [stack, debugId] of Object.entries(registry)) {
    if (seen.has(stack)) continue;
    seen.add(stack);
    const url = URL_IN_FRAME.exec(stack)?.[1];
    if (url) byUrl.set(url, debugId);
  }
}

// The debug ID of each file in the stack that has one, by URL.
export function debugIdsFor(stacktrace: string | undefined): Record<string, string> | undefined {
  if (!stacktrace) return undefined;
  refresh();
  if (byUrl.size === 0) return undefined;
  const found: Record<string, string> = {};
  for (const match of stacktrace.matchAll(new RegExp(URL_IN_FRAME, "g"))) {
    const debugId = byUrl.get(match[1]!);
    if (debugId) found[match[1]!] = debugId;
  }
  return Object.keys(found).length ? found : undefined;
}
