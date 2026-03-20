"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "catalogai-beta-dismissed";

export function BetaBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const dismissed = localStorage.getItem(STORAGE_KEY);
      if (!dismissed) setVisible(true);
    }
  }, []);

  function dismiss() {
    setVisible(false);
    localStorage.setItem(STORAGE_KEY, "true");
  }

  if (!visible) return null;

  return (
    <div className="relative z-50 animate-slide-down bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-600 text-white">
      <div className="flex items-center justify-center gap-2 px-4 py-2 text-xs sm:text-sm">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-pulse" />
          <span className="font-semibold text-emboss">We&apos;re in Beta</span>
        </span>
        <span className="hidden sm:inline text-indigo-200">—</span>
        <span className="hidden sm:inline text-indigo-100">
          Help us shape CatalogAI.
          <a
            href="https://github.com/appydam/catalogue-normaliser-next/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-white ml-1 font-medium"
          >
            Share feedback
          </a>
        </span>
        <button
          onClick={dismiss}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-white/10 transition-colors"
          aria-label="Dismiss beta banner"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
