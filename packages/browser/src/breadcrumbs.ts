import type { Context } from "@opentelemetry/api";
import type { LogRecordProcessor, SdkLogRecord } from "@opentelemetry/sdk-logs";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace";
import type { Breadcrumb } from "./types.js";

const MAX_MESSAGE = 200;

// The most recent things that happened on the page, sent with each error.
export class Breadcrumbs {
  private readonly items: Breadcrumb[] = [];

  constructor(
    private readonly max: number,
    private readonly before?: (breadcrumb: Breadcrumb) => Breadcrumb | null,
  ) {}

  add(breadcrumb: Breadcrumb): void {
    if (this.max <= 0) return;
    let kept: Breadcrumb | null = { ...breadcrumb, timestamp: breadcrumb.timestamp ?? Date.now() };
    if (this.before) {
      try {
        kept = this.before(kept);
      } catch {
        // A failing hook keeps the breadcrumb as it was.
      }
    }
    if (!kept) return;
    this.items.push({ ...kept, message: kept.message.slice(0, MAX_MESSAGE), timestamp: kept.timestamp ?? Date.now() });
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }

  // Oldest first, as JSON for a log attribute.
  serialize(): string | undefined {
    return this.items.length ? JSON.stringify(this.items) : undefined;
  }

  clear(): void {
    this.items.length = 0;
  }
}

// Navigations become breadcrumbs as the navigation instrumentation logs them.
export class NavigationBreadcrumbProcessor implements LogRecordProcessor {
  constructor(private readonly breadcrumbs: Breadcrumbs) {}

  onEmit(record: SdkLogRecord, _context?: Context): void {
    if (record.eventName !== "browser.navigation") return;
    const url = record.attributes["url.full"];
    if (typeof url === "string") this.breadcrumbs.add({ category: "navigation", message: url });
  }

  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

// Finished fetch and XMLHttpRequest spans become breadcrumbs.
export class HttpBreadcrumbProcessor implements SpanProcessor {
  constructor(
    private readonly breadcrumbs: Breadcrumbs,
    private readonly ignore: (url: string) => boolean,
  ) {}

  onStart(_span: Span, _context: Context): void {}

  onEnd(span: ReadableSpan): void {
    const method = span.attributes["http.request.method"];
    const url = span.attributes["url.full"];
    if (typeof method !== "string" || typeof url !== "string" || this.ignore(url)) return;
    const status = span.attributes["http.response.status_code"];
    const [seconds, nanos] = span.duration;
    const data: Record<string, string | number> = { duration_ms: Math.round(seconds * 1_000 + nanos / 1e6), method };
    if (typeof status === "number") data.status_code = status;
    this.breadcrumbs.add({
      category: "http",
      data,
      level: typeof status === "number" && status >= 400 ? "error" : "info",
      message: `${method} ${url.split("?")[0]}${typeof status === "number" ? ` ${status}` : ""}`,
    });
  }

  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

// A short selector for the clicked element: tag, id, and classes, with the
// nearest parent that has an id.
export function describeElement(element: Element): string {
  const part = (node: Element) => {
    const id = node.id ? `#${node.id}` : "";
    const classes = typeof node.className === "string" && node.className.trim()
      ? `.${node.className.trim().split(/\s+/).slice(0, 3).join(".")}`
      : "";
    return `${node.tagName.toLowerCase()}${id}${classes}`;
  };
  const parent = element.parentElement?.closest("[id]");
  const label = (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40);
  return `${parent && !element.id ? `${part(parent)} > ` : ""}${part(element)}${label ? ` "${label}"` : ""}`;
}

export function recordClicks(breadcrumbs: Breadcrumbs): () => void {
  const listener = (event: Event) => {
    const target = event.target;
    if (target instanceof Element) breadcrumbs.add({ category: "click", message: describeElement(target) });
  };
  document.addEventListener("click", listener, { capture: true, passive: true });
  return () => document.removeEventListener("click", listener, { capture: true });
}

const CONSOLE_LEVELS = { debug: "debug", error: "error", info: "info", log: "info", warn: "warning" } as const;

export function recordConsole(breadcrumbs: Breadcrumbs): () => void {
  const originals = new Map<keyof typeof CONSOLE_LEVELS, (...args: unknown[]) => void>();
  for (const method of Object.keys(CONSOLE_LEVELS) as (keyof typeof CONSOLE_LEVELS)[]) {
    const original = console[method];
    if (typeof original !== "function") continue;
    originals.set(method, original);
    console[method] = function (this: Console, ...args: unknown[]) {
      try {
        breadcrumbs.add({
          category: "console",
          level: CONSOLE_LEVELS[method],
          message: args.map((arg) => (typeof arg === "string" ? arg : safeString(arg))).join(" "),
        });
      } catch {
        // Recording never breaks the console.
      }
      return original.apply(this, args);
    };
  }
  return () => {
    for (const [method, original] of originals) console[method] = original;
  };
}

function safeString(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
