import React, { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional label shown in the recovery UI (e.g. page name). */
  label?: string;
  /** Optional fallback when the user chooses Reset. Defaults to remounting children. */
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  message: string;
  resetKey: number;
}

/**
 * Root / section error boundary — prevents a single render throw from
 * white-screening the entire suite.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "", resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      message: error?.message || "An unexpected rendering error occurred.",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", this.props.label ?? "root", error, info.componentStack);
  }

  handleReset = (): void => {
    this.props.onReset?.();
    this.setState((s) => ({
      hasError: false,
      message: "",
      resetKey: s.resetKey + 1,
    }));
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "40vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: 24,
            color: "#e4e4e7",
            background: "#0a0a0a",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, color: "#f87171" }}>
            Something went wrong{this.props.label ? ` in ${this.props.label}` : ""}
          </h2>
          <p style={{ margin: 0, maxWidth: 480, textAlign: "center", color: "#a1a1aa", fontSize: 13 }}>
            {this.state.message}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            style={{
              marginTop: 8,
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid #3f3f46",
              background: "#18181b",
              color: "#22d3ee",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}
