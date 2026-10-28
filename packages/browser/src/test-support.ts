import { vi } from "vitest";
import { flush } from "./init.js";

type AnyValue = { stringValue?: string; boolValue?: boolean; intValue?: string | number; doubleValue?: number; arrayValue?: { values: AnyValue[] } };
type KeyValue = { key: string; value: AnyValue };

function value(v: AnyValue): unknown {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.boolValue !== undefined) return v.boolValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.arrayValue) return v.arrayValue.values.map(value);
  return undefined;
}

function attributes(list: KeyValue[] | undefined): Record<string, unknown> {
  return Object.fromEntries((list ?? []).map((kv) => [kv.key, value(kv.value)]));
}

export interface SentLog {
  attributes: Record<string, unknown>;
  body: unknown;
  eventName?: string;
  resource: Record<string, unknown>;
  severityNumber?: number;
  traceId?: string;
}

export interface SentSpan {
  attributes: Record<string, unknown>;
  name: string;
  resource: Record<string, unknown>;
}

// Records the OTLP/HTTP requests the SDK makes.
export function captureExports() {
  const requests: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ? JSON.parse(new TextDecoder().decode(init.body as Uint8Array)) : null;
    requests.push({ body, headers: Object.fromEntries(new Headers(init?.headers).entries()), url });
    return new Response(null, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);

  return {
    requests,
    async logs(): Promise<SentLog[]> {
      await flush();
      return requests.filter((r) => r.url.endsWith("/v1/logs")).flatMap((r) =>
        r.body.resourceLogs.flatMap((rl: any) =>
          rl.scopeLogs.flatMap((sl: any) =>
            sl.logRecords.map((lr: any) => ({
              attributes: attributes(lr.attributes),
              body: lr.body ? value(lr.body) : undefined,
              eventName: lr.eventName,
              resource: attributes(rl.resource.attributes),
              severityNumber: lr.severityNumber,
              traceId: lr.traceId,
            })))));
    },
    async spans(): Promise<SentSpan[]> {
      await flush();
      return requests.filter((r) => r.url.endsWith("/v1/traces")).flatMap((r) =>
        r.body.resourceSpans.flatMap((rs: any) =>
          rs.scopeSpans.flatMap((ss: any) =>
            ss.spans.map((s: any) => ({ attributes: attributes(s.attributes), name: s.name, resource: attributes(rs.resource.attributes) })))));
    },
  };
}

export function exceptions(logs: SentLog[]): SentLog[] {
  return logs.filter((log) => log.eventName === "exception");
}
