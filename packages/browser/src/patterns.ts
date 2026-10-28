import type { UrlPattern } from "./types.js";

export function matches(value: string, patterns: readonly UrlPattern[]): boolean {
  return patterns.some((pattern) => (typeof pattern === "string" ? value.includes(pattern) : pattern.test(value)));
}
