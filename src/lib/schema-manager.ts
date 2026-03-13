import { getSupabase } from "./supabase";
import type { ColumnDefinition } from "./types";

const TYPE_MAP: Record<string, string> = {
  TEXT: "TEXT",
  NUMERIC: "NUMERIC",
  INTEGER: "INTEGER",
  BOOLEAN: "BOOLEAN",
  "TEXT[]": "TEXT[]",
};

export function sanitizeTableName(companyName: string, catalogName: string): string {
  const raw = `catalog_${companyName}_${catalogName}`;
  const name = raw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return name.slice(0, 63);
}

export function sanitizeColumnName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

export async function createDynamicTable(
  tableName: string,
  columns: ColumnDefinition[]
): Promise<void> {
  const sb = getSupabase();
  const colDefs = [
    "id UUID PRIMARY KEY DEFAULT gen_random_uuid()",
    "catalog_id UUID REFERENCES master_catalogs(id) ON DELETE CASCADE",
    ...columns.map((col) => {
      const pgType = TYPE_MAP[col.type] ?? "TEXT";
      const colName = sanitizeColumnName(col.name);
      return `${colName} ${pgType}`;
    }),
  ];
  const sql = `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${colDefs.join(",\n  ")}\n);`;
  await sb.rpc("exec_sql", { query: sql });
}

export async function dropDynamicTable(tableName: string): Promise<void> {
  const sb = getSupabase();
  await sb.rpc("exec_sql", { query: `DROP TABLE IF EXISTS "${tableName}" CASCADE;` });
}
