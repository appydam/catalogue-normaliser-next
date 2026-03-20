"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Catalog } from "@/lib/types";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { SkeletonCard } from "@/components/ui/skeleton";
import { toast } from "sonner";

export default function CatalogsPage() {
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchCatalogs() {
    try {
      const res = await fetch("/api/catalogs");
      if (!res.ok) throw new Error("Failed to load catalogs");
      const data = await res.json();
      setCatalogs(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load catalogs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCatalogs();
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
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Catalogs</h2>
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
          <Link href="/upload">
            <Button size="md">
              <Icon name="plus" className="w-4 h-4" strokeWidth={2} />
              New Catalog
            </Button>
          </Link>
        </div>
      </div>

      {/* Hero Stats */}
      {!loading && catalogs.length > 0 && (
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-500 p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-indigo-100">Your Catalog Intelligence</p>
              <p className="text-3xl font-bold mt-1 tabular-nums">{catalogs.length} Catalogs</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-indigo-100">Total Products</p>
              <p className="text-3xl font-bold mt-1 tabular-nums">{catalogs.reduce((sum, c) => sum + (c.total_products ?? 0), 0).toLocaleString("en-IN")}</p>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : catalogs.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {catalogs.map((catalog, index) => (
            <div key={catalog.id} className="animate-fade-in-up" style={{ animationDelay: `${index * 50}ms` }}>
              <CatalogCard catalog={catalog} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center mb-4">
        <Icon name="document" className="w-8 h-8 text-indigo-400" />
      </div>
      <h3 className="text-sm font-semibold text-slate-800 mb-1">No catalogs yet</h3>
      <p className="text-sm text-slate-400 mb-6 max-w-xs">
        Upload your first product catalog PDF to get started with AI-powered extraction.
      </p>
      <Link href="/upload">
        <Button>
          <Icon name="upload" className="w-4 h-4" />
          Upload Catalog
        </Button>
      </Link>
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
    <Card hover={isClickable} className="p-5">
      {/* Top row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-50 to-violet-50 flex items-center justify-center shrink-0">
          <Icon name="document" className="w-5 h-5 text-indigo-400" />
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
            <p className="text-lg font-bold text-slate-900 leading-none">
              {catalog.total_products.toLocaleString()}
            </p>
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
    </Card>
  );

  if (!isClickable) return cardContent;

  return (
    <Link href={`/catalog/${catalog.id}`} className="block">
      {cardContent}
    </Link>
  );
}
