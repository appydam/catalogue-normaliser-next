import { NextRequest, NextResponse } from "next/server";
import { getClaudeClient, CLAUDE_MODEL, stripMarkdownFences } from "@/lib/claude";
import { getSupabase } from "@/lib/supabase";
import { isValidUUID, escapeSQLString } from "@/lib/types";
import { needsTranslation, translateToEnglish } from "@/lib/translate";

export const maxDuration = 60;

interface CatalogSchema {
  catalog_id: string;
  catalog_name: string;
  company_name: string;
  table_name: string;
  columns: { name: string; type: string; description: string }[];
  categories: string[];
  sample_values: Record<string, string[]>;
}

/**
 * POST /api/search
 *
 * AI-powered natural language search. Claude converts the user's query into
 * a structured SQL WHERE clause using actual catalog schema + sample values,
 * then executes it against product_search_index (+ the dynamic table if a
 * specific catalog is selected).
 */
export async function POST(req: NextRequest) {
  try {
  const { query: rawQuery, catalog_id, limit = 30, offset = 0 } = await req.json();
  if (!rawQuery?.trim()) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  // Hindi/Hinglish translation — detect and translate before processing
  let query = rawQuery.trim();
  let translation: { translated: string; original: string; language: string } | null = null;

  if (needsTranslation(query)) {
    translation = await translateToEnglish(query);
    query = translation.translated;
  }

  const sb = getSupabase();
  const safeLimit = Math.min(Math.max(1, Number(limit) || 30), 100);
  const safeOffset = Math.max(0, Number(offset) || 0);

  // If a specific catalog is selected, get its schema + sample values for Claude
  let catalogSchema: CatalogSchema | null = null;
  if (catalog_id && isValidUUID(catalog_id)) {
    const { data: cat } = await sb
      .from("master_catalogs")
      .select("id, catalog_name, company_name, table_name, schema_definition, category_hierarchy")
      .eq("id", catalog_id)
      .single();

    if (cat) {
      const schemaDef = cat.schema_definition as { columns: { name: string; type: string; description: string }[] };
      const columns = schemaDef?.columns ?? [];

      // Fetch sample distinct values for key columns (helps Claude understand the data)
      const sampleValues: Record<string, string[]> = {};
      const sampleCols = columns
        .filter((c) => ["TEXT"].includes(c.type) && !["product_description", "special_notes", "special_features"].includes(c.name))
        .slice(0, 8);

      for (const col of sampleCols) {
        const { data: vals } = await sb.rpc("query_sql", {
          query: `SELECT DISTINCT "${col.name}" FROM "${cat.table_name}" WHERE "${col.name}" IS NOT NULL AND "${col.name}" != '' LIMIT 10`,
        });
        if (Array.isArray(vals) && vals.length > 0) {
          sampleValues[col.name] = vals.map((v: Record<string, unknown>) => String(v[col.name]));
        }
      }

      catalogSchema = {
        catalog_id: cat.id,
        catalog_name: cat.catalog_name,
        company_name: cat.company_name,
        table_name: cat.table_name,
        columns,
        categories: (cat.category_hierarchy as string[]) ?? [],
        sample_values: sampleValues,
      };
    }
  }

  // Ask Claude to parse the natural language query into a structured SQL filter
  let parsed: {
    sql_where: string;
    explanation: string;
    search_mode: "catalog_specific" | "global";
    fallback_keywords: string[];
  };

  try {
    const client = getClaudeClient();
    const systemPrompt = buildSystemPrompt(catalogSchema);

    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: query.trim() }],
      system: systemPrompt,
    });
    const rawText = (response.content[0] as { type: string; text: string }).text;

    parsed = JSON.parse(stripMarkdownFences(rawText));
  } catch (err) {
    console.error("[search] Claude parse error:", err);
    // Fallback: use the query as keyword search
    parsed = {
      sql_where: "",
      explanation: "Could not parse query, falling back to keyword search",
      search_mode: "global",
      fallback_keywords: query.trim().split(/\s+/),
    };
  }

  let results: Record<string, unknown>[] = [];
  let total = 0;

  if (parsed.search_mode === "catalog_specific" && catalogSchema && parsed.sql_where) {
    // Query the dynamic table directly with structured WHERE clause
    const { results: r, total: t } = await queryCatalogDirect(
      sb, catalogSchema, parsed.sql_where, safeLimit, safeOffset
    );
    results = r;
    total = t;

    // If structured query returned nothing, fall back to keyword search on this catalog
    if (results.length === 0 && parsed.fallback_keywords.length > 0) {
      const { results: fr, total: ft } = await querySearchIndex(
        sb, parsed.fallback_keywords, catalogSchema.catalog_id, safeLimit, safeOffset
      );
      results = fr;
      total = ft;
      parsed.explanation += " (structured query returned no results, fell back to keyword search)";
    }
  } else {
    // Global search across all catalogs using keyword matching on search index
    const keywords = parsed.fallback_keywords.length > 0
      ? parsed.fallback_keywords
      : query.trim().split(/\s+/).filter(Boolean);
    const catalogFilter = catalog_id && isValidUUID(catalog_id) ? catalog_id : undefined;
    const { results: r, total: t } = await querySearchIndex(
      sb, keywords, catalogFilter, safeLimit, safeOffset
    );
    results = r;
    total = t;
  }

  // Non-blocking: log search for demand intelligence analytics
  logSearch(sb, query, total, "web");

  return NextResponse.json({
    query,
    original_query: translation ? translation.original : undefined,
    translated_from: translation ? translation.language : undefined,
    ai_interpretation: parsed.explanation,
    search_mode: parsed.search_mode,
    sql_filter: parsed.sql_where || null,
    catalog_context: catalogSchema ? {
      catalog_id: catalogSchema.catalog_id,
      catalog_name: catalogSchema.catalog_name,
      company_name: catalogSchema.company_name,
    } : null,
    total_results: total,
    results,
  });
  } catch (err) {
    console.error("[search] Unhandled error:", err);
    return NextResponse.json(
      { error: "Search failed", details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// ── Non-blocking search logging for Demand Intelligence ───────────────────────

function logSearch(sb: ReturnType<typeof getSupabase>, query: string, resultsCount: number, source: string) {
  const safeQuery = escapeSQLString(query);
  const safeSource = escapeSQLString(source);
  const safeCount = Math.max(0, Math.floor(resultsCount));

  // Fire-and-forget: create table if needed, then insert
  Promise.resolve(
    sb.rpc("exec_sql", {
      query: `
        CREATE TABLE IF NOT EXISTS search_logs (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          query TEXT NOT NULL,
          results_count INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'web',
          created_at TIMESTAMPTZ DEFAULT now()
        )
      `,
    })
  )
    .then(() =>
      sb.rpc("exec_sql", {
        query: `INSERT INTO search_logs (query, results_count, source) VALUES ('${safeQuery}', ${safeCount}, '${safeSource}')`,
      })
    )
    .catch((err: unknown) => {
      console.error("[search-log] Failed to log search:", err);
    });
}

// ── Claude system prompt ──────────────────────────────────────────────────────

function buildSystemPrompt(schema: CatalogSchema | null): string {
  if (!schema) {
    return `You are a product search assistant. The user is searching across multiple product catalogs (plumbing, pipes, sanitaryware, fittings, etc.).

Since no specific catalog is selected, extract keywords from the natural language query for a keyword search.

Return ONLY valid JSON:
{
  "sql_where": "",
  "explanation": "brief description of what the user is looking for",
  "search_mode": "global",
  "fallback_keywords": ["keyword1", "keyword2", ...]
}

Extract meaningful keywords. For example:
- "quickfit pipes 180mm 8 kgf pressure" → ["quickfit", "pipes", "180", "8 kgf"]
- "wall hung EWC under 20000" → ["wall hung", "EWC"]
- "CPVC fittings 25mm coupler" → ["CPVC", "fittings", "25", "coupler"]

Return ONLY valid JSON, no markdown, no explanation.`;
  }

  const colDescriptions = schema.columns
    .map((c) => {
      const samples = schema.sample_values[c.name];
      const sampleStr = samples ? ` — sample values: ${samples.slice(0, 6).join(", ")}` : "";
      return `  - ${c.name} (${c.type}): ${c.description}${sampleStr}`;
    })
    .join("\n");

  const categoryStr = schema.categories.length > 0
    ? `\nCategories in this catalog: ${schema.categories.join(", ")}`
    : "";

  return `You are a product search SQL assistant. The user is searching within a specific catalog:

Catalog: "${schema.catalog_name}" by ${schema.company_name}
Table: "${schema.table_name}"
${categoryStr}

Table columns:
${colDescriptions}

Your job: Convert the user's natural language query into a SQL WHERE clause that filters this table precisely.

RULES:
1. Use the EXACT column names from the schema above.
2. For TEXT columns, use ILIKE with % wildcards for flexible matching.
3. For NUMERIC columns, use = for exact values, or >= / <= for ranges.
4. String values in the query should be matched against the appropriate column based on context and sample values.
5. If the user mentions a size like "180" or "180mm", match against the size column (e.g. size_mm = '180' or size_mm ILIKE '%180%').
6. If the user mentions pressure like "8kgf" or "8 kgf/cm2", match against the pressure column.
7. If the user mentions a pipe type like "quickfit" or "plain", match against pipe_type.
8. If the user mentions a category, match against category or sub_category.
9. Always include catalog_id = '${schema.catalog_id}' in the WHERE clause.
10. Keep the WHERE clause simple and precise. Don't over-filter — it's better to return more results than none.

Also provide fallback_keywords in case the structured query returns no results.

Return ONLY valid JSON:
{
  "sql_where": "catalog_id = '${schema.catalog_id}' AND pipe_type ILIKE '%quickfit%' AND size_mm = '180'",
  "explanation": "Looking for Quickfit pipes, size 180mm",
  "search_mode": "catalog_specific",
  "fallback_keywords": ["quickfit", "180"]
}

Examples for this catalog:
- "quickfit pipes 180 8kgf" → catalog_id = '...' AND pipe_type ILIKE '%QUICKFIT%' AND size_mm = '180' AND pressure_rating ILIKE '%8 kgf%'
- "all plain pipes above 100mm" → catalog_id = '...' AND pipe_type ILIKE '%PLAIN%' AND CAST(NULLIF(size_mm, '') AS NUMERIC) >= 100
- "ringfit 6 kgf" → catalog_id = '...' AND pipe_type ILIKE '%RINGFIT%' AND pressure_rating ILIKE '%6 kgf%'
- "coupler fittings" → catalog_id = '...' AND product_description ILIKE '%coupler%'

Return ONLY valid JSON, no markdown, no explanation.`;
}

// ── Direct catalog query ──────────────────────────────────────────────────────

async function queryCatalogDirect(
  sb: ReturnType<typeof getSupabase>,
  schema: CatalogSchema,
  whereClause: string,
  limit: number,
  offset: number
): Promise<{ results: Record<string, unknown>[]; total: number }> {
  // Sanitize: ensure the WHERE clause doesn't contain dangerous statements
  const lower = whereClause.toLowerCase();
  if (lower.includes("drop ") || lower.includes("delete ") || lower.includes("update ") ||
      lower.includes("insert ") || lower.includes("alter ") || lower.includes(";")) {
    return { results: [], total: 0 };
  }

  const tableName = schema.table_name;

  const dataSql = `
    SELECT t.*, c.company_name, c.catalog_name,
           psi.image_url, psi.description as search_description
    FROM "${tableName}" t
    JOIN master_catalogs c ON c.id = t.catalog_id
    LEFT JOIN product_search_index psi ON psi.catalog_id = t.catalog_id
      AND psi.raw_data->>'page_number' = t.page_number::text
      AND psi.product_name = t.product_description
    WHERE ${whereClause}
    LIMIT ${limit} OFFSET ${offset}
  `;

  const countSql = `
    SELECT COUNT(*)::int as total FROM "${tableName}" t WHERE ${whereClause}
  `;

  const [dataResult, countResult] = await Promise.all([
    sb.rpc("query_sql", { query: dataSql }),
    sb.rpc("query_sql", { query: countSql }),
  ]);

  const rawResults = Array.isArray(dataResult.data) ? dataResult.data : [];
  const total = Array.isArray(countResult.data) && countResult.data.length > 0
    ? countResult.data[0].total : 0;

  // Transform to match SearchResultItem structure
  const results = rawResults.map((row: Record<string, unknown>) => {
    const { id, catalog_id, company_name, catalog_name, image_url, search_description, ...rest } = row;
    return {
      id,
      catalog_id,
      product_name: rest.product_description ?? rest.product_name ?? null,
      category: rest.category ?? null,
      sub_category: rest.sub_category ?? null,
      description: search_description ?? Object.entries(rest)
        .filter(([k, v]) => v != null && !["id", "catalog_id"].includes(k))
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | "),
      price: rest.rate_rs ?? rest.price ?? null,
      price_unit: rest.price_unit ?? rest.unit ?? null,
      image_url: image_url ?? (rest as Record<string, unknown>)._image_url ?? null,
      company_name,
      catalog_name,
      raw_data: rest,
    };
  });

  return { results, total };
}

// ── Fallback keyword search on product_search_index ───────────────────────────

async function querySearchIndex(
  sb: ReturnType<typeof getSupabase>,
  keywords: string[],
  catalogId: string | undefined,
  limit: number,
  offset: number
): Promise<{ results: Record<string, unknown>[]; total: number }> {
  const filtered = keywords.filter((kw) => kw.length >= 2);
  if (filtered.length === 0) return { results: [], total: 0 };

  const catalogFilter = catalogId ? `AND psi.catalog_id = '${escapeSQLString(catalogId)}'` : "";

  // Build ILIKE conditions
  const ilikeConditions = filtered.map((kw) => {
    const escaped = escapeSQLString(kw).replace(/%/g, "\\%").replace(/_/g, "\\_");
    return `(psi.description ILIKE '%${escaped}%' OR psi.product_name ILIKE '%${escaped}%' OR psi.category ILIKE '%${escaped}%' OR psi.sub_category ILIKE '%${escaped}%')`;
  });

  const minMatches = filtered.length <= 2 ? 1 : Math.ceil(filtered.length / 2);
  const matchCountExpr = ilikeConditions.map((c) => `CASE WHEN ${c} THEN 1 ELSE 0 END`).join(" + ");
  const whereCondition = `(${matchCountExpr}) >= ${minMatches}`;

  // Also try tsvector
  const tsQuery = filtered.map((kw) => escapeSQLString(kw)).join(" ");
  const tsCondition = `psi.search_text @@ websearch_to_tsquery('english', '${tsQuery}')`;

  const sql = `
    SELECT
      psi.id, psi.catalog_id, psi.product_name, psi.category, psi.sub_category,
      psi.description, psi.price, psi.price_unit, psi.image_url, psi.raw_data,
      c.company_name, c.catalog_name
    FROM product_search_index psi
    JOIN master_catalogs c ON c.id = psi.catalog_id
    WHERE (${tsCondition} OR ${whereCondition}) ${catalogFilter}
    ORDER BY CASE WHEN ${tsCondition} THEN 1 ELSE 2 END,
             (${matchCountExpr}) DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const countSql = `
    SELECT COUNT(*)::int as total
    FROM product_search_index psi
    WHERE (${tsCondition} OR ${whereCondition}) ${catalogFilter}
  `;

  const [dataResult, countResult] = await Promise.all([
    sb.rpc("query_sql", { query: sql }),
    sb.rpc("query_sql", { query: countSql }),
  ]);

  return {
    results: Array.isArray(dataResult.data) ? dataResult.data : [],
    total: Array.isArray(countResult.data) && countResult.data.length > 0
      ? countResult.data[0].total : 0,
  };
}
