"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-8 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mb-4">
        <Icon name="warning" className="w-7 h-7 text-red-400" />
      </div>
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Something went wrong</h2>
      <p className="text-sm text-slate-500 mb-6 max-w-sm">
        {error.message || "An unexpected error occurred. Please try again."}
      </p>
      <Button onClick={reset} variant="secondary">
        Try Again
      </Button>
    </div>
  );
}
