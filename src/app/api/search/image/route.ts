import { NextRequest, NextResponse } from "next/server";
import { getClaudeClient, CLAUDE_MODEL, stripMarkdownFences } from "@/lib/claude";
import { getSupabase } from "@/lib/supabase";
import { uploadImageToS3 } from "@/lib/s3";
import { escapeSQLString, escapeILIKE, isValidUUID } from "@/lib/types";
import { normalizeQuery, getExpandedKeywords } from "@/lib/search-enhancer";
import { generateImageEmbedding, embeddingToSql } from "@/lib/bedrock-embeddings";
import { v4 as uuidv4 } from "uuid";

export const maxDuration = 120;

const STOP_WORDS = new Set(["a","an","the","and","or","but","in","on","at","to","for","of","with","by","from","is","it","as","be","was","are","has","had","not","no","its","this","that","rs","per"]);

function filterKeywords(keywords: string[]): string[] {
  return keywords.filter((kw) => kw.length >= 2 && !STOP_WORDS.has(kw.toLowerCase()));
}

function kwMatchExpr(kw: string): string {
  const escaped = escapeILIKE(escapeSQLString(kw));
  return `(psi.description ILIKE '%${escaped}%' OR psi.product_name ILIKE '%${escaped}%' OR psi.category ILIKE '%${escaped}%' OR psi.sub_category ILIKE '%${escaped}%')`;
}

interface SearchResultItem {
  id: string;
  catalog_id: string;
  product_name: string | null;
  category: string | null;
  sub_category: string | null;
  description: string | null;
  price: number | null;
  price_unit: string | null;
  image_url: string | null;
  raw_data: Record<string, unknown>;
  company_name: string;
  catalog_name: string;
  similarity?: number;
  relevance?: number;
}

/**
 * Ask Claude Vision to re-rank top candidates by visually comparing them to the query image.
 * Returns ranked IDs with explanation.
 */
async function rerankWithClaude(
  queryBase64: string,
  queryMimeType: string,
  candidates: SearchResultItem[]
): Promise<{ ranked_ids: string[]; explanation: string; confidence: "high" | "medium" | "low"; visual_variants: boolean }> {
  // Only re-rank if we have crop images (not full page images)
  const withCrops = candidates.filter((c) => c.image_url?.includes("/crops/"));
  if (withCrops.length === 0) {
    return {
      ranked_ids: candidates.map((c) => c.id),
      explanation: "No individual product crops available for visual comparison.",
      confidence: "low",
      visual_variants: false,
    };
  }

  const client = getClaudeClient();

  // Build candidate list text for Claude
  const candidateDesc = withCrops
    .slice(0, 5)
    .map(
      (c, i) =>
        `Candidate ${i + 1}: ${c.product_name ?? "Unknown"} | Cat: ${c.raw_data?.cat_no ?? c.raw_data?.product_code ?? "N/A"} | ${c.description?.slice(0, 150) ?? ""}`
    )
    .join("\n");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [
    {
      type: "text",
      text: `You are a product matching expert for a building materials / sanitaryware catalog system.

The user uploaded a photo of a product they want to find. Below is their photo, followed by the top candidate product images from our catalog.

Your job: Determine which catalog product best matches the user's photo.

${candidateDesc}

Look carefully at:
- Overall shape and form factor
- Material finish (chrome, matte, white, etc.)
- Key functional features (hose length, mounting type, handle style)
- Any visible text, model numbers, or brand marks

Return ONLY valid JSON (no markdown):
{
  "ranked_ids": ["<id of best match>", "<id of second best>", ...],
  "explanation": "Brief explanation of why the top match was chosen and how the products differ",
  "confidence": "high | medium | low",
  "visual_variants": true/false (true if top candidates look nearly identical)
}`,
    },
    {
      type: "text",
      text: "USER'S QUERY IMAGE:",
    },
    {
      type: "image",
      source: { type: "base64", media_type: queryMimeType, data: queryBase64 },
    },
  ];

  // Add candidate images (fetch from S3 URLs won't work server-side easily, use URL source)
  for (let i = 0; i < Math.min(withCrops.length, 5); i++) {
    const c = withCrops[i];
    content.push({ type: "text", text: `CATALOG CANDIDATE ${i + 1} (ID: ${c.id}):` });
    if (c.image_url) {
      content.push({
        type: "image",
        source: { type: "url", url: c.image_url },
      });
    }
  }

  try {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content }],
    });

    const text = (response.content[0] as { type: string; text: string }).text;
    const parsed = JSON.parse(stripMarkdownFences(text));

    return {
      ranked_ids: Array.isArray(parsed.ranked_ids) ? parsed.ranked_ids : withCrops.map((c) => c.id),
      explanation: parsed.explanation ?? "",
      confidence: parsed.confidence ?? "medium",
      visual_variants: parsed.visual_variants ?? false,
    };
  } catch {
    return {
      ranked_ids: withCrops.map((c) => c.id),
      explanation: "Re-ranking unavailable.",
      confidence: "low",
      visual_variants: false,
    };
  }
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("image") as File | null;
  const catalogIdRaw = formData.get("catalog_id") as string | null;
  const catalogId = catalogIdRaw && isValidUUID(catalogIdRaw) ? catalogIdRaw : null;

  if (!file) {
    return NextResponse.json({ error: "Image file is required" }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = file.type || "image/jpeg";
  const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!validTypes.includes(mimeType)) {
    return NextResponse.json({ error: "Unsupported image type. Use JPEG, PNG, WebP, or GIF." }, { status: 400 });
  }

  // Upload query image to S3
  const ext = mimeType.split("/")[1];
  const s3Key = `search-queries/${uuidv4()}.${ext}`;
  const imageUrl = await uploadImageToS3(s3Key, base64, mimeType);

  const sb = getSupabase();

  // ── Check if vector search is available ──────────────────────────────────
  // For now, vector search requires pgvector extension to be enabled
  // Just set to false — will be enabled when pgvector is set up
  const vectorAvailable = false;

  // ── Step 1: Claude Vision describes the product ───────────────────────────
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
            text: `You are a product search assistant for a building materials / sanitaryware / plumbing products database.

Look at this image carefully. It could be:
- A single product photo (e.g. a washbasin, toilet, pipe fitting)
- A catalog page showing multiple products
- A photo of a physical product

Identify the PRIMARY product and extract maximum details visible in the image.

Return ONLY valid JSON (no markdown):
{
  "description": "detailed description of what you see for display to user",
  "search_query": "3-5 core keywords only (product type + material/finish). Do NOT include generic terms like wall, mount, holder, hose. Example: 'health faucet chrome ABS'",
  "category": "product category (e.g. 'wash basin', 'health faucet', 'EWC') or null",
  "tsquery": "PostgreSQL tsquery — use | (OR) between variant names, & (AND) only for product type. Example: 'health & faucet' or 'wash & basin | washbasin'. Keep it SHORT, 2-4 terms max.",
  "visible_specs": {
    "material": "e.g. ABS, stainless steel, ceramic or null",
    "finish": "e.g. chrome, matte white or null",
    "mounting": "e.g. wall hung, floor mounted or null",
    "key_feature": "most distinctive visible feature or null"
  }
}`,
          },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any[],
      },
    ],
  });

  const rawText = (describeResponse.content[0] as { type: string; text: string }).text;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripMarkdownFences(rawText));
  } catch {
    parsed = { search_query: "", description: "Could not analyze image", category: null, tsquery: "" };
  }

  const searchQuery = (parsed.search_query as string) ?? "";
  const normalized = normalizeQuery(searchQuery);
  const expandedKeywords = getExpandedKeywords(normalized);
  const originalKeywords = filterKeywords(searchQuery.split(/\s+/).filter(Boolean));
  const allKeywords = filterKeywords([...new Set([...originalKeywords, ...expandedKeywords])]);

  let results: SearchResultItem[] = [];
  let searchMode: "vector" | "text" = "text";
  let rerankResult: Awaited<ReturnType<typeof rerankWithClaude>> | null = null;

  // ── Step 2a: Vector search (if embeddings available for selected catalog) ─
  if (vectorAvailable && catalogId) {
    try {
      searchMode = "vector";
      const queryEmbedding = await generateImageEmbedding(base64, searchQuery);
      const vectorSql = embeddingToSql(queryEmbedding);

      const { data: vectorResults } = await sb.rpc("search_by_image_embedding", {
        query_embedding: vectorSql,
        match_threshold: 0.45,
        match_count: 20,
        filter_catalog_id: catalogId,
      });

      if (Array.isArray(vectorResults) && vectorResults.length > 0) {
        results = vectorResults.map((r) => ({ ...r, relevance: Math.round((r.similarity ?? 0) * 100) }));

        // ── Step 2b: Claude Vision re-ranking of top 5 ──────────────────────
        rerankResult = await rerankWithClaude(base64, mimeType, results.slice(0, 5));

        // Reorder top 5 by Claude's ranking
        if (rerankResult.ranked_ids.length > 0) {
          const rankMap = new Map(rerankResult.ranked_ids.map((id, i) => [id, i]));
          const top5 = results.slice(0, 5).sort((a, b) => {
            const ra = rankMap.get(a.id) ?? 99;
            const rb = rankMap.get(b.id) ?? 99;
            return ra - rb;
          });
          results = [...top5, ...results.slice(5)];
        }
      }
    } catch (err) {
      console.warn("[image-search] Vector search failed, falling back to text:", err);
      searchMode = "text";
    }
  }

  // ── Step 2c: Text search fallback (or when no catalog selected) ────────────
  if (searchMode === "text" || results.length === 0) {
    searchMode = "text";

    const tsquery = escapeSQLString((parsed.tsquery as string) ?? "");
    const cat = parsed.category ? escapeSQLString(parsed.category as string) : null;

    const keywordCountCases = allKeywords.map((kw) => `CASE WHEN ${kwMatchExpr(kw)} THEN 1 ELSE 0 END`);
    const keywordCountExpr = keywordCountCases.length > 0 ? `(${keywordCountCases.join(" + ")})` : "0";
    // Image search: be very lenient — match if at least 1 keyword hits
    const minMatches = 1;
    const ilikeCondition = allKeywords.length > 0 ? `(${keywordCountExpr} >= ${minMatches})` : "FALSE";
    const catFilter = cat ? `AND (psi.category ILIKE '%${escapeILIKE(cat)}%' OR psi.sub_category ILIKE '%${escapeILIKE(cat)}%')` : "";
    const catalogFilter = catalogId ? `AND psi.catalog_id = '${catalogId}'` : "";

    // Use websearch_to_tsquery which handles OR-like matching better than to_tsquery
    const sanitizedSearch = escapeSQLString(searchQuery);
    const sanitizedEnhanced = escapeSQLString(normalized.normalized);
    const wsCondition = `psi.search_text @@ websearch_to_tsquery('english', '${sanitizedEnhanced}')`;
    const wsCondition2 = `psi.search_text @@ websearch_to_tsquery('english', '${sanitizedSearch}')`;
    const tsRank = `ts_rank(psi.search_text, websearch_to_tsquery('english', '${sanitizedEnhanced}'))`;

    // Also try a simple category-only search as the broadest net
    const catOnlyCondition = cat
      ? `(psi.category ILIKE '%${escapeILIKE(cat)}%' OR psi.sub_category ILIKE '%${escapeILIKE(cat)}%')`
      : "FALSE";

    const sql = `
      WITH ts_results AS (
        SELECT
          psi.id, psi.catalog_id, psi.product_name, psi.category, psi.sub_category,
          psi.description, psi.price, psi.price_unit, psi.image_url, psi.raw_data,
          c.company_name, c.catalog_name,
          (100.0 + ${tsRank} * 100) as relevance
        FROM product_search_index psi
        JOIN master_catalogs c ON c.id = psi.catalog_id
        WHERE (${wsCondition} OR ${wsCondition2}) ${catalogFilter}
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
        WHERE ${ilikeCondition} ${catalogFilter}
          AND psi.id NOT IN (SELECT id FROM ts_results)
        LIMIT 30
      ),
      cat_results AS (
        SELECT
          psi.id, psi.catalog_id, psi.product_name, psi.category, psi.sub_category,
          psi.description, psi.price, psi.price_unit, psi.image_url, psi.raw_data,
          c.company_name, c.catalog_name,
          50.0 as relevance
        FROM product_search_index psi
        JOIN master_catalogs c ON c.id = psi.catalog_id
        WHERE ${catOnlyCondition} ${catalogFilter}
          AND psi.id NOT IN (SELECT id FROM ts_results UNION SELECT id FROM ilike_results)
        LIMIT 20
      )
      SELECT * FROM (
        SELECT * FROM ts_results
        UNION ALL
        SELECT * FROM ilike_results
        UNION ALL
        SELECT * FROM cat_results
      ) combined
      ORDER BY relevance DESC
      LIMIT 30
    `;

    const { data } = await sb.rpc("query_sql", { query: sql });
    results = Array.isArray(data) ? data : [];
  }

  return NextResponse.json({
    query: searchQuery,
    query_image_url: imageUrl,
    ai_description: parsed.description,
    search_mode: searchMode,
    vector_available: vectorAvailable,
    visible_specs: parsed.visible_specs ?? null,
    ai_rerank: rerankResult
      ? {
          explanation: rerankResult.explanation,
          confidence: rerankResult.confidence,
          visual_variants: rerankResult.visual_variants,
        }
      : null,
    parsed_filters: {
      keywords: originalKeywords,
      expanded_keywords: allKeywords,
      category: parsed.category,
      tsquery: parsed.tsquery,
      expansions: normalized.expanded_terms,
    },
    total_results: results.length,
    results,
  });
}
