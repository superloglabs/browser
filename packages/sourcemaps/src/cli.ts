#!/usr/bin/env node
import { parseArgs } from "node:util";
import { injectDebugIds } from "./inject.js";
import { uploadSourceMaps } from "./upload.js";

const usage = `Usage:
  superlog-sourcemaps inject <dir>
  superlog-sourcemaps upload <dir> [--release <version>] [--url <url>] [--delete]

upload tags the files first. It reads the API key from SUPERLOG_API_KEY.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    delete: { type: "boolean" },
    release: { type: "string" },
    url: { type: "string" },
  },
});
const [command, directory] = positionals;
if (!directory || (command !== "inject" && command !== "upload")) {
  console.error(usage);
  process.exit(2);
}

const files = await injectDebugIds(directory);
console.log(`Tagged ${files.length} files with debug IDs.`);
if (command === "upload") {
  const apiKey = process.env.SUPERLOG_API_KEY;
  if (!apiKey) {
    console.error("Set SUPERLOG_API_KEY to a workspace API key.");
    process.exit(2);
  }
  const result = await uploadSourceMaps(files, {
    apiKey,
    deleteAfterUpload: values.delete,
    release: values.release ?? process.env.SUPERLOG_RELEASE,
    url: values.url ?? process.env.SUPERLOG_URL,
  });
  console.log(`Uploaded ${result.uploaded} of ${files.length} source maps.`);
  for (const failure of result.failed) console.error(`${failure.file}: ${failure.error}`);
  if (result.failed.length > 0) process.exit(1);
}
