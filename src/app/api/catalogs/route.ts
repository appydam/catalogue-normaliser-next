import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { sanitizeTableName, createDynamicTable } from "@/lib/schema-manager";
import { normalizeCompanyName, normalizeCatalogName, normalizeFileName } from "@/lib/fingerprint";
import type { SchemaDiscovery } from "@/lib/types";

// GET /api/catalogs — list all catalogs
export async function GET() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("master_catalogs")
    .select(
      "id, company_name, catalog_name, file_name, total_products, processing_status, processing_log, error_message, created_at, version, is_latest_version"
    )
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/catalogs — create catalog record + dynamic table eagerly
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    file_name: string;
    schema: SchemaDiscovery;
    total_pages: number;
    fingerprint?: {
      file_hash: string;
      file_size: number;
      content_hash?: string;
      text_sample?: string;
    };
    parent_catalog_id?: string;
    version?: number;
  };

  const sb = getSupabase();
  const tableName = sanitizeTableName(
    body.schema.company_name,
    body.schema.catalog_name
  );

  // If this is a new version, mark old catalog as not latest
  if (body.parent_catalog_id) {
    await sb
      .from("master_catalogs")
      .update({ is_latest_version: false })
      .eq("id", body.parent_catalog_id);
  }

  // Insert catalog record
  const { data, error } = await sb
    .from("master_catalogs")
    .insert({
      company_name: body.schema.company_name,
      catalog_name: body.schema.catalog_name,
      file_name: body.file_name,
      table_name: tableName,
      schema_definition: { columns: body.schema.columns },
      category_hierarchy: body.schema.categories,
      total_pages: body.total_pages,
      processing_status: "extracting",
      version: body.version ?? 1,
      parent_catalog_id: body.parent_catalog_id ?? null,
      is_latest_version: true,
      processing_log: [
        {
          timestamp: new Date().toISOString(),
          status: "extracting",
          message: `Schema discovered: ${body.schema.columns.length} columns, ${body.schema.categories.length} categories. Starting extraction of ${body.total_pages} pages...`,
        },
      ],
    })
    .select("id, table_name")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Create the dynamic table eagerly so extract-chunk can insert directly
  try {
    await createDynamicTable(tableName, body.schema.columns);
  } catch (tableErr) {
    // Clean up: delete the catalog row if table creation failed
    await sb.from("master_catalogs").delete().eq("id", data.id);
    return NextResponse.json(
      { error: `Table creation failed: ${String(tableErr)}` },
      { status: 500 }
    );
  }

  // Store fingerprint data if provided
  if (body.fingerprint?.file_hash) {
    try {
      await sb.from("catalog_fingerprints").upsert(
        {
          master_catalog_id: data.id,
          file_hash_sha256: body.fingerprint.file_hash,
          file_size_bytes: body.fingerprint.file_size,
          content_hash: body.fingerprint.content_hash ?? null,
          page_count: body.total_pages,
          file_name_normalized: normalizeFileName(body.file_name),
          company_name_normalized: normalizeCompanyName(body.schema.company_name),
          catalog_name_normalized: normalizeCatalogName(body.schema.catalog_name),
          text_sample: body.fingerprint.text_sample?.slice(0, 2000) ?? null,
        },
        { onConflict: "file_hash_sha256" }
      );
    } catch {
      // Non-critical — fingerprint storage failure shouldn't block catalog creation
      console.error("Failed to store fingerprint, continuing...");
    }
  }

  return NextResponse.json({ catalog_id: data.id, table_name: tableName });
}
