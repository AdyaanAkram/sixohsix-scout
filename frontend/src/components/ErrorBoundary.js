import React from "react";
import { Button } from "@/components/ui/button";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep console for local; Sentry (if wired) picks up uncaught errors
    console.error("UI crash:", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center px-4" data-testid="error-boundary">
          <div className="max-w-md text-center space-y-4">
            <p className="font-display text-3xl text-foreground">Something went wrong</p>
            <p className="text-sm text-muted-foreground">
              The page hit an unexpected error. Your data is safe — try reloading or return home.
            </p>
            <div className="flex gap-2 justify-center">
              <Button className="rounded-full bg-brand" onClick={() => window.location.reload()}>
                Reload
              </Button>
              {/* Plain <a> — ErrorBoundary may render outside Router context */}
              <Button asChild variant="outline" className="rounded-full">
                <a href="/">Home</a>
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
