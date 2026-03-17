import { NextRequest, NextResponse } from "next/server";
import { getClaudeClient, CLAUDE_MODEL, repairTruncatedJsonArray, buildPageContentBlocks } from "@/lib/claude";
import { getSupabase } from "@/lib/supabase";
import { insertProducts } from "@/lib/data-inserter";
import { indexProductsBatch } from "@/lib/indexer";
import { uploadImageToS3 } from "@/lib/s3";
import { sanitizeColumnName } from "@/lib/schema-manager";
import { buildExtractionPrompt, getExtractionMaxTokens } from "@/lib/extraction-prompts";
import { filterLowConfidenceProducts, validateChunkExtraction } from "@/lib/extraction-validator";
import type { CatalogType, PageClassification } from "@/lib/catalog-classifier";
import type { ColumnDefinition } from "@/lib/types";

export const maxDuration = 300;

async function appendLog(catalogId: string, status: string, message: string) {
  const sb = getSupabase();
  const { data } = await sb
    .from("master_catalogs")
    .select("processing_log")
    .eq("id", catalogId)
    .single();

  const log = (data?.processing_log as object[]) ?? [];
  log.push({ timestamp: new Date().toISOString(), status, message });
  await sb.from("master_catalogs").update({ processing_log: log }).eq("id", catalogId);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: catalogId } = await params;
  const sb = getSupabase();

  try {
    const body = (await req.json()) as {
      pages: Array<{ page_number: number; image_url?: string; image_base64?: string; text: string }>;
      schema: { company_name: string; columns: ColumnDefinition[] };
      category_context?: string;
      chunk_index: number;
      total_chunks: number;
      catalog_type?: CatalogType;
      page_classifications?: PageClassification[];
    };

    const startPage = body.pages[0].page_number;
    const endPage = body.pages.at(-1)!.page_number;

    await appendLog(
      catalogId,
      "extracting",
      `Processing chunk ${body.chunk_index + 1}/${body.total_chunks} (pages ${startPage}–${endPage})...`
    );

    // Build type-specific extraction prompt
    const catalogType: CatalogType = body.catalog_type ?? "mixed";
    const extractionPrompt = buildExtractionPrompt({
      company_name: body.schema.company_name,
      columns: body.schema.columns,
      category_context: body.category_context ?? "",
      catalog_type: catalogType,
      page_classifications: body.page_classifications,
    });

    const pageBlocks = await buildPageContentBlocks(body.pages);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [
      { type: "text", text: extractionPrompt },
      ...pageBlocks,
    ];

    const maxTokens = getExtractionMaxTokens(catalogType, body.pages.length);

    const client = getClaudeClient();
    const stream = client.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content }],
    });
    const response = await stream.finalMessage();

    const rawText = (response.content[0] as { type: string; text: string }).text;
    const stopReason = response.stop_reason;
    console.log(`[Chunk ${body.chunk_index}] Claude response: ${rawText.length} chars, stop_reason: ${stopReason}`);
    if (stopReason === "max_tokens") {
      console.warn(`[Chunk ${body.chunk_index}] WARNING: Response was truncated (hit max_tokens). Some products may be lost.`);
    }
    console.log(`[Chunk ${body.chunk_index}] Raw text preview: ${rawText.slice(0, 300)}`);
    const products = repairTruncatedJsonArray(rawText) as Record<string, unknown>[];
    console.log(`[Chunk ${body.chunk_index}] Parsed ${products.length} products`);

    // Fetch table_name from catalog (table was created eagerly in POST /api/catalogs)
    const { data: catalog } = await sb
      .from("master_catalogs")
      .select("table_name, schema_definition")
      .eq("id", catalogId)
      .single();

    if (!catalog) {
      return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
    }

    const columns = (catalog.schema_definition as { columns: ColumnDefinition[] }).columns;

    // Build page→imageUrl map (pages may already have S3 URLs from client upload)
    const pageImageMap = new Map<number, string>();
    for (const page of body.pages) {
      if (page.image_url) {
        pageImageMap.set(page.page_number, page.image_url);
      } else if (page.image_base64) {
        // Fallback: upload base64 to S3 if URL not provided
        try {
          const s3Key = `catalogs/${catalogId}/pages/page-${page.page_number}.jpg`;
          const url = await uploadImageToS3(s3Key, page.image_base64, "image/jpeg");
          pageImageMap.set(page.page_number, url);
        } catch {
          // Non-critical
        }
      }
    }

    // Attach image_url to each product based on its page_number
    for (const product of products) {
      const pageNum = product.page_number as number | undefined;
      if (pageNum && pageImageMap.has(pageNum)) {
        product._image_url = pageImageMap.get(pageNum);
      }
    }

    // P0-5: Normalize product keys to match schema columns
    const schemaColNames = new Set(columns.map((c) => sanitizeColumnName(c.name)));
    const strippedToSchema = new Map<string, string>();
    for (const colName of schemaColNames) {
      strippedToSchema.set(colName.replace(/_/g, ""), colName);
    }

    let totalUnmatched = 0;
    for (const product of products) {
      const normalizedProduct: Record<string, unknown> = {};
      let unmatchedKeys = 0;

      for (const [rawKey, value] of Object.entries(product)) {
        if (rawKey === "_image_url") {
          normalizedProduct._image_url = value;
          continue;
        }
        const sanitized = sanitizeColumnName(rawKey);
        if (schemaColNames.has(sanitized)) {
          normalizedProduct[sanitized] = value;
        } else {
          const stripped = sanitized.replace(/_/g, "");
          const match = strippedToSchema.get(stripped);
          if (match) {
            normalizedProduct[match] = value;
          } else {
            unmatchedKeys++;
          }
        }
      }
      if (unmatchedKeys > 0) totalUnmatched += unmatchedKeys;
      for (const key of Object.keys(product)) delete product[key];
      Object.assign(product, normalizedProduct);
    }
    if (totalUnmatched > 0) {
      console.warn(`[Chunk ${body.chunk_index}] ${totalUnmatched} unmatched keys across ${products.length} products`);
    }

    // Confidence filtering — remove clearly invalid products
    const { filtered: validProducts, removed: removedCount } = filterLowConfidenceProducts(
      products, columns, 0.25
    );
    if (removedCount > 0) {
      console.log(`[Chunk ${body.chunk_index}] Filtered out ${removedCount} low-confidence products`);
    }

    // Validate extraction quality against page classifications
    const pageClassifications = body.page_classifications ?? [];
    const chunkPageClassifications = pageClassifications.filter(
      (pc) => pc.page_number >= startPage && pc.page_number <= endPage
    );
    const validation = validateChunkExtraction(validProducts, columns, chunkPageClassifications);
    if (validation.overall_quality === "poor") {
      console.warn(`[Chunk ${body.chunk_index}] Poor extraction quality: ${validation.products_found} found vs ${validation.products_expected} expected`);
    }

    // Use validProducts from here on
    const productsToInsert = validProducts;

    // P1-3: Deduplication guard — delete existing rows for this page range before insert (idempotent retries)
    await sb.rpc("exec_sql", {
      query: `DELETE FROM "${catalog.table_name}" WHERE catalog_id = '${catalogId}' AND page_number >= ${startPage} AND page_number <= ${endPage}`,
    });
    await sb.from("product_search_index")
      .delete()
      .eq("catalog_id", catalogId)
      .eq("source_table", catalog.table_name)
      .gte("raw_data->>page_number", String(startPage))
      .lte("raw_data->>page_number", String(endPage));

    // Insert products into the dynamic table
    const inserted = await insertProducts(catalog.table_name, catalogId, productsToInsert, columns);

    // Index products for search (without tsvector — that happens at finalize)
    await indexProductsBatch(catalogId, catalog.table_name, productsToInsert);

    // Derive category context from last product for next chunk
    const lastProduct = productsToInsert.at(-1) as Record<string, unknown> | undefined;
    const newContext = lastProduct
      ? [lastProduct.category, lastProduct.sub_category]
          .filter(Boolean)
          .join(" > ")
      : body.category_context ?? "";

    await appendLog(
      catalogId,
      "extracting",
      `Chunk ${body.chunk_index + 1}/${body.total_chunks} done: ${inserted} products inserted`
    );

    return NextResponse.json({
      chunk_index: body.chunk_index,
      products_found: products.length,
      products_inserted: inserted,
      products_filtered: removedCount,
      truncated: stopReason === "max_tokens",
      category_context: newContext,
      quality: validation.overall_quality,
      pages_needing_reextraction: validation.pages_needing_reextraction,
    });
  } catch (err) {
    console.error(`Chunk error:`, err);
    await appendLog(
      catalogId,
      "extracting",
      `Warning: Chunk failed (${String(err).slice(0, 120)}), continuing...`
    );
    return NextResponse.json({ chunk_index: -1, products_found: 0, category_context: "" });
  }
}
