import type { Attributes, AttributeValue } from "@opentelemetry/api";
import type { CaptureOptions } from "./client.js";
import { currentClient } from "./init.js";
import type { Breadcrumb, User } from "./types.js";

export { DEFAULT_ENDPOINT, flush, init, shutdown } from "./init.js";
export type { CaptureOptions } from "./client.js";
export type { Breadcrumb, ErrorEvent, InitOptions, UrlPattern, User } from "./types.js";

export function captureException(error: unknown, options?: CaptureOptions): void {
  currentClient()?.captureException(error, options);
}

export function captureMessage(message: string, level?: "info" | "warning" | "error", attributes?: Attributes): void {
  currentClient()?.captureMessage(message, level, attributes);
}

export function addBreadcrumb(breadcrumb: Breadcrumb): void {
  currentClient()?.breadcrumbs.add(breadcrumb);
}

// The signed-in user, added to every log and span. Pass null on sign-out.
export function setUser(user: User | null): void {
  currentClient()?.scope.setUser(user);
}

// Attributes added to every log and span from now on. A value of undefined
// removes one.
export function setAttributes(attributes: Record<string, AttributeValue | undefined>): void {
  const client = currentClient();
  for (const [key, value] of Object.entries(attributes)) client?.scope.set(key, value);
}
