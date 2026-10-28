import { captureException } from "@superlog/browser/api";

type RootErrorInfo = { componentStack?: string | null };

// For React 19's `createRoot` and `hydrateRoot` options: `onUncaughtError`,
// `onCaughtError`, and `onRecoverableError`. Recoverable errors include
// hydration mismatches, which no boundary sees.
export function reactErrorHandler(callback?: (error: unknown, info: RootErrorInfo) => void) {
  return (error: unknown, info: RootErrorInfo): void => {
    captureException(error, {
      attributes: info.componentStack ? { "react.component_stack": info.componentStack } : {},
      handled: true,
      mechanism: "react",
    });
    callback?.(error, info);
  };
}
