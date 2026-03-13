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
  created_at: string;
  updated_at: string;
}

export interface PageData {
  page_number: number;
  image_base64: string;
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
}
