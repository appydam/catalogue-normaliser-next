import { NextRequest, NextResponse } from "next/server";
import { getClaudeClient, CLAUDE_MODEL, stripMarkdownFences } from "@/lib/claude";
import { getSupabase } from "@/lib/supabase";
import { escapeSQLString, escapeILIKE } from "@/lib/types";

export const maxDuration = 60;

/**
 * POST /api/search/cross-reference
 *
 * Given a product (by ID or by attributes), find similar products
 * from OTHER catalogs/brands in the database. This enables distributors
 * to instantly say "I have a similar product from Brand B" when a
 * retailer asks about Brand A.
 *
 * Approach:
 * 1. Fetch the source product details
 * 2. Use Claude to extract the "essence" — what makes this product what it is
 *    (type, size, material, specs) independent of brand
 * 3. Search product_search_index for matches in OTHER catalogs
 * 4. Return ranked results with price comparison
 */
export async function POST(req: NextRequest) {
  const { product_id, product_data, source_catalog_id } = await req.json();

  if (!product_id && !product_data) {
    return NextResponse.json(
      { error: "Either product_id or product_data is required" },
      { status: 400 }
    );
  }

  const sb = getSupabase();

  // Step 1: Get the source product
  let sourceProduct: Record<string, unknown> | null = null;
  let sourceCatalogId: string | null = source_catalog_id ?? null;

  if (product_id) {
    // Fetch from product_search_index
    const { data } = await sb.rpc("query_sql", {
      query: `
        SELECT psi.*, c.company_name, c.catalog_name
        FROM product_search_index psi
        JOIN master_catalogs c ON c.id = psi.catalog_id
        WHERE psi.id = '${escapeSQLString(product_id)}'
        LIMIT 1
      `,
    });
    if (Array.isArray(data) && data.length > 0) {
      sourceProduct = data[0] as Record<string, unknown>;
      sourceCatalogId = (sourceProduct as Record<string, unknown>).catalog_id as string;
    }
  } else if (product_data) {
    sourceProduct = product_data;
    sourceCatalogId = product_data.catalog_id ?? source_catalog_id ?? null;
  }

  if (!sourceProduct) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  // Step 2: Use Claude to extract cross-reference search keywords
  // Claude understands that "Hindware Enigma 3L Cistern" and "Parryware Verve 3L Flush Tank" are the same thing
  const client = getClaudeClient();

  const productDescription = buildProductDescription(sourceProduct);

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 512,
    system: `You are a product cross-reference assistant for Indian building materials, plumbing, sanitaryware, and hardware distributors.

Given a product, extract the GENERIC attributes that identify what this product IS — independent of brand. Focus on:
- Product type/category (e.g., "wall hung EWC", "CPVC pipe", "angle cock")
- Key specifications (size, dimensions, pressure rating, material)
- Functional description (what it does, where it's used)

DO NOT include brand name, model name, or brand-specific series names in the search keywords.

Return ONLY valid JSON:
{
  "product_type": "the generic product type (e.g. wall hung EWC, 3 inch PVC pipe)",
  "search_keywords": ["keyword1", "keyword2", ...],
  "key_specs": {"size": "value", "material": "value", ...},
  "tsquery": "PostgreSQL tsquery for finding similar products"
}`,
    messages: [{ role: "user", content: productDescription }],
  });
  const rawText = (response.content[0] as { type: string; text: string }).text;

  let parsed: {
    product_type: string;
    search_keywords: string[];
    key_specs: Record<string, string>;
    tsquery: string;
  };

  try {
    parsed = JSON.parse(stripMarkdownFences(rawText));
  } catch {
    // Fallback: use basic keyword extraction
    const name = String(sourceProduct.product_name ?? "");
    const category = String(sourceProduct.category ?? "");
    parsed = {
      product_type: category || name,
      search_keywords: [...name.split(/\s+/), ...category.split(/\s+/)].filter(Boolean),
      key_specs: {},
      tsquery: name.split(/\s+/).filter(Boolean).join(" & "),
    };
  }

  // Step 3: Search for similar products in OTHER catalogs
  const keywords = parsed.search_keywords.filter((kw) => kw.length >= 2);
  if (keywords.length === 0) {
    return NextResponse.json({
      source_product: formatSourceProduct(sourceProduct),
      product_type: parsed.product_type,
      cross_references: [],
      total: 0,
    });
  }

  // Build the SQL for cross-reference search
  const excludeCatalog = sourceCatalogId
    ? `AND psi.catalog_id != '${escapeSQLString(sourceCatalogId)}'`
    : "";

  // ILIKE conditions for keyword matching
  const ilikeConditions = keywords.map((kw) => {
    const escaped = escapeILIKE(escapeSQLString(kw));
    return `(psi.description ILIKE '%${escaped}%' OR psi.product_name ILIKE '%${escaped}%' OR psi.category ILIKE '%${escaped}%' OR psi.sub_category ILIKE '%${escaped}%')`;
  });

  const matchCountCases = ilikeConditions.map(
    (c) => `CASE WHEN ${c} THEN 1 ELSE 0 END`
  );
  const matchCountExpr = matchCountCases.join(" + ");
  // Require at least half the keywords to match
  const minMatches = Math.max(1, Math.ceil(keywords.length / 2));

  // Also try tsvector
  const tsquery = escapeSQLString(parsed.tsquery ?? keywords.join(" & "));
  const tsCondition = tsquery
    ? `psi.search_text @@ to_tsquery('english', '${tsquery}')`
    : "FALSE";

  // Websearch fallback
  const wsTerms = escapeSQLString(keywords.join(" "));
  const wsCondition = `psi.search_text @@ websearch_to_tsquery('english', '${wsTerms}')`;

  const sql = `
    WITH ranked AS (
      SELECT
        psi.id, psi.catalog_id, psi.product_name, psi.category, psi.sub_category,
        psi.description, psi.price, psi.price_unit, psi.image_url, psi.raw_data,
        c.company_name, c.catalog_name,
        (${matchCountExpr}) as keyword_matches,
        CASE WHEN ${tsCondition} THEN 1 ELSE 0 END as ts_match,
        CASE WHEN ${wsCondition} THEN 1 ELSE 0 END as ws_match
      FROM product_search_index psi
      JOIN master_catalogs c ON c.id = psi.catalog_id
      WHERE (
        (${matchCountExpr}) >= ${minMatches}
        OR ${tsCondition}
        OR ${wsCondition}
      )
      ${excludeCatalog}
    )
    SELECT *,
      (keyword_matches::float / ${keywords.length}.0 * 70 + ts_match * 20 + ws_match * 10) as relevance
    FROM ranked
    ORDER BY relevance DESC, keyword_matches DESC
    LIMIT 20
  `;

  const { data: results } = await sb.rpc("query_sql", { query: sql });
  const crossRefs = Array.isArray(results) ? results : [];

  // Step 4: Build price comparison data
  const sourcePrice = Number(sourceProduct.price) || null;
  const enrichedResults = crossRefs.map((item: Record<string, unknown>) => {
    const itemPrice = Number(item.price) || null;
    let priceDiff: number | null = null;
    let priceDiffPct: number | null = null;

    if (sourcePrice && itemPrice) {
      priceDiff = itemPrice - sourcePrice;
      priceDiffPct = Math.round((priceDiff / sourcePrice) * 100);
    }

    return {
      ...item,
      price_diff: priceDiff,
      price_diff_pct: priceDiffPct,
    };
  });

  return NextResponse.json({
    source_product: formatSourceProduct(sourceProduct),
    product_type: parsed.product_type,
    key_specs: parsed.key_specs,
    cross_references: enrichedResults,
    total: enrichedResults.length,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildProductDescription(product: Record<string, unknown>): string {
  const parts: string[] = [];

  if (product.product_name) parts.push(`Product: ${product.product_name}`);
  if (product.category) parts.push(`Category: ${product.category}`);
  if (product.sub_category) parts.push(`Sub-category: ${product.sub_category}`);
  if (product.description) parts.push(`Description: ${product.description}`);

  // Include raw_data fields for richer context
  const raw = product.raw_data as Record<string, unknown> | undefined;
  if (raw) {
    for (const [key, val] of Object.entries(raw)) {
      if (
        val != null &&
        val !== "" &&
        !["id", "catalog_id", "_image_url", "page_number"].includes(key)
      ) {
        parts.push(`${key}: ${val}`);
      }
    }
  }

  return parts.join("\n");
}

function formatSourceProduct(product: Record<string, unknown>) {
  return {
    id: product.id,
    catalog_id: product.catalog_id,
    product_name: product.product_name,
    category: product.category,
    sub_category: product.sub_category,
    price: product.price,
    price_unit: product.price_unit,
    company_name: product.company_name,
    catalog_name: product.catalog_name,
    image_url: product.image_url,
    raw_data: product.raw_data,
  };
}
