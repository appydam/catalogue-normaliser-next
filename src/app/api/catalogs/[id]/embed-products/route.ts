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

Below is a list of products that were extracted from this page. For each product, return the bounding box of the ENTIRE PRODUCT CARD/SECTION — including the product photo AND its name/label below it.

Products to locate:
[${productList}]

Rules:
- Return coordinates as fractions of the full image (0.0 to 1.0), where (0,0) is top-left
- x = left edge, y = top edge, w = width, h = height
- Include the product image AND its name/label/price text directly below or beside it
- Each bbox should be at least 0.12 wide and 0.15 tall — if your box is smaller, expand it
- Only include products you can confidently locate (skip if uncertain)
- If a product appears multiple times, use the main/largest instance
- DO NOT return tiny boxes (< 0.10 width) — those are likely just icons, not the full product

Return ONLY valid JSON array (no markdown):
[{"id":"<product_id>","bbox":{"x":0.05,"y":0.10,"w":0.22,"h":0.28}},...]`;

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
  return parsed
    .filter(
      (r): r is BboxResult =>
        r.id &&
        r.bbox &&
        typeof r.bbox.x === "number" &&
        typeof r.bbox.y === "number" &&
        typeof r.bbox.w === "number" &&
        typeof r.bbox.h === "number"
    )
    .map((r) => {
      // Enforce minimum bbox size — expand tiny boxes to at least 15% × 18%
      const MIN_W = 0.15;
      const MIN_H = 0.18;
      const bbox = { ...r.bbox };

      if (bbox.w < MIN_W) {
        const needed = MIN_W;
        // Shift x left enough to fit the minimum width
        bbox.x = Math.max(0, Math.min(bbox.x, 1 - needed));
        bbox.w = needed;
      }
      if (bbox.h < MIN_H) {
        const needed = MIN_H;
        bbox.y = Math.max(0, Math.min(bbox.y, 1 - needed));
        bbox.h = needed;
      }
      // Final clamp
      if (bbox.x + bbox.w > 1) { bbox.x = Math.max(0, 1 - bbox.w); }
      if (bbox.y + bbox.h > 1) { bbox.y = Math.max(0, 1 - bbox.h); }
      return { ...r, bbox };
    });
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

  // Fetch all products for this catalog
  // Don't select image_embedding (may not exist if pgvector not enabled yet)
  let query = sb
    .from("product_search_index")
    .select("id, product_name, raw_data, image_url, crop_bbox")
    .eq("catalog_id", catalogId);

  // If not force, only fetch products that haven't been cropped yet
  if (!body.force) {
    query = query.is("crop_bbox", null);
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

    // Find the original page image URL (prefer /pages/ URL, not /crops/)
    const pageImageUrl = products.find((p) => p.image_url?.includes("/pages/"))?.image_url;

    let pageBuffer: Buffer | null = null;
    let pageBase64: string | null = null;

    // Try to fetch from /pages/ URL directly
    if (pageImageUrl) {
      try {
        const s3Key = s3UrlToKey(pageImageUrl);
        pageBuffer = await fetchPageFromS3(s3Key);
        pageBase64 = pageBuffer.toString("base64");
      } catch (err) {
        console.warn(`[embed] Failed to fetch page ${pageNum} image:`, err);
      }
    }

    // If no /pages/ URL found (all products already have crop URLs), construct the page key
    if (!pageBuffer && catalogId && pageNum > 0) {
      const extensions = ["jpg", "png"];
      for (const ext of extensions) {
        try {
          const s3Key = `catalogs/${catalogId}/pages/page-${pageNum}.${ext}`;
          pageBuffer = await fetchPageFromS3(s3Key);
          pageBase64 = pageBuffer.toString("base64");
          break;
        } catch {
          // Try next extension
        }
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

        // Update crop in DB immediately (even if embedding fails later)
        if (cropUrl || bbox) {
          const cropUpdate: Record<string, unknown> = {};
          if (cropUrl) cropUpdate.image_url = cropUrl;
          if (bbox) cropUpdate.crop_bbox = bbox;
          await sb
            .from("product_search_index")
            .update(cropUpdate)
            .eq("id", product.id);
        }

        // Try embedding (may fail if pgvector not enabled — that's OK)
        const embeddingSource = cropBase64 ?? pageBase64;
        if (embeddingSource) {
          try {
            const textAnnotation = buildTextAnnotation(product);
            const embedding = await generateImageEmbedding(embeddingSource, textAnnotation);

            await sb
              .from("product_search_index")
              .update({
                image_embedding: embeddingToSql(embedding),
                embedding_generated_at: new Date().toISOString(),
              } as never)
              .eq("id", product.id);

            totalEmbedded++;
          } catch (embedErr) {
            // pgvector not enabled or Titan API error — crop still saved
            console.warn(`[embed] Embedding failed for ${product.id} (crop saved):`, embedErr);
          }
        }
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

  // Count total vs cropped products (doesn't require pgvector)
  const { data: totalData } = await sb
    .from("product_search_index")
    .select("id", { count: "exact", head: true })
    .eq("catalog_id", catalogId);

  const { data: croppedData } = await sb
    .from("product_search_index")
    .select("id", { count: "exact", head: true })
    .eq("catalog_id", catalogId)
    .not("crop_bbox", "is", null);

  const total = (totalData as unknown as { count: number })?.count ?? 0;
  const cropped = (croppedData as unknown as { count: number })?.count ?? 0;

  return NextResponse.json({
    catalog_id: catalogId,
    total,
    cropped,
    pending: total - cropped,
    ready: cropped > 0,
    progress_pct: total > 0 ? Math.round((cropped / total) * 100) : 0,
  });
}
