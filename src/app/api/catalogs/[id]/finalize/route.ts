import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { buildSearchIndex } from "@/lib/indexer";

export const maxDuration = 60;

async function appendLog(catalogId: string, status: string, message: string) {
  const sb = getSupabase();
  const { data } = await sb
    .from("master_catalogs")
    .select("processing_log")
    .eq("id", catalogId)
    .single();
  const log = (data?.processing_log as object[]) ?? [];
  log.push({ timestamp: new Date().toISOString(), status, message });
  await sb.from("master_catalogs").update({ processing_log: log, processing_status: status }).eq("id", catalogId);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: catalogId } = await params;
  const sb = getSupabase();

  // Accept optional content fingerprint + chunk failure data + extraction metrics from client
  let bodyData: {
    content_hash?: string;
    text_sample?: string;
    failed_chunks?: number;
    total_chunks?: number;
    truncated_chunks?: number;
    reextracted_pages?: number;
    filtered_products?: number;
    catalog_type?: string;
    pages_skipped?: number;
    pages_processed?: number;
  } = {};
  try {
    bodyData = await req.json();
  } catch {
    // Body is optional
  }

  try {
    const { data: catalog, error } = await sb
      .from("master_catalogs")
      .select("table_name")
      .eq("id", catalogId)
      .single();

    if (error || !catalog) {
      return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
    }

    // P1-5: Count products using query_sql (bypasses PostgREST schema cache for dynamic tables)
    let totalProducts = 0;
    const { data: countData } = await sb.rpc("query_sql", {
      query: `SELECT COUNT(*)::int as total FROM "${catalog.table_name}" WHERE catalog_id = '${catalogId}'`,
    });
    if (Array.isArray(countData) && countData.length > 0) {
      totalProducts = countData[0].total ?? 0;
    }

    // Build tsvector search index for all un-indexed rows
    await appendLog(catalogId, "indexing", `Building full-text search index for ${totalProducts} products...`);
    await buildSearchIndex(catalogId);

    // P0-6: Determine completion status based on chunk failures
    const failedChunks = bodyData.failed_chunks ?? 0;
    const truncatedChunks = bodyData.truncated_chunks ?? 0;
    const hasWarnings = failedChunks > 0 || truncatedChunks > 0;
    const finalStatus = hasWarnings ? "completed_with_warnings" : "completed";

    let statusMessage = `Processing complete: ${totalProducts} products extracted and indexed`;
    if (hasWarnings) {
      const warnings: string[] = [];
      if (failedChunks > 0) warnings.push(`${failedChunks} chunks failed`);
      if (truncatedChunks > 0) warnings.push(`${truncatedChunks} chunks truncated`);
      statusMessage += ` (warnings: ${warnings.join(", ")})`;
    }

    // Mark complete
    const { data: finalData } = await sb
      .from("master_catalogs")
      .select("processing_log")
      .eq("id", catalogId)
      .single();
    const finalLog = (finalData?.processing_log as object[]) ?? [];
    finalLog.push({
      timestamp: new Date().toISOString(),
      status: finalStatus,
      message: statusMessage,
    });

    const errorMessage = hasWarnings
      ? `Completed with warnings: ${failedChunks} failed chunks, ${truncatedChunks} truncated chunks out of ${bodyData.total_chunks ?? "unknown"} total`
      : null;

    await sb
      .from("master_catalogs")
      .update({
        processing_status: finalStatus,
        total_products: totalProducts,
        extracted_products: null,
        processing_log: finalLog,
        error_message: errorMessage,
      })
      .eq("id", catalogId);

    // Update content fingerprint if provided
    if (bodyData.content_hash) {
      try {
        await sb
          .from("catalog_fingerprints")
          .update({
            content_hash: bodyData.content_hash,
            text_sample: bodyData.text_sample?.slice(0, 2000) ?? null,
          })
          .eq("master_catalog_id", catalogId);
      } catch {
        // Non-critical
      }
    }

    // Trigger product image embedding job in the background (non-blocking)
    // This crops individual product images and generates Titan visual embeddings
    const embedUrl = new URL(`/api/catalogs/${catalogId}/embed-products`, req.url);
    fetch(embedUrl.toString(), { method: "POST" }).catch((err) => {
      console.warn("[finalize] Failed to trigger embed-products job:", err);
    });

    // Build extraction report
    const extractionReport = {
      total_products: totalProducts,
      total_chunks: bodyData.total_chunks ?? 0,
      failed_chunks: failedChunks,
      truncated_chunks: truncatedChunks,
      reextracted_pages: bodyData.reextracted_pages ?? 0,
      filtered_products: bodyData.filtered_products ?? 0,
      catalog_type: bodyData.catalog_type ?? "unknown",
      pages_skipped: bodyData.pages_skipped ?? 0,
      pages_processed: bodyData.pages_processed ?? 0,
    };

    return NextResponse.json({
      inserted: totalProducts,
      indexed: totalProducts,
      status: finalStatus,
      warnings: hasWarnings ? { failed_chunks: failedChunks, truncated_chunks: truncatedChunks } : null,
      extraction_report: extractionReport,
    });
  } catch (err) {
    console.error("Finalize error:", err);
    await appendLog(catalogId, "failed", `Finalize failed: ${String(err).slice(0, 200)}`);
    await sb
      .from("master_catalogs")
      .update({ processing_status: "failed", error_message: String(err).slice(0, 500) })
      .eq("id", catalogId);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
