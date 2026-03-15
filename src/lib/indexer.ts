import { getSupabase } from "./supabase";
import { isValidUUID } from "./types";

// Keys that are not useful for full-text search
const SKIP_KEYS = new Set([
  "_image_url", "image_url", "page_number", "catalog_id", "id",
]);

// Keys whose values are URLs or IDs — skip them
function isSkippableValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /^https?:\/\//.test(value) || /^[0-9a-f]{8}-[0-9a-f]{4}/.test(value);
}

function findField(product: Record<string, unknown>, candidates: string[]): string | null {
  for (const key of candidates) {
    const val = product[key];
    if (val != null) return String(val);
  }
  return null;
}

function findPrice(product: Record<string, unknown>): number | null {
  for (const key of ["price", "price_inr", "rate_rs", "list_price", "mrp", "rate"]) {
    const val = product[key];
    if (val != null) {
      const n = Number(val);
      if (!isNaN(n)) return n;
    }
  }
  return null;
}

/**
 * Build a rich, search-friendly text description from a product.
 * Includes field names as context so searches like "category:Toilet" or
 * just "Toilet" both match. Excludes URLs, IDs, and page numbers.
 */
function buildSearchText(product: Record<string, unknown>): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(product)) {
    if (SKIP_KEYS.has(key)) continue;
    if (value == null) continue;

    if (Array.isArray(value)) {
      const strs = value.map(String).filter((s) => s && !isSkippableValue(s));
      if (strs.length > 0) parts.push(strs.join(" "));
    } else {
      const str = String(value);
      if (!str || isSkippableValue(str)) continue;
      // Include the field name for context (helps with structured searches)
      const label = key.replace(/_/g, " ");
      parts.push(`${label} ${str}`);
    }
  }

  return parts.join(" | ");
}

function buildRow(catalogId: string, tableName: string, product: Record<string, unknown>) {
  return {
    catalog_id: catalogId,
    source_table: tableName,
    product_name: findField(product, [
      "product_name", "product_description", "description", "item", "name", "material_name", "product_code",
    ]),
    category: findField(product, ["category", "series", "collection"]),
    sub_category: findField(product, ["sub_category", "subcategory", "product_type"]),
    description: buildSearchText(product),
    price: findPrice(product),
    price_unit: findField(product, ["price_unit", "rate_unit", "price_note"]),
    image_url: product._image_url ? String(product._image_url) : null,
    raw_data: product,
  };
}

/**
 * Insert a batch of products into product_search_index WITHOUT updating tsvector.
 * Called per-chunk during extraction for incremental indexing.
 */
export async function indexProductsBatch(
  catalogId: string,
  tableName: string,
  products: Record<string, unknown>[],
  batchSize = 100
): Promise<number> {
  const sb = getSupabase();
  let indexed = 0;

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    const rows = batch.map((p) => buildRow(catalogId, tableName, p));
    const { error } = await sb.from("product_search_index").insert(rows);
    if (error) {
      console.error(`[indexer] Batch index insert failed:`, error.message);
      for (const row of rows) {
        const { error: rowErr } = await sb.from("product_search_index").insert(row);
        if (!rowErr) indexed++;
      }
    } else {
      indexed += rows.length;
    }
  }

  return indexed;
}

/**
 * Build the tsvector search_text for all un-indexed rows of a catalog.
 * Uses weighted vectors: product_name and category get weight 'A' (highest),
 * description gets weight 'B'. This ensures product name matches rank higher.
 * Called once at finalize after all chunks are done.
 */
export async function buildSearchIndex(catalogId: string): Promise<void> {
  if (!isValidUUID(catalogId)) {
    console.error(`[indexer] Invalid catalog UUID: ${catalogId}`);
    return;
  }
  const sb = getSupabase();
  await sb.rpc("exec_sql", {
    query: `UPDATE product_search_index SET search_text =
      setweight(to_tsvector('simple', coalesce(product_name, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(category, '') || ' ' || coalesce(sub_category, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(description, '')), 'B')
    WHERE catalog_id = '${catalogId}' AND search_text IS NULL;`,
  });
}
