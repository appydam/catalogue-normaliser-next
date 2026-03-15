import { getSupabase } from "./supabase";
import { sanitizeColumnName } from "./schema-manager";
import type { ColumnDefinition } from "./types";
import { isValidUUID, isValidTableName } from "./types";

function escapeSQL(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (isNaN(value)) return "NULL";
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/\0/g, "")}'`).join(",");
    return `ARRAY[${items}]::TEXT[]`;
  }
  // String — escape single quotes, backslashes, null bytes
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/\0/g, "")}'`;
}

export interface InsertResult {
  inserted: number;
  failed: number;
  errors: string[];
}

export async function insertProducts(
  tableName: string,
  catalogId: string,
  products: Record<string, unknown>[],
  columns: ColumnDefinition[],
  batchSize = 50
): Promise<number> {
  const result = await insertProductsDetailed(tableName, catalogId, products, columns, batchSize);
  return result.inserted;
}

export async function insertProductsDetailed(
  tableName: string,
  catalogId: string,
  products: Record<string, unknown>[],
  columns: ColumnDefinition[],
  batchSize = 50
): Promise<InsertResult> {
  // P1-1: Validate inputs before SQL interpolation
  if (!isValidUUID(catalogId)) {
    return { inserted: 0, failed: products.length, errors: [`Invalid catalog UUID: ${catalogId}`] };
  }
  if (!isValidTableName(tableName)) {
    return { inserted: 0, failed: products.length, errors: [`Invalid table name: ${tableName}`] };
  }

  const sb = getSupabase();
  const colNames = ["catalog_id", ...columns.map((c) => sanitizeColumnName(c.name))];

  let inserted = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);

    const valueRows = batch.map((product) => {
      const vals = colNames.map((col) => {
        if (col === "catalog_id") return escapeSQL(catalogId);
        const rawKey = Object.keys(product).find(
          (k) => sanitizeColumnName(k) === col
        );
        return escapeSQL(rawKey !== undefined ? product[rawKey] : null);
      });
      return `(${vals.join(", ")})`;
    });

    const sql = `INSERT INTO "${tableName}" (${colNames.map((c) => `"${c}"`).join(", ")}) VALUES ${valueRows.join(", ")}`;

    const { data, error } = await sb.rpc("exec_sql", { query: sql });
    const batchFailed = error || (data && !data.ok);

    if (batchFailed) {
      const errMsg = error?.message || data?.error || "Unknown error";
      console.error(`[data-inserter] Batch insert failed:`, errMsg);
      errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${errMsg}`);

      // Try one-by-one to salvage valid rows
      for (let j = 0; j < valueRows.length; j++) {
        const singleSql = `INSERT INTO "${tableName}" (${colNames.map((c) => `"${c}"`).join(", ")}) VALUES ${valueRows[j]}`;
        const { data: rd, error: re } = await sb.rpc("exec_sql", { query: singleSql });
        if (!re && rd?.ok) {
          inserted++;
        } else {
          failed++;
          const rowErr = re?.message || rd?.error || "Unknown";
          errors.push(`Row ${i + j + 1}: ${rowErr}`);
        }
      }
    } else {
      inserted += batch.length;
    }
  }

  if (errors.length > 10) {
    // Keep first 5 + last 5 to avoid huge error arrays
    const trimmed = [...errors.slice(0, 5), `... ${errors.length - 10} more errors ...`, ...errors.slice(-5)];
    return { inserted, failed, errors: trimmed };
  }

  return { inserted, failed, errors };
}
