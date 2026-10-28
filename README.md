# Superlog browser SDK

Errors, sessions, traces, and Web Vitals for the browser, sent as standard
OpenTelemetry over OTLP/HTTP. It works with Superlog and with any OTLP
backend.

- `@superlog/browser`: error capture, breadcrumbs, user and attributes,
  filtering, sessions, fetch and XMLHttpRequest tracing, navigation, and Web
  Vitals.
- `@superlog/react`: an error boundary, React 19 root error handlers, and
  route patterns from React Router.
- `@superlog/sourcemaps`: a Vite plugin and a CLI that tag built files with
  debug IDs and upload their source maps, so errors show and group by the
  original code.

It is built on the OpenTelemetry Browser SIG packages
(`@opentelemetry/browser-sdk` and `@opentelemetry/browser-instrumentation`),
which provide the providers, exporters, sessions, and instrumentations.

## Install

```sh
npm install @superlog/browser @superlog/react
```

## Start it

Call `init` before the application renders.

```ts
import { init, setUser } from "@superlog/browser";

init({
  service: "storefront",
  ingestKey: import.meta.env.VITE_SUPERLOG_INGEST_KEY,
  release: import.meta.env.VITE_RELEASE,
  environment: import.meta.env.MODE,
  // Cross-origin APIs that should continue the trace. Same-origin requests
  // always do.
  tracePropagationTargets: ["https://api.example.com"],
});

setUser({ id: user.id, email: user.email });
```

To send to another OTLP backend, set `endpoint` and `headers` instead of
`ingestKey`.

## React

```tsx
import { ErrorBoundary, instrumentRouter, reactErrorHandler } from "@superlog/react";
import { createBrowserRouter, RouterProvider } from "react-router";

const router = createBrowserRouter(routes);
instrumentRouter(router);

createRoot(document.getElementById("root")!, {
  onCaughtError: reactErrorHandler(),
  onRecoverableError: reactErrorHandler(),
}).render(
  <ErrorBoundary fallback={({ reset }) => <button onClick={reset}>Try again</button>}>
    <RouterProvider router={router} />
  </ErrorBoundary>,
);
```

## Source maps

```ts
// vite.config.ts
import { superlogSourceMaps } from "@superlog/sourcemaps/vite";

export default defineConfig({
  plugins: [superlogSourceMaps({ release: process.env.RELEASE })],
});
```

The plugin builds hidden source maps, writes a debug ID into each file and
its map, uploads the maps with `SUPERLOG_API_KEY` (a workspace API key, not
the ingest key), and deletes them from the output. For other bundlers, run
the CLI on the build output:

```sh
SUPERLOG_API_KEY=... npx superlog-sourcemaps upload dist --release "$RELEASE" --delete
```

The SDK sends the debug IDs of the files in each error's stack as
`app.debug_ids`, and Superlog maps those frames back to the original file,
line, and function before grouping.

## Manual capture

```ts
import { addBreadcrumb, captureException, captureMessage, setAttributes } from "@superlog/browser";

try {
  await pay(cart);
} catch (error) {
  captureException(error, { attributes: { "payment.provider": "stripe" } });
}

addBreadcrumb({ category: "checkout", message: "payment started" });
setAttributes({ "app.plan": "pro" });
captureMessage("checkout took longer than 5s", "warning");
```

## What it sends

Each error is an OpenTelemetry log record with `eventName: "exception"` and
severity ERROR, which is how OpenTelemetry records exceptions as logs.

| Attribute | Value |
|---|---|
| `exception.type`, `exception.message`, `exception.stacktrace` | The error. Causes follow the stack as `Caused by:` |
| `exception.mechanism` | `onerror`, `onunhandledrejection`, `react`, or `manual` |
| `exception.handled` | Whether the application caught it |
| `app.breadcrumbs` | JSON array of the last clicks, navigations, console messages, and requests |
| `app.debug_ids` | JSON object of each file's debug ID by URL, for files tagged by `@superlog/sourcemaps` |
| `url.full` | The page |
| `url.template` | The route pattern, with `@superlog/react`'s router integration |
| `react.component_stack` | The component stack, from React |
| `session.id` | The session, on every log and span |
| `user.id`, `user.email`, `user.name` | From `setUser`, on every log and span |

The resource has `service.name`, `service.version` (the release),
`deployment.environment.name`, and the browser's `user_agent.original`,
`browser.platform`, `browser.brands`, `browser.mobile`, and
`browser.language`.

Other signals:

- Spans for fetch and XMLHttpRequest calls, with `traceparent` sent to the
  application's own origin and to `tracePropagationTargets`.
- Logs for page loads and navigations (`browser.navigation`), page load timing,
  and Web Vitals (`browser.web_vital`).

## Filtering

These are dropped before sending:

- `Script error.` without details.
- The ResizeObserver loop notice.
- Errors whose frames all come from browser extensions or from `denyUrls`.
- Errors matching `ignoreErrors`.
- The same error repeated within a second.
- Errors past `maxErrorsPerMinute` (30).

`beforeSend` can change or drop any error, and `beforeBreadcrumb` any
breadcrumb.

## Releasing

Bump `version` in each package, then push a tag such as `v0.1.1`. The Publish
workflow builds, tests, and publishes all three packages with npm trusted
publishing.

## Development

```sh
pnpm install
pnpm test        # Chromium, Firefox, and WebKit through Playwright
pnpm typecheck
pnpm size
node examples/cross-browser/run.mjs   # the same bug in three browsers, as sent
```
