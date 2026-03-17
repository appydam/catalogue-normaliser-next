// ─── Catalog Diff Engine ──────────────────────────────────────────────────────
// Compares products between two catalog versions, matching by name/code
// and computing price changes, additions, and removals.

export interface ProductRecord {
  [key: string]: unknown;
}

export interface ProductChange {
  column: string;
  oldVal: string | number | null;
  newVal: string | number | null;
}

export interface MatchedProduct {
  old: ProductRecord;
  new: ProductRecord;
  changes: ProductChange[];
  similarity: number;
}

export interface PriceChangeSummary {
  increased: number;
  decreased: number;
  unchanged: number;
  avgIncreasePct: number;
  avgDecreasePct: number;
}

export interface CatalogDiffResult {
  matched: MatchedProduct[];
  added: ProductRecord[];
  removed: ProductRecord[];
  priceChanges: PriceChangeSummary;
}

// ─── String Similarity (Jaccard on word sets) ────────────────────────────────

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0)
  );
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Product Name / Code Extraction ──────────────────────────────────────────

const NAME_COLUMNS = [
  "product_name",
  "product_description",
  "item_name",
  "item_description",
  "description",
  "name",
  "material",
  "product",
];

const CODE_COLUMNS = [
  "product_code",
  "item_code",
  "sku",
  "article_code",
  "article_number",
  "part_number",
  "code",
  "catalog_number",
  "cat_no",
];

const PRICE_COLUMNS = [
  "rate_rs",
  "price",
  "mrp",
  "rate",
  "unit_price",
  "price_rs",
  "cost",
  "amount",
  "list_price",
  "selling_price",
];

function findColumn(product: ProductRecord, candidates: string[]): string | null {
  const keys = Object.keys(product).map((k) => k.toLowerCase());
  for (const candidate of candidates) {
    const found = keys.find((k) => k === candidate || k.includes(candidate));
    if (found) {
      // Return the original key (preserving case)
      return Object.keys(product).find((k) => k.toLowerCase() === found) ?? null;
    }
  }
  return null;
}

function getProductName(product: ProductRecord): string {
  const nameCol = findColumn(product, NAME_COLUMNS);
  if (nameCol && product[nameCol] != null) return String(product[nameCol]);
  return "";
}

function getProductCode(product: ProductRecord): string {
  const codeCol = findColumn(product, CODE_COLUMNS);
  if (codeCol && product[codeCol] != null) return String(product[codeCol]).trim();
  return "";
}

function getPrice(product: ProductRecord): number | null {
  const priceCol = findColumn(product, PRICE_COLUMNS);
  if (!priceCol || product[priceCol] == null) return null;
  const val = product[priceCol];
  const num = typeof val === "number" ? val : parseFloat(String(val).replace(/[^0-9.-]/g, ""));
  return isNaN(num) ? null : num;
}

function getPriceColumnName(product: ProductRecord): string | null {
  return findColumn(product, PRICE_COLUMNS);
}

// ─── Main Diff Engine ────────────────────────────────────────────────────────

const MATCH_THRESHOLD = 0.6;

export function computeCatalogDiff(
  oldProducts: ProductRecord[],
  newProducts: ProductRecord[],
  matchColumns?: string[]
): CatalogDiffResult {
  const matched: MatchedProduct[] = [];
  const matchedOldIndices = new Set<number>();
  const matchedNewIndices = new Set<number>();

  // Determine columns to compare for changes (excluding internal columns)
  const internalCols = new Set(["id", "catalog_id", "created_at", "updated_at"]);

  // Phase 1: Exact match on product code (if available)
  for (let ni = 0; ni < newProducts.length; ni++) {
    if (matchedNewIndices.has(ni)) continue;
    const newCode = getProductCode(newProducts[ni]);
    if (!newCode) continue;

    for (let oi = 0; oi < oldProducts.length; oi++) {
      if (matchedOldIndices.has(oi)) continue;
      const oldCode = getProductCode(oldProducts[oi]);
      if (oldCode && oldCode.toLowerCase() === newCode.toLowerCase()) {
        matchedOldIndices.add(oi);
        matchedNewIndices.add(ni);
        matched.push(buildMatch(oldProducts[oi], newProducts[ni], 1.0, internalCols));
        break;
      }
    }
  }

  // Phase 2: Exact match on custom matchColumns (if provided)
  if (matchColumns && matchColumns.length > 0) {
    for (let ni = 0; ni < newProducts.length; ni++) {
      if (matchedNewIndices.has(ni)) continue;
      const newVals = matchColumns.map((c) => String(newProducts[ni][c] ?? "").toLowerCase().trim());
      if (newVals.every((v) => !v)) continue;

      for (let oi = 0; oi < oldProducts.length; oi++) {
        if (matchedOldIndices.has(oi)) continue;
        const oldVals = matchColumns.map((c) => String(oldProducts[oi][c] ?? "").toLowerCase().trim());
        if (newVals.every((v, i) => v === oldVals[i]) && newVals.some((v) => v.length > 0)) {
          matchedOldIndices.add(oi);
          matchedNewIndices.add(ni);
          matched.push(buildMatch(oldProducts[oi], newProducts[ni], 1.0, internalCols));
          break;
        }
      }
    }
  }

  // Phase 3: Fuzzy match on product name using Jaccard similarity
  // Build a list of unmatched products with their names for faster lookup
  const unmatchedOld = oldProducts
    .map((p, i) => ({ product: p, index: i, name: getProductName(p) }))
    .filter((x) => !matchedOldIndices.has(x.index) && x.name.length > 0);

  for (let ni = 0; ni < newProducts.length; ni++) {
    if (matchedNewIndices.has(ni)) continue;
    const newName = getProductName(newProducts[ni]);
    if (!newName) continue;

    let bestMatch: { index: number; similarity: number; product: ProductRecord } | null = null;

    for (const oldItem of unmatchedOld) {
      if (matchedOldIndices.has(oldItem.index)) continue;
      const similarity = jaccardSimilarity(newName, oldItem.name);
      if (similarity >= MATCH_THRESHOLD && (!bestMatch || similarity > bestMatch.similarity)) {
        bestMatch = { index: oldItem.index, similarity, product: oldItem.product };
      }
    }

    if (bestMatch) {
      matchedOldIndices.add(bestMatch.index);
      matchedNewIndices.add(ni);
      matched.push(buildMatch(bestMatch.product, newProducts[ni], bestMatch.similarity, internalCols));
    }
  }

  // Collect unmatched products
  const added = newProducts.filter((_, i) => !matchedNewIndices.has(i));
  const removed = oldProducts.filter((_, i) => !matchedOldIndices.has(i));

  // Compute price change summary
  const priceChanges = computePriceChangeSummary(matched);

  return { matched, added, removed, priceChanges };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildMatch(
  oldProduct: ProductRecord,
  newProduct: ProductRecord,
  similarity: number,
  internalCols: Set<string>
): MatchedProduct {
  const changes: ProductChange[] = [];

  // Get all columns from both products
  const allKeys = new Set([...Object.keys(oldProduct), ...Object.keys(newProduct)]);

  for (const key of allKeys) {
    if (internalCols.has(key)) continue;

    const oldVal = oldProduct[key] ?? null;
    const newVal = newProduct[key] ?? null;

    const oldStr = oldVal == null ? "" : String(oldVal).trim();
    const newStr = newVal == null ? "" : String(newVal).trim();

    if (oldStr !== newStr) {
      changes.push({
        column: key,
        oldVal: oldVal as string | number | null,
        newVal: newVal as string | number | null,
      });
    }
  }

  return { old: oldProduct, new: newProduct, changes, similarity };
}

function computePriceChangeSummary(matched: MatchedProduct[]): PriceChangeSummary {
  let increased = 0;
  let decreased = 0;
  let unchanged = 0;
  let totalIncreasePct = 0;
  let totalDecreasePct = 0;

  for (const match of matched) {
    const oldPrice = getPrice(match.old);
    const newPrice = getPrice(match.new);

    if (oldPrice == null || newPrice == null) {
      unchanged++;
      continue;
    }

    if (newPrice > oldPrice) {
      increased++;
      if (oldPrice > 0) {
        totalIncreasePct += ((newPrice - oldPrice) / oldPrice) * 100;
      }
    } else if (newPrice < oldPrice) {
      decreased++;
      if (oldPrice > 0) {
        totalDecreasePct += ((oldPrice - newPrice) / oldPrice) * 100;
      }
    } else {
      unchanged++;
    }
  }

  return {
    increased,
    decreased,
    unchanged,
    avgIncreasePct: increased > 0 ? Math.round((totalIncreasePct / increased) * 100) / 100 : 0,
    avgDecreasePct: decreased > 0 ? Math.round((totalDecreasePct / decreased) * 100) / 100 : 0,
  };
}

// Re-export helpers used by the diff page
export { getProductName, getPrice, getPriceColumnName };
