// Turns whatever was thrown into an exception type, message, and stack.

const MAX_CAUSES = 5;
const MAX_MESSAGE = 4_000;

export interface Exception {
  type: string;
  message: string;
  stacktrace?: string;
}

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  cause?: unknown;
}

function isErrorLike(value: unknown): value is ErrorLike {
  return typeof value === "object" && value !== null && "message" in value && ("name" in value || "stack" in value);
}

// Firefox and Safari stacks have no `Type: message` line, so it is added to
// keep every browser's stack readable on its own.
function stackOf(error: ErrorLike, type: string, message: string): string | undefined {
  if (typeof error.stack !== "string" || !error.stack) return undefined;
  return error.stack.startsWith(`${type}`) ? error.stack : `${type}: ${message}\n${error.stack}`;
}

function describe(value: unknown): string {
  if (typeof Event !== "undefined" && value instanceof Event) {
    const target = value.target as { tagName?: string } | null;
    return `Event \`${value.type}\`${target?.tagName ? ` on <${target.tagName.toLowerCase()}>` : ""}`;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function toException(value: unknown, fallbackType = "Error"): Exception {
  if (isErrorLike(value)) {
    const type = typeof value.name === "string" && value.name ? value.name : "Error";
    const message = String(value.message ?? "").slice(0, MAX_MESSAGE);
    let stacktrace = stackOf(value, type, message);
    // The causes follow the error, as Node prints them.
    let cause = value.cause;
    for (let depth = 0; depth < MAX_CAUSES && cause !== undefined && cause !== null; depth += 1) {
      const inner = toException(cause);
      stacktrace = `${stacktrace ?? `${type}: ${message}`}\nCaused by: ${inner.stacktrace ?? `${inner.type}: ${inner.message}`}`;
      cause = isErrorLike(cause) ? cause.cause : undefined;
    }
    return { message, stacktrace, type };
  }
  if (typeof value === "string") return { message: value.slice(0, MAX_MESSAGE), type: fallbackType };
  return { message: describe(value).slice(0, MAX_MESSAGE), type: fallbackType };
}
