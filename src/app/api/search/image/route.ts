import { NextRequest, NextResponse } from "next/server";
import { getClaudeClient, CLAUDE_MODEL, stripMarkdownFences } from "@/lib/claude";
import { getSupabase } from "@/lib/supabase";
import { uploadImageToS3 } from "@/lib/s3";
import { v4 as uuidv4 } from "uuid";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("image") as File | null;

  if (!file) {
    return NextResponse.json({ error: "Image file is required" }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  // Determine media type
  const mimeType = file.type || "image/jpeg";
  const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!validTypes.includes(mimeType)) {
    return NextResponse.json({ error: "Unsupported image type. Use JPEG, PNG, WebP, or GIF." }, { status: 400 });
  }

  // Upload query image to S3 for reference
  const ext = mimeType.split("/")[1];
  const s3Key = `search-queries/${uuidv4()}.${ext}`;
  const imageUrl = await uploadImageToS3(s3Key, base64, mimeType);

  // Step 1: Claude Vision describes the product in the image
  const client = getClaudeClient();
  const describeResponse = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mimeType, data: base64 },
          },
          {
            type: "text",
            text: `You are a product search assistant for a building materials / sanitary ware / plumbing products database.

Look at this image carefully. It could be:
- A single product photo (e.g. a washbasin, toilet, pipe fitting)
- A catalog page showing multiple products with names, specs, and prices
- A photo taken of a physical product or a catalog page

Your job: identify the PRIMARY product type(s) shown and generate search keywords that would find these products (or similar ones) in our database.

If it's a catalog page with multiple products, focus on the MAIN product category/type shown (e.g. "wall hung EWC" or "table top wash basin"), not every individual variant.

If you can read specific details (color, size, material, brand, model number), include them.

Return ONLY valid JSON (no markdown, no explanation):
{
  "description": "brief description of what you see — for display to the user",
  "search_query": "optimized keywords for full-text search. Be specific but not too narrow.",
  "category": "product category (e.g. 'wash basin', 'EWC', 'pipe fitting') or null",
  "tsquery": "PostgreSQL tsquery using & for AND, | for OR. Use OR between variants. Example: 'wall & hung & EWC | wash & basin & rimless'"
}`,
          },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any[],
      },
    ],
  });

  const rawText = (describeResponse.content[0] as { type: string; text: string }).text;
  const parsed = JSON.parse(stripMarkdownFences(rawText));

  // Step 2: Search using the generated query
  const tsquery = (parsed.tsquery ?? "").replace(/[';\\]/g, "");
  const conditions: string[] = [];

  if (tsquery) {
    conditions.push(`psi.search_text @@ to_tsquery(''english'', ''${tsquery}'')`);
  }
  if (parsed.category) {
    const cat = parsed.category.replace(/[';\\]/g, "");
    conditions.push(`(psi.category ILIKE ''%${cat}%'' OR psi.sub_category ILIKE ''%${cat}%'')`);
  }

  const whereClause = conditions.length > 0 ? conditions.join(" AND ") : "TRUE";
  const rankExpr = tsquery
    ? `ts_rank(psi.search_text, to_tsquery(''english'', ''${tsquery}''))`
    : "1";

  const sql = `
    SELECT
      psi.id,
      psi.catalog_id,
      psi.product_name,
      psi.category,
      psi.sub_category,
      psi.description,
      psi.price,
      psi.price_unit,
      psi.image_url,
      psi.raw_data,
      c.company_name,
      c.catalog_name,
      ${rankExpr} as relevance
    FROM product_search_index psi
    JOIN master_catalogs c ON c.id = psi.catalog_id
    WHERE ${whereClause}
    ORDER BY relevance DESC
    LIMIT 20
  `;

  const countSql = `
    SELECT COUNT(*)::int as total
    FROM product_search_index psi
    WHERE ${whereClause}
  `;

  const sb = getSupabase();
  const [resultData, countData] = await Promise.all([
    sb.rpc("query_sql", { query: sql }),
    sb.rpc("query_sql", { query: countSql }),
  ]);

  const results = Array.isArray(resultData.data) ? resultData.data : [];
  const total = Array.isArray(countData.data) && countData.data.length > 0 ? countData.data[0].total : 0;

  return NextResponse.json({
    query: parsed.search_query,
    query_image_url: imageUrl,
    ai_description: parsed.description,
    parsed_filters: {
      keywords: parsed.search_query?.split(" ") ?? [],
      category: parsed.category,
      tsquery: parsed.tsquery,
    },
    total_results: total,
    results,
  });
}
