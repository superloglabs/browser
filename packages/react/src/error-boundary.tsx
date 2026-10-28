import { captureException } from "@superlog/browser/api";
import { Component, type ErrorInfo, type ReactNode } from "react";

export interface FallbackProps {
  error: unknown;
  // Clears the error and renders the children again.
  reset: () => void;
}

export interface ErrorBoundaryProps {
  children?: ReactNode;
  fallback?: ReactNode | ((props: FallbackProps) => ReactNode);
  onError?: (error: unknown, info: ErrorInfo) => void;
  onReset?: () => void;
}

interface State {
  error: unknown;
  failed: boolean;
}

// Sends render errors with the component stack, then shows the fallback.
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    captureException(error, {
      attributes: info.componentStack ? { "react.component_stack": info.componentStack } : {},
      handled: true,
      mechanism: "react",
    });
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.props.onReset?.();
    this.setState({ error: null, failed: false });
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const { fallback } = this.props;
    return typeof fallback === "function" ? fallback({ error: this.state.error, reset: this.reset }) : (fallback ?? null);
  }
}
