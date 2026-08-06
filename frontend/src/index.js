import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { registerAppShell } from "@/lib/templateCache";

// Register the offline app-shell service worker at boot so a cold reload while
// offline still loads the app — not only after the evaluate flow has been opened.
registerAppShell();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    {/* Outer boundary: no Router Link here — uses plain <a> */}
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
