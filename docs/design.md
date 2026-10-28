# Design

## Goal

Frontend error tracking on par with Sentry's browser SDK, sent as
OpenTelemetry so customers are not tied to one backend.

## Layers

1. **OpenTelemetry Browser SIG packages** provide the logger and tracer
   providers, OTLP/HTTP export with `keepalive` fetch and flushing when the
   page is hidden, sessions stored in localStorage, the browser resource,
   and the fetch, XHR, navigation, navigation timing, and Web Vitals
   instrumentations. They are pre-1.0, so versions are pinned and nothing of
   theirs is part of this package's API.
2. **`@superlog/browser`** adds what those packages do not have:
   - Error capture through `onerror` and `unhandledrejection`, with causes,
     non-error values, and DOM events described.
   - Breadcrumbs from clicks, console calls, navigation logs, and HTTP spans,
     kept in memory and sent only with errors.
   - The user and custom attributes on every log and span.
   - Filtering: default browser noise, extension frames, `ignoreErrors`,
     `denyUrls`, `beforeSend`, deduplication, and a per-minute limit.
   - Manual `captureException` and `captureMessage`.
3. **`@superlog/react`** adds the error boundary, React 19 root handlers
   (hydration errors arrive through `onRecoverableError`), and `url.template`
   from React Router data routers.

## Choices

- **Errors are logs, not span events.** OpenTelemetry records exceptions as
  log records with `exception.*` attributes, and Superlog's error issues
  already read ERROR logs. The body repeats the message.
- **Clicks and console output are breadcrumbs only.** Exporting every click
  as a log, as the SIG user-action instrumentation does, costs more than it
  shows. Navigations and Web Vitals are exported, since they are few and
  useful on their own.
- **HTTP breadcrumbs come from spans.** Requests are already traced, so the
  breadcrumb reads the finished span instead of wrapping fetch twice. An
  unsampled trace has no breadcrumb.
- **Trace headers go to the same origin only by default.** Sending
  `traceparent` everywhere can fail third-party CORS preflights.
- **No offline queue yet.** The exporter retries in memory. IndexedDB
  buffering is planned.

## Not done yet

- Source maps: a build plugin that adds debug IDs and uploads maps, and
  symbolication on ingest before errors are grouped. Minified stacks group
  by minified names until then.
- `@superlog/next` for the Next.js client, server, and edge runtimes.
- Offline buffering, long animation frames, session replay, and release
  health.

## Cross-browser grouping

`examples/cross-browser/run.mjs` throws the same bug from a minified,
content-hashed bundle in Chromium, Firefox, and WebKit. With Superlog's v2
fingerprint and the Firefox fix in responder-oss#435, Chromium and Firefox
errors land in one issue although their messages differ. WebKit's do not:
Safari drops the frames of tail calls (`return f(x)` in strict code) and
leaves arrow functions unnamed. Symbolication with source maps narrows this;
it cannot restore frames Safari never recorded.

## Size

`pnpm size`: about 39 KB gzipped for `init`, with tracing, Web Vitals, and
sessions. Sentry's errors-only bundle is about 29 KB and its bundle with
tracing about 51 KB. An errors-only entry point would cut ours further.
