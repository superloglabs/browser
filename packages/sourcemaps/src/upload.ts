import { readFile, rm } from "node:fs/promises";
import type { TaggedFile } from "./inject.js";

export const DEFAULT_URL = "https://superlog.sh";

export interface UploadOptions {
  // A workspace API key, from Settings → API keys. Not the ingest key.
  apiKey: string;
  // The release the files belong to, shown on the source map.
  release?: string;
  // The Superlog app, for self-hosted installs.
  url?: string;
  // Removes the source maps after upload, so they are not served publicly.
  deleteAfterUpload?: boolean;
  concurrency?: number;
}

export interface UploadResult {
  failed: { file: string; error: string }[];
  uploaded: number;
}

export async function uploadSourceMaps(files: TaggedFile[], options: UploadOptions): Promise<UploadResult> {
  const base = (options.url ?? DEFAULT_URL).replace(/\/+$/, "");
  const result: UploadResult = { failed: [], uploaded: 0 };
  const queue = [...files];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const params = new URLSearchParams({ file: next.file, ...(options.release ? { release: options.release } : {}) });
      try {
        const response = await fetch(`${base}/api/v1/source-maps/${next.debugId}?${params}`, {
          body: await readFile(next.mapPath),
          headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
          method: "PUT",
        });
        if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
        result.uploaded += 1;
        if (options.deleteAfterUpload) await rm(next.mapPath, { force: true });
      } catch (error) {
        result.failed.push({ error: error instanceof Error ? error.message : String(error), file: next.file });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 4) }, worker));
  return result;
}
