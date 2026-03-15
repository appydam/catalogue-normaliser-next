/**
 * Post-extraction validation and confidence scoring.
 *
 * After Claude extracts products from a chunk, this module:
 * 1. Scores each product's extraction confidence (0-1)
 * 2. Validates extraction completeness against page classifications
 * 3. Identifies pages that likely need re-extraction
 */

import type { PageClassification } from "./catalog-classifier";
import type { ColumnDefinition } from "./types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProductConfidence {
  product_index: number;
  confidence: number;
  issues: string[];
}

export interface ChunkValidation {
  products_found: number;
  products_expected: number;
  coverage_ratio: number; // products_found / products_expected
  low_confidence_count: number;
  pages_needing_reextraction: number[];
  product_confidences: ProductConfidence[];
  overall_quality: "good" | "acceptable" | "poor";
}

// ─── Confidence scoring ─────────────────────────────────────────────────────

/**
 * Score a single extracted product's confidence.
 * Returns 0-1 where 1 = high confidence this is a valid, complete product.
 */
export function scoreProduct(
  product: Record<string, unknown>,
  columns: ColumnDefinition[]
): ProductConfidence {
  const issues: string[] = [];
  let score = 1.0;

  // Check page_number exists
  if (product.page_number == null) {
    score -= 0.3;
    issues.push("missing page_number");
  }

  // Check for a product identifier (name, code, or description)
  const hasName = Boolean(product.product_name || product.product_description || product.description || product.name || product.item);
  const hasCode = Boolean(product.product_code || product.catalog_number || product.cat_no || product.article_number);
  if (!hasName && !hasCode) {
    score -= 0.4;
    issues.push("no product identifier (name or code)");
  }

  // Check how many schema columns are filled
  const schemaColNames = new Set(columns.map((c) => c.name.toLowerCase()));
  let filledCount = 0;
  let totalRelevant = 0;
  for (const col of columns) {
    const colName = col.name.toLowerCase();
    if (["page_number", "category", "sub_category"].includes(colName)) continue; // metadata columns
    totalRelevant++;
    const val = product[colName];
    if (val != null && String(val).trim() !== "") filledCount++;
  }

  const fillRate = totalRelevant > 0 ? filledCount / totalRelevant : 0;
  if (fillRate < 0.2) {
    score -= 0.3;
    issues.push(`very sparse: only ${filledCount}/${totalRelevant} columns filled`);
  } else if (fillRate < 0.4) {
    score -= 0.15;
    issues.push(`sparse: ${filledCount}/${totalRelevant} columns filled`);
  }

  // Check for price (if schema has a price column)
  const hasPriceCol = [...schemaColNames].some((n) =>
    ["price", "price_inr", "rate_rs", "mrp", "rate", "list_price"].includes(n)
  );
  if (hasPriceCol) {
    const hasPrice = ["price", "price_inr", "rate_rs", "mrp", "rate", "list_price"].some(
      (k) => product[k] != null && !isNaN(Number(product[k]))
    );
    if (!hasPrice) {
      score -= 0.1;
      issues.push("no price value");
    }
  }

  // Check for suspiciously short or long values
  const nameVal = String(product.product_name || product.product_description || product.description || "");
  if (nameVal.length > 0 && nameVal.length < 3) {
    score -= 0.15;
    issues.push("product name too short");
  }

  // Check for duplicate-looking data (all fields identical to another common pattern)
  if (product.category === product.product_name) {
    score -= 0.1;
    issues.push("category equals product_name (likely extraction error)");
  }

  return {
    product_index: 0, // set by caller
    confidence: Math.max(0, Math.min(1, score)),
    issues,
  };
}

/**
 * Validate a chunk's extraction results against page classifications.
 */
export function validateChunkExtraction(
  products: Record<string, unknown>[],
  columns: ColumnDefinition[],
  pageClassifications: PageClassification[]
): ChunkValidation {
  // Score each product
  const confidences: ProductConfidence[] = products.map((product, i) => {
    const result = scoreProduct(product, columns);
    result.product_index = i;
    return result;
  });

  const lowConfCount = confidences.filter((c) => c.confidence < 0.5).length;

  // Compare against expected products from page classification
  const expectedTotal = pageClassifications.reduce(
    (sum, p) => sum + Math.max(p.estimated_product_count, 1),
    0
  );

  const coverageRatio = expectedTotal > 0 ? products.length / expectedTotal : 1;

  // Identify pages that might need re-extraction
  const pagesNeedingReextraction: number[] = [];
  for (const pageClass of pageClassifications) {
    if (pageClass.page_type !== "product") continue;

    const productsOnPage = products.filter(
      (p) => Number(p.page_number) === pageClass.page_number
    );

    // If we expected products but got very few, flag for re-extraction
    if (pageClass.estimated_product_count > 3 && productsOnPage.length < pageClass.estimated_product_count * 0.3) {
      pagesNeedingReextraction.push(pageClass.page_number);
    }
  }

  // Overall quality assessment
  let quality: "good" | "acceptable" | "poor";
  if (coverageRatio >= 0.7 && lowConfCount <= products.length * 0.1) {
    quality = "good";
  } else if (coverageRatio >= 0.4 && lowConfCount <= products.length * 0.3) {
    quality = "acceptable";
  } else {
    quality = "poor";
  }

  return {
    products_found: products.length,
    products_expected: expectedTotal,
    coverage_ratio: coverageRatio,
    low_confidence_count: lowConfCount,
    pages_needing_reextraction: pagesNeedingReextraction,
    product_confidences: confidences,
    overall_quality: quality,
  };
}

/**
 * Filter out products that are clearly invalid (confidence < threshold).
 * Returns the filtered array and the count of removed products.
 */
export function filterLowConfidenceProducts(
  products: Record<string, unknown>[],
  columns: ColumnDefinition[],
  threshold = 0.25
): { filtered: Record<string, unknown>[]; removed: number } {
  const filtered: Record<string, unknown>[] = [];
  let removed = 0;

  for (const product of products) {
    const { confidence } = scoreProduct(product, columns);
    if (confidence >= threshold) {
      filtered.push(product);
    } else {
      removed++;
    }
  }

  return { filtered, removed };
}
