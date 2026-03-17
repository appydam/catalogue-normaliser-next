import { NextRequest, NextResponse } from "next/server";
import { getClaudeClient, CLAUDE_MODEL, stripMarkdownFences, buildPageContentBlocks } from "@/lib/claude";
import { validateSchema } from "@/lib/types";
import { classifyPage, classifyCatalog } from "@/lib/catalog-classifier";


export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { pages: Array<{ page_number: number; image_url?: string; image_base64?: string; text: string }>; total_pages?: number };
    const client = getClaudeClient();

    const pageBlocks = await buildPageContentBlocks(body.pages, 4000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [
      {
        type: "text",
        text: `You are analyzing a product catalog PDF. I will show you several sample pages from this catalog.

Your job is to:
1. Identify the company name and catalog name/type
2. List ALL distinct product data fields you can find across these pages
3. Identify the category/sub-category hierarchy of products
4. Determine the best flat table schema to store ALL products from this catalog

The schema must handle EVERY product as a FLAT ROW. One row = one product (or one product variant with its own price).

IMPORTANT RULES:
- Include "page_number" (INTEGER), "category" (TEXT), and "sub_category" (TEXT) columns always.
- Use these PostgreSQL types: TEXT, NUMERIC, INTEGER, BOOLEAN, TEXT[]
- Column names must be valid PostgreSQL identifiers (lowercase, underscores, no spaces)

FOR TABULAR / PRICE LIST CATALOGS (pipe prices, fittings, building materials):
- Flatten multi-dimensional price grids. E.g., sizes × pressure ratings → columns: product_description, size_mm, pressure_rating, rate_rs. NOT a wide table with one column per size.
- If the catalog has different product types with prices by size (e.g., "Reducer 20×15 = ₹36.20"), use columns: product_description (TEXT), size (TEXT), rate_rs (NUMERIC).
- Include a "price_unit" (TEXT) column for notes like "per length", "per piece", "per 3 mtr".

FOR IMAGE-BASED CATALOGS (product photos with specs — sanitaryware, faucets, etc.):
- Always include: "product_name" (TEXT) — full name with series (e.g., "CHANEL One Piece EWC")
- "product_code" (TEXT) — catalog/article number (e.g., "S1013210", "F1005451BM")
- "product_description" (TEXT) — detailed specs, features, materials
- "series" (TEXT) — collection/series name if products are grouped (e.g., CHANEL, RUBY, LUSTRE)
- "color" (TEXT) — if variants by color exist (Snow White, Ivory, Black Matte, etc.)
- "dimensions" (TEXT) — size in mm
- "price" (NUMERIC) — price in INR
- "trap_type" (TEXT) — for EWCs: S Trap, P Trap, etc.
- Only include columns that actually appear in the catalog. Don't add columns for data that doesn't exist.

FOR MIXED CATALOGS (both tabular and image sections):
- Design the schema to accommodate BOTH formats. Use TEXT for flexible fields.

Return ONLY valid JSON (no markdown fences, no explanation) in this exact format:
{
  "company_name": "...",
  "catalog_name": "...",
  "categories": ["category1", "category2"],
  "columns": [
    {"name": "column_name", "type": "TEXT|NUMERIC|INTEGER|BOOLEAN|TEXT[]", "description": "what this column stores"}
  ]
}`,
      },
      ...pageBlocks,
    ];

    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content }],
    });

    const text = stripMarkdownFences(
      (response.content[0] as { type: string; text: string }).text
    );
    const rawSchema = JSON.parse(text);

    // Classify pages to determine catalog type
    const totalPages = body.total_pages ?? body.pages.length;
    const pageClassifications = body.pages.map((p) =>
      classifyPage(p.page_number, p.text, totalPages)
    );
    const catalogClassification = classifyCatalog(pageClassifications);

    // Validate schema — retry once with stricter prompt on failure
    try {
      const schema = validateSchema(rawSchema);
      return NextResponse.json({
        ...schema,
        classification: catalogClassification,
      });
    } catch (validationErr) {
      console.warn(`[schema] First attempt validation failed: ${validationErr}. Retrying with stricter prompt...`);

      const retryResponse = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        messages: [
          { role: "user", content },
          { role: "assistant", content: [{ type: "text", text }] },
          {
            role: "user",
            content: `Your previous response was invalid: ${validationErr}. Please fix the JSON and return it again. Requirements:
- company_name: non-empty string
- catalog_name: non-empty string
- columns: non-empty array, each with "name" (valid PostgreSQL identifier), "type" (TEXT|NUMERIC|INTEGER|BOOLEAN|TEXT[]), "description" (string)
- Must include page_number (INTEGER), category (TEXT), sub_category (TEXT) columns
Return ONLY valid JSON, no markdown.`,
          },
        ],
      });
      const retryText = stripMarkdownFences(
        (retryResponse.content[0] as { type: string; text: string }).text
      );
      const retryRaw = JSON.parse(retryText);
      const schema = validateSchema(retryRaw);
      return NextResponse.json({
        ...schema,
        classification: catalogClassification,
      });
    }
  } catch (err) {
    console.error("Schema discovery error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
