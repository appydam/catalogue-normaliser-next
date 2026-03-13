import { getSupabase } from "./supabase";
import { sanitizeColumnName } from "./schema-manager";
import type { ColumnDefinition } from "./types";

export async function insertProducts(
  tableName: string,
  catalogId: string,
  products: Record<string, unknown>[],
  columns: ColumnDefinition[],
  batchSize = 100
): Promise<number> {
  const sb = getSupabase();
  const validColNames = new Set(columns.map((c) => sanitizeColumnName(c.name)));
  let inserted = 0;

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    const rows = batch.map((product) => {
      const row: Record<string, unknown> = { catalog_id: catalogId };
      for (const [key, value] of Object.entries(product)) {
        const colName = sanitizeColumnName(key);
        if (validColNames.has(colName)) row[colName] = value;
      }
      return row;
    });
    await sb.from(tableName).insert(rows);
    inserted += rows.length;
  }

  return inserted;
}
