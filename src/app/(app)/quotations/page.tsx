"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import type { SearchResultItem } from "@/lib/types";
import {
  calculateQuotationTotals,
  GST_RATES,
  type GSTRate,
  type QuotationLineItem,
} from "@/lib/gst";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface QuoteItem extends QuotationLineItem {
  id: string;
  searchResultId: string;
  catalogName?: string;
  companyName?: string;
}

const DEFAULT_NOTES =
  "Prices are subject to change without prior notice.\nDelivery within 7-10 working days.\nGoods once sold will not be taken back.\nPayment due within 30 days.";

export default function QuotationsPage() {
  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Quote items
  const [items, setItems] = useState<QuoteItem[]>([]);

  // Quotation settings
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [gstRate, setGstRate] = useState<GSTRate>(18);
  const [isInterState, setIsInterState] = useState(false);
  const [discountPct, setDiscountPct] = useState(0);
  const [notes, setNotes] = useState(DEFAULT_NOTES);

  // Generating state
  const [generating, setGenerating] = useState(false);

  // ── Search ──────────────────────────────────────────────────────────────────

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery }),
      });
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setSearchResults(data.results ?? []);
      if ((data.results ?? []).length === 0) {
        toast.info("No products found. Try a different search term.");
      }
    } catch {
      toast.error("Search failed. Please try again.");
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery]);

  // ── Add / Remove items ──────────────────────────────────────────────────────

  function addItem(result: SearchResultItem) {
    // Prevent duplicates
    if (items.some((i) => i.searchResultId === result.id)) {
      toast.info("Product already added to quotation.");
      return;
    }

    const price = Number(result.price) || 0;
    const rawData = result.raw_data as Record<string, unknown> | undefined;

    const newItem: QuoteItem = {
      id: crypto.randomUUID(),
      searchResultId: result.id,
      productName: result.product_name ?? "Unnamed product",
      hsn: rawData?.hsn_code ? String(rawData.hsn_code) : rawData?.hsn ? String(rawData.hsn) : undefined,
      rate: price,
      qty: 1,
      unit: (result.price_unit as string) ?? rawData?.unit as string ?? "Nos",
      catalogName: result.catalog_name,
      companyName: result.company_name,
    };

    setItems((prev) => [...prev, newItem]);
    toast.success(`Added "${newItem.productName}" to quotation`);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function updateQty(id: string, qty: number) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, qty: Math.max(1, qty) } : i))
    );
  }

  function updateRate(id: string, rate: number) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, rate: Math.max(0, rate) } : i))
    );
  }

  // ── Totals ──────────────────────────────────────────────────────────────────

  const totals = calculateQuotationTotals(items, gstRate, isInterState, discountPct);

  const fmt = (n: number) =>
    n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ── Generate quotation ──────────────────────────────────────────────────────

  async function handleGenerate() {
    if (items.length === 0) {
      toast.error("Add at least one product to generate a quotation.");
      return;
    }

    setGenerating(true);
    try {
      const payload = {
        customerName,
        customerAddress,
        items: items.map((i) => ({
          productName: i.productName,
          hsn: i.hsn,
          rate: i.rate,
          qty: i.qty,
          unit: i.unit,
        })),
        gstRate,
        isInterState,
        discountPct,
        notes,
      };

      const res = await fetch("/api/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to generate quotation");
      }

      const html = await res.text();
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");

      toast.success("Quotation generated! Use Ctrl+P to save as PDF.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate quotation");
    } finally {
      setGenerating(false);
    }
  }

  // ── WhatsApp share ──────────────────────────────────────────────────────────

  function handleWhatsAppShare() {
    if (items.length === 0) {
      toast.error("Add at least one product first.");
      return;
    }

    const lines: string[] = [
      "*QUOTATION*",
      "",
      customerName ? `*To:* ${customerName}` : "",
      customerAddress ? `${customerAddress}` : "",
      "",
      "*Items:*",
    ];

    items.forEach((item, i) => {
      lines.push(
        `${i + 1}. ${item.productName} - Qty: ${item.qty} x Rs.${fmt(item.rate)} = Rs.${fmt(item.rate * item.qty)}`
      );
    });

    lines.push("");
    lines.push(`*Subtotal:* Rs.${fmt(totals.subtotal)}`);

    if (discountPct > 0) {
      lines.push(`*Discount (${discountPct}%):* -Rs.${fmt(totals.discountAmount)}`);
    }

    if (gstRate > 0) {
      if (isInterState) {
        lines.push(`*IGST (${gstRate}%):* Rs.${fmt(totals.igst)}`);
      } else {
        lines.push(`*CGST (${gstRate / 2}%):* Rs.${fmt(totals.cgst)}`);
        lines.push(`*SGST (${gstRate / 2}%):* Rs.${fmt(totals.sgst)}`);
      }
    }

    lines.push("");
    lines.push(`*GRAND TOTAL: Rs.${fmt(totals.grandTotal)}*`);
    lines.push("");
    lines.push("_Generated via CatalogAI_");

    const text = lines.filter((l) => l !== undefined).join("\n");
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/dashboard" className="text-slate-400 hover:text-slate-600 transition-colors">
              <Icon name="arrowLeft" className="w-4 h-4" />
            </Link>
            <h2 className="text-2xl font-bold text-slate-900">Quick Quotation</h2>
          </div>
          <p className="text-sm text-slate-500">
            Search products, add to quote, and generate professional GST quotations.
          </p>
        </div>
        <div className="hidden md:flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleWhatsAppShare}
            disabled={items.length === 0}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
            </svg>
            WhatsApp
          </Button>
          <Button size="sm" onClick={handleGenerate} disabled={items.length === 0 || generating}>
            <Icon name="receipt" className="w-4 h-4" />
            {generating ? "Generating..." : "Generate Quotation"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left column: Search + Items ─────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Product search */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Icon name="search" className="w-4 h-4 text-indigo-400" />
              Search Products
            </h3>
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Search for products to add to quotation..."
                className="w-full pl-4 pr-24 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent transition-shadow"
              />
              <div className="absolute right-2 inset-y-2">
                <Button
                  onClick={handleSearch}
                  disabled={!searchQuery.trim() || searchLoading}
                  size="sm"
                  className="h-full"
                >
                  {searchLoading ? "..." : "Search"}
                </Button>
              </div>
            </div>

            {/* Search results */}
            {searchLoading && (
              <div className="mt-4 space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-4 w-16 ml-auto" />
                  </div>
                ))}
              </div>
            )}

            {!searchLoading && searchResults.length > 0 && (
              <div className="mt-4 max-h-64 overflow-y-auto space-y-1.5">
                {searchResults.map((result) => {
                  const alreadyAdded = items.some((i) => i.searchResultId === result.id);
                  return (
                    <div
                      key={result.id}
                      className="flex items-center gap-3 p-3 bg-slate-50 hover:bg-indigo-50 rounded-lg transition-colors group"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {result.product_name ?? "Unnamed product"}
                        </p>
                        <p className="text-xs text-slate-400 truncate">
                          {[result.company_name, result.catalog_name, result.category]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      {result.price != null && (
                        <span className="text-sm font-semibold text-slate-700 shrink-0">
                          &#x20B9;{Number(result.price).toLocaleString("en-IN")}
                        </span>
                      )}
                      <button
                        onClick={() => addItem(result)}
                        disabled={alreadyAdded}
                        className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          alreadyAdded
                            ? "bg-emerald-50 text-emerald-600 cursor-default"
                            : "bg-indigo-500 text-white hover:bg-indigo-600 shadow-sm"
                        }`}
                      >
                        {alreadyAdded ? (
                          <>
                            <Icon name="check" className="w-3 h-3" />
                            Added
                          </>
                        ) : (
                          <>
                            <Icon name="plus" className="w-3 h-3" />
                            Add
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Quotation items table */}
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Icon name="receipt" className="w-4 h-4 text-indigo-400" />
                Quotation Items
                {items.length > 0 && (
                  <span className="bg-indigo-50 text-indigo-600 text-xs font-semibold px-2 py-0.5 rounded-full">
                    {items.length}
                  </span>
                )}
              </h3>
            </div>

            {items.length === 0 ? (
              <div className="p-10 text-center">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
                  <Icon name="receipt" className="w-6 h-6 text-slate-300" />
                </div>
                <p className="text-sm font-medium text-slate-500">No items added yet</p>
                <p className="text-xs text-slate-400 mt-1">
                  Search for products above and click &quot;Add&quot; to add them to the quotation.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Product
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">
                        Rate (&#x20B9;)
                      </th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">
                        Qty
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">
                        Amount (&#x20B9;)
                      </th>
                      <th className="px-4 py-3 w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const amount = item.rate * item.qty;
                      return (
                        <tr
                          key={item.id}
                          className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-800 text-sm">
                              {item.productName}
                            </p>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {[item.companyName, item.catalogName].filter(Boolean).join(" · ")}
                              {item.hsn && ` · HSN: ${item.hsn}`}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              value={item.rate || ""}
                              onChange={(e) =>
                                updateRate(item.id, parseFloat(e.target.value) || 0)
                              }
                              className="w-full text-right bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
                              min="0"
                              step="0.01"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              value={item.qty}
                              onChange={(e) =>
                                updateQty(item.id, parseInt(e.target.value) || 1)
                              }
                              className="w-full text-center bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
                              min="1"
                            />
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-800">
                            {fmt(amount)}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => removeItem(item.id)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                              title="Remove item"
                            >
                              <Icon name="trash" className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50">
                      <td colSpan={3} className="px-4 py-3 text-right text-sm font-semibold text-slate-600">
                        Subtotal
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-slate-800">
                        &#x20B9;{fmt(totals.subtotal)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* ── Right column: Settings + Totals ─────────────────────────────────── */}
        <div className="space-y-6">
          {/* Customer details */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Customer Details</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Customer Name
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter customer name"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Customer Address
                </label>
                <input
                  type="text"
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  placeholder="Enter address"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
                />
              </div>
            </div>
          </Card>

          {/* GST settings */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">GST Settings</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  GST Rate
                </label>
                <select
                  value={gstRate}
                  onChange={(e) => setGstRate(Number(e.target.value) as GSTRate)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
                >
                  {GST_RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}%
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <input
                  type="checkbox"
                  id="interstate"
                  checked={isInterState}
                  onChange={(e) => setIsInterState(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-500 focus:ring-indigo-300"
                />
                <label htmlFor="interstate" className="text-sm text-slate-700 cursor-pointer">
                  Inter-State Supply
                  <span className="block text-xs text-slate-400">
                    {isInterState ? "IGST will be applied" : "CGST + SGST will be applied"}
                  </span>
                </label>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Discount (%)
                </label>
                <input
                  type="number"
                  value={discountPct || ""}
                  onChange={(e) =>
                    setDiscountPct(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))
                  }
                  placeholder="0"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
                  min="0"
                  max="100"
                  step="0.5"
                />
              </div>
            </div>
          </Card>

          {/* Totals breakdown */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Totals</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="font-medium">&#x20B9;{fmt(totals.subtotal)}</span>
              </div>

              {discountPct > 0 && (
                <div className="flex justify-between text-red-500">
                  <span>Discount ({discountPct}%)</span>
                  <span className="font-medium">-&#x20B9;{fmt(totals.discountAmount)}</span>
                </div>
              )}

              {(discountPct > 0) && (
                <div className="flex justify-between text-slate-600">
                  <span>Taxable Amount</span>
                  <span className="font-medium">&#x20B9;{fmt(totals.taxableAmount)}</span>
                </div>
              )}

              {gstRate > 0 && (
                <>
                  {isInterState ? (
                    <div className="flex justify-between text-slate-600">
                      <span>IGST ({gstRate}%)</span>
                      <span className="font-medium">&#x20B9;{fmt(totals.igst)}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between text-slate-600">
                        <span>CGST ({gstRate / 2}%)</span>
                        <span className="font-medium">&#x20B9;{fmt(totals.cgst)}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>SGST ({gstRate / 2}%)</span>
                        <span className="font-medium">&#x20B9;{fmt(totals.sgst)}</span>
                      </div>
                    </>
                  )}
                </>
              )}

              <div className="pt-3 mt-2 border-t-2 border-indigo-100">
                <div className="flex justify-between">
                  <span className="text-base font-bold text-slate-900">Grand Total</span>
                  <span className="text-lg font-bold text-indigo-600">
                    &#x20B9;{fmt(totals.grandTotal)}
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* Notes */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Terms &amp; Notes</h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent resize-none leading-relaxed"
              placeholder="Enter terms and conditions..."
            />
          </Card>

          {/* Action buttons (visible on all screens) */}
          <div className="space-y-2">
            <Button
              className="w-full"
              size="lg"
              onClick={handleGenerate}
              disabled={items.length === 0 || generating}
            >
              <Icon name="receipt" className="w-4 h-4" />
              {generating ? "Generating..." : "Generate Quotation"}
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              size="lg"
              onClick={handleWhatsAppShare}
              disabled={items.length === 0}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
              </svg>
              Share on WhatsApp
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
