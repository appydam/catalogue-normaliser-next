"use client";

import { Toaster } from "sonner";

export function ToastProvider() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          borderRadius: "0.75rem",
          fontSize: "0.8125rem",
          border: "1px solid var(--border, #e2e8f0)",
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.08)",
          background: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(8px)",
        },
      }}
      gap={8}
    />
  );
}
