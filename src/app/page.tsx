"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Catalog } from "@/lib/types";

const STATUS_CONFIG = {
  pending: { label: "Pending", dot: "bg-slate-300", badge: "bg-slate-50 text-slate-500 ring-slate-200" },
  processing: { label: "Processing", dot: "bg-amber-400 animate-pulse", badge: "bg-amber-50 text-amber-600 ring-amber-200" },
  extracting: { label: "Extracting", dot: "bg-blue-400 animate-pulse", badge: "bg-blue-50 text-blue-600 ring-blue-200" },
  inserting: { label: "Inserting", dot: "bg-violet-400 animate-pulse", badge: "bg-violet-50 text-violet-600 ring-violet-200" },
  indexing: { label: "Indexing", dot: "bg-indigo-400 animate-pulse", badge: "bg-indigo-50 text-indigo-600 ring-indigo-200" },
  completed: { label: "Completed", dot: "bg-emerald-400", badge: "bg-emerald-50 text-emerald-600 ring-emerald-200" },
  failed: { label: "Failed", dot: "bg-red-400", badge: "bg-red-50 text-red-500 ring-red-200" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-slate-800 mb-1">No catalogs yet</h3>
      <p className="text-sm text-slate-400 mb-6 max-w-xs">Upload your first product catalog PDF to get started with AI-powered extraction.</p>
      <Link
        href="/upload"
        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white text-sm font-medium rounded-lg hover:bg-indigo-600 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
        </svg>
        Upload Catalog
      </Link>
    </div>
  );
}

export default function CatalogsPage() {
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchCatalogs() {
    try {
      const res = await fetch("/api/catalogs");
      if (res.ok) {
        const data = await res.json();
        setCatalogs(data);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCatalogs();
    // Auto-refresh if any catalog is still processing
    const interval = setInterval(() => {
      setCatalogs((prev) => {
        const hasActive = prev.some((c) =>
          !["completed", "failed"].includes(c.processing_status)
        );
        if (hasActive) fetchCatalogs();
        return prev;
      });
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const hasActive = catalogs.some((c) => !["completed", "failed"].includes(c.processing_status));

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Catalogs</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {loading ? "Loading…" : `${catalogs.length} catalog${catalogs.length !== 1 ? "s" : ""} total`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {hasActive && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Auto-refreshing
            </span>
          )}
          <Link
            href="/upload"
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white text-sm font-semibold rounded-lg hover:bg-indigo-600 transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Catalog
          </Link>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
              <div className="h-4 bg-slate-100 rounded w-3/4 mb-3" />
              <div className="h-3 bg-slate-100 rounded w-1/2 mb-4" />
              <div className="h-3 bg-slate-100 rounded w-1/4" />
            </div>
          ))}
        </div>
      ) : catalogs.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {catalogs.map((catalog) => (
            <CatalogCard key={catalog.id} catalog={catalog} />
          ))}
        </div>
      )}
    </div>
  );
}

function CatalogCard({ catalog }: { catalog: Catalog }) {
  const isClickable = catalog.processing_status === "completed";
  const createdAt = new Date(catalog.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const cardContent = (
    <div className={`bg-white rounded-xl border border-slate-200 p-5 transition-all ${isClickable ? "hover:shadow-md hover:border-slate-300 cursor-pointer" : ""}`}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
        </div>
        <StatusBadge status={catalog.processing_status} />
      </div>

      {/* Name */}
      <h3 className="text-sm font-semibold text-slate-900 leading-tight mb-0.5 line-clamp-1">
        {catalog.catalog_name || catalog.company_name}
      </h3>
      <p className="text-xs text-slate-400 mb-4 line-clamp-1">{catalog.company_name}</p>

      {/* Stats */}
      <div className="flex items-center gap-4 pt-3 border-t border-slate-100">
        {catalog.total_products != null && (
          <div>
            <p className="text-lg font-bold text-slate-900 leading-none">{catalog.total_products.toLocaleString()}</p>
            <p className="text-xs text-slate-400 mt-0.5">products</p>
          </div>
        )}
        <div className="ml-auto text-right">
          <p className="text-xs text-slate-400">{createdAt}</p>
        </div>
      </div>

      {/* Processing log preview */}
      {!isClickable && catalog.processing_status !== "failed" && catalog.processing_log && Array.isArray(catalog.processing_log) && catalog.processing_log.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-400 truncate">
            {(catalog.processing_log[catalog.processing_log.length - 1] as { message: string }).message}
          </p>
        </div>
      )}

      {catalog.processing_status === "failed" && catalog.error_message && (
        <div className="mt-3 pt-3 border-t border-red-100">
          <p className="text-xs text-red-400 truncate">{catalog.error_message}</p>
        </div>
      )}
    </div>
  );

  if (!isClickable) return cardContent;

  return (
    <Link href={`/catalog/${catalog.id}`} className="block">
      {cardContent}
    </Link>
  );
}
