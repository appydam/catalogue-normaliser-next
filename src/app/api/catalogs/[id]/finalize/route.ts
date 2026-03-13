import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { buildSearchIndex } from "@/lib/indexer";

export const maxDuration = 60; // Much faster now — just tsvector + status update

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
      .select("table_name")
      .eq("id", catalogId)
      .single();

    if (error || !catalog) {
      return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
    }

    // Count products already inserted by extract-chunk calls
    const { count } = await sb
      .from(catalog.table_name)
      .select("*", { count: "exact", head: true })
      .eq("catalog_id", catalogId);

    const totalProducts = count ?? 0;

    // Build tsvector search index for all un-indexed rows
    await appendLog(catalogId, "indexing", `Building full-text search index for ${totalProducts} products...`);
    await buildSearchIndex(catalogId);

    // Mark complete
    const { data: finalData } = await sb
      .from("catalogs")
      .select("processing_log")
      .eq("id", catalogId)
      .single();
    const finalLog = (finalData?.processing_log as object[]) ?? [];
    finalLog.push({
      timestamp: new Date().toISOString(),
      status: "completed",
      message: `Processing complete: ${totalProducts} products extracted and indexed`,
    });

    await sb
      .from("catalogs")
      .update({
        processing_status: "completed",
        total_products: totalProducts,
        extracted_products: null,
        processing_log: finalLog,
      })
      .eq("id", catalogId);

    return NextResponse.json({ inserted: totalProducts, indexed: totalProducts });
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
