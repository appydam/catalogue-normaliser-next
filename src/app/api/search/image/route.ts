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
            text: `You are a product search assistant. Look at this product image and generate a search query that would find this product or similar products in a building materials / sanitary ware / plumbing products database.

Return ONLY valid JSON (no markdown, no explanation):
{
  "description": "brief product description for display",
  "search_query": "optimized search keywords for PostgreSQL full-text search",
  "category": "product category or null",
  "tsquery": "PostgreSQL tsquery string using & for AND. Example: 'wash & basin & white'"
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
    JOIN catalogs c ON c.id = psi.catalog_id
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
