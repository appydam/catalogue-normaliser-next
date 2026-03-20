"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { SearchResultItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";

type SearchMode = "text" | "image";

interface CatalogOption {
  id: string;
  catalog_name: string;
  company_name: string;
  total_products: number;
}

interface SearchResponse {
  query: string;
  original_query?: string;
  translated_from?: string;
  ai_interpretation?: string;
  search_mode?: "catalog_specific" | "global" | "vector" | "text";
  sql_filter?: string | null;
  catalog_context?: { catalog_id: string; catalog_name: string; company_name: string } | null;
  query_image_url?: string;
  ai_description?: string;
  vector_available?: boolean;
  visible_specs?: Record<string, string | null> | null;
  ai_rerank?: {
    explanation: string;
    confidence: "high" | "medium" | "low";
    visual_variants: boolean;
  } | null;
  parsed_filters?: Record<string, unknown>;
  results: SearchResultItem[];
  total_results: number;
}

interface CrossRefResult {
  id: string;
  catalog_id: string;
  product_name: string | null;
  category: string | null;
  sub_category: string | null;
  description: string | null;
  price: number | null;
  price_unit: string | null;
  image_url: string | null;
  company_name: string;
  catalog_name: string;
  raw_data: Record<string, unknown>;
  price_diff: number | null;
  price_diff_pct: number | null;
}

interface CrossRefResponse {
  source_product: Record<string, unknown>;
  product_type: string;
  key_specs: Record<string, string>;
  cross_references: CrossRefResult[];
  total: number;
}

export default function SearchPage() {
  const [mode, setMode] = useState<SearchMode>("text");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Catalog selector state
  const [catalogs, setCatalogs] = useState<CatalogOption[]>([]);
  const [selectedCatalog, setSelectedCatalog] = useState<string>("");
  const [catalogDropdownOpen, setCatalogDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Image search state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Dynamic suggestions from actual database
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Cross-reference state
  const [crossRefId, setCrossRefId] = useState<string | null>(null);
  const [crossRefLoading, setCrossRefLoading] = useState(false);
  const [crossRefData, setCrossRefData] = useState<CrossRefResponse | null>(null);

  // Voice search
  const {
    isListening,
    isSupported: voiceSupported,
    transcript,
    startListening,
    stopListening,
  } = useSpeechRecognition({
    lang: "en-IN",
    onResult: (text) => {
      setQuery(text);
      // Auto-search after voice input
      handleTextSearch(text);
    },
    onError: (err) => toast.error(err),
  });

  // Update input field with interim speech results
  useEffect(() => {
    if (isListening && transcript) {
      setQuery(transcript);
    }
  }, [isListening, transcript]);

  // Fetch catalogs for the selector
  useEffect(() => {
    fetch("/api/catalogs")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: CatalogOption[]) => {
        const completed = data.filter(
          (c) => c.total_products > 0
        );
        setCatalogs(completed);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/search/suggestions")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.suggestions?.length > 0) setSuggestions(data.suggestions);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (mode === "text") inputRef.current?.focus();
  }, [mode]);

  // Close catalog dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setCatalogDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectedCatalogName = catalogs.find((c) => c.id === selectedCatalog)?.catalog_name;

  // ── Text search ────────────────────────────────────────────────────────────
  async function handleTextSearch(q?: string) {
    const searchQuery = q ?? query;
    if (!searchQuery.trim()) return;

    setSubmitted(searchQuery);
    setLoading(true);
    setResponse(null);
    setExpandedId(null);
    setCrossRefId(null);
    setCrossRefData(null);

    try {
      const body: Record<string, unknown> = { query: searchQuery };
      if (selectedCatalog) body.catalog_id = selectedCatalog;

      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Search failed");
      }

      setResponse(await res.json());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  // ── Cross-reference search ─────────────────────────────────────────────────
  async function handleCrossReference(productId: string, item: SearchResultItem) {
    if (crossRefId === productId) {
      // Toggle off
      setCrossRefId(null);
      setCrossRefData(null);
      return;
    }

    setCrossRefId(productId);
    setCrossRefLoading(true);
    setCrossRefData(null);

    try {
      const res = await fetch("/api/search/cross-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: productId,
          source_catalog_id: item.catalog_id,
        }),
      });

      if (!res.ok) {
        throw new Error("Cross-reference search failed");
      }

      const data: CrossRefResponse = await res.json();
      setCrossRefData(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cross-reference failed");
      setCrossRefId(null);
    } finally {
      setCrossRefLoading(false);
    }
  }

  // ── Image search ───────────────────────────────────────────────────────────
  function handleImageSelect(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
  }

  async function handleImageSearch() {
    if (!imageFile) return;

    setSubmitted("Image search");
    setLoading(true);
    setResponse(null);
    setExpandedId(null);
    setCrossRefId(null);
    setCrossRefData(null);

    try {
      const formData = new FormData();
      formData.append("image", imageFile);

      const res = await fetch("/api/search/image", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Image search failed");
      }

      const data = await res.json();
      setSubmitted(data.query || "Image search");
      setResponse(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Image search failed");
    } finally {
      setLoading(false);
    }
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
  }, []);

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Search Products</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Search in natural language — supports English, Hindi &amp; Hinglish. Try voice search!
        </p>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit mb-6">
        <button
          onClick={() => {
            setMode("text");
            setResponse(null);
            setSubmitted("");
          }}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            mode === "text"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <Icon name="search" className="w-4 h-4" />
          Text Search
        </button>
        <button
          onClick={() => {
            setMode("image");
            setResponse(null);
            setSubmitted("");
          }}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            mode === "image"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <Icon name="camera" className="w-4 h-4" />
          Image Search
        </button>
      </div>

      {/* ── Text Search Mode ─────────────────────────────────────────────────── */}
      {mode === "text" && (
        <>
          {/* Catalog selector */}
          <div className="mb-3" ref={dropdownRef}>
            <div className="relative">
              <button
                onClick={() => setCatalogDropdownOpen(!catalogDropdownOpen)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm border transition-all ${
                  selectedCatalog
                    ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                    : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                }`}
              >
                <Icon name="filter" className="w-4 h-4" />
                {selectedCatalog ? (
                  <span className="font-medium truncate max-w-xs">
                    {selectedCatalogName}
                  </span>
                ) : (
                  <span>All Catalogs</span>
                )}
                <Icon
                  name="chevronDown"
                  className={`w-3.5 h-3.5 transition-transform ${catalogDropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              {catalogDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-80 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 max-h-64 overflow-y-auto">
                  <button
                    onClick={() => {
                      setSelectedCatalog("");
                      setCatalogDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors ${
                      !selectedCatalog ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-700"
                    }`}
                  >
                    All Catalogs
                    <span className="text-xs text-slate-400 ml-2">Search across everything</span>
                  </button>
                  {catalogs.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => {
                        setSelectedCatalog(cat.id);
                        setCatalogDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors ${
                        selectedCatalog === cat.id
                          ? "bg-indigo-50 text-indigo-700 font-medium"
                          : "text-slate-700"
                      }`}
                    >
                      <div className="truncate">{cat.catalog_name}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {cat.company_name} &middot; {cat.total_products} products
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Search input with voice button */}
          <div className="relative mb-4">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
              {loading ? (
                <svg
                  className="w-5 h-5 text-indigo-400 animate-spin"
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
              ) : (
                <Icon name="sparkle" className="w-5 h-5 text-indigo-400" />
              )}
            </div>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleTextSearch()}
              placeholder={
                selectedCatalog
                  ? "e.g. quickfit pipes 180mm 8 kgf pressure"
                  : 'e.g. "3 inch PVC pipe" or "तीन इंच पाइप" or "teen inch pipe ka rate"'
              }
              className="w-full pl-12 pr-28 py-5 bg-white border border-slate-200 rounded-2xl text-slate-800 placeholder-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent shadow-lg shadow-slate-200/50 focus:shadow-xl focus:shadow-indigo-100/50 transition-shadow"
            />
            <div className="absolute right-3 inset-y-3 flex items-center gap-1.5">
              {/* Voice search button */}
              {voiceSupported && (
                <button
                  onClick={isListening ? stopListening : startListening}
                  className={`h-full aspect-square flex items-center justify-center rounded-xl transition-all ${
                    isListening
                      ? "bg-red-50 text-red-500 ring-2 ring-red-200 animate-pulse"
                      : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  }`}
                  title={isListening ? "Stop listening" : "Voice search (Hindi/English)"}
                >
                  <Icon name="microphone" className="w-5 h-5" />
                </button>
              )}
              <Button
                onClick={() => handleTextSearch()}
                disabled={!query.trim() || loading}
                size="sm"
                className="h-full px-4"
              >
                Search
              </Button>
            </div>
          </div>

          {/* Voice listening indicator */}
          {isListening && (
            <div className="mb-4 flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl">
              <div className="w-3 h-3 rounded-full bg-red-400 animate-pulse" />
              <span className="text-sm text-red-600 font-medium">
                Listening... speak now
              </span>
              <button
                onClick={stopListening}
                className="ml-auto text-xs text-red-500 hover:text-red-700 font-medium"
              >
                Stop
              </button>
            </div>
          )}

          {!submitted && suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-8">
              <span className="text-xs text-slate-400 self-center">Try:</span>
              {suggestions.map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setQuery(q);
                    handleTextSearch(q);
                  }}
                  className="px-3 py-1.5 bg-white border border-slate-200 text-slate-500 text-xs rounded-lg hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 hover:scale-[1.02] transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Image Search Mode ────────────────────────────────────────────────── */}
      {mode === "image" && (
        <>
          {!imageFile ? (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => imageInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all mb-4 ${
                isDragging
                  ? "border-indigo-400 bg-indigo-50 scale-[1.01]"
                  : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50"
              }`}
            >
              <input
                ref={imageInputRef}
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
                  <Icon name="camera" className="w-7 h-7 text-indigo-400" />
                </div>
                <div>
                  <p className="font-semibold text-slate-700">
                    Drop a product image or catalog page
                  </p>
                  <p className="text-sm text-slate-400 mt-0.5">
                    Photo of a product, screenshot, or catalog page — JPEG, PNG, WebP
                  </p>
                </div>
                <p className="text-xs text-slate-300">
                  Claude Vision identifies products and finds matches in your catalogs
                </p>
              </div>
            </div>
          ) : (
            <div className="mb-4">
              <Card className="p-4">
                <div className="flex items-start gap-4">
                  <div className="relative w-32 h-32 rounded-xl overflow-hidden bg-slate-100 shrink-0">
                    {imagePreview && (
                      <Image
                        src={imagePreview}
                        alt="Search image"
                        fill
                        className="object-cover"
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
                    {response?.ai_description && (
                      <div className="mt-3 p-2.5 bg-indigo-50 rounded-lg">
                        <p className="text-xs text-slate-400 flex items-center gap-1 mb-1">
                          <Icon name="sparkle" className="w-3 h-3 text-indigo-400" />
                          AI identified
                        </p>
                        <p className="text-xs text-indigo-700 font-medium">
                          {response.ai_description}
                        </p>
                      </div>
                    )}
                    {/* Vector search badge */}
                    {response?.search_mode === "vector" && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-xs font-medium">
                          <Icon name="sparkle" className="w-3 h-3" />
                          Visual similarity search
                        </span>
                        {response.ai_rerank && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            response.ai_rerank.confidence === "high" ? "bg-green-100 text-green-700" :
                            response.ai_rerank.confidence === "medium" ? "bg-amber-100 text-amber-700" :
                            "bg-slate-100 text-slate-600"
                          }`}>
                            {response.ai_rerank.confidence} confidence
                          </span>
                        )}
                      </div>
                    )}
                    {/* AI re-rank explanation */}
                    {response?.ai_rerank?.explanation && response.search_mode === "vector" && (
                      <div className="mt-2 p-2.5 bg-violet-50 rounded-lg">
                        <p className="text-xs text-violet-600">{response.ai_rerank.explanation}</p>
                      </div>
                    )}
                    {/* Visual variants warning */}
                    {response?.ai_rerank?.visual_variants && (
                      <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                        <p className="text-xs text-amber-700 font-medium">
                          Multiple visually similar products found — check specifications carefully to pick the right variant.
                        </p>
                      </div>
                    )}
                    <div className="flex gap-2 mt-3">
                      <Button onClick={handleImageSearch} disabled={loading} size="sm">
                        {loading ? "Searching..." : "Search by Image"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setImageFile(null);
                          setImagePreview(null);
                          setResponse(null);
                          setSubmitted("");
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </>
      )}

      {/* ── Shared results section ───────────────────────────────────────────── */}

      {/* Translation indicator */}
      {response?.translated_from && response.original_query && (
        <div className="mb-4">
          <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl">
            <span className="text-base">&#x1F1EE;&#x1F1F3;</span>
            <div className="text-xs">
              <span className="text-amber-700 font-medium">
                Translated from {response.translated_from === "hindi" ? "Hindi" : "Hinglish"}:
              </span>{" "}
              <span className="text-amber-600">
                &ldquo;{response.original_query}&rdquo; &rarr; &ldquo;{response.query}&rdquo;
              </span>
            </div>
          </div>
        </div>
      )}

      {/* AI interpretation badge */}
      {response?.ai_interpretation && (
        <div className="mb-4">
          <div className="flex items-start gap-2 p-3 bg-indigo-50 rounded-xl">
            <Icon name="sparkle" className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-indigo-700 font-medium">{response.ai_interpretation}</p>
              {response.search_mode === "catalog_specific" && response.sql_filter && (
                <p className="text-xs text-indigo-400 mt-1 font-mono">
                  {response.sql_filter}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Image search AI description */}
      {response?.parsed_filters && !response.ai_interpretation && (
        <div className="mb-5 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Icon name="sparkle" className="w-3.5 h-3.5 text-indigo-400" />
              AI parsed:
            </span>
            {Object.entries(response.parsed_filters)
              .filter(
                ([key, v]) =>
                  v != null &&
                  v !== "" &&
                  !(Array.isArray(v) && v.length === 0) &&
                  key !== "expansions" &&
                  key !== "expanded_keywords"
              )
              .map(([key, val]) => (
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
              {response.results.map((item, i) => (
                <div key={item.id} className="animate-fade-in-up" style={{ animationDelay: `${i * 30}ms` }}>
                  <ResultCard
                    item={item}
                    expanded={expandedId === item.id}
                    showSimilarity={response.search_mode === "vector"}
                    onToggle={() =>
                      setExpandedId(expandedId === item.id ? null : item.id)
                    }
                    onCrossReference={() => handleCrossReference(item.id, item)}
                    crossRefActive={crossRefId === item.id}
                    crossRefLoading={crossRefId === item.id && crossRefLoading}
                  />

                  {/* Cross-reference results panel */}
                  {crossRefId === item.id && (crossRefLoading || crossRefData) && (
                    <CrossReferencePanel
                      loading={crossRefLoading}
                      data={crossRefData}
                      sourcePrice={Number(item.price) || null}
                      sourceName={item.product_name}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!submitted && !loading && mode === "text" && <EmptyState />}
    </div>
  );
}

// ─── Filter Chip ──────────────────────────────────────────────────────────────
function FilterChip({ label, value }: { label: string; value: unknown }) {
  const displayVal =
    typeof value === "object" && value !== null
      ? JSON.stringify(value)
      : String(value);

  const colorMap: Record<string, string> = {
    keywords: "bg-indigo-50 text-indigo-600 ring-indigo-200",
    price_max: "bg-emerald-50 text-emerald-600 ring-emerald-200",
    price_min: "bg-emerald-50 text-emerald-600 ring-emerald-200",
    category: "bg-amber-50 text-amber-600 ring-amber-200",
    size: "bg-blue-50 text-blue-600 ring-blue-200",
    material: "bg-violet-50 text-violet-600 ring-violet-200",
  };

  const colorClass =
    colorMap[label] ?? "bg-slate-50 text-slate-600 ring-slate-200";

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset ${colorClass}`}
    >
      <span className="opacity-60">{label}:</span>
      {displayVal}
    </span>
  );
}

// ─── Result Card ──────────────────────────────────────────────────────────────
function ResultCard({
  item,
  expanded,
  showSimilarity,
  onToggle,
  onCrossReference,
  crossRefActive,
  crossRefLoading,
}: {
  item: SearchResultItem;
  expanded: boolean;
  showSimilarity?: boolean;
  onToggle: () => void;
  onCrossReference: () => void;
  crossRefActive: boolean;
  crossRefLoading: boolean;
}) {
  const rawData = item.raw_data as Record<string, unknown> | undefined;

  return (
    <Card className="overflow-hidden" hover>
      <button onClick={onToggle} className="w-full text-left p-5">
        <div className="flex items-start gap-4">
          {/* Product image thumbnail */}
          {item.image_url && (
            <div className="w-16 h-16 rounded-lg overflow-hidden bg-slate-100 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.image_url}
                alt={item.product_name ?? ""}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-400 mb-1 truncate">
              {item.company_name && (
                <span className="font-medium text-slate-500">{item.company_name}</span>
              )}
              {item.company_name && item.catalog_name && " · "}
              {item.catalog_name ?? item.catalog_id}
            </p>

            <h4 className="font-semibold text-slate-900 text-sm leading-tight">
              {item.product_name ?? "Unnamed product"}
            </h4>

            {(item.category || item.sub_category) && (
              <div className="flex items-center gap-1.5 mt-1.5">
                {item.category && (
                  <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md font-medium">
                    {item.category}
                  </span>
                )}
                {item.category && item.sub_category && (
                  <Icon
                    name="chevronDown"
                    className="w-3 h-3 text-slate-300 -rotate-90"
                  />
                )}
                {item.sub_category && (
                  <span className="text-xs text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md">
                    {item.sub_category}
                  </span>
                )}
              </div>
            )}

            {item.description && (
              <p className="text-xs text-slate-400 mt-1.5 line-clamp-1">
                {item.description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {showSimilarity && item.relevance != null && (
              <div className="text-right">
                <p className="text-xs text-violet-600 font-semibold">
                  {item.relevance}% match
                </p>
              </div>
            )}
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

      {/* Cross-reference button — always visible */}
      <div className="px-5 pb-3 -mt-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCrossReference();
          }}
          disabled={crossRefLoading}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            crossRefActive
              ? "bg-violet-100 text-violet-700 ring-1 ring-violet-200"
              : "bg-slate-50 text-slate-500 hover:bg-violet-50 hover:text-violet-600 ring-1 ring-slate-200 hover:ring-violet-200"
          }`}
        >
          <Icon name="crossReference" className="w-3.5 h-3.5" />
          {crossRefLoading
            ? "Finding similar..."
            : crossRefActive
            ? "Hide alternatives"
            : "Similar in other brands"}
        </button>
      </div>

      {expanded && rawData && (
        <div className="border-t border-slate-100 px-5 pb-5 pt-4">
          <div className="flex gap-4">
            {/* Large image in expanded view */}
            {item.image_url && (
              <div className="w-40 h-40 rounded-xl overflow-hidden bg-slate-100 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.image_url}
                  alt={item.product_name ?? ""}
                  className="w-full h-full object-contain"
                />
              </div>
            )}
            <div className="flex-1">
              <p className="text-xs font-semibold text-slate-400 mb-3">
                Full product details
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
                {Object.entries(rawData)
                  .filter(
                    ([k, v]) =>
                      v != null &&
                      k !== "catalog_id" &&
                      k !== "id" &&
                      k !== "_image_url"
                  )
                  .map(([k, v]) => (
                    <div key={k}>
                      <p className="text-xs text-slate-400 font-mono">{k}</p>
                      <p className="text-xs text-slate-700 font-medium break-words">
                        {String(v)}
                      </p>
                    </div>
                  ))}
              </div>

              {/* Action buttons */}
              <div className="mt-4 flex items-center gap-3">
                {item.catalog_id && (
                  <Link
                    href={`/catalog/${item.catalog_id}`}
                    className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                  >
                    View full catalog &rarr;
                  </Link>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCrossReference();
                  }}
                  disabled={crossRefLoading}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    crossRefActive
                      ? "bg-violet-100 text-violet-700 ring-1 ring-violet-200"
                      : "bg-slate-50 text-slate-600 hover:bg-violet-50 hover:text-violet-600 ring-1 ring-slate-200 hover:ring-violet-200"
                  }`}
                >
                  <Icon name="crossReference" className="w-3.5 h-3.5" />
                  {crossRefLoading
                    ? "Finding..."
                    : crossRefActive
                    ? "Hide alternatives"
                    : "Similar in other brands"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Cross-Reference Panel ──────────────────────────────────────────────────
function CrossReferencePanel({
  loading,
  data,
  sourcePrice,
  sourceName,
}: {
  loading: boolean;
  data: CrossRefResponse | null;
  sourcePrice: number | null;
  sourceName: string | null;
}) {
  if (loading) {
    return (
      <div className="ml-4 mt-2 border-l-2 border-violet-200 pl-4 pb-2">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-3 h-3 rounded-full bg-violet-400 animate-pulse" />
          <span className="text-xs text-violet-600 font-medium">
            AI is finding similar products across other brands...
          </span>
        </div>
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => (
            <Card key={i} className="p-3">
              <Skeleton className="h-4 w-3/4 mb-2" />
              <Skeleton className="h-3 w-1/2" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!data || data.total === 0) {
    return (
      <div className="ml-4 mt-2 border-l-2 border-violet-200 pl-4 pb-2">
        <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
          <Icon name="noResults" className="w-4 h-4 text-slate-400" />
          <span className="text-xs text-slate-500">
            No similar products found in other catalogs.
            {sourceName && <> Upload more catalogs to find alternatives for &ldquo;{sourceName}&rdquo;.</>}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="ml-4 mt-2 border-l-2 border-violet-200 pl-4 pb-2">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="crossReference" className="w-4 h-4 text-violet-500" />
        <span className="text-xs text-violet-700 font-semibold">
          {data.total} similar product{data.total !== 1 ? "s" : ""} in other brands
        </span>
        {data.product_type && (
          <span className="text-xs text-violet-400">
            &middot; {data.product_type}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {data.cross_references.map((ref) => (
          <Card key={ref.id} className="p-3 hover:bg-slate-50 transition-colors">
            <div className="flex items-start gap-3">
              {ref.image_url && (
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ref.image_url}
                    alt={ref.product_name ?? ""}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-violet-600">
                    {ref.company_name}
                  </span>
                  <span className="text-xs text-slate-300">&middot;</span>
                  <span className="text-xs text-slate-400 truncate">
                    {ref.catalog_name}
                  </span>
                </div>
                <p className="text-sm font-medium text-slate-800 mt-0.5 leading-tight">
                  {ref.product_name ?? "Unknown product"}
                </p>
                {(ref.category || ref.sub_category) && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    {[ref.category, ref.sub_category].filter(Boolean).join(" > ")}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                {ref.price != null && (
                  <>
                    <p className="text-sm font-bold text-slate-900">
                      &#x20B9;{Number(ref.price).toLocaleString("en-IN")}
                    </p>
                    {ref.price_diff_pct != null && sourcePrice && (
                      <p
                        className={`text-xs font-medium ${
                          ref.price_diff_pct < 0
                            ? "text-emerald-600"
                            : ref.price_diff_pct > 0
                            ? "text-red-500"
                            : "text-slate-400"
                        }`}
                      >
                        {ref.price_diff_pct < 0
                          ? `${Math.abs(ref.price_diff_pct)}% cheaper`
                          : ref.price_diff_pct > 0
                          ? `${ref.price_diff_pct}% costlier`
                          : "Same price"}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Empty States ──────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <Icon name="sparkle" className="w-7 h-7 text-indigo-300" />
      </div>
      <p className="text-sm font-medium text-slate-500">
        AI-powered search across all your product catalogs
      </p>
      <p className="text-xs text-slate-400 mt-1">
        Search in English, Hindi, or Hinglish. Try voice search with the mic button!
      </p>
      <div className="flex items-center gap-4 mt-4 text-xs text-slate-300">
        <span className="flex items-center gap-1">
          <Icon name="microphone" className="w-3.5 h-3.5" /> Voice
        </span>
        <span className="flex items-center gap-1">
          <Icon name="crossReference" className="w-3.5 h-3.5" /> Cross-brand
        </span>
        <span className="flex items-center gap-1">
          <Icon name="camera" className="w-3.5 h-3.5" /> Image
        </span>
      </div>
    </div>
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <Card className="p-8 text-center">
      <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mx-auto mb-3">
        <Icon name="noResults" className="w-6 h-6 text-slate-300" />
      </div>
      <p className="text-sm font-semibold text-slate-600">
        No products found for &ldquo;{query}&rdquo;
      </p>
      <p className="text-xs text-slate-400 mt-1">
        Try different keywords, voice search, or select a specific catalog
      </p>
    </Card>
  );
}
