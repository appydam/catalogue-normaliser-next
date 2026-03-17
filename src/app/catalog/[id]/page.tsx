"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { Catalog, ColumnDefinition } from "@/lib/types";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Dropdown, DropdownTrigger, DropdownContent, DropdownCheckboxItem, DropdownLabel } from "@/components/ui/dropdown";
import { Tooltip } from "@/components/ui/tooltip";
import { toast } from "sonner";

const PAGE_SIZE = 50;

interface TallyFieldMapping {
  stockItemName: string;
  parent: string;
  category: string;
  baseUnit: string;
  rate: string;
  hsnCode?: string;
  gstRate?: string;
}

const TALLY_FIELDS: { key: keyof TallyFieldMapping; label: string; required: boolean }[] = [
  { key: "stockItemName", label: "Stock Item Name", required: true },
  { key: "parent", label: "Stock Group", required: true },
  { key: "category", label: "Category", required: true },
  { key: "baseUnit", label: "Unit", required: true },
  { key: "rate", label: "Rate / Price", required: true },
  { key: "hsnCode", label: "HSN Code", required: false },
  { key: "gstRate", label: "GST Rate", required: false },
];

const AUTO_SUGGEST_PATTERNS: Record<keyof TallyFieldMapping, RegExp> = {
  stockItemName: /product.?name|item.?name|description|product.?description|name/i,
  parent: /stock.?group|group|brand/i,
  category: /category|sub.?category|type/i,
  baseUnit: /unit|uom|base.?unit|measurement/i,
  rate: /price|rate|mrp|cost|amount/i,
  hsnCode: /hsn|hsn.?code|sac/i,
  gstRate: /gst|tax|gst.?rate|tax.?rate/i,
};

function autoSuggestMapping(columns: string[]): Partial<TallyFieldMapping> {
  const result: Partial<TallyFieldMapping> = {};
  for (const field of TALLY_FIELDS) {
    const pattern = AUTO_SUGGEST_PATTERNS[field.key];
    const match = columns.find((col) => pattern.test(col));
    if (match) {
      result[field.key] = match;
    }
  }
  return result;
}

function getTallyStorageKey(catalogId: string): string {
  return `tally_mapping_${catalogId}`;
}

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
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [tallyDialogOpen, setTallyDialogOpen] = useState(false);
  const [tallyMapping, setTallyMapping] = useState<Partial<TallyFieldMapping>>({});
  const [tallyExporting, setTallyExporting] = useState(false);
  const schema = catalog?.schema_definition as { columns: ColumnDefinition[] } | undefined;
  const allCols = schema?.columns.map((c) => c.name) ?? [];

  // ── Data fetching ────────────────────────────────────────────────────────────
  useEffect(() => {
    async function fetchCatalog() {
      try {
        const res = await fetch(`/api/catalogs/${id}`);
        if (!res.ok) { router.push("/"); return; }
        const data: Catalog = await res.json();
        setCatalog(data);
        if (data.schema_definition) {
          const cols = (data.schema_definition as { columns: ColumnDefinition[] }).columns.map((c) => c.name);
          setVisibleCols(new Set(cols.slice(0, 8)));
        }
      } catch {
        toast.error("Failed to load catalog");
        router.push("/");
      } finally {
        setLoading(false);
      }
    }
    fetchCatalog();
  }, [id, router]);

  const fetchProducts = useCallback(async (pageNum: number) => {
    if (!catalog || !["completed", "completed_with_warnings"].includes(catalog.processing_status)) return;
    setProductsLoading(true);
    try {
      let url = `/api/catalogs/${id}/products?page=${pageNum}&page_size=${PAGE_SIZE}`;
      if (sortBy) url += `&sort_by=${sortBy}&sort_dir=${sortDir}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products ?? []);
        setTotal(data.total ?? 0);
      }
    } catch {
      toast.error("Failed to load products");
    } finally {
      setProductsLoading(false);
    }
  }, [catalog, id, sortBy, sortDir]);

  useEffect(() => {
    if (catalog?.processing_status === "completed" || catalog?.processing_status === "completed_with_warnings") fetchProducts(page);
  }, [catalog, page, fetchProducts]);

  // Auto-refresh while processing
  useEffect(() => {
    if (!catalog || ["completed", "completed_with_warnings", "failed"].includes(catalog.processing_status)) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/catalogs/${id}`);
      if (res.ok) {
        const data: Catalog = await res.json();
        setCatalog(data);
        if ((data.processing_status === "completed" || data.processing_status === "completed_with_warnings") && data.schema_definition) {
          const cols = (data.schema_definition as { columns: ColumnDefinition[] }).columns.map((c) => c.name);
          setVisibleCols(new Set(cols.slice(0, 8)));
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [catalog, id]);

  // ── Actions ────────────────────────────────────────────────────────────────────
  async function handleDelete() {
    setDeleting(true);
    try {
      await fetch(`/api/catalogs/${id}`, { method: "DELETE" });
      toast.success("Catalog deleted");
      router.push("/");
    } catch {
      toast.error("Failed to delete catalog");
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }

  async function exportCsv() {
    toast.info("Exporting CSV…");
    const allProducts: Record<string, unknown>[] = [];
    const totalPages = Math.ceil(total / PAGE_SIZE);
    for (let p = 1; p <= totalPages; p++) {
      const res = await fetch(`/api/catalogs/${id}/products?page=${p}&page_size=${PAGE_SIZE}`);
      if (res.ok) {
        const d = await res.json();
        allProducts.push(...(d.products ?? []));
      }
    }

    const cols = Array.from(visibleCols);
    const rows = [cols.join(","), ...allProducts.map((p) =>
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
    toast.success("CSV exported");
  }

  function handleSort(col: string) {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
    setPage(1);
  }

  async function handleSaveName() {
    if (!nameInput.trim() || nameInput.trim() === catalog?.catalog_name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      const res = await fetch(`/api/catalogs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalog_name: nameInput.trim() }),
      });
      if (res.ok) {
        const updated = await res.json();
        setCatalog(updated);
        toast.success("Catalog name updated");
      } else {
        toast.error("Failed to update name");
      }
    } catch {
      toast.error("Failed to update name");
    } finally {
      setSavingName(false);
      setEditingName(false);
    }
  }

  function openTallyDialog() {
    const stored = localStorage.getItem(getTallyStorageKey(id));
    if (stored) {
      try {
        setTallyMapping(JSON.parse(stored));
      } catch {
        setTallyMapping(autoSuggestMapping(allCols));
      }
    } else {
      setTallyMapping(autoSuggestMapping(allCols));
    }
    setTallyDialogOpen(true);
  }

  function updateTallyField(key: keyof TallyFieldMapping, value: string) {
    setTallyMapping((prev) => {
      const next = { ...prev };
      if (value) {
        next[key] = value;
      } else {
        delete next[key];
      }
      return next;
    });
  }

  async function exportTally() {
    const required: (keyof TallyFieldMapping)[] = ["stockItemName", "parent", "category", "baseUnit", "rate"];
    for (const key of required) {
      if (!tallyMapping[key]) {
        toast.error(`Please select a column for "${TALLY_FIELDS.find((f) => f.key === key)!.label}"`);
        return;
      }
    }

    const finalMapping = tallyMapping as TallyFieldMapping;
    localStorage.setItem(getTallyStorageKey(id), JSON.stringify(finalMapping));

    setTallyExporting(true);
    toast.info("Generating Tally XML...");
    try {
      const mappingParam = encodeURIComponent(JSON.stringify(finalMapping));
      const res = await fetch(`/api/catalogs/${id}/export/tally?mapping=${mappingParam}`);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        toast.error(err.error || "Export failed");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${catalog?.catalog_name ?? "catalog"}_tally_import.xml`;
      a.click();
      URL.revokeObjectURL(url);
      setTallyDialogOpen(false);
      toast.success("Tally XML exported");
    } catch {
      toast.error("Failed to export Tally XML");
    } finally {
      setTallyExporting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loading) return <PageSkeleton />;
  if (!catalog) return null;

  const totalPageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 md:p-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm mb-6">
        <Link href="/" className="text-slate-400 hover:text-slate-600 transition-colors">
          Catalogs
        </Link>
        <Icon name="chevronRight" className="w-3.5 h-3.5 text-slate-300" />
        <span className="text-slate-700 font-medium truncate max-w-xs">{catalog.catalog_name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  className="text-2xl font-bold text-slate-900 bg-white border border-indigo-300 rounded-lg px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <Button size="sm" onClick={handleSaveName} disabled={savingName}>
                  {savingName ? "Saving..." : "Save"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingName(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-slate-900">{catalog.catalog_name}</h2>
                <button
                  onClick={() => { setNameInput(catalog.catalog_name); setEditingName(true); }}
                  className="p-1 rounded-md hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600"
                  title="Edit catalog name"
                >
                  <Icon name="pencil" className="w-4 h-4" />
                </button>
              </>
            )}
            <StatusBadge status={catalog.processing_status} />
          </div>
          <p className="text-sm text-slate-500 mt-0.5">{catalog.company_name}</p>
        </div>
        <div className="flex items-center gap-2">
          {(catalog.processing_status === "completed" || catalog.processing_status === "completed_with_warnings") && (
            <>
              <Link href={`/catalog/${id}/diff`}>
                <Button variant="secondary" size="sm" disabled={!catalog.parent_catalog_id}>
                  <Icon name="diff" className="w-4 h-4" />
                  Compare Versions
                </Button>
              </Link>
              <Button variant="secondary" size="sm" onClick={exportCsv}>
                <Icon name="download" className="w-4 h-4" />
                Export CSV
              </Button>
              <Button variant="secondary" size="sm" onClick={openTallyDialog}>
                <Icon name="download" className="w-4 h-4" />
                Export to Tally
              </Button>
            </>
          )}
          <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)} disabled={deleting}>
            <Icon name="trash" className="w-4 h-4" />
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete catalog</DialogTitle>
            <DialogDescription>
              This will permanently delete &ldquo;{catalog.catalog_name}&rdquo; and all its products. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete Catalog"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tally Export Dialog */}
      <Dialog open={tallyDialogOpen} onOpenChange={setTallyDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Export to Tally</DialogTitle>
            <DialogDescription>
              Map your catalog columns to Tally Stock Item fields. Required fields are marked with *.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 my-2">
            {TALLY_FIELDS.map((field) => (
              <div key={field.key} className="flex items-center gap-3">
                <label className="text-sm text-slate-700 w-36 shrink-0 font-medium">
                  {field.label}{field.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                <select
                  value={tallyMapping[field.key] ?? ""}
                  onChange={(e) => updateTallyField(field.key, e.target.value)}
                  className="flex-1 h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300"
                >
                  <option value="">{field.required ? "Select column..." : "None"}</option>
                  {allCols.map((col) => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button onClick={exportTally} disabled={tallyExporting}>
              <Icon name="download" className="w-4 h-4" />
              {tallyExporting ? "Exporting..." : "Export"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Products" value={catalog.total_products?.toLocaleString() ?? "—"} />
        <StatCard label="Columns" value={allCols.length > 0 ? String(allCols.length) : "—"} />
        <StatCard label="Status" value={catalog.processing_status} highlight={catalog.processing_status === "completed"} />
        <StatCard label="Created" value={new Date(catalog.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} />
      </div>

      {/* Schema */}
      {schema && (
        <Card className="mb-6">
          <CardContent>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Schema</h3>
            <div className="flex flex-wrap gap-2">
              {schema.columns.map((col) => (
                <span key={col.name} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-100 text-xs">
                  <span className="font-mono font-semibold text-indigo-600">{col.name}</span>
                  <span className="text-slate-300">&middot;</span>
                  <span className="text-slate-400">{col.type}</span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Warning banner for completed_with_warnings */}
      {catalog.processing_status === "completed_with_warnings" && catalog.error_message && (
        <Card className="mb-6 p-4 bg-amber-50 border-amber-200">
          <div className="flex items-start gap-3">
            <Icon name="warning" className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" strokeWidth={2} />
            <div>
              <p className="text-sm font-semibold text-amber-700">Extraction completed with warnings</p>
              <p className="text-xs text-amber-600 mt-1">{catalog.error_message}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Extraction report from processing log */}
      {(catalog.processing_status === "completed" || catalog.processing_status === "completed_with_warnings") && catalog.processing_log && (
        <ExtractionReport log={catalog.processing_log as { timestamp: string; status: string; message: string }[]} />
      )}

      {/* Processing log */}
      {!["completed", "completed_with_warnings", "failed"].includes(catalog.processing_status) && catalog.processing_log && (
        <ProcessingLog status={catalog.processing_status} log={catalog.processing_log as { timestamp: string; status: string; message: string }[]} />
      )}

      {/* Products table */}
      {(catalog.processing_status === "completed" || catalog.processing_status === "completed_with_warnings") && (
        <Card className="overflow-hidden">
          {/* Table header */}
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Products</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {productsLoading ? "Loading…" : `${total.toLocaleString()} total · page ${page} of ${totalPageCount}`}
              </p>
            </div>

            {/* Column picker dropdown */}
            <Dropdown>
              <DropdownTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Icon name="columns" className="w-3.5 h-3.5" />
                  Columns ({visibleCols.size})
                </Button>
              </DropdownTrigger>
              <DropdownContent align="end" className="max-h-72 overflow-y-auto">
                <DropdownLabel>Toggle columns</DropdownLabel>
                {allCols.map((col) => (
                  <DropdownCheckboxItem
                    key={col}
                    checked={visibleCols.has(col)}
                    onCheckedChange={(checked) => {
                      const next = new Set(visibleCols);
                      checked ? next.add(col) : next.delete(col);
                      setVisibleCols(next);
                    }}
                  >
                    {col}
                  </DropdownCheckboxItem>
                ))}
              </DropdownContent>
            </Dropdown>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {allCols.filter((c) => visibleCols.has(c)).map((col) => (
                    <th
                      key={col}
                      onClick={() => handleSort(col)}
                      className="px-4 py-3 text-left font-semibold text-slate-500 whitespace-nowrap cursor-pointer hover:text-slate-700 transition-colors select-none"
                    >
                      <span className="inline-flex items-center gap-1">
                        {col}
                        {sortBy === col && (
                          <Icon
                            name="chevronDown"
                            className={`w-3 h-3 transition-transform ${sortDir === "asc" ? "rotate-180" : ""}`}
                            strokeWidth={2}
                          />
                        )}
                        {sortBy !== col && (
                          <Icon name="arrowUpDown" className="w-3 h-3 text-slate-300" strokeWidth={2} />
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={productsLoading ? "opacity-50" : ""}>
                {products.map((product, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    {allCols.filter((c) => visibleCols.has(c)).map((col) => {
                      const val = product[col];
                      const strVal = val == null ? null : String(val);
                      const isLong = strVal != null && strVal.length > 40;
                      return (
                        <td key={col} className="px-4 py-3 text-slate-600 max-w-48">
                          {strVal == null ? (
                            <span className="text-slate-300">&mdash;</span>
                          ) : isLong ? (
                            <Tooltip content={strVal}>
                              <span className="truncate block max-w-48">{strVal}</span>
                            </Tooltip>
                          ) : (
                            strVal
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
              <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                Previous
              </Button>
              <span className="text-xs text-slate-400">
                Page {page} of {totalPageCount}
              </span>
              <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(totalPageCount, p + 1))} disabled={page === totalPageCount}>
                Next
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${highlight ? "text-emerald-500" : "text-slate-900"}`}>{value}</p>
    </Card>
  );
}

function ProcessingLog({ status, log }: { status: string; log: { timestamp: string; status: string; message: string }[] }) {
  return (
    <Card className="p-5 mb-6">
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
    </Card>
  );
}

function ExtractionReport({ log }: { log: { timestamp: string; status: string; message: string }[] }) {
  // Parse extraction stats from processing log
  const extractingLogs = log.filter((l) => l.status === "extracting");
  const completedLog = log.find((l) => l.status === "completed" || l.status === "completed_with_warnings");

  // Count chunks and products from log messages
  const chunkLogs = extractingLogs.filter((l) => /^Chunk \d+\/\d+:/.test(l.message));
  const skippedLog = extractingLogs.find((l) => l.message.includes("Skipping"));
  const catalogTypeLog = log.find((l) => l.message.includes("Catalog type:"));

  const skippedCount = skippedLog ? parseInt(skippedLog.message.match(/Skipping (\d+)/)?.[1] ?? "0") : 0;
  const catalogType = catalogTypeLog?.message.match(/Catalog type: (\w+)/)?.[1] ?? "unknown";

  const totalChunks = chunkLogs.length;
  const failedChunks = chunkLogs.filter((l) => l.message.includes("failed")).length;
  const reextractedLogs = extractingLogs.filter((l) => l.message.includes("re-extracted"));

  if (totalChunks === 0 && !completedLog) return null;

  return (
    <Card className="mb-6">
      <CardContent>
        <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Icon name="sparkle" className="w-4 h-4 text-indigo-400" />
          Extraction Report
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ReportStat label="Catalog Type" value={catalogType} />
          <ReportStat label="Chunks Processed" value={String(totalChunks)} />
          {failedChunks > 0 && <ReportStat label="Chunks Failed" value={String(failedChunks)} warn />}
          {skippedCount > 0 && <ReportStat label="Pages Skipped" value={String(skippedCount)} />}
          {reextractedLogs.length > 0 && <ReportStat label="Pages Re-extracted" value={String(reextractedLogs.length)} />}
        </div>
        {completedLog && (
          <p className="text-xs text-slate-400 mt-3">{completedLog.message}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ReportStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2.5">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-sm font-bold ${warn ? "text-amber-600" : "text-slate-700"}`}>{value}</p>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="p-6 md:p-8">
      <Skeleton className="h-4 w-24 mb-6" />
      <Skeleton className="h-8 w-64 mb-2" />
      <Skeleton className="h-4 w-40 mb-8" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      <SkeletonTable />
    </div>
  );
}
