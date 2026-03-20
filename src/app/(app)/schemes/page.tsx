"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────────────────────

type OfferType =
  | "buy_x_get_y"
  | "percentage_discount"
  | "flat_discount"
  | "cashback"
  | "other";

interface SchemeData {
  scheme_title: string;
  supplier_name: string;
  products_covered: string;
  offer_type: OfferType;
  offer_details: string;
  minimum_order: string | null;
  valid_from: string | null;
  valid_until: string | null;
  terms: string | null;
}

interface SavedScheme extends SchemeData {
  id: string;
  created_at: string;
  image_data_url: string | null;
}

type FilterTab = "active" | "expiring" | "expired" | "all";

const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  buy_x_get_y: "Buy X Get Y",
  percentage_discount: "% Discount",
  flat_discount: "Flat Discount",
  cashback: "Cashback",
  other: "Other",
};

const OFFER_TYPE_COLORS: Record<OfferType, string> = {
  buy_x_get_y: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  percentage_discount: "bg-blue-50 text-blue-700 ring-blue-200",
  flat_discount: "bg-amber-50 text-amber-700 ring-amber-200",
  cashback: "bg-violet-50 text-violet-700 ring-violet-200",
  other: "bg-slate-50 text-slate-600 ring-slate-200",
};

const STORAGE_KEY = "catalogai_schemes";

// ─── Helpers ────────────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getDaysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr + "T23:59:59");
  const now = new Date();
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getExpiryStatus(dateStr: string | null): "expired" | "critical" | "warning" | "safe" | "unknown" {
  const days = getDaysUntil(dateStr);
  if (days === null) return "unknown";
  if (days < 0) return "expired";
  if (days <= 3) return "critical";
  if (days <= 7) return "warning";
  return "safe";
}

function getExpiryBadgeClasses(status: ReturnType<typeof getExpiryStatus>): string {
  switch (status) {
    case "expired": return "bg-slate-100 text-slate-500 ring-slate-200";
    case "critical": return "bg-red-50 text-red-600 ring-red-200";
    case "warning": return "bg-amber-50 text-amber-600 ring-amber-200";
    case "safe": return "bg-emerald-50 text-emerald-600 ring-emerald-200";
    case "unknown": return "bg-slate-50 text-slate-400 ring-slate-200";
  }
}

function loadSchemes(): SavedScheme[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSchemes(schemes: SavedScheme[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(schemes));
}

// ─── Supplier color helper ──────────────────────────────────────────────────────

const SUPPLIER_COLORS = [
  "bg-indigo-50 text-indigo-700",
  "bg-rose-50 text-rose-700",
  "bg-teal-50 text-teal-700",
  "bg-amber-50 text-amber-700",
  "bg-violet-50 text-violet-700",
  "bg-cyan-50 text-cyan-700",
  "bg-fuchsia-50 text-fuchsia-700",
  "bg-lime-50 text-lime-700",
];

function getSupplierColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return SUPPLIER_COLORS[Math.abs(hash) % SUPPLIER_COLORS.length];
}

// ─── Component ──────────────────────────────────────────────────────────────────

export default function SchemesPage() {
  const [schemes, setSchemes] = useState<SavedScheme[]>([]);
  const [filterTab, setFilterTab] = useState<FilterTab>("active");

  // Upload / extraction state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState<SchemeData | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load from localStorage on mount
  useEffect(() => {
    setSchemes(loadSchemes());
  }, []);

  // Sync to localStorage
  useEffect(() => {
    if (schemes.length > 0 || localStorage.getItem(STORAGE_KEY)) {
      saveSchemes(schemes);
    }
  }, [schemes]);

  // ── Image handling ──────────────────────────────────────────────────────────

  function handleImageSelect(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Image must be under 20 MB");
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setExtractedData(null);
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleImageSelect(file);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle paste from clipboard
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) {
            handleImageSelect(file);
            e.preventDefault();
            break;
          }
        }
      }
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Extraction ──────────────────────────────────────────────────────────────

  async function handleExtract() {
    if (!imageFile) return;
    setExtracting(true);
    try {
      const formData = new FormData();
      formData.append("image", imageFile);
      const res = await fetch("/api/schemes/extract", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Extraction failed");
      }
      const data: SchemeData = await res.json();
      setExtractedData(data);
      toast.success("Scheme details extracted successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to extract scheme");
    } finally {
      setExtracting(false);
    }
  }

  // ── Save scheme ─────────────────────────────────────────────────────────────

  function handleSaveScheme() {
    if (!extractedData) return;

    // Convert image to data URL for localStorage persistence
    let imageDataUrl: string | null = null;
    if (imagePreview) {
      // We'll use the object URL for display but store a compressed version
      const canvas = document.createElement("canvas");
      const img = document.createElement("img");
      img.src = imagePreview;
      // For simplicity, store the preview URL — we'll re-read from file
    }

    // Read file as data URL for storage
    if (imageFile) {
      const reader = new FileReader();
      reader.onload = () => {
        imageDataUrl = reader.result as string;
        // Compress if too large (> 500KB) — store thumbnail
        if (imageDataUrl && imageDataUrl.length > 500_000) {
          // Store null for very large images to save localStorage space
          imageDataUrl = null;
        }
        doSave(imageDataUrl);
      };
      reader.readAsDataURL(imageFile);
    } else {
      doSave(null);
    }

    function doSave(imgUrl: string | null) {
      const newScheme: SavedScheme = {
        ...extractedData!,
        id: generateId(),
        created_at: new Date().toISOString(),
        image_data_url: imgUrl,
      };

      setSchemes((prev) => [newScheme, ...prev]);
      toast.success("Scheme saved successfully");

      // Reset form
      setImageFile(null);
      setImagePreview(null);
      setExtractedData(null);
    }
  }

  function handleDeleteScheme(id: string) {
    setSchemes((prev) => prev.filter((s) => s.id !== id));
    toast.success("Scheme removed");
  }

  function handleClearForm() {
    setImageFile(null);
    setImagePreview(null);
    setExtractedData(null);
  }

  // ── Filtering ───────────────────────────────────────────────────────────────

  const now = new Date();

  const filteredSchemes = schemes
    .filter((s) => {
      const days = getDaysUntil(s.valid_until);
      switch (filterTab) {
        case "active":
          return days === null || days >= 0;
        case "expiring":
          return days !== null && days >= 0 && days <= 7;
        case "expired":
          return days !== null && days < 0;
        case "all":
          return true;
      }
    })
    .sort((a, b) => {
      // Sort by expiry: soonest first, nulls last
      const da = getDaysUntil(a.valid_until);
      const db = getDaysUntil(b.valid_until);
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    });

  // Summary stats
  const activeCount = schemes.filter((s) => {
    const d = getDaysUntil(s.valid_until);
    return d === null || d >= 0;
  }).length;

  const expiringThisWeek = schemes.filter((s) => {
    const d = getDaysUntil(s.valid_until);
    return d !== null && d >= 0 && d <= 7;
  }).length;

  const activeSuppliers = new Set(
    schemes
      .filter((s) => {
        const d = getDaysUntil(s.valid_until);
        return d === null || d >= 0;
      })
      .map((s) => s.supplier_name)
  ).size;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Scheme Tracker</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Upload supplier scheme circulars. AI extracts the details. Never miss a scheme again.
        </p>
      </div>

      {/* Summary Bar */}
      {schemes.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <Icon name="check" className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{activeCount}</p>
                <p className="text-xs text-slate-400">Active Schemes</p>
              </div>
            </div>
          </Card>
          <Card className={`p-4 ${expiringThisWeek > 0 ? "ring-2 ring-amber-200" : ""}`}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                expiringThisWeek > 0 ? "bg-amber-50" : "bg-slate-50"
              }`}>
                <Icon name="warning" className={`w-5 h-5 ${
                  expiringThisWeek > 0 ? "text-amber-500" : "text-slate-300"
                }`} />
              </div>
              <div>
                <p className={`text-2xl font-bold ${
                  expiringThisWeek > 0 ? "text-amber-600" : "text-slate-900"
                }`}>
                  {expiringThisWeek}
                </p>
                <p className="text-xs text-slate-400">Expiring This Week</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                <Icon name="catalog" className="w-5 h-5 text-indigo-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{activeSuppliers}</p>
                <p className="text-xs text-slate-400">Active Suppliers</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Add Scheme Section */}
      <Card className="mb-8">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <Icon name="plus" className="w-4 h-4 text-indigo-500" />
            Add Scheme Circular
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Upload a photo of a scheme circular (WhatsApp forward, printed flyer, etc.) or paste from clipboard
          </p>
        </div>
        <CardContent>
          {!imageFile ? (
            /* Drop zone */
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
                isDragging
                  ? "border-indigo-400 bg-indigo-50 scale-[1.01]"
                  : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImageSelect(f);
                }}
              />
              <div className="flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center">
                  <Icon name="scheme" className="w-7 h-7 text-indigo-400" />
                </div>
                <div>
                  <p className="font-semibold text-slate-700">
                    Drop a scheme circular image
                  </p>
                  <p className="text-sm text-slate-400 mt-0.5">
                    WhatsApp forward, photo, screenshot, or printed flyer -- JPEG, PNG, WebP
                  </p>
                </div>
                <p className="text-xs text-slate-300">
                  You can also paste an image from clipboard (Ctrl+V / Cmd+V)
                </p>
              </div>
            </div>
          ) : (
            /* Image preview + extraction */
            <div className="space-y-5">
              <div className="flex items-start gap-5">
                {/* Image preview */}
                <div className="relative w-48 h-48 rounded-xl overflow-hidden bg-slate-100 shrink-0 border border-slate-200">
                  {imagePreview && (
                    <Image
                      src={imagePreview}
                      alt="Scheme circular"
                      fill
                      className="object-contain"
                    />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 text-sm truncate">
                    {imageFile.name}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {(imageFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>

                  {!extractedData && !extracting && (
                    <div className="mt-4 flex gap-2">
                      <Button onClick={handleExtract} size="md">
                        <Icon name="sparkle" className="w-4 h-4" />
                        Extract with AI
                      </Button>
                      <Button variant="ghost" size="md" onClick={handleClearForm}>
                        Clear
                      </Button>
                    </div>
                  )}

                  {extracting && (
                    <div className="mt-4">
                      <div className="flex items-center gap-2 p-3 bg-indigo-50 rounded-xl">
                        <svg
                          className="w-4 h-4 text-indigo-500 animate-spin"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                        <span className="text-sm text-indigo-600 font-medium">
                          AI is reading the scheme circular...
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Extracted data form */}
              {extractedData && (
                <div className="border-t border-slate-100 pt-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Icon name="sparkle" className="w-4 h-4 text-indigo-400" />
                    <span className="text-sm font-semibold text-slate-700">
                      Extracted Scheme Details
                    </span>
                    <span className="text-xs text-slate-400">-- edit any field if needed</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      label="Scheme Title"
                      value={extractedData.scheme_title}
                      onChange={(v) =>
                        setExtractedData({ ...extractedData, scheme_title: v })
                      }
                    />
                    <FormField
                      label="Supplier Name"
                      value={extractedData.supplier_name}
                      onChange={(v) =>
                        setExtractedData({ ...extractedData, supplier_name: v })
                      }
                    />
                    <FormField
                      label="Products Covered"
                      value={extractedData.products_covered}
                      onChange={(v) =>
                        setExtractedData({ ...extractedData, products_covered: v })
                      }
                      className="md:col-span-2"
                    />
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1.5">
                        Offer Type
                      </label>
                      <select
                        value={extractedData.offer_type}
                        onChange={(e) =>
                          setExtractedData({
                            ...extractedData,
                            offer_type: e.target.value as OfferType,
                          })
                        }
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
                      >
                        {Object.entries(OFFER_TYPE_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <FormField
                      label="Offer Details"
                      value={extractedData.offer_details}
                      onChange={(v) =>
                        setExtractedData({ ...extractedData, offer_details: v })
                      }
                    />
                    <FormField
                      label="Minimum Order"
                      value={extractedData.minimum_order ?? ""}
                      onChange={(v) =>
                        setExtractedData({
                          ...extractedData,
                          minimum_order: v || null,
                        })
                      }
                      placeholder="e.g. Rs 50,000 minimum order"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        label="Valid From"
                        value={extractedData.valid_from ?? ""}
                        onChange={(v) =>
                          setExtractedData({
                            ...extractedData,
                            valid_from: v || null,
                          })
                        }
                        type="date"
                      />
                      <FormField
                        label="Valid Until"
                        value={extractedData.valid_until ?? ""}
                        onChange={(v) =>
                          setExtractedData({
                            ...extractedData,
                            valid_until: v || null,
                          })
                        }
                        type="date"
                      />
                    </div>
                    <FormField
                      label="Terms & Conditions"
                      value={extractedData.terms ?? ""}
                      onChange={(v) =>
                        setExtractedData({
                          ...extractedData,
                          terms: v || null,
                        })
                      }
                      className="md:col-span-2"
                    />
                  </div>

                  <div className="flex gap-2 mt-5">
                    <Button onClick={handleSaveScheme} size="md">
                      <Icon name="check" className="w-4 h-4" />
                      Save Scheme
                    </Button>
                    <Button variant="ghost" size="md" onClick={handleClearForm}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filter Tabs */}
      {schemes.length > 0 && (
        <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit mb-6">
          {(
            [
              { key: "active", label: "Active", count: activeCount },
              { key: "expiring", label: "Expiring Soon", count: expiringThisWeek },
              { key: "expired", label: "Expired", count: schemes.length - activeCount },
              { key: "all", label: "All", count: schemes.length },
            ] as { key: FilterTab; label: string; count: number }[]
          ).map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setFilterTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                filterTab === key
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
              {count > 0 && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                    filterTab === key
                      ? key === "expiring"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-indigo-100 text-indigo-700"
                      : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Scheme Cards */}
      {filteredSchemes.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredSchemes.map((scheme) => (
            <SchemeCard
              key={scheme.id}
              scheme={scheme}
              onDelete={() => handleDeleteScheme(scheme.id)}
            />
          ))}
        </div>
      ) : schemes.length > 0 ? (
        /* No results for current filter */
        <Card className="p-8 text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mx-auto mb-3">
            <Icon name="scheme" className="w-6 h-6 text-slate-300" />
          </div>
          <p className="text-sm font-semibold text-slate-600">
            No {filterTab === "all" ? "" : filterTab} schemes found
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Try switching to a different filter tab
          </p>
        </Card>
      ) : (
        /* Empty state */
        <EmptyState />
      )}
    </div>
  );
}

// ─── Form Field ─────────────────────────────────────────────────────────────────

function FormField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-500 mb-1.5">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent"
      />
    </div>
  );
}

// ─── Scheme Card ────────────────────────────────────────────────────────────────

function SchemeCard({
  scheme,
  onDelete,
}: {
  scheme: SavedScheme;
  onDelete: () => void;
}) {
  const expiryStatus = getExpiryStatus(scheme.valid_until);
  const daysLeft = getDaysUntil(scheme.valid_until);
  const supplierColor = getSupplierColor(scheme.supplier_name);

  let daysLabel = "";
  if (daysLeft === null) {
    daysLabel = "No expiry";
  } else if (daysLeft < 0) {
    daysLabel = `Expired ${Math.abs(daysLeft)}d ago`;
  } else if (daysLeft === 0) {
    daysLabel = "Expires today";
  } else if (daysLeft === 1) {
    daysLabel = "1 day left";
  } else {
    daysLabel = `${daysLeft} days left`;
  }

  return (
    <Card
      className={`overflow-hidden transition-all ${
        expiryStatus === "expired" ? "opacity-60" : ""
      }`}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          {/* Supplier badge */}
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold ${supplierColor}`}
          >
            {scheme.supplier_name}
          </span>

          {/* Delete button */}
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all"
            title="Delete scheme"
          >
            <Icon name="trash" className="w-4 h-4" />
          </button>
        </div>

        {/* Title */}
        <h4 className="font-semibold text-slate-900 text-sm leading-tight mb-2">
          {scheme.scheme_title}
        </h4>

        {/* Offer details */}
        <div className="flex items-center gap-2 mb-3">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset ${
              OFFER_TYPE_COLORS[scheme.offer_type]
            }`}
          >
            {OFFER_TYPE_LABELS[scheme.offer_type]}
          </span>
          <span className="text-sm font-medium text-slate-700">
            {scheme.offer_details}
          </span>
        </div>

        {/* Products covered */}
        <p className="text-xs text-slate-500 mb-3 line-clamp-2">
          <span className="font-medium text-slate-600">Products:</span>{" "}
          {scheme.products_covered}
        </p>

        {/* Minimum order */}
        {scheme.minimum_order && (
          <p className="text-xs text-slate-400 mb-3">
            <span className="font-medium">Min. order:</span> {scheme.minimum_order}
          </p>
        )}

        {/* Terms */}
        {scheme.terms && (
          <p className="text-xs text-slate-400 mb-3 line-clamp-1">
            <span className="font-medium">Terms:</span> {scheme.terms}
          </p>
        )}

        {/* Expiry footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <div className="flex items-center gap-2">
            {scheme.valid_from && (
              <span className="text-xs text-slate-400">
                From {new Date(scheme.valid_from).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </span>
            )}
            {scheme.valid_from && scheme.valid_until && (
              <span className="text-xs text-slate-300">-</span>
            )}
            {scheme.valid_until && (
              <span className="text-xs text-slate-400">
                Until {new Date(scheme.valid_until).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            )}
          </div>

          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset ${getExpiryBadgeClasses(
              expiryStatus
            )}`}
          >
            {expiryStatus === "critical" && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            )}
            {expiryStatus === "warning" && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            )}
            {daysLabel}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Empty State ────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <Icon name="scheme" className="w-7 h-7 text-indigo-300" />
      </div>
      <p className="text-sm font-medium text-slate-500">
        No schemes tracked yet
      </p>
      <p className="text-xs text-slate-400 mt-1 max-w-sm">
        Upload a scheme circular to get started. Snap a photo of a WhatsApp forward,
        printed flyer, or any supplier scheme and let AI extract the details.
      </p>
      <div className="flex items-center gap-4 mt-4 text-xs text-slate-300">
        <span className="flex items-center gap-1">
          <Icon name="sparkle" className="w-3.5 h-3.5" /> AI Extraction
        </span>
        <span className="flex items-center gap-1">
          <Icon name="warning" className="w-3.5 h-3.5" /> Expiry Alerts
        </span>
        <span className="flex items-center gap-1">
          <Icon name="scheme" className="w-3.5 h-3.5" /> Track Offers
        </span>
      </div>
    </div>
  );
}
