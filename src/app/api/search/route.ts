import { NextRequest, NextResponse } from "next/server";
import { getClaudeClient, CLAUDE_MODEL, stripMarkdownFences } from "@/lib/claude";
import { getSupabase } from "@/lib/supabase";
import type { ParsedSearchFilters } from "@/lib/types";

export const maxDuration = 60;

function sanitizeSqlString(value: string): string {
  return value.replace(/[';\\]/g, "");
}

export async function POST(req: NextRequest) {
  const { query, catalog_ids, limit = 20, offset = 0 } = await req.json();
  if (!query?.trim()) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  const client = getClaudeClient();

  // Step 1: Parse query with Claude
  const parseResponse = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Parse this product search query into structured filters for a product database.

Query: "${query}"

Return ONLY valid JSON (no markdown, no explanation):
{
  "keywords": ["list", "of", "keywords"],
  "category": "category name or null",
  "price_min": number or null,
  "price_max": number or null,
  "size": "size string or null",
  "brand": "brand or null",
  "tsquery": "PostgreSQL tsquery string (use & for AND, | for OR). Example: 'PVC & pipe & 50mm'"
}`,
      },
    ],
  });

  const parsed = JSON.parse(
    stripMarkdownFences(
      (parseResponse.content[0] as { type: string; text: string }).text
    )
  ) as ParsedSearchFilters;

  // Step 2: Build SQL
  const conditions: string[] = [];
  const tsquery = sanitizeSqlString(parsed.tsquery ?? "");

  if (tsquery) {
    conditions.push(`psi.search_text @@ to_tsquery(''english'', ''${tsquery}'')`);
  }
  if (parsed.price_min != null) {
    conditions.push(`psi.price >= ${Number(parsed.price_min)}`);
  }
  if (parsed.price_max != null) {
    conditions.push(`psi.price <= ${Number(parsed.price_max)}`);
  }
  if (parsed.category) {
    const cat = sanitizeSqlString(parsed.category);
    conditions.push(
      `(psi.category ILIKE ''%${cat}%'' OR psi.sub_category ILIKE ''%${cat}%'')`
    );
  }
  if (Array.isArray(catalog_ids) && catalog_ids.length > 0) {
    const ids = catalog_ids.map((id: string) => `''${sanitizeSqlString(id)}''`).join(",");
    conditions.push(`psi.catalog_id IN (${ids})`);
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
    LIMIT ${Number(limit)} OFFSET ${Number(offset)}
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
  const total =
    Array.isArray(countData.data) && countData.data.length > 0
      ? countData.data[0].total
      : 0;

  return NextResponse.json({
    query,
    parsed_filters: parsed,
    total_results: total,
    results,
  });
}
