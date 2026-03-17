"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

// ─── Types ───────────────────────────────────────────────────────────────────

type Period = "7d" | "30d" | "90d";

interface ZeroResultSearch {
  query: string;
  count: number;
  last_searched: string;
}

interface TopSearch {
  query: string;
  count: number;
  avg_results: number;
}

interface TrendingCategory {
  category: string;
  search_count: number;
  growth_pct: number;
}

interface DayVolume {
  date: string;
  count: number;
}

interface InsightsData {
  period: string;
  total_searches: number;
  unique_queries: number;
  zero_result_searches: ZeroResultSearch[];
  top_searches: TopSearch[];
  trending_categories: TrendingCategory[];
  search_volume_by_day: DayVolume[];
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const [period, setPeriod] = useState<Period>("30d");
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInsights = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/analytics/insights?period=${p}`);
      if (!res.ok) throw new Error("Failed to fetch insights");
      const json: InsightsData = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInsights(period);
  }, [period, fetchInsights]);

  const periodLabels: Record<Period, string> = {
    "7d": "7 days",
    "30d": "30 days",
    "90d": "90 days",
  };

  const isEmpty =
    data &&
    data.total_searches === 0 &&
    data.top_searches.length === 0 &&
    data.zero_result_searches.length === 0;

  const avgPerDay =
    data && data.search_volume_by_day.length > 0
      ? Math.round(data.total_searches / data.search_volume_by_day.length)
      : 0;

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
            <Icon name="insights" className="w-6 h-6 text-indigo-500" />
            Demand Intelligence
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            What your retailers are looking for — powered by search analytics
          </p>
        </div>

        {/* Period selector */}
        <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
          {(["7d", "30d", "90d"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                period === p
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              {periodLabels[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Loading state */}
      {loading && <LoadingSkeleton />}

      {/* Error state */}
      {error && !loading && (
        <Card className="p-8 text-center">
          <Icon name="warning" className="w-8 h-8 text-red-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-600">{error}</p>
          <button
            onClick={() => fetchInsights(period)}
            className="mt-3 text-sm text-indigo-500 hover:text-indigo-700 font-medium"
          >
            Try again
          </button>
        </Card>
      )}

      {/* Empty state */}
      {isEmpty && !loading && !error && <EmptyState />}

      {/* Data */}
      {data && !isEmpty && !loading && !error && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <SummaryCard
              label="Total Searches"
              value={data.total_searches}
              icon="search"
              color="indigo"
            />
            <SummaryCard
              label="Unique Queries"
              value={data.unique_queries}
              icon="sparkle"
              color="violet"
            />
            <SummaryCard
              label="Zero-Result Searches"
              value={data.zero_result_searches.length}
              icon="noResults"
              color={data.zero_result_searches.length > 0 ? "red" : "slate"}
              highlight={data.zero_result_searches.length > 0}
            />
            <SummaryCard
              label="Avg / Day"
              value={avgPerDay}
              icon="insights"
              color="emerald"
            />
          </div>

          {/* Main content: two columns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Zero-result searches */}
            <ZeroResultSection items={data.zero_result_searches} />

            {/* Top searches */}
            <TopSearchesSection items={data.top_searches} />
          </div>

          {/* Search volume trend */}
          <VolumeChart data={data.search_volume_by_day} period={period} />

          {/* Trending categories */}
          {data.trending_categories.length > 0 && (
            <div className="mt-6">
              <TrendingSection items={data.trending_categories} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Summary Card ────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  icon,
  color,
  highlight,
}: {
  label: string;
  value: number;
  icon: "search" | "sparkle" | "noResults" | "insights";
  color: string;
  highlight?: boolean;
}) {
  const colorMap: Record<string, { bg: string; icon: string; text: string; ring: string }> = {
    indigo: { bg: "bg-indigo-50", icon: "text-indigo-400", text: "text-indigo-900", ring: "ring-indigo-200" },
    violet: { bg: "bg-violet-50", icon: "text-violet-400", text: "text-violet-900", ring: "ring-violet-200" },
    red: { bg: "bg-red-50", icon: "text-red-400", text: "text-red-700", ring: "ring-red-200" },
    emerald: { bg: "bg-emerald-50", icon: "text-emerald-400", text: "text-emerald-900", ring: "ring-emerald-200" },
    slate: { bg: "bg-slate-50", icon: "text-slate-400", text: "text-slate-900", ring: "ring-slate-200" },
  };

  const c = colorMap[color] ?? colorMap.slate;

  return (
    <Card className={cn(highlight && "ring-1", highlight && c.ring)}>
      <CardContent className="flex items-start gap-3">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", c.bg)}>
          <Icon name={icon} className={cn("w-5 h-5", c.icon)} />
        </div>
        <div>
          <p className="text-xs text-slate-400 font-medium">{label}</p>
          <p className={cn("text-2xl font-bold", c.text)}>{value.toLocaleString()}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Zero-Result Searches ────────────────────────────────────────────────────

function ZeroResultSection({ items }: { items: ZeroResultSearch[] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center">
            <Icon name="noResults" className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Products Not In Your Catalog</h3>
            <p className="text-xs text-slate-400">
              Searched but not found — consider stocking them
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <Icon name="checkCircle" className="w-6 h-6 text-emerald-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400">
              All search queries returned results. Great coverage!
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {items.map((item) => (
              <div
                key={item.query}
                className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {item.query}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Last searched {item.last_searched}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold",
                      item.count >= 5
                        ? "bg-red-50 text-red-600 ring-1 ring-inset ring-red-200"
                        : "bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-200"
                    )}
                  >
                    {item.count}x
                  </span>
                  {item.count >= 5 && (
                    <p className="text-[10px] text-red-500 font-medium mt-0.5">
                      {item.count} retailers searched!
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Top Searches (Bar Chart) ────────────────────────────────────────────────

function TopSearchesSection({ items }: { items: TopSearch[] }) {
  const maxCount = items.length > 0 ? Math.max(...items.map((i) => i.count)) : 1;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center">
            <Icon name="search" className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Most Searched Products</h3>
            <p className="text-xs text-slate-400">Top 15 search queries by frequency</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <Icon name="search" className="w-6 h-6 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400">No search data yet.</p>
          </div>
        ) : (
          <div className="px-5 pb-4 space-y-2.5">
            {items.map((item, idx) => {
              const pct = Math.max(4, (item.count / maxCount) * 100);
              return (
                <div key={item.query} className="group">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-xs text-slate-300 font-mono w-5 text-right shrink-0">
                        {idx + 1}
                      </span>
                      <span className="text-sm text-slate-700 font-medium truncate">
                        {item.query}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-2">
                      <span className="text-xs text-slate-400">
                        {item.avg_results} avg results
                      </span>
                      <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                        {item.count}
                      </span>
                    </div>
                  </div>
                  <div className="ml-7 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-400 rounded-full transition-all duration-500 group-hover:bg-indigo-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Volume Chart (CSS bar chart) ────────────────────────────────────────────

function VolumeChart({ data, period }: { data: DayVolume[]; period: Period }) {
  if (data.length === 0) return null;

  const maxCount = Math.max(...data.map((d) => d.count), 1);

  // For longer periods, show fewer labels
  const labelEvery = period === "7d" ? 1 : period === "30d" ? 5 : 10;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center">
            <Icon name="insights" className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Search Volume Trend</h3>
            <p className="text-xs text-slate-400">Daily search activity over time</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-[2px] h-40">
          {data.map((day, idx) => {
            const heightPct = Math.max(2, (day.count / maxCount) * 100);
            const showLabel = idx % labelEvery === 0 || idx === data.length - 1;
            const dateLabel = day.date.slice(5); // MM-DD

            return (
              <div
                key={day.date}
                className="flex-1 flex flex-col items-center group relative"
              >
                {/* Tooltip */}
                <div className="absolute bottom-full mb-1 hidden group-hover:block z-10">
                  <div className="bg-slate-800 text-white text-[10px] px-2 py-1 rounded-md shadow-lg whitespace-nowrap">
                    {day.date}: {day.count} searches
                  </div>
                </div>
                <div
                  className="w-full bg-emerald-400 rounded-t transition-all duration-300 hover:bg-emerald-500 min-w-[4px]"
                  style={{ height: `${heightPct}%` }}
                />
                {showLabel && (
                  <span className="text-[9px] text-slate-400 mt-1 transform -rotate-45 origin-top-left whitespace-nowrap">
                    {dateLabel}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Trending Categories ─────────────────────────────────────────────────────

function TrendingSection({ items }: { items: TrendingCategory[] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
            <Icon name="sparkle" className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Trending Search Terms</h3>
            <p className="text-xs text-slate-400">
              Growing in popularity compared to the previous period
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <div
              key={item.category}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ring-1 ring-inset",
                item.growth_pct > 50
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : item.growth_pct > 0
                  ? "bg-amber-50 text-amber-700 ring-amber-200"
                  : "bg-slate-50 text-slate-600 ring-slate-200"
              )}
            >
              <span className="capitalize">{item.category}</span>
              <span className="text-[10px] opacity-70">
                {item.search_count}x
              </span>
              {item.growth_pct > 0 && (
                <span
                  className={cn(
                    "text-[10px] font-bold",
                    item.growth_pct > 50 ? "text-emerald-600" : "text-amber-600"
                  )}
                >
                  +{item.growth_pct}%
                </span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-start gap-3">
              <Skeleton className="w-10 h-10 rounded-xl" />
              <div className="flex-1">
                <Skeleton className="h-3 w-20 mb-2" />
                <Skeleton className="h-7 w-16" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Content cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {[...Array(2)].map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Skeleton className="w-7 h-7 rounded-lg" />
                <div>
                  <Skeleton className="h-4 w-40 mb-1" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[...Array(5)].map((_, j) => (
                  <div key={j} className="flex items-center justify-between">
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-5 w-10 rounded-full" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Volume chart skeleton */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Skeleton className="w-7 h-7 rounded-lg" />
            <div>
              <Skeleton className="h-4 w-36 mb-1" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-1 h-40">
            {[...Array(20)].map((_, i) => {
              // Use deterministic heights for skeleton bars
              const heights = ["h-1/4", "h-2/5", "h-3/5", "h-1/3", "h-2/3", "h-1/2", "h-4/5", "h-3/4", "h-2/5", "h-1/3"];
              const hClass = heights[i % heights.length];
              return (
                <div key={i} className="flex-1 flex items-end">
                  <Skeleton className={cn("w-full rounded-t", hClass)} />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <Card className="p-12 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-5">
        <Icon name="insights" className="w-8 h-8 text-slate-300" />
      </div>
      <h3 className="text-lg font-semibold text-slate-700 mb-1">
        No search data yet
      </h3>
      <p className="text-sm text-slate-400 max-w-md mx-auto">
        As you and your retailers search for products, insights will appear here.
        Search analytics help you understand demand and identify gaps in your catalog.
      </p>
      <div className="flex items-center justify-center gap-6 mt-6 text-xs text-slate-300">
        <span className="flex items-center gap-1.5">
          <Icon name="search" className="w-4 h-4" /> Search trends
        </span>
        <span className="flex items-center gap-1.5">
          <Icon name="noResults" className="w-4 h-4" /> Missing products
        </span>
        <span className="flex items-center gap-1.5">
          <Icon name="insights" className="w-4 h-4" /> Volume analysis
        </span>
      </div>
    </Card>
  );
}
