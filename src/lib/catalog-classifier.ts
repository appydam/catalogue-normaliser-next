/**
 * Catalog classification system.
 *
 * Analyzes sample pages during schema discovery to determine catalog type,
 * page density, and structural patterns. This information drives:
 *   - Which extraction prompt template to use
 *   - How many pages per chunk
 *   - Which pages to skip
 *   - Post-extraction validation thresholds
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type CatalogType = "tabular" | "image_based" | "mixed";

export type PageType =
  | "product"       // Contains extractable product data
  | "index"         // Table of contents / index page
  | "cover"         // Cover, back cover, intro
  | "lifestyle"     // Lifestyle photos with no product data
  | "blank"         // Empty or near-empty page
  | "unknown";      // Could not classify

export interface PageClassification {
  page_number: number;
  page_type: PageType;
  text_length: number;
  has_prices: boolean;
  has_table_structure: boolean;
  has_product_codes: boolean;
  estimated_product_count: number;
  confidence: number; // 0-1
}

export interface CatalogClassification {
  catalog_type: CatalogType;
  confidence: number;
  pages_per_chunk: number;
  estimated_products_per_page: number;
  has_price_grids: boolean;
  has_product_images: boolean;
  page_classifications: PageClassification[];
}

// ─── Heuristic classifiers ──────────────────────────────────────────────────

const PRICE_PATTERN = /(?:₹|rs\.?|inr|price|rate|mrp)\s*[:\.]?\s*[\d,.]+/gi;
const TABLE_PATTERN = /(?:\d+\s*[×xX]\s*\d+|\|\s*\d|\d+\s*mm\s+\d+\s*mm|─|━|┃|│)/g;
const PRODUCT_CODE_PATTERN = /(?:[A-Z]{1,3}\d{4,}|#?\s*Cat\.?\s*No\.?\s*[A-Z0-9]+|Art\.?\s*(?:No|#)\.?\s*[A-Z0-9]+)/gi;
const DIMENSION_PATTERN = /\d+\s*[×xX]\s*\d+(?:\s*[×xX]\s*\d+)?(?:\s*mm)?/g;
const TOC_PATTERN = /(?:table\s*of\s*contents|index|contents|sr\.?\s*no|page\s*no)/gi;
const COVER_PATTERN = /(?:price\s*list|catalogue|catalog|product\s*range|collection)\s*\d{2,4}/gi;

// Patterns for dense tabular data (pipe fittings, price grids)
const GRID_ROW_PATTERN = /(?:\d+\.?\d*\s+){3,}/g; // 3+ numbers in a row
const SIZE_HEADER_PATTERN = /(?:size|dia|nominal|mm|inch)\s*(?:\(|\|)/gi;

/**
 * Classify a single page based on its text content.
 */
export function classifyPage(
  pageNum: number,
  text: string,
  totalPages: number
): PageClassification {
  const textLength = text.length;

  // Blank/near-empty
  if (textLength < 30) {
    return {
      page_number: pageNum,
      page_type: "blank",
      text_length: textLength,
      has_prices: false,
      has_table_structure: false,
      has_product_codes: false,
      estimated_product_count: 0,
      confidence: 0.95,
    };
  }

  const priceMatches = text.match(PRICE_PATTERN) ?? [];
  const tableMatches = text.match(TABLE_PATTERN) ?? [];
  const codeMatches = text.match(PRODUCT_CODE_PATTERN) ?? [];
  const dimMatches = text.match(DIMENSION_PATTERN) ?? [];
  const tocMatches = text.match(TOC_PATTERN) ?? [];
  const coverMatches = text.match(COVER_PATTERN) ?? [];
  const gridRows = text.match(GRID_ROW_PATTERN) ?? [];
  const sizeHeaders = text.match(SIZE_HEADER_PATTERN) ?? [];

  const hasPrices = priceMatches.length > 0;
  const hasTableStructure = tableMatches.length >= 2 || gridRows.length >= 3 || sizeHeaders.length > 0;
  const hasProductCodes = codeMatches.length > 0;

  // Index / TOC detection
  if (tocMatches.length > 0 && priceMatches.length === 0) {
    return {
      page_number: pageNum,
      page_type: "index",
      text_length: textLength,
      has_prices: false,
      has_table_structure: false,
      has_product_codes: false,
      estimated_product_count: 0,
      confidence: 0.85,
    };
  }

  // Cover page detection (first 3 or last 2 pages with cover-like text and no prices)
  if ((pageNum <= 3 || pageNum >= totalPages - 1) && coverMatches.length > 0 && priceMatches.length <= 1 && textLength < 500) {
    return {
      page_number: pageNum,
      page_type: "cover",
      text_length: textLength,
      has_prices: false,
      has_table_structure: false,
      has_product_codes: false,
      estimated_product_count: 0,
      confidence: 0.8,
    };
  }

  // Lifestyle page (very little text, no prices, no codes, not first/last)
  if (textLength < 100 && !hasPrices && !hasProductCodes && pageNum > 3 && pageNum < totalPages - 1) {
    return {
      page_number: pageNum,
      page_type: "lifestyle",
      text_length: textLength,
      has_prices: false,
      has_table_structure: false,
      has_product_codes: false,
      estimated_product_count: 0,
      confidence: 0.6,
    };
  }

  // Product page — estimate product count
  let estimatedProducts = 0;

  if (hasTableStructure || gridRows.length >= 3) {
    // Tabular: estimate from price count or grid rows
    estimatedProducts = Math.max(priceMatches.length, gridRows.length);
  } else if (hasProductCodes) {
    // Image-based: estimate from product codes
    estimatedProducts = codeMatches.length;
  } else if (hasPrices) {
    estimatedProducts = priceMatches.length;
  } else if (dimMatches.length > 0) {
    estimatedProducts = dimMatches.length;
  } else if (textLength > 200) {
    // Has substantial text but no clear signals — likely a product page we can't easily count
    estimatedProducts = 1;
  }

  return {
    page_number: pageNum,
    page_type: estimatedProducts > 0 ? "product" : "unknown",
    text_length: textLength,
    has_prices: hasPrices,
    has_table_structure: hasTableStructure,
    has_product_codes: hasProductCodes,
    estimated_product_count: estimatedProducts,
    confidence: estimatedProducts > 0 ? 0.7 : 0.4,
  };
}

/**
 * Classify the overall catalog type based on sample page classifications.
 */
export function classifyCatalog(
  pageClassifications: PageClassification[]
): CatalogClassification {
  const productPages = pageClassifications.filter((p) => p.page_type === "product");

  if (productPages.length === 0) {
    return {
      catalog_type: "mixed",
      confidence: 0.3,
      pages_per_chunk: 2,
      estimated_products_per_page: 1,
      has_price_grids: false,
      has_product_images: false,
      page_classifications: pageClassifications,
    };
  }

  const tabularPages = productPages.filter((p) => p.has_table_structure);
  const imagePages = productPages.filter((p) => p.has_product_codes && !p.has_table_structure);
  const tabularRatio = tabularPages.length / productPages.length;

  let catalogType: CatalogType;
  let confidence: number;

  if (tabularRatio >= 0.7) {
    catalogType = "tabular";
    confidence = 0.85;
  } else if (tabularRatio <= 0.3) {
    catalogType = "image_based";
    confidence = 0.8;
  } else {
    catalogType = "mixed";
    confidence = 0.7;
  }

  // Compute density metrics
  const avgProducts = productPages.reduce((s, p) => s + p.estimated_product_count, 0) / productPages.length;
  const avgTextLength = productPages.reduce((s, p) => s + p.text_length, 0) / productPages.length;
  const hasPriceGrids = tabularPages.some((p) => p.estimated_product_count > 10);

  // Determine pages per chunk based on density
  let pagesPerChunk = 2;
  if (avgTextLength > 3000 || avgProducts > 20) {
    pagesPerChunk = 1; // Dense pages need individual processing
  } else if (avgTextLength < 500 && catalogType === "image_based") {
    pagesPerChunk = 3; // Light image pages can be batched more
  }

  return {
    catalog_type: catalogType,
    confidence,
    pages_per_chunk: pagesPerChunk,
    estimated_products_per_page: Math.round(avgProducts),
    has_price_grids: hasPriceGrids,
    has_product_images: imagePages.length > 0,
    page_classifications: pageClassifications,
  };
}

/**
 * Get the list of page numbers that should be skipped (not extracted).
 */
export function getSkippablePages(classifications: PageClassification[]): number[] {
  return classifications
    .filter((p) => ["index", "cover", "lifestyle", "blank"].includes(p.page_type) && p.confidence >= 0.6)
    .map((p) => p.page_number);
}

/**
 * Get pages that should be extracted, sorted by page number.
 */
export function getExtractablePages(classifications: PageClassification[]): number[] {
  const skippable = new Set(getSkippablePages(classifications));
  return classifications
    .filter((p) => !skippable.has(p.page_number))
    .map((p) => p.page_number)
    .sort((a, b) => a - b);
}
