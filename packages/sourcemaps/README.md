# @superlog/sourcemaps

Tags built JavaScript with debug IDs and uploads its source maps to Superlog,
so browser errors show and group by the original code.

```ts
// vite.config.ts
import { superlogSourceMaps } from "@superlog/sourcemaps/vite";

export default defineConfig({ plugins: [superlogSourceMaps({ release: process.env.RELEASE })] });
```

For other bundlers:

```sh
SUPERLOG_API_KEY=... npx superlog-sourcemaps upload dist --release "$RELEASE" --delete
```

See the [repository README](https://github.com/superloglabs/browser#source-maps).
