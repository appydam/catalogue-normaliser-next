import { NextRequest, NextResponse } from "next/server";
import { getClaudeClient, CLAUDE_MODEL, repairTruncatedJsonArray, buildPageContentBlocks } from "@/lib/claude";
import { getSupabase } from "@/lib/supabase";
import { insertProducts } from "@/lib/data-inserter";
import { indexProductsBatch } from "@/lib/indexer";
import { uploadImageToS3 } from "@/lib/s3";
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
    };

    const startPage = body.pages[0].page_number;
    const endPage = body.pages.at(-1)!.page_number;

    await appendLog(
      catalogId,
      "extracting",
      `Processing chunk ${body.chunk_index + 1}/${body.total_chunks} (pages ${startPage}–${endPage})...`
    );

    const columnDesc = body.schema.columns
      .map((c) => `  - ${c.name} (${c.type}): ${c.description}`)
      .join("\n");

    const contextNote = body.category_context
      ? `\nPrevious category context: ${body.category_context}\nContinue with this context if the current pages don't specify a new category.\n`
      : "";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [
      {
        type: "text",
        text: `You are extracting product data from a catalog by ${body.schema.company_name}.

The table schema is:
${columnDesc}
${contextNote}
Extract ALL products from the following pages. Return a JSON array of objects, one per product.

IMPORTANT RULES:
- For multi-dimensional tables (e.g., price grids with sizes across columns), flatten each unique combination into its own row.
- If a page has no product data (intro text, photos), return an empty array [].
- Include the page_number for each product.
- For prices, extract only the numeric value (no currency symbols).
- If a field is not applicable, use null.
- Return ONLY a valid JSON array (no markdown fences, no explanation).
- Be thorough — extract EVERY product visible on each page.`,
      },
      ...buildPageContentBlocks(body.pages),
    ];

    const client = getClaudeClient();
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 64000,
      messages: [{ role: "user", content }],
    });

    const rawText = (response.content[0] as { type: string; text: string }).text;
    const products = repairTruncatedJsonArray(rawText) as Record<string, unknown>[];

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
          const s3Key = `catalogs/${catalogId}/pages/page-${page.page_number}.png`;
          const url = await uploadImageToS3(s3Key, page.image_base64, "image/png");
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

    // Insert products directly into the dynamic table (no JSONB accumulation)
    const inserted = await insertProducts(catalog.table_name, catalogId, products, columns);

    // Index products for search (without tsvector — that happens at finalize)
    await indexProductsBatch(catalogId, catalog.table_name, products);

    // Derive category context from last product for next chunk
    const lastProduct = products.at(-1) as Record<string, unknown> | undefined;
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
      category_context: newContext,
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
