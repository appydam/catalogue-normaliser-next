import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { createDynamicTable } from "@/lib/schema-manager";
import { insertProducts } from "@/lib/data-inserter";
import { indexProducts } from "@/lib/indexer";
import type { ColumnDefinition } from "@/lib/types";

export const maxDuration = 300;

async function appendLog(catalogId: string, status: string, message: string) {
  const sb = getSupabase();
  const { data } = await sb
    .from("catalogs")
    .select("processing_log")
    .eq("id", catalogId)
    .single();
  const log = (data?.processing_log as object[]) ?? [];
  log.push({ timestamp: new Date().toISOString(), status, message });
  await sb.from("catalogs").update({ processing_log: log, processing_status: status }).eq("id", catalogId);
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: catalogId } = await params;
  const sb = getSupabase();

  try {
    const { data: catalog, error } = await sb
      .from("catalogs")
      .select("table_name, schema_definition, extracted_products, company_name, catalog_name")
      .eq("id", catalogId)
      .single();

    if (error || !catalog) {
      return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
    }

    const columns = (catalog.schema_definition as { columns: ColumnDefinition[] }).columns;
    const products = (catalog.extracted_products as Record<string, unknown>[]) ?? [];
    const { table_name: tableName } = catalog;

    await appendLog(catalogId, "inserting", `Creating dynamic table '${tableName}'...`);
    await createDynamicTable(tableName, columns);

    await appendLog(catalogId, "inserting", `Inserting ${products.length} products...`);
    const inserted = await insertProducts(tableName, catalogId, products, columns);
    await appendLog(catalogId, "inserting", `Inserted ${inserted} products into '${tableName}'`);

    await appendLog(catalogId, "indexing", "Building full-text search index...");
    const indexed = await indexProducts(catalogId, tableName, products);
    await appendLog(catalogId, "indexing", `Indexed ${indexed} products for search`);

    // Mark complete and clear temp storage
    const { data: finalData } = await sb
      .from("catalogs")
      .select("processing_log")
      .eq("id", catalogId)
      .single();
    const finalLog = (finalData?.processing_log as object[]) ?? [];
    finalLog.push({
      timestamp: new Date().toISOString(),
      status: "completed",
      message: `Processing complete: ${inserted} products extracted and indexed`,
    });

    await sb
      .from("catalogs")
      .update({
        processing_status: "completed",
        total_products: inserted,
        extracted_products: null,
        processing_log: finalLog,
      })
      .eq("id", catalogId);

    return NextResponse.json({ inserted, indexed });
  } catch (err) {
    console.error("Finalize error:", err);
    await appendLog(catalogId, "failed", `Finalize failed: ${String(err).slice(0, 200)}`);
    await sb
      .from("catalogs")
      .update({ processing_status: "failed", error_message: String(err).slice(0, 500) })
      .eq("id", catalogId);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
