/**
 * PDF Fingerprinting & Deduplication Utilities
 *
 * Client-side: computeFileHash(), computeContentHash()
 * Server-side: normalizeCompanyName(), normalizeCatalogName(), normalizeFileName()
 */

// ─── Company/Catalog Name Normalization ─────────────────────────────────────

const COMPANY_SUFFIXES = [
  "pvt", "private", "ltd", "limited", "inc", "incorporated",
  "llc", "llp", "corp", "corporation", "co", "company",
  "industries", "enterprises", "sanitaryware", "ceramics",
  "pipes", "fittings", "group", "international", "india",
];

export function normalizeCompanyName(name: string): string {
  let normalized = name.toLowerCase().trim();
  // Remove punctuation and special chars
  normalized = normalized.replace(/[^a-z0-9\s]/g, "");
  // Remove common suffixes
  const words = normalized.split(/\s+/).filter((w) => !COMPANY_SUFFIXES.includes(w));
  return words.join("_").replace(/_+/g, "_").replace(/^_|_$/g, "") || normalized.replace(/\s+/g, "_");
}

export function normalizeCatalogName(name: string): string {
  let normalized = name.toLowerCase().trim();
  // Remove dates, edition numbers, version markers
  normalized = normalized.replace(/\b(20\d{2}|19\d{2})\b/g, ""); // years
  normalized = normalized.replace(/\b(v\d+|version\s*\d+|edition\s*\d+|ed\.\s*\d+)\b/gi, "");
  normalized = normalized.replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi, "");
  normalized = normalized.replace(/\b(jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/gi, "");
  // Remove punctuation
  normalized = normalized.replace(/[^a-z0-9\s]/g, "");
  // Collapse whitespace
  normalized = normalized.trim().replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return normalized || name.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

export function normalizeFileName(name: string): string {
  let normalized = name.toLowerCase().trim();
  // Remove extension
  normalized = normalized.replace(/\.(pdf|PDF)$/, "");
  // Remove copy/duplicate markers
  normalized = normalized.replace(/\s*\(\d+\)\s*$/, ""); // "(1)", "(2)"
  normalized = normalized.replace(/\s*-\s*copy\s*$/i, "");
  // Remove dates/timestamps
  normalized = normalized.replace(/\b(20\d{2}|19\d{2})\b/g, "");
  normalized = normalized.replace(/\d{2}[-_]\d{2}[-_]\d{4}/g, "");
  // Clean up
  normalized = normalized.replace(/[^a-z0-9\s]/g, "");
  return normalized.trim().replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

// ─── Confidence Scoring ─────────────────────────────────────────────────────

export interface FingerprintMatch {
  master_catalog_id: string;
  confidence: number;
  match_type: "exact" | "content" | "version_update" | "similar";
  match_details: string;
  catalog_name: string;
  company_name: string;
  total_products: number;
  version: number;
  processing_status: string;
}

export interface FingerprintCheckRequest {
  file_hash: string;
  content_hash: string;
  file_name: string;
  page_count: number;
  file_size: number;
  text_sample: string;
}

/**
 * Compute similarity between two normalized strings (Jaccard on word sets).
 */
export function stringSimilarity(a: string, b: string): number {
  const setA = new Set(a.split("_").filter(Boolean));
  const setB = new Set(b.split("_").filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}
