import type { Attributes } from "@opentelemetry/api";
import type { LogRecordProcessor } from "@opentelemetry/sdk-logs";
import type { SpanProcessor } from "@opentelemetry/sdk-trace";

export type UrlPattern = string | RegExp;

// An error about to be sent. `beforeSend` may change it or drop it.
export interface ErrorEvent {
  type: string;
  message: string;
  stacktrace?: string;
  // Where the error was caught: `onerror`, `onunhandledrejection`, `react`,
  // or `manual`.
  mechanism: string;
  handled: boolean;
  attributes: Attributes;
}

export interface Breadcrumb {
  // `navigation`, `click`, `console`, `http`, or a name of your own.
  category: string;
  message: string;
  level?: "debug" | "info" | "warning" | "error";
  timestamp?: number;
  data?: Record<string, string | number | boolean>;
}

export interface User {
  id?: string;
  email?: string;
  name?: string;
  fullName?: string;
  roles?: string[];
}

export interface InitOptions {
  // Name of the application, sent as `service.name`.
  service: string;
  // Superlog ingest key. Sent as `Authorization: Bearer <key>`.
  ingestKey?: string;
  // OTLP/HTTP endpoint. `/v1/logs` and `/v1/traces` are added to it.
  endpoint?: string;
  // Headers for every export request, for any OTLP backend.
  headers?: Record<string, string>;
  // Version of the build, sent as `service.version`. Source maps are matched
  // by it.
  release?: string;
  // Sent as `deployment.environment.name`.
  environment?: string;
  resourceAttributes?: Attributes;
  // Cross-origin URLs that receive `traceparent`. Same-origin requests always
  // do. Other origins never do unless listed, since an unexpected header can
  // fail a CORS preflight.
  tracePropagationTargets?: UrlPattern[];
  // Share of traces kept, from 0 to 1. Errors are always sent.
  tracesSampleRate?: number;
  // Errors whose message matches are dropped. Strings match anywhere.
  ignoreErrors?: UrlPattern[];
  // Errors whose stack only has frames from these URLs are dropped.
  denyUrls?: UrlPattern[];
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;
  beforeBreadcrumb?: (breadcrumb: Breadcrumb) => Breadcrumb | null;
  maxBreadcrumbs?: number;
  // Errors sent per minute at most, so a loop cannot flood the backend.
  maxErrorsPerMinute?: number;
  // Removes secrets from URLs before they are recorded.
  sanitizeUrl?: (url: string) => string;
  instrumentations?: {
    // Traces fetch and XMLHttpRequest calls. Default on.
    fetch?: boolean;
    xhr?: boolean;
    // Sends a log for each page load and navigation. Default on.
    navigation?: boolean;
    // Sends page load timing. Default on.
    navigationTiming?: boolean;
    // Sends LCP, INP, CLS, FCP, and TTFB. Default on.
    webVitals?: boolean;
    // Records clicks and console output as breadcrumbs. Default on.
    clicks?: boolean;
    console?: boolean;
  };
  // Extra processors, such as an exporter to a second backend.
  logRecordProcessors?: LogRecordProcessor[];
  spanProcessors?: SpanProcessor[];
  // Session length limits, in milliseconds.
  session?: { inactivityTimeout?: number; maxDuration?: number };
  disabled?: boolean;
  debug?: boolean;
}
