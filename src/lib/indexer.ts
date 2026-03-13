import { getSupabase } from "./supabase";

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

function buildSearchText(product: Record<string, unknown>): string {
  return Object.values(product)
    .flatMap((v) => (Array.isArray(v) ? v.map(String) : v != null ? [String(v)] : []))
    .join(" ");
}

function buildRow(catalogId: string, tableName: string, product: Record<string, unknown>) {
  return {
    catalog_id: catalogId,
    source_table: tableName,
    product_name: findField(product, [
      "product_name", "product_description", "description", "item", "name", "material_name",
    ]),
    category: findField(product, ["category"]),
    sub_category: findField(product, ["sub_category", "subcategory"]),
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
    await sb.from("product_search_index").insert(rows);
    indexed += rows.length;
  }

  return indexed;
}

/**
 * Build the tsvector search_text for all un-indexed rows of a catalog.
 * Called once at finalize after all chunks are done.
 */
export async function buildSearchIndex(catalogId: string): Promise<void> {
  const sb = getSupabase();
  await sb.rpc("exec_sql", {
    query: `UPDATE product_search_index SET search_text = to_tsvector('english', coalesce(description, '')) WHERE catalog_id = '${catalogId}' AND search_text IS NULL;`,
  });
}
