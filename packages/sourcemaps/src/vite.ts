import type { Plugin } from "vite";
import { injectDebugIds } from "./inject.js";
import { uploadSourceMaps, type UploadOptions } from "./upload.js";

export interface SuperlogSourceMapsOptions extends Partial<UploadOptions> {
  // Fails the build when an upload fails. Default false: the build succeeds
  // and the failure is printed.
  failOnError?: boolean;
}

// Builds hidden source maps, tags the output with debug IDs, and uploads the
// maps. Without an API key the output is still tagged, so `superlog-sourcemaps
// upload` can send the maps later.
export function superlogSourceMaps(options: SuperlogSourceMapsOptions = {}): Plugin {
  let outDir = "dist";
  return {
    apply: "build",
    config(config) {
      // Hidden maps are written but not referenced from the scripts.
      if (config.build?.sourcemap === undefined || config.build.sourcemap === false) {
        return { build: { sourcemap: "hidden" } };
      }
      return undefined;
    },
    configResolved(config) {
      outDir = config.build.outDir.startsWith("/") ? config.build.outDir : `${config.root}/${config.build.outDir}`;
    },
    name: "superlog-sourcemaps",
    async writeBundle() {
      const files = await injectDebugIds(outDir);
      const apiKey = options.apiKey ?? process.env.SUPERLOG_API_KEY;
      if (!apiKey) {
        this.warn(`Tagged ${files.length} files. Set SUPERLOG_API_KEY to upload their source maps.`);
        return;
      }
      const result = await uploadSourceMaps(files, {
        ...options,
        apiKey,
        deleteAfterUpload: options.deleteAfterUpload ?? true,
        release: options.release ?? process.env.SUPERLOG_RELEASE,
      });
      const summary = `Uploaded ${result.uploaded} of ${files.length} source maps to Superlog.`;
      if (result.failed.length === 0) return this.info(summary);
      const details = result.failed.map((f) => `${f.file}: ${f.error}`).join("\n");
      if (options.failOnError) this.error(`${summary}\n${details}`);
      this.warn(`${summary}\n${details}`);
    },
  };
}
