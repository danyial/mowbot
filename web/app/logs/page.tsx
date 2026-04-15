"use client";

import dynamic from "next/dynamic";

// Phase 6 / Plan 03 — /logs page. Analog: app/lidar/page.tsx.
// SSR off because <LogViewer> opens a WebSocket + reads scroll metrics.

const LogViewer = dynamic(
  () =>
    import("@/components/logs/log-viewer").then((m) => ({
      default: m.LogViewer,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full bg-background flex items-center justify-center">
        <span className="text-muted-foreground text-sm">
          Logs werden geladen…
        </span>
      </div>
    ),
  }
);

export default function LogsPage() {
  return <LogViewer className="h-full w-full" />;
}
