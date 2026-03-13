"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Catalog, ColumnDefinition } from "@/lib/types";

const PAGE_SIZE = 50;

// ─── Component ────────────────────────────────────────────────────────────────
export default function CatalogDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [products, setProducts] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set());
  const [showColPicker, setShowColPicker] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);

  // Derived
  const schema = catalog?.schema_definition as { columns: ColumnDefinition[] } | undefined;
  const allCols = schema?.columns.map((c) => c.name) ?? [];

  // ── Data fetching ────────────────────────────────────────────────────────────
  useEffect(() => {
    async function fetchCatalog() {
      const res = await fetch(`/api/catalogs/${id}`);
      if (!res.ok) { router.push("/"); return; }
      const data: Catalog = await res.json();
      setCatalog(data);

      if (data.schema_definition) {
        const cols = (data.schema_definition as { columns: ColumnDefinition[] }).columns.map((c) => c.name);
        setVisibleCols(new Set(cols.slice(0, 8))); // show first 8 by default
      }
      setLoading(false);
    }
    fetchCatalog();
  }, [id, router]);

  const fetchProducts = useCallback(async (pageNum: number) => {
    if (!catalog || catalog.processing_status !== "completed") return;
    setProductsLoading(true);
    try {
      const res = await fetch(`/api/catalogs/${id}/products?page=${pageNum}&page_size=${PAGE_SIZE}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products ?? []);
        setTotal(data.total ?? 0);
      }
    } finally {
      setProductsLoading(false);
    }
  }, [catalog, id]);

  useEffect(() => {
    if (catalog?.processing_status === "completed") fetchProducts(page);
  }, [catalog, page, fetchProducts]);

  // Auto-refresh if still processing
  useEffect(() => {
    if (!catalog || ["completed", "failed"].includes(catalog.processing_status)) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/catalogs/${id}`);
      if (res.ok) {
        const data: Catalog = await res.json();
        setCatalog(data);
        if (data.processing_status === "completed") {
          if (data.schema_definition) {
            const cols = (data.schema_definition as { columns: ColumnDefinition[] }).columns.map((c) => c.name);
            setVisibleCols(new Set(cols.slice(0, 8)));
          }
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [catalog, id]);

  // Close col picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) {
        setShowColPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ── Delete ────────────────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!confirm(`Delete "${catalog?.catalog_name}"? This cannot be undone.`)) return;
    setDeleting(true);
    await fetch(`/api/catalogs/${id}`, { method: "DELETE" });
    router.push("/");
  }

  // ── CSV Export ────────────────────────────────────────────────────────────────
  async function exportCsv() {
    // Fetch all products
    const allPages: Record<string, unknown>[] = [];
    const totalPages = Math.ceil(total / PAGE_SIZE);
    for (let p = 1; p <= totalPages; p++) {
      const res = await fetch(`/api/catalogs/${id}/products?page=${p}&page_size=${PAGE_SIZE}`);
      if (res.ok) {
        const d = await res.json();
        allPages.push(...(d.products ?? []));
      }
    }

    const cols = Array.from(visibleCols);
    const rows = [cols.join(","), ...allPages.map((p) =>
      cols.map((c) => {
        const v = p[c];
        const str = v == null ? "" : String(v);
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(",")
    )];

    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${catalog?.catalog_name ?? "catalog"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loading) return <PageSkeleton />;
  if (!catalog) return null;

  const totalPageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-8">
      {/* Back */}
      <button
        onClick={() => router.push("/")}
        className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 mb-6 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
        </svg>
        All Catalogs
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{catalog.catalog_name}</h2>
          <p className="text-sm text-slate-500 mt-0.5">{catalog.company_name}</p>
        </div>
        <div className="flex items-center gap-2">
          {catalog.processing_status === "completed" && (
            <button
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Export CSV
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-red-200 text-red-500 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Products" value={catalog.total_products?.toLocaleString() ?? "—"} />
        <StatCard label="Columns" value={allCols.length > 0 ? String(allCols.length) : "—"} />
        <StatCard label="Status" value={catalog.processing_status} highlight={catalog.processing_status === "completed"} />
        <StatCard
          label="Created"
          value={new Date(catalog.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        />
      </div>

      {/* Schema */}
      {schema && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Schema</h3>
          <div className="flex flex-wrap gap-2">
            {schema.columns.map((col) => (
              <span key={col.name} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-100 text-xs">
                <span className="font-mono font-semibold text-indigo-600">{col.name}</span>
                <span className="text-slate-300">·</span>
                <span className="text-slate-400">{col.type}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Processing log */}
      {catalog.processing_status !== "completed" && catalog.processing_log && (
        <ProcessingLog
          status={catalog.processing_status}
          log={catalog.processing_log as { timestamp: string; status: string; message: string }[]}
        />
      )}

      {/* Products table */}
      {catalog.processing_status === "completed" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {/* Table header */}
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Products</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {productsLoading ? "Loading…" : `${total.toLocaleString()} total · page ${page} of ${totalPageCount}`}
              </p>
            </div>
            <div className="relative" ref={colPickerRef}>
              <button
                onClick={() => setShowColPicker(!showColPicker)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-100 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125Z" />
                </svg>
                Columns ({visibleCols.size})
              </button>
              {showColPicker && (
                <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-xl shadow-lg p-3 min-w-48 max-h-72 overflow-y-auto">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500">Toggle columns</span>
                    <button
                      onClick={() => setVisibleCols(new Set(allCols))}
                      className="text-xs text-indigo-500 hover:text-indigo-700"
                    >
                      All
                    </button>
                  </div>
                  {allCols.map((col) => (
                    <label key={col} className="flex items-center gap-2 py-1 cursor-pointer hover:text-slate-700">
                      <input
                        type="checkbox"
                        checked={visibleCols.has(col)}
                        onChange={(e) => {
                          const next = new Set(visibleCols);
                          e.target.checked ? next.add(col) : next.delete(col);
                          setVisibleCols(next);
                        }}
                        className="w-3.5 h-3.5 accent-indigo-500"
                      />
                      <span className="text-xs font-mono text-slate-600">{col}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {allCols.filter((c) => visibleCols.has(c)).map((col) => (
                    <th
                      key={col}
                      className="px-4 py-3 text-left font-semibold text-slate-500 whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={productsLoading ? "opacity-50" : ""}>
                {products.map((product, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    {allCols.filter((c) => visibleCols.has(c)).map((col) => {
                      const val = product[col];
                      return (
                        <td key={col} className="px-4 py-3 text-slate-600 max-w-48 truncate">
                          {val == null ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            String(val)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPageCount > 1 && (
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-xs text-slate-400">
                Page {page} of {totalPageCount}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPageCount, p + 1))}
                disabled={page === totalPageCount}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${highlight ? "text-emerald-500" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}

function ProcessingLog({
  status,
  log,
}: {
  status: string;
  log: { timestamp: string; status: string; message: string }[];
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        <h3 className="text-sm font-semibold text-slate-700 capitalize">{status}…</h3>
      </div>
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {[...log].reverse().map((entry, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="text-xs text-slate-300 shrink-0 mt-0.5 font-mono">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            <p className="text-xs text-slate-500">{entry.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="p-8 animate-pulse">
      <div className="h-4 bg-slate-100 rounded w-24 mb-6" />
      <div className="h-8 bg-slate-100 rounded w-64 mb-2" />
      <div className="h-4 bg-slate-100 rounded w-40 mb-8" />
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-slate-100 rounded-xl" />)}
      </div>
      <div className="h-32 bg-slate-100 rounded-xl" />
    </div>
  );
}
