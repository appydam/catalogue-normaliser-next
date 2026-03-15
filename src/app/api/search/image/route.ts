import { NextRequest, NextResponse } from "next/server";
import { getClaudeClient, CLAUDE_MODEL, stripMarkdownFences } from "@/lib/claude";
import { getSupabase } from "@/lib/supabase";
import { uploadImageToS3 } from "@/lib/s3";
import { escapeSQLString, escapeILIKE } from "@/lib/types";
import { normalizeQuery, getExpandedKeywords } from "@/lib/search-enhancer";
import { v4 as uuidv4 } from "uuid";

export const maxDuration = 60;

// Common stop words
const STOP_WORDS = new Set(["a","an","the","and","or","but","in","on","at","to","for","of","with","by","from","is","it","as","be","was","are","has","had","not","no","its","this","that","rs","per"]);

function filterKeywords(keywords: string[]): string[] {
  return keywords.filter((kw) => kw.length >= 2 && !STOP_WORDS.has(kw.toLowerCase()));
}

function kwMatchExpr(kw: string): string {
  const escaped = escapeILIKE(escapeSQLString(kw));
  return `(psi.description ILIKE '%${escaped}%' OR psi.product_name ILIKE '%${escaped}%' OR psi.category ILIKE '%${escaped}%' OR psi.sub_category ILIKE '%${escaped}%')`;
}

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
  const describeStream = client.messages.stream({
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
  const describeResponse = await describeStream.finalMessage();

  const rawText = (describeResponse.content[0] as { type: string; text: string }).text;
  const parsed = JSON.parse(stripMarkdownFences(rawText));

  // Step 2: Enhanced search using normalized + expanded query
  const searchQuery = parsed.search_query ?? "";
  const normalized = normalizeQuery(searchQuery);
  const expandedKeywords = getExpandedKeywords(normalized);

  const originalKeywords = filterKeywords(searchQuery.split(/\s+/).filter(Boolean));
  const allKeywords = filterKeywords([...new Set([...originalKeywords, ...expandedKeywords])]);

  const tsquery = escapeSQLString(parsed.tsquery ?? "");
  const cat = parsed.category ? escapeSQLString(parsed.category) : null;

  // Build ILIKE conditions
  const keywordCountCases = allKeywords.map((kw: string) => `CASE WHEN ${kwMatchExpr(kw)} THEN 1 ELSE 0 END`);
  const keywordCountExpr = keywordCountCases.length > 0 ? `(${keywordCountCases.join(" + ")})` : "0";
  const minMatches = allKeywords.length <= 2 ? 1 : Math.ceil(allKeywords.length / 2);
  const ilikeCondition = allKeywords.length > 0 ? `(${keywordCountExpr} >= ${minMatches})` : "FALSE";

  // Category filter
  const catFilter = cat ? `AND (psi.category ILIKE '%${escapeILIKE(cat)}%' OR psi.sub_category ILIKE '%${escapeILIKE(cat)}%')` : "";

  const tsCondition = tsquery ? `psi.search_text @@ to_tsquery('english', '${tsquery}')` : "FALSE";
  const tsRank = tsquery ? `ts_rank(psi.search_text, to_tsquery('english', '${tsquery}'))` : "0";

  // Also try websearch with the enhanced query for broader matching
  const sanitizedEnhanced = escapeSQLString(normalized.normalized);
  const wsCondition = `psi.search_text @@ websearch_to_tsquery('english', '${sanitizedEnhanced}')`;

  const sql = `
    WITH ts_results AS (
      SELECT
        psi.id, psi.catalog_id, psi.product_name, psi.category, psi.sub_category,
        psi.description, psi.price, psi.price_unit, psi.image_url, psi.raw_data,
        c.company_name, c.catalog_name,
        (100.0 + ${tsRank} * 100) as relevance
      FROM product_search_index psi
      JOIN master_catalogs c ON c.id = psi.catalog_id
      WHERE (${tsCondition} OR ${wsCondition}) ${catFilter}
      LIMIT 30
    ),
    ilike_results AS (
      SELECT
        psi.id, psi.catalog_id, psi.product_name, psi.category, psi.sub_category,
        psi.description, psi.price, psi.price_unit, psi.image_url, psi.raw_data,
        c.company_name, c.catalog_name,
        (${keywordCountExpr}::float / ${Math.max(allKeywords.length, 1)}.0 * 90) as relevance
      FROM product_search_index psi
      JOIN master_catalogs c ON c.id = psi.catalog_id
      WHERE ${ilikeCondition} ${catFilter}
        AND psi.id NOT IN (SELECT id FROM ts_results)
      LIMIT 30
    )
    SELECT * FROM (
      SELECT * FROM ts_results
      UNION ALL
      SELECT * FROM ilike_results
    ) combined
    ORDER BY relevance DESC
    LIMIT 30
  `;

  const countSql = `
    SELECT COUNT(*)::int as total
    FROM product_search_index psi
    WHERE ((${tsCondition} OR ${wsCondition}) OR ${ilikeCondition}) ${catFilter}
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
      keywords: originalKeywords,
      expanded_keywords: allKeywords,
      category: parsed.category,
      tsquery: parsed.tsquery,
      expansions: normalized.expanded_terms,
    },
    total_results: total,
    results,
  });
}
