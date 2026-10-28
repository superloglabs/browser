# @superlog/browser

Errors, breadcrumbs, sessions, traces, and Web Vitals for the browser, sent as
OpenTelemetry over OTLP/HTTP to Superlog or any OTLP backend.

```ts
import { init } from "@superlog/browser";

init({ service: "storefront", ingestKey: import.meta.env.VITE_SUPERLOG_INGEST_KEY });
```

See the [repository README](https://github.com/superloglabs/browser#readme) for options and what is sent.
