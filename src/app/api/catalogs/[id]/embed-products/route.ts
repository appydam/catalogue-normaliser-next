import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getClaudeClient, CLAUDE_MODEL, stripMarkdownFences } from "@/lib/claude";
import { generateImageEmbedding, embeddingToSql } from "@/lib/bedrock-embeddings";
import { fetchPageFromS3, s3UrlToKey, cropProduct, bufferToBase64, BoundingBox } from "@/lib/image-cropper";
import { uploadImageToS3 } from "@/lib/s3";
import { isValidUUID } from "@/lib/types";

export const maxDuration = 300;

interface ProductRow {
  id: string;
  product_name: string | null;
  raw_data: Record<string, unknown>;
  image_url: string | null;
  crop_bbox: BoundingBox | null;
  image_embedding: number[] | null;
}

interface BboxResult {
  id: string;
  bbox: BoundingBox;
}

/**
 * Ask Claude Vision to return bounding boxes for each product on a catalog page.
 * Returns only products it can confidently locate.
 */
async function getBoundingBoxes(
  pageBase64: string,
  products: ProductRow[]
): Promise<BboxResult[]> {
  const client = getClaudeClient();
  const productList = products
    .map((p) => {
      const catNo =
        p.raw_data?.cat_no ??
        p.raw_data?.product_code ??
        p.raw_data?.cat_number ??
        p.raw_data?.item_code ??
        null;
      return `{"id":"${p.id}","name":${JSON.stringify(p.product_name ?? "")},"cat_no":${JSON.stringify(catNo ?? "")}}`;
    })
    .join(",\n");

  const prompt = `You are analyzing a product catalog page image.

Below is a list of products that were extracted from this page. For each product, identify the bounding box of its PRIMARY PRODUCT IMAGE (not the text label, not the whole product card — just the product photo/illustration itself).

Products to locate:
[${productList}]

Rules:
- Return coordinates as fractions of the full image (0.0 to 1.0), where (0,0) is top-left
- x = left edge of the product image, y = top edge
- w = width of the product image, h = height of the product image
- Only include products you can confidently locate (skip if uncertain)
- If a product appears multiple times, use the main/largest instance
- Exclude text labels, prices, QR codes from the bounding box

Return ONLY valid JSON array (no markdown):
[{"id":"<product_id>","bbox":{"x":0.05,"y":0.10,"w":0.20,"h":0.30}},...]`;

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: pageBase64 },
          },
          { type: "text", text: prompt },
        ] as any[],
      },
    ],
  });

  const text = (response.content[0] as { type: string; text: string }).text;
  const cleaned = stripMarkdownFences(text);
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (r): r is BboxResult =>
      r.id &&
      r.bbox &&
      typeof r.bbox.x === "number" &&
      typeof r.bbox.y === "number" &&
      typeof r.bbox.w === "number" &&
      typeof r.bbox.h === "number"
  );
}

/**
 * Build a text annotation for Titan multimodal embedding.
 * Combines product name, cat_no, and category for better discrimination.
 */
function buildTextAnnotation(product: ProductRow): string {
  const parts: string[] = [];
  if (product.product_name) parts.push(product.product_name);
  const raw = product.raw_data;
  const catNo = raw?.cat_no ?? raw?.product_code ?? raw?.cat_number ?? raw?.item_code;
  if (catNo) parts.push(`Cat No ${catNo}`);
  const category = raw?.category ?? raw?.sub_category;
  if (category) parts.push(String(category));
  const desc = raw?.product_description ?? raw?.description;
  if (desc) parts.push(String(desc).slice(0, 100));
  return parts.join(" | ");
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: catalogId } = await params;

  if (!isValidUUID(catalogId)) {
    return NextResponse.json({ error: "Invalid catalog ID" }, { status: 400 });
  }

  let body: { page_numbers?: number[]; force?: boolean } = {};
  try { body = await req.json(); } catch { /* optional */ }

  const sb = getSupabase();

  // Fetch all products for this catalog that need embedding
  let query = sb
    .from("product_search_index")
    .select("id, product_name, raw_data, image_url, crop_bbox, image_embedding")
    .eq("catalog_id", catalogId);

  if (!body.force) {
    query = query.is("image_embedding", null);
  }

  const { data: allProducts, error } = await query.returns<ProductRow[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!allProducts || allProducts.length === 0) {
    return NextResponse.json({ message: "No products to embed", embedded: 0 });
  }

  // Group products by page number
  const byPage = new Map<number, ProductRow[]>();
  for (const p of allProducts) {
    const pageNum = Number(p.raw_data?.page_number ?? 0);
    if (!byPage.has(pageNum)) byPage.set(pageNum, []);
    byPage.get(pageNum)!.push(p);
  }

  let totalEmbedded = 0;
  let totalCropped = 0;
  let totalFailed = 0;
  const pageNumbers = [...byPage.keys()].sort((a, b) => a - b);

  for (const pageNum of pageNumbers) {
    const products = byPage.get(pageNum)!;

    // Find the page image URL from any product on this page
    const pageImageUrl = products.find((p) => p.image_url)?.image_url;

    let pageBuffer: Buffer | null = null;
    let pageBase64: string | null = null;

    if (pageImageUrl) {
      try {
        const s3Key = s3UrlToKey(pageImageUrl);
        // Only fetch the original page image (not a crop URL)
        if (s3Key.includes("/pages/")) {
          pageBuffer = await fetchPageFromS3(s3Key);
          pageBase64 = pageBuffer.toString("base64");
        }
      } catch (err) {
        console.warn(`[embed] Failed to fetch page ${pageNum} image:`, err);
      }
    }

    // Step 1: Get bounding boxes from Claude Vision (only if we have page image)
    const bboxMap = new Map<string, BoundingBox>();

    if (pageBase64 && products.length > 0) {
      try {
        const bboxResults = await getBoundingBoxes(pageBase64, products);
        for (const r of bboxResults) {
          bboxMap.set(r.id, r.bbox);
        }
      } catch (err) {
        console.warn(`[embed] BBox extraction failed for page ${pageNum}:`, err);
      }
    }

    // Step 2: For each product — crop, upload, embed
    for (const product of products) {
      try {
        let cropBase64: string | null = null;
        let cropUrl: string | null = null;
        let bbox: BoundingBox | null = product.crop_bbox;

        // Crop if we have bounding box + page buffer
        const newBbox = bboxMap.get(product.id);
        if (newBbox && pageBuffer) {
          try {
            const cropBuffer = await cropProduct(pageBuffer, newBbox);
            cropBase64 = bufferToBase64(cropBuffer);
            bbox = newBbox;

            // Upload crop to S3
            const s3Key = `catalogs/${catalogId}/crops/${product.id}.jpg`;
            cropUrl = await uploadImageToS3(s3Key, cropBase64, "image/jpeg");
            totalCropped++;
          } catch (cropErr) {
            console.warn(`[embed] Crop failed for product ${product.id}:`, cropErr);
          }
        }

        // Use crop base64 for embedding if available, else fall back to full page
        const embeddingSource = cropBase64 ?? pageBase64;
        if (!embeddingSource) {
          totalFailed++;
          continue;
        }

        const textAnnotation = buildTextAnnotation(product);
        const embedding = await generateImageEmbedding(embeddingSource, textAnnotation);

        // Update product_search_index
        const updateData: Record<string, unknown> = {
          image_embedding: embeddingToSql(embedding),
          embedding_generated_at: new Date().toISOString(),
        };
        if (cropUrl) updateData.image_url = cropUrl;
        if (bbox) updateData.crop_bbox = bbox;

        await sb
          .from("product_search_index")
          .update(updateData)
          .eq("id", product.id);

        totalEmbedded++;
      } catch (err) {
        console.warn(`[embed] Failed for product ${product.id}:`, err);
        totalFailed++;
      }
    }

    // Small delay between pages to avoid Bedrock rate limits
    await new Promise((r) => setTimeout(r, 200));
  }

  // Update catalog to mark embedding as done
  await sb
    .from("master_catalogs")
    .update({ embedding_status: "completed" } as never)
    .eq("id", catalogId);

  return NextResponse.json({
    embedded: totalEmbedded,
    cropped: totalCropped,
    failed: totalFailed,
    pages_processed: pageNumbers.length,
  });
}

/**
 * GET: Return embedding progress stats for a catalog.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: catalogId } = await params;

  if (!isValidUUID(catalogId)) {
    return NextResponse.json({ error: "Invalid catalog ID" }, { status: 400 });
  }

  const sb = getSupabase();
  const { data } = await sb.rpc("get_embedding_stats", { p_catalog_id: catalogId });

  const stats = Array.isArray(data) && data.length > 0 ? data[0] : { total: 0, embedded: 0, pending: 0 };

  return NextResponse.json({
    catalog_id: catalogId,
    ...stats,
    ready: stats.embedded > 0,
    progress_pct: stats.total > 0 ? Math.round((stats.embedded / stats.total) * 100) : 0,
  });
}
