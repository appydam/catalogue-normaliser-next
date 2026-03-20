"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SupplierInfo {
  company_name: string;
  catalog_name: string;
  catalog_id: string;
  avg_price: number;
  product_count: number;
  cheapest_count: number;
}

interface CategoryGroup {
  category: string;
  sub_category: string;
  product_count: number;
  suppliers: SupplierInfo[];
  potential_savings: number;
  best_supplier: string;
}

interface OptimizeResponse {
  categories: CategoryGroup[];
  total_catalogs_analyzed: number;
  total_products_compared: number;
  total_potential_savings: number;
  message?: string;
}

interface ProductVariant {
  catalog_id: string;
  product_name: string;
  company_name: string;
  catalog_name: string;
  price: number;
  price_unit: string | null;
  diff_from_cheapest: number;
  is_cheapest: boolean;
}

interface ProductGroup {
  representative_name: string;
  variants: ProductVariant[];
  cheapest_price: number;
  most_expensive_price: number;
  savings: number;
}

interface CompareResponse {
  category: string;
  sub_category: string | null;
  product_groups: ProductGroup[];
  total_products: number;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ProcurementPage() {
  const [data, setData] = useState<OptimizeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [compareData, setCompareData] = useState<CompareResponse | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/procurement/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed to fetch procurement data");
      const json: OptimizeResponse = await res.json();
      setData(json);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load procurement data"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRowExpand = async (cat: CategoryGroup) => {
    const key = `${cat.category}|||${cat.sub_category}`;
    if (expandedRow === key) {
      setExpandedRow(null);
      setCompareData(null);
      return;
    }

    setExpandedRow(key);
    setCompareLoading(true);
    setCompareData(null);

    try {
      const res = await fetch("/api/procurement/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: cat.category,
          sub_category: cat.sub_category,
        }),
      });
      if (!res.ok) throw new Error("Failed to fetch comparison");
      const json: CompareResponse = await res.json();
      setCompareData(json);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load comparison"
      );
    } finally {
      setCompareLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(value);
  };

  // ── Empty state (fewer than 2 catalogs) ──────────────────────────────────

  if (!loading && data && data.total_catalogs_analyzed < 2) {
    return (
      <div className="p-6 md:p-8">
        <PageHeader />
        <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
            <Icon name="procurement" className="w-8 h-8 text-amber-400" />
          </div>
          <h3 className="text-sm font-semibold text-slate-800 mb-1">
            Need more catalogs
          </h3>
          <p className="text-sm text-slate-400 mb-6 max-w-sm">
            Upload at least 2 catalogs to compare suppliers and find the best
            prices across your product categories.
          </p>
          <a href="/upload">
            <Button>
              <Icon name="upload" className="w-4 h-4" />
              Upload Catalog
            </Button>
          </a>
        </div>
      </div>
    );
  }

  // ── Loading skeleton ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 md:p-8">
        <PageHeader />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardContent className="py-6">
                <Skeleton className="h-3 w-24 mb-3" />
                <Skeleton className="h-8 w-20 mb-1" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
        <SkeletonTable rows={6} cols={6} />
      </div>
    );
  }

  if (!data) return null;

  const bestBuys = data.categories
    .filter((c) => c.potential_savings > 0)
    .slice(0, 10);

  return (
    <div className="p-6 md:p-8">
      <PageHeader />

      {/* ── Summary Cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardContent className="py-6">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">
              Catalogs Analyzed
            </p>
            <p className="text-3xl font-bold text-slate-900">
              {data.total_catalogs_analyzed}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              completed catalogs in your library
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-6">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">
              Products Compared
            </p>
            <p className="text-3xl font-bold text-slate-900">
              {data.total_products_compared.toLocaleString()}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              matched across suppliers
            </p>
          </CardContent>
        </Card>
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardContent className="py-6">
            <p className="text-xs font-medium text-emerald-600 uppercase tracking-wider mb-1">
              Potential Savings
            </p>
            <p className="text-3xl font-bold text-emerald-700">
              {formatCurrency(data.total_potential_savings)}
            </p>
            <p className="text-xs text-emerald-500 mt-1">
              if you switch to the cheapest supplier per category
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Category-wise Table ────────────────────────────────────────── */}
      {data.categories.length > 0 && (
        <Card className="mb-8">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                Category Analysis
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Click any row to see detailed product comparisons
              </p>
            </div>
            <span className="text-xs text-slate-400">
              {data.categories.length} categories
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Products
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Best Supplier
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Best Avg Price
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                    2nd Best
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Savings
                  </th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {data.categories.map((cat) => {
                  const key = `${cat.category}|||${cat.sub_category}`;
                  const isExpanded = expandedRow === key;
                  const secondSupplier = cat.suppliers[1];

                  return (
                    <CategoryRow
                      key={key}
                      cat={cat}
                      isExpanded={isExpanded}
                      secondSupplier={secondSupplier}
                      compareData={compareData}
                      compareLoading={compareLoading}
                      onToggle={() => handleRowExpand(cat)}
                      formatCurrency={formatCurrency}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Best Buys This Week ──────────────────────────────────────── */}
      {bestBuys.length > 0 && (
        <Card>
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-800">
              Best Buys This Week
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Top {bestBuys.length} categories where switching supplier saves
              the most
            </p>
          </div>
          <div className="divide-y divide-slate-50">
            {bestBuys.map((cat, idx) => {
              const currentLikely = cat.suppliers[cat.suppliers.length - 1];
              const recommended = cat.suppliers[0];

              return (
                <div
                  key={`${cat.category}-${cat.sub_category}`}
                  className="px-5 py-4 flex items-center gap-4"
                >
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-emerald-600">
                      {idx + 1}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {cat.category}
                      {cat.sub_category !== "General" &&
                        ` / ${cat.sub_category}`}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      <span className="text-red-400">
                        {currentLikely?.company_name ?? "N/A"}
                      </span>
                      {" -> "}
                      <span className="text-emerald-600 font-medium">
                        {recommended.company_name}
                      </span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-emerald-600">
                      {formatCurrency(cat.potential_savings)}
                    </p>
                    <p className="text-[11px] text-slate-400">savings</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── No comparison data ───────────────────────────────────────── */}
      {data.categories.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-xl bg-slate-50 flex items-center justify-center mb-4">
            <Icon name="noResults" className="w-7 h-7 text-slate-300" />
          </div>
          <h3 className="text-sm font-semibold text-slate-700 mb-1">
            No comparable products found
          </h3>
          <p className="text-xs text-slate-400 max-w-sm">
            The uploaded catalogs don&apos;t have overlapping product categories
            with prices. Upload more catalogs from competing suppliers to see
            comparisons.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function PageHeader() {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
          <Icon name="procurement" className="w-5 h-5 text-indigo-500" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">
            Procurement Optimizer
          </h2>
          <p className="text-sm text-slate-500">
            AI analyzes all your catalogs to find the best supplier for every
            product category
          </p>
        </div>
      </div>
    </div>
  );
}

function CategoryRow({
  cat,
  isExpanded,
  secondSupplier,
  compareData,
  compareLoading,
  onToggle,
  formatCurrency,
}: {
  cat: CategoryGroup;
  isExpanded: boolean;
  secondSupplier: SupplierInfo | undefined;
  compareData: CompareResponse | null;
  compareLoading: boolean;
  onToggle: () => void;
  formatCurrency: (v: number) => string;
}) {
  return (
    <>
      <tr
        className={cn(
          "border-b border-slate-50 cursor-pointer transition-colors",
          isExpanded ? "bg-indigo-50/40" : "hover:bg-slate-50/60"
        )}
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <p className="font-medium text-slate-800">{cat.category}</p>
          {cat.sub_category !== "General" && (
            <p className="text-xs text-slate-400">{cat.sub_category}</p>
          )}
        </td>
        <td className="px-4 py-3 text-slate-600">{cat.product_count}</td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="font-medium text-slate-800">
              {cat.best_supplier}
            </span>
          </span>
        </td>
        <td className="px-4 py-3 text-right font-medium text-slate-700">
          {cat.suppliers[0]
            ? formatCurrency(cat.suppliers[0].avg_price)
            : "-"}
        </td>
        <td className="px-4 py-3">
          {secondSupplier ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-slate-600">
                {secondSupplier.company_name}
              </span>
            </span>
          ) : (
            <span className="text-slate-300">-</span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          {cat.potential_savings > 0 ? (
            <span className="font-semibold text-emerald-600">
              {formatCurrency(cat.potential_savings)}
            </span>
          ) : (
            <span className="text-slate-300">-</span>
          )}
        </td>
        <td className="px-4 py-3">
          <Icon
            name="chevronDown"
            className={cn(
              "w-4 h-4 text-slate-400 transition-transform",
              isExpanded && "rotate-180"
            )}
          />
        </td>
      </tr>

      {/* Expanded row: supplier detail + product comparison */}
      {isExpanded && (
        <tr>
          <td colSpan={7} className="px-0 py-0">
            <div className="bg-slate-50/60 border-b border-slate-100">
              {/* Supplier ranking cards */}
              <div className="px-6 py-4">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
                  All suppliers for this category
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {cat.suppliers.map((supplier, idx) => (
                    <div
                      key={supplier.catalog_id}
                      className={cn(
                        "rounded-lg border p-3",
                        idx === 0
                          ? "border-emerald-200 bg-emerald-50/50"
                          : idx === 1
                            ? "border-amber-200 bg-amber-50/50"
                            : "border-red-200 bg-red-50/50"
                      )}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className={cn(
                            "text-xs font-semibold px-2 py-0.5 rounded-full",
                            idx === 0
                              ? "bg-emerald-100 text-emerald-700"
                              : idx === 1
                                ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700"
                          )}
                        >
                          #{idx + 1}
                        </span>
                        <span className="text-xs text-slate-400">
                          {supplier.cheapest_count} cheapest
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-slate-800 truncate">
                        {supplier.company_name}
                      </p>
                      <p className="text-xs text-slate-400 truncate mb-2">
                        {supplier.catalog_name}
                      </p>
                      <div className="flex items-end justify-between">
                        <div>
                          <p className="text-lg font-bold text-slate-900">
                            {formatCurrency(supplier.avg_price)}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            avg price
                          </p>
                        </div>
                        <p className="text-xs text-slate-400">
                          {supplier.product_count} products
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Product-level comparison */}
              <div className="px-6 pb-4">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
                  Product-level price comparison
                </p>
                {compareLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full rounded-lg" />
                    ))}
                  </div>
                ) : compareData &&
                  compareData.product_groups.length > 0 ? (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {compareData.product_groups.map((group, gIdx) => (
                      <div
                        key={gIdx}
                        className="bg-white rounded-lg border border-slate-200 p-3"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-medium text-slate-700 truncate flex-1">
                            {group.representative_name}
                          </p>
                          {group.savings > 0 && (
                            <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full ml-2 shrink-0">
                              Save {formatCurrency(group.savings)}
                            </span>
                          )}
                        </div>
                        <div className="space-y-1">
                          {group.variants.map((v, vIdx) => (
                            <div
                              key={vIdx}
                              className="flex items-center justify-between text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span
                                  className={cn(
                                    "w-1.5 h-1.5 rounded-full shrink-0",
                                    v.is_cheapest
                                      ? "bg-emerald-400"
                                      : "bg-slate-300"
                                  )}
                                />
                                <span className="text-slate-600 truncate">
                                  {v.company_name}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <span
                                  className={cn(
                                    "font-medium",
                                    v.is_cheapest
                                      ? "text-emerald-600"
                                      : "text-slate-700"
                                  )}
                                >
                                  {formatCurrency(v.price)}
                                </span>
                                {!v.is_cheapest && v.diff_from_cheapest > 0 && (
                                  <span className="text-red-400 text-[11px]">
                                    +{formatCurrency(v.diff_from_cheapest)}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    No matching products found across suppliers for detailed
                    comparison.
                  </p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
