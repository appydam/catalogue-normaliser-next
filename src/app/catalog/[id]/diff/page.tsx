"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";
import { toast } from "sonner";
import type { ProductChange } from "@/lib/catalog-diff";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CatalogInfo {
  id: string;
  catalog_name: string;
  company_name: string;
  version: number;
  total_products: number;
  created_at: string;
}

interface MatchedProduct {
  old: Record<string, unknown>;
  new: Record<string, unknown>;
  changes: ProductChange[];
  similarity: number;
}

interface PriceChangeSummary {
  increased: number;
  decreased: number;
  unchanged: number;
  avgIncreasePct: number;
  avgDecreasePct: number;
}

interface DiffResponse {
  current_catalog: CatalogInfo;
  parent_catalog: CatalogInfo;
  summary: {
    total_matched: number;
    total_added: number;
    total_removed: number;
    price_changes: PriceChangeSummary;
  };
  matched: MatchedProduct[];
  added: Record<string, unknown>[];
  removed: Record<string, unknown>[];
}

// ─── Price helpers ───────────────────────────────────────────────────────────

const PRICE_COLUMNS = [
  "rate_rs", "price", "mrp", "rate", "unit_price",
  "price_rs", "cost", "amount", "list_price", "selling_price",
];

const NAME_COLUMNS = [
  "product_name", "product_description", "item_name",
  "item_description", "description", "name", "material", "product",
];

function findCol(product: Record<string, unknown>, candidates: string[]): string | null {
  const keys = Object.keys(product).map((k) => k.toLowerCase());
  for (const c of candidates) {
    const found = keys.find((k) => k === c || k.includes(c));
    if (found) return Object.keys(product).find((k) => k.toLowerCase() === found) ?? null;
  }
  return null;
}

function getPrice(product: Record<string, unknown>): number | null {
  const col = findCol(product, PRICE_COLUMNS);
  if (!col || product[col] == null) return null;
  const num = typeof product[col] === "number"
    ? product[col] as number
    : parseFloat(String(product[col]).replace(/[^0-9.-]/g, ""));
  return isNaN(num) ? null : num;
}

function getName(product: Record<string, unknown>): string {
  const col = findCol(product, NAME_COLUMNS);
  if (col && product[col] != null) return String(product[col]);
  // Fallback: join first few non-internal values
  const internal = new Set(["id", "catalog_id", "created_at", "updated_at"]);
  return Object.entries(product)
    .filter(([k, v]) => !internal.has(k) && v != null)
    .slice(0, 2)
    .map(([, v]) => String(v))
    .join(" - ") || "Unnamed Product";
}

function formatPrice(val: number | null): string {
  if (val == null) return "--";
  return val.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function pctChange(oldP: number, newP: number): number {
  if (oldP === 0) return 0;
  return ((newP - oldP) / oldP) * 100;
}

// ─── Tab type ────────────────────────────────────────────────────────────────

type Tab = "prices" | "new" | "discontinued";

// ─── Component ───────────────────────────────────────────────────────────────

export default function CatalogDiffPage() {
  const { id } = useParams<{ id: string }>();
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("prices");

  useEffect(() => {
    async function fetchDiff() {
      try {
        const res = await fetch(`/api/catalogs/${id}/diff`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? "Failed to load diff");
          return;
        }
        const data: DiffResponse = await res.json();
        setDiff(data);
      } catch {
        toast.error("Failed to load version comparison");
        setError("Failed to load version comparison");
      } finally {
        setLoading(false);
      }
    }
    fetchDiff();
  }, [id]);

  if (loading) return <DiffSkeleton />;

  if (error) {
    return (
      <div className="p-6 md:p-8">
        <nav className="flex items-center gap-1.5 text-sm mb-6">
          <Link href="/" className="text-slate-400 hover:text-slate-600 transition-colors">
            Catalogs
          </Link>
          <Icon name="chevronRight" className="w-3.5 h-3.5 text-slate-300" />
          <Link href={`/catalog/${id}`} className="text-slate-400 hover:text-slate-600 transition-colors">
            Catalog
          </Link>
          <Icon name="chevronRight" className="w-3.5 h-3.5 text-slate-300" />
          <span className="text-slate-700 font-medium">Version Diff</span>
        </nav>
        <Card className="p-8 text-center">
          <Icon name="warning" className="w-10 h-10 text-amber-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-slate-700 mb-1">Cannot Compare Versions</h3>
          <p className="text-sm text-slate-500">{error}</p>
          <Link href={`/catalog/${id}`}>
            <Button variant="secondary" size="sm" className="mt-4">
              <Icon name="arrowLeft" className="w-4 h-4" />
              Back to Catalog
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  if (!diff) return null;

  const { summary, current_catalog, parent_catalog } = diff;

  // Filter matched products that have price changes
  const priceChanges = diff.matched.filter((m) => {
    const oldP = getPrice(m.old);
    const newP = getPrice(m.new);
    return oldP != null && newP != null && oldP !== newP;
  });

  const tabCounts: Record<Tab, number> = {
    prices: priceChanges.length,
    new: diff.added.length,
    discontinued: diff.removed.length,
  };

  return (
    <div className="p-6 md:p-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm mb-6">
        <Link href="/" className="text-slate-400 hover:text-slate-600 transition-colors">
          Catalogs
        </Link>
        <Icon name="chevronRight" className="w-3.5 h-3.5 text-slate-300" />
        <Link href={`/catalog/${id}`} className="text-slate-400 hover:text-slate-600 transition-colors">
          {current_catalog.catalog_name}
        </Link>
        <Icon name="chevronRight" className="w-3.5 h-3.5 text-slate-300" />
        <span className="text-slate-700 font-medium">Version Comparison</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Icon name="diff" className="w-6 h-6 text-indigo-500" />
            Version Comparison
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            v{parent_catalog.version} ({new Date(parent_catalog.created_at).toLocaleDateString()})
            {" "}&rarr;{" "}
            v{current_catalog.version} ({new Date(current_catalog.created_at).toLocaleDateString()})
          </p>
        </div>
        <Link href={`/catalog/${id}`}>
          <Button variant="secondary" size="sm">
            <Icon name="arrowLeft" className="w-4 h-4" />
            Back to Catalog
          </Button>
        </Link>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <SummaryCard
          label="Matched"
          value={summary.total_matched}
          color="text-slate-700"
          bg="bg-slate-50"
        />
        <SummaryCard
          label="Price Increases"
          value={summary.price_changes.increased}
          color="text-red-600"
          bg="bg-red-50"
        />
        <SummaryCard
          label="Price Decreases"
          value={summary.price_changes.decreased}
          color="text-emerald-600"
          bg="bg-emerald-50"
        />
        <SummaryCard
          label="Avg Increase"
          value={`${summary.price_changes.avgIncreasePct}%`}
          color="text-red-600"
          bg="bg-red-50"
        />
        <SummaryCard
          label="Avg Decrease"
          value={`${summary.price_changes.avgDecreasePct}%`}
          color="text-emerald-600"
          bg="bg-emerald-50"
        />
        <SummaryCard
          label="Unchanged"
          value={summary.price_changes.unchanged}
          color="text-slate-500"
          bg="bg-slate-50"
        />
      </div>

      {/* Added / Removed cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card className="p-4 border-blue-200 bg-blue-50/30">
          <div className="flex items-center gap-2 mb-1">
            <Icon name="plus" className="w-4 h-4 text-blue-500" strokeWidth={2} />
            <span className="text-sm font-semibold text-blue-700">New Products</span>
          </div>
          <p className="text-2xl font-bold text-blue-600">{summary.total_added}</p>
          <p className="text-xs text-blue-500 mt-0.5">
            Products in v{current_catalog.version} not found in v{parent_catalog.version}
          </p>
        </Card>
        <Card className="p-4 border-slate-300 bg-slate-50/50">
          <div className="flex items-center gap-2 mb-1">
            <Icon name="trash" className="w-4 h-4 text-slate-500" strokeWidth={2} />
            <span className="text-sm font-semibold text-slate-600">Discontinued</span>
          </div>
          <p className="text-2xl font-bold text-slate-600">{summary.total_removed}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Products in v{parent_catalog.version} not found in v{current_catalog.version}
          </p>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {([
          { key: "prices" as Tab, label: "Price Changes" },
          { key: "new" as Tab, label: "New Products" },
          { key: "discontinued" as Tab, label: "Discontinued" },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
              activeTab === key
                ? "text-indigo-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
              activeTab === key
                ? "bg-indigo-100 text-indigo-700"
                : "bg-slate-100 text-slate-500"
            }`}>
              {tabCounts[key]}
            </span>
            {activeTab === key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-t" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "prices" && <PriceChangesTab changes={priceChanges} />}
      {activeTab === "new" && <ProductListTab products={diff.added} variant="added" />}
      {activeTab === "discontinued" && <ProductListTab products={diff.removed} variant="removed" />}
    </div>
  );
}

// ─── Summary Card ────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  color,
  bg,
}: {
  label: string;
  value: string | number;
  color: string;
  bg: string;
}) {
  return (
    <Card className={`p-3 ${bg} border-transparent`}>
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </Card>
  );
}

// ─── Price Changes Tab ───────────────────────────────────────────────────────

function PriceChangesTab({ changes }: { changes: MatchedProduct[] }) {
  if (changes.length === 0) {
    return (
      <Card className="p-8 text-center">
        <Icon name="check" className="w-8 h-8 text-emerald-400 mx-auto mb-2" strokeWidth={2} />
        <p className="text-sm font-medium text-slate-600">No price changes detected</p>
        <p className="text-xs text-slate-400 mt-1">All matched products have the same price</p>
      </Card>
    );
  }

  // Sort by absolute % change descending
  const sorted = [...changes].sort((a, b) => {
    const aOld = getPrice(a.old) ?? 0;
    const aNew = getPrice(a.new) ?? 0;
    const bOld = getPrice(b.old) ?? 0;
    const bNew = getPrice(b.new) ?? 0;
    return Math.abs(pctChange(bOld, bNew)) - Math.abs(pctChange(aOld, aNew));
  });

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-4 py-3 text-left font-semibold text-slate-500 whitespace-nowrap">Product</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-500 whitespace-nowrap">Old Price</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-500 whitespace-nowrap">New Price</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-500 whitespace-nowrap">Change</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-500 whitespace-nowrap">% Change</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((match, i) => {
              const oldP = getPrice(match.old) ?? 0;
              const newP = getPrice(match.new) ?? 0;
              const diff = newP - oldP;
              const pct = pctChange(oldP, newP);
              const isIncrease = diff > 0;

              return (
                <tr
                  key={i}
                  className={`border-b border-slate-50 transition-colors ${
                    isIncrease ? "hover:bg-red-50/50" : "hover:bg-emerald-50/50"
                  }`}
                >
                  <td className="px-4 py-3 text-slate-700 font-medium max-w-xs truncate">
                    {getName(match.new)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500 font-mono">
                    {formatPrice(oldP)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700 font-mono font-semibold">
                    {formatPrice(newP)}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono font-semibold ${
                    isIncrease ? "text-red-600" : "text-emerald-600"
                  }`}>
                    {isIncrease ? "+" : ""}{formatPrice(diff)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                      isIncrease
                        ? "bg-red-100 text-red-700"
                        : "bg-emerald-100 text-emerald-700"
                    }`}>
                      {isIncrease ? "+" : ""}{pct.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── Product List Tab (New / Discontinued) ───────────────────────────────────

function ProductListTab({
  products,
  variant,
}: {
  products: Record<string, unknown>[];
  variant: "added" | "removed";
}) {
  if (products.length === 0) {
    const msg = variant === "added"
      ? "No new products in this version"
      : "No discontinued products";
    return (
      <Card className="p-8 text-center">
        <Icon name="check" className="w-8 h-8 text-emerald-400 mx-auto mb-2" strokeWidth={2} />
        <p className="text-sm font-medium text-slate-600">{msg}</p>
      </Card>
    );
  }

  // Determine columns to display (exclude internal)
  const internal = new Set(["id", "catalog_id", "created_at", "updated_at"]);
  const allKeys = Array.from(
    new Set(products.flatMap((p) => Object.keys(p)))
  ).filter((k) => !internal.has(k));

  // Show max 6 columns
  const displayCols = allKeys.slice(0, 6);

  const colorConfig = variant === "added"
    ? { headerBg: "bg-blue-50", badge: "bg-blue-100 text-blue-700", hoverRow: "hover:bg-blue-50/50" }
    : { headerBg: "bg-slate-50", badge: "bg-slate-200 text-slate-600", hoverRow: "hover:bg-slate-50" };

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colorConfig.badge}`}>
          {products.length} {variant === "added" ? "new" : "discontinued"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className={`${colorConfig.headerBg} border-b border-slate-100`}>
              {displayCols.map((col) => (
                <th key={col} className="px-4 py-3 text-left font-semibold text-slate-500 whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map((product, i) => (
              <tr key={i} className={`border-b border-slate-50 transition-colors ${colorConfig.hoverRow}`}>
                {displayCols.map((col) => {
                  const val = product[col];
                  const strVal = val == null ? null : String(val);
                  return (
                    <td key={col} className="px-4 py-3 text-slate-600 max-w-48 truncate">
                      {strVal ?? <span className="text-slate-300">&mdash;</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────

function DiffSkeleton() {
  return (
    <div className="p-6 md:p-8">
      <Skeleton className="h-4 w-48 mb-6" />
      <Skeleton className="h-8 w-72 mb-2" />
      <Skeleton className="h-4 w-56 mb-6" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
      <Skeleton className="h-10 w-96 mb-4" />
      <SkeletonTable rows={8} cols={5} />
    </div>
  );
}
