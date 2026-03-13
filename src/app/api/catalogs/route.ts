import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { sanitizeTableName, createDynamicTable } from "@/lib/schema-manager";
import type { SchemaDiscovery } from "@/lib/types";

// GET /api/catalogs — list all catalogs
export async function GET() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("catalogs")
    .select(
      "id, company_name, catalog_name, file_name, total_products, processing_status, processing_log, error_message, created_at"
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
  };

  const sb = getSupabase();
  const tableName = sanitizeTableName(
    body.schema.company_name,
    body.schema.catalog_name
  );

  // Insert catalog record
  const { data, error } = await sb
    .from("catalogs")
    .insert({
      company_name: body.schema.company_name,
      catalog_name: body.schema.catalog_name,
      file_name: body.file_name,
      table_name: tableName,
      schema_definition: { columns: body.schema.columns },
      category_hierarchy: body.schema.categories,
      processing_status: "extracting",
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
    await sb.from("catalogs").delete().eq("id", data.id);
    return NextResponse.json(
      { error: `Table creation failed: ${String(tableErr)}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ catalog_id: data.id, table_name: tableName });
}
