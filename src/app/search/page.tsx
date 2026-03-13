"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SearchResultItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

const SUGGESTED_QUERIES = [
  "wall hung EWC under 20000",
  "50mm PVC pipe",
  "washbasin white",
  "rimless toilet",
  "pressure pipe 6kg",
];

interface SearchResponse {
  query: string;
  parsed_filters: Record<string, unknown>;
  results: SearchResultItem[];
  total_results: number;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSearch(q?: string) {
    const searchQuery = q ?? query;
    if (!searchQuery.trim()) return;

    setSubmitted(searchQuery);
    setLoading(true);
    setResponse(null);
    setExpandedId(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Search failed");
      }

      const data: SearchResponse = await res.json();
      setResponse(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  const activeFilters = response?.parsed_filters
    ? Object.entries(response.parsed_filters).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0))
    : [];

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-900">Search Products</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Ask in plain English — Claude parses your query into structured filters.
        </p>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
          {loading ? (
            <svg className="w-5 h-5 text-indigo-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <Icon name="search" className="w-5 h-5 text-slate-400" />
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="e.g. rimless wall hung EWC under 20000"
          className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-2xl text-slate-800 placeholder-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent shadow-sm transition-shadow"
        />
        <div className="absolute right-3 inset-y-3">
          <Button onClick={() => handleSearch()} disabled={!query.trim() || loading} size="sm" className="h-full px-4">
            Search
          </Button>
        </div>
      </div>

      {/* Suggested queries */}
      {!submitted && (
        <div className="flex flex-wrap gap-2 mb-8">
          <span className="text-xs text-slate-400 self-center">Try:</span>
          {SUGGESTED_QUERIES.map((q) => (
            <button
              key={q}
              onClick={() => { setQuery(q); handleSearch(q); }}
              className="px-3 py-1.5 bg-white border border-slate-200 text-slate-500 text-xs rounded-lg hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 transition-all"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* AI Parsed Filters */}
      {response && activeFilters.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Icon name="sparkle" className="w-3.5 h-3.5 text-indigo-400" />
              AI parsed:
            </span>
            {activeFilters.map(([key, val]) => (
              <FilterChip key={key} label={key} value={val} />
            ))}
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Skeleton className="h-4 w-20 rounded-full" />
                <Skeleton className="h-4 w-16 rounded-full" />
              </div>
              <Skeleton className="h-5 w-3/4 mb-2" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3 mt-1" />
            </Card>
          ))}
        </div>
      )}

      {/* Results */}
      {response && !loading && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-700">
              {response.total_results > 0
                ? `${response.total_results} result${response.total_results !== 1 ? "s" : ""} for "${submitted}"`
                : `No results for "${submitted}"`}
            </h3>
          </div>

          {response.total_results === 0 ? (
            <NoResults query={submitted} />
          ) : (
            <div className="space-y-3">
              {response.results.map((item) => (
                <ResultCard
                  key={item.id}
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!submitted && !loading && <EmptyState />}
    </div>
  );
}

// ─── Filter Chip ──────────────────────────────────────────────────────────────
function FilterChip({ label, value }: { label: string; value: unknown }) {
  const displayVal =
    typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);

  const colorMap: Record<string, string> = {
    keywords: "bg-indigo-50 text-indigo-600 ring-indigo-200",
    price_max: "bg-emerald-50 text-emerald-600 ring-emerald-200",
    price_min: "bg-emerald-50 text-emerald-600 ring-emerald-200",
    category: "bg-amber-50 text-amber-600 ring-amber-200",
    size: "bg-blue-50 text-blue-600 ring-blue-200",
    material: "bg-violet-50 text-violet-600 ring-violet-200",
  };

  const colorClass = colorMap[label] ?? "bg-slate-50 text-slate-600 ring-slate-200";

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset ${colorClass}`}>
      <span className="opacity-60">{label}:</span>
      {displayVal}
    </span>
  );
}

// ─── Result Card ──────────────────────────────────────────────────────────────
function ResultCard({
  item,
  expanded,
  onToggle,
}: {
  item: SearchResultItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const rawData = item.raw_data as Record<string, unknown> | undefined;

  return (
    <Card className="overflow-hidden" hover>
      <button onClick={onToggle} className="w-full text-left p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-slate-400 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-full">
                {item.catalog_name ?? item.catalog_id}
              </span>
              {item.category && (
                <span className="text-xs text-indigo-500 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
                  {item.category}
                </span>
              )}
              {item.sub_category && (
                <span className="text-xs text-slate-400">{item.sub_category}</span>
              )}
            </div>

            <h4 className="font-semibold text-slate-900 text-sm leading-tight">
              {item.product_name ?? "Unnamed product"}
            </h4>

            {item.description && (
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">{item.description}</p>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {item.price != null && (
              <div className="text-right">
                <p className="text-lg font-bold text-slate-900">
                  &#x20B9;{Number(item.price).toLocaleString("en-IN")}
                </p>
              </div>
            )}
            <Icon
              name="chevronDown"
              className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
              strokeWidth={2}
            />
          </div>
        </div>
      </button>

      {expanded && rawData && (
        <div className="border-t border-slate-100 px-5 pb-5 pt-4">
          <p className="text-xs font-semibold text-slate-400 mb-3">Full product details</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
            {Object.entries(rawData)
              .filter(([k, v]) => v != null && k !== "catalog_id" && k !== "id")
              .map(([k, v]) => (
                <div key={k}>
                  <p className="text-xs text-slate-400 font-mono">{k}</p>
                  <p className="text-xs text-slate-700 font-medium break-words">{String(v)}</p>
                </div>
              ))}
          </div>
          {item.catalog_id && (
            <div className="mt-4">
              <Link
                href={`/catalog/${item.catalog_id}`}
                className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
              >
                View full catalog &rarr;
              </Link>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Empty States ──────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <Icon name="search" className="w-7 h-7 text-slate-300" />
      </div>
      <p className="text-sm font-medium text-slate-500">Search across all your product catalogs</p>
      <p className="text-xs text-slate-400 mt-1">Claude will parse your natural language query into structured filters</p>
    </div>
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <Card className="p-8 text-center">
      <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mx-auto mb-3">
        <Icon name="noResults" className="w-6 h-6 text-slate-300" />
      </div>
      <p className="text-sm font-semibold text-slate-600">No products found for &ldquo;{query}&rdquo;</p>
      <p className="text-xs text-slate-400 mt-1">Try different keywords or a broader search term</p>
    </Card>
  );
}
