import type { Attributes, AttributeValue, Context } from "@opentelemetry/api";
import type { LogRecordProcessor, SdkLogRecord } from "@opentelemetry/sdk-logs";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace";
import type { User } from "./types.js";

// Attributes added to every log and span: the user, the route, and any set
// with `setAttributes`.
export class Scope {
  private attributes: Attributes = {};

  set(key: string, value: AttributeValue | undefined): void {
    if (value === undefined || value === null) delete this.attributes[key];
    else this.attributes[key] = value;
  }

  setUser(user: User | null): void {
    this.set("user.id", user?.id);
    this.set("user.email", user?.email);
    this.set("user.name", user?.name);
    this.set("user.full_name", user?.fullName);
    this.set("user.roles", user?.roles);
  }

  all(): Attributes {
    return this.attributes;
  }
}

export class ScopeLogRecordProcessor implements LogRecordProcessor {
  constructor(private readonly scope: Scope) {}

  onEmit(record: SdkLogRecord, _context?: Context): void {
    for (const [key, value] of Object.entries(this.scope.all())) {
      if (value !== undefined && record.attributes[key] === undefined) record.setAttribute(key, value);
    }
  }

  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

export class ScopeSpanProcessor implements SpanProcessor {
  constructor(private readonly scope: Scope) {}

  onStart(span: Span, _context: Context): void {
    for (const [key, value] of Object.entries(this.scope.all())) {
      if (value !== undefined) span.setAttribute(key, value);
    }
  }

  onEnd(_span: ReadableSpan): void {}
  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}
