export interface ColumnDefinition {
  name: string;
  type: "TEXT" | "NUMERIC" | "INTEGER" | "BOOLEAN" | "TEXT[]";
  description: string;
}

export interface SchemaDiscovery {
  company_name: string;
  catalog_name: string;
  categories: string[];
  columns: ColumnDefinition[];
}

export type ProcessingStatus =
  | "pending"
  | "rendering"
  | "schema_discovery"
  | "extracting"
  | "inserting"
  | "indexing"
  | "completed"
  | "completed_with_warnings"
  | "failed";

export interface ProcessingLogEntry {
  timestamp: string;
  status: ProcessingStatus;
  message: string;
}

export interface Catalog {
  id: string;
  company_name: string;
  catalog_name: string;
  file_name: string;
  table_name: string;
  schema_definition: { columns: ColumnDefinition[] } | null;
  category_hierarchy: string[] | null;
  total_products: number;
  processing_status: ProcessingStatus;
  processing_log: ProcessingLogEntry[];
  error_message: string | null;
  version: number;
  parent_catalog_id: string | null;
  is_latest_version: boolean;
  total_pages: number | null;
  created_at: string;
  updated_at: string;
}

export interface CatalogFingerprint {
  id: string;
  master_catalog_id: string;
  file_hash_sha256: string;
  file_size_bytes: number;
  content_hash: string | null;
  page_count: number | null;
  file_name_normalized: string;
  company_name_normalized: string;
  catalog_name_normalized: string;
  text_sample: string | null;
  created_at: string;
}

export interface PageData {
  page_number: number;
  image_base64?: string;
  image_url?: string;
  text: string;
}

export interface ParsedSearchFilters {
  keywords: string[];
  category: string | null;
  price_min: number | null;
  price_max: number | null;
  size: string | null;
  brand: string | null;
  tsquery: string;
}

export interface SearchResultItem {
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
  relevance: number;
  similarity?: number; // 0-1 cosine similarity (vector search only)
}

// ─── Validation helpers ──────────────────────────────────────────────────────

const VALID_COLUMN_TYPES = new Set(["TEXT", "NUMERIC", "INTEGER", "BOOLEAN", "TEXT[]"]);
const REQUIRED_COLUMNS = ["page_number", "category", "sub_category"];

/**
 * Validate and normalize a schema discovery response from Claude.
 * Throws a descriptive error if the schema is fundamentally invalid.
 */
export function validateSchema(raw: unknown): SchemaDiscovery {
  if (!raw || typeof raw !== "object") {
    throw new Error("Schema response is not an object");
  }

  const obj = raw as Record<string, unknown>;

  // Validate company_name
  if (!obj.company_name || typeof obj.company_name !== "string" || !obj.company_name.trim()) {
    throw new Error("Schema missing or empty company_name");
  }

  // Validate catalog_name
  if (!obj.catalog_name || typeof obj.catalog_name !== "string" || !obj.catalog_name.trim()) {
    throw new Error("Schema missing or empty catalog_name");
  }

  // Validate categories
  const categories = Array.isArray(obj.categories)
    ? obj.categories.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    : [];

  // Validate columns
  if (!Array.isArray(obj.columns) || obj.columns.length === 0) {
    throw new Error("Schema has no columns defined");
  }

  const seenNames = new Set<string>();
  const validatedColumns: ColumnDefinition[] = [];

  for (const col of obj.columns) {
    if (!col || typeof col !== "object") continue;
    const c = col as Record<string, unknown>;

    const name = typeof c.name === "string" ? c.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_") : "";
    if (!name) continue;

    // Skip duplicates
    if (seenNames.has(name)) continue;
    seenNames.add(name);

    // Validate and normalize type
    const rawType = typeof c.type === "string" ? c.type.toUpperCase().trim() : "TEXT";
    const type = VALID_COLUMN_TYPES.has(rawType) ? rawType : "TEXT";

    const description = typeof c.description === "string" ? c.description : "";

    validatedColumns.push({
      name,
      type: type as ColumnDefinition["type"],
      description,
    });
  }

  if (validatedColumns.length === 0) {
    throw new Error("Schema has no valid columns after validation");
  }

  // Auto-add required columns if missing
  for (const reqCol of REQUIRED_COLUMNS) {
    if (!seenNames.has(reqCol)) {
      const typeMap: Record<string, ColumnDefinition["type"]> = {
        page_number: "INTEGER",
        category: "TEXT",
        sub_category: "TEXT",
      };
      validatedColumns.push({
        name: reqCol,
        type: typeMap[reqCol] ?? "TEXT",
        description: `Auto-added required column: ${reqCol}`,
      });
    }
  }

  return {
    company_name: obj.company_name as string,
    catalog_name: obj.catalog_name as string,
    categories,
    columns: validatedColumns,
  };
}

// ─── SQL Safety helpers ──────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE_NAME_REGEX = /^[a-z_][a-z0-9_]{0,62}$/;

/** Validate that a string is a valid UUID v4 format */
export function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

/** Validate that a string is a safe PostgreSQL table name */
export function isValidTableName(value: string): boolean {
  return TABLE_NAME_REGEX.test(value);
}

/** Escape a value for safe use in ILIKE patterns (escape %, _, \) */
export function escapeILIKE(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Escape a string for safe use in SQL string literals (escape ', \, null bytes) */
export function escapeSQLString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/\0/g, "");
}
