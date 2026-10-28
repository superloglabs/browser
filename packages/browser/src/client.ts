import type { Attributes } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import type { Logger } from "@opentelemetry/api-logs";
import type { Breadcrumbs } from "./breadcrumbs.js";
import { type Exception, toException } from "./exception.js";
import { matches } from "./patterns.js";
import type { Scope } from "./scope.js";
import type { ErrorEvent, InitOptions, UrlPattern } from "./types.js";

// Browser noise that says nothing about the application: cross-origin script
// errors without details and the ResizeObserver loop notice.
const DEFAULT_IGNORE_ERRORS: UrlPattern[] = [
  /^Script error\.?$/,
  /^ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)/,
];

const EXTENSION_URL = /(?:chrome|moz|safari|safari-web|ms-browser)-extension:\/\//;
const FRAME_URL = /(?:\(|@|\s)((?:https?|[a-z-]+-extension|file):\/\/[^\s)]+?)(?::\d+){1,2}\)?\s*$/;
const DEDUPE_WINDOW_MS = 1_000;

export interface CaptureOptions {
  attributes?: Attributes;
  handled?: boolean;
  mechanism?: string;
}

export class Client {
  private recent: { key: string; at: number } | null = null;
  private sent: number[] = [];

  constructor(
    private readonly options: InitOptions,
    private readonly logger: Logger,
    readonly breadcrumbs: Breadcrumbs,
    readonly scope: Scope,
  ) {}

  captureException(value: unknown, options: CaptureOptions = {}): void {
    this.capture(toException(value), options);
  }

  captureMessage(message: string, level: "info" | "warning" | "error" = "info", attributes?: Attributes): void {
    const severity = { error: SeverityNumber.ERROR, info: SeverityNumber.INFO, warning: SeverityNumber.WARN }[level];
    this.logger.emit({
      attributes: { ...attributes, ...this.breadcrumbAttributes(), ...this.pageAttributes() },
      body: message,
      severityNumber: severity,
      severityText: level.toUpperCase(),
    });
  }

  private capture(exception: Exception, options: CaptureOptions): void {
    let event: ErrorEvent | null = {
      attributes: { ...options.attributes },
      handled: options.handled ?? true,
      mechanism: options.mechanism ?? "manual",
      message: exception.message,
      stacktrace: exception.stacktrace,
      type: exception.type,
    };
    if (this.ignored(event) || this.duplicate(event) || this.overLimit()) return;
    if (this.options.beforeSend) {
      try {
        event = this.options.beforeSend(event);
      } catch {
        // A failing hook sends the error as it was.
      }
      if (!event) return;
    }
    this.sent.push(Date.now());
    this.logger.emit({
      attributes: {
        ...this.pageAttributes(),
        ...event.attributes,
        ...this.breadcrumbAttributes(),
        "exception.handled": event.handled,
        "exception.mechanism": event.mechanism,
        "exception.message": event.message,
        "exception.type": event.type,
        ...(event.stacktrace ? { "exception.stacktrace": event.stacktrace } : {}),
      },
      // The body repeats the message so backends that group logs by body
      // still tell errors apart.
      body: event.message || event.type,
      eventName: "exception",
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
    });
  }

  private ignored(event: ErrorEvent): boolean {
    const text = event.message || event.type;
    if (matches(text, [...DEFAULT_IGNORE_ERRORS, ...(this.options.ignoreErrors ?? [])])) return true;
    if (matches(`${event.type}: ${event.message}`, this.options.ignoreErrors ?? [])) return true;
    const urls = framesUrls(event.stacktrace);
    if (urls.length === 0) return false;
    // Errors raised only by browser extensions or denied scripts are not the
    // application's.
    const denied = this.options.denyUrls ?? [];
    return urls.every((url) => EXTENSION_URL.test(url) || matches(url, denied));
  }

  // The same error raised again at once, as by a handler that runs on every
  // frame, is sent once.
  private duplicate(event: ErrorEvent): boolean {
    const key = `${event.type}\n${event.message}\n${event.stacktrace ?? ""}`;
    const now = Date.now();
    const repeated = this.recent?.key === key && now - this.recent.at < DEDUPE_WINDOW_MS;
    this.recent = { at: now, key };
    return repeated;
  }

  private overLimit(): boolean {
    const now = Date.now();
    this.sent = this.sent.filter((at) => now - at < 60_000);
    return this.sent.length >= (this.options.maxErrorsPerMinute ?? 30);
  }

  private breadcrumbAttributes(): Attributes {
    const serialized = this.breadcrumbs.serialize();
    return serialized ? { "app.breadcrumbs": serialized } : {};
  }

  private pageAttributes(): Attributes {
    if (typeof location === "undefined") return {};
    const url = this.options.sanitizeUrl ? this.options.sanitizeUrl(location.href) : location.href;
    return { "url.full": url };
  }
}

function framesUrls(stacktrace: string | undefined): string[] {
  if (!stacktrace) return [];
  const urls: string[] = [];
  for (const line of stacktrace.split("\n")) {
    const match = line.trim().match(FRAME_URL);
    if (match?.[1]) urls.push(match[1]);
  }
  return urls;
}
