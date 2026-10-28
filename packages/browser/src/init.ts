import { context, propagation, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { startBrowserSdk, type Instrumentation } from "@opentelemetry/browser-sdk";
import { browserDetector } from "@opentelemetry/browser-sdk/browser-detector";
import {
  createDefaultSessionIdGenerator,
  createLocalStorageSessionStore,
  createSessionLogRecordProcessor,
  createSessionManager,
  createSessionSpanProcessor,
} from "@opentelemetry/browser-sdk/session";
import { FetchInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/fetch";
import { NavigationInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/navigation";
import { NavigationTimingInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/navigation-timing";
import { WebVitalsInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/web-vitals";
import { XhrInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/xhr";
import {
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace";
import {
  Breadcrumbs,
  HttpBreadcrumbProcessor,
  NavigationBreadcrumbProcessor,
  recordClicks,
  recordConsole,
} from "./breadcrumbs.js";
import { Client } from "./client.js";
import { matches } from "./patterns.js";
import { Scope, ScopeLogRecordProcessor, ScopeSpanProcessor } from "./scope.js";
import type { InitOptions } from "./types.js";

export const DEFAULT_ENDPOINT = "https://intake.superlog.sh";
const SCOPE_NAME = "@superlog/browser";

interface Started {
  client: Client;
  stop: () => Promise<void>;
}

let started: Started | null = null;

export function currentClient(): Client | null {
  return started?.client ?? null;
}

// Starts error capture, sessions, tracing, and Web Vitals. Call it once, as
// early as possible, before the application renders.
export function init(options: InitOptions): Client | null {
  if (started) return started.client;
  if (options.disabled || typeof window === "undefined") return null;

  const endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");
  const headers = {
    ...(options.ingestKey ? { authorization: `Bearer ${options.ingestKey}` } : {}),
    ...options.headers,
  };
  const isExport = (url: string) => url.startsWith(endpoint);
  const enabled = { clicks: true, console: true, fetch: true, navigation: true, navigationTiming: true, webVitals: true, xhr: true, ...options.instrumentations };

  const breadcrumbs = new Breadcrumbs(options.maxBreadcrumbs ?? 50, options.beforeBreadcrumb);
  const scope = new Scope();
  const sessions = createSessionManager({
    inactivityTimeout: options.session?.inactivityTimeout ?? 30 * 60_000,
    maxDuration: options.session?.maxDuration ?? 4 * 60 * 60_000,
    sessionIdGenerator: createDefaultSessionIdGenerator(),
    sessionStore: createLocalStorageSessionStore(),
  });
  void sessions.start();

  const propagateTo = options.tracePropagationTargets ?? [];
  const ignoreUrls = [new RegExp(`^${endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)];
  const sanitizeUrl = options.sanitizeUrl;
  const instrumentations: Instrumentation[] = [];
  if (enabled.navigation) instrumentations.push(new NavigationInstrumentation({ sanitizeUrl, useNavigationApiIfAvailable: true }));
  if (enabled.navigationTiming) instrumentations.push(new NavigationTimingInstrumentation());
  if (enabled.webVitals) instrumentations.push(new WebVitalsInstrumentation());
  if (enabled.fetch) instrumentations.push(new FetchInstrumentation({ ignoreUrls, propagateTraceHeaderCorsUrls: propagateTo, sanitizeUrl }));
  if (enabled.xhr) instrumentations.push(new XhrInstrumentation({ ignoreUrls, propagateTraceHeaderCorsUrls: propagateTo, sanitizeUrl }));

  const rate = options.tracesSampleRate ?? 1;
  const sdk = startBrowserSdk({
    exportConfig: { headers, url: endpoint },
    instrumentations,
    logLevel: options.debug ? "DEBUG" : "WARN",
    logs: {
      exportConfig: { headers, url: `${endpoint}/v1/logs` },
      processors: [
        createSessionLogRecordProcessor(sessions),
        new ScopeLogRecordProcessor(scope),
        new NavigationBreadcrumbProcessor(breadcrumbs),
        ...(options.logRecordProcessors ?? []),
      ],
    },
    resourceAttributes: {
      ...browserDetector.detect().attributes,
      ...(options.environment ? { "deployment.environment.name": options.environment } : {}),
      ...options.resourceAttributes,
    },
    serviceName: options.service,
    ...(options.release ? { serviceVersion: options.release } : {}),
    traces: {
      exportConfig: { headers, url: `${endpoint}/v1/traces` },
      processors: [
        createSessionSpanProcessor(sessions),
        new ScopeSpanProcessor(scope),
        new HttpBreadcrumbProcessor(breadcrumbs, (url) => isExport(url) || matches(url, ignoreUrls)),
        ...(options.spanProcessors ?? []),
      ],
      sampler: rate >= 1 ? new ParentBasedSampler({ root: new AlwaysOnSampler() }) : new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(rate) }),
    },
  });

  const client = new Client(options, logs.getLogger(SCOPE_NAME), breadcrumbs, scope);
  const stops = [
    listenForErrors(client),
    enabled.clicks ? recordClicks(breadcrumbs) : () => {},
    enabled.console ? recordConsole(breadcrumbs) : () => {},
  ];
  started = {
    client,
    stop: async () => {
      for (const stop of stops) stop();
      sessions.shutdown();
      await sdk.shutdown();
      // Unregisters the global providers so init can run again, as in tests.
      logs.disable();
      trace.disable();
      propagation.disable();
      context.disable();
    },
  };
  return client;
}

function listenForErrors(client: Client): () => void {
  const onError = (event: globalThis.ErrorEvent) => {
    client.captureException(event.error ?? event.message, { handled: false, mechanism: "onerror" });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    client.captureException(event.reason, { handled: false, mechanism: "onunhandledrejection" });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

// Sends everything recorded so far. Call it before the page unloads on your
// own terms, such as before a redirect.
export async function flush(): Promise<void> {
  const loggerProvider = logs.getLoggerProvider() as { forceFlush?: () => Promise<void> };
  const tracerProvider = trace.getTracerProvider() as { getDelegate?: () => { forceFlush?: () => Promise<void> }; forceFlush?: () => Promise<void> };
  const delegate = tracerProvider.getDelegate?.() ?? tracerProvider;
  await Promise.all([loggerProvider.forceFlush?.(), delegate.forceFlush?.()]);
}

export async function shutdown(): Promise<void> {
  const current = started;
  started = null;
  await current?.stop();
}
