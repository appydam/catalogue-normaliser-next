import { NextRequest, NextResponse } from "next/server";
import { getClaudeClient, CLAUDE_MODEL, stripMarkdownFences, buildPageContentBlocks } from "@/lib/claude";
import type { PageData } from "@/lib/types";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { pages: PageData[] };
    const client = getClaudeClient();

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

IMPORTANT RULES:
- For tabular data with multiple dimensions (e.g., size x pressure rating = price), flatten into one row per unique combination. E.g., a pipe in sizes 20mm-160mm at pressure ratings 4-10 kgf/cm2 should have columns: product_description, size_mm, pressure_rating, rate_rs — NOT a wide table with size columns.
- Include a "page_number" column (INTEGER) to track which page each product came from.
- Include "category" and "sub_category" columns (TEXT) for product categorization.
- Use these PostgreSQL types: TEXT, NUMERIC, INTEGER, BOOLEAN, TEXT[]
- Column names must be valid PostgreSQL identifiers (lowercase, underscores, no spaces)
- Keep column names descriptive but concise

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
      ...buildPageContentBlocks(body.pages),
    ];

    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content }],
    });

    const text = stripMarkdownFences(
      (response.content[0] as { type: string; text: string }).text
    );
    const schema = JSON.parse(text);
    return NextResponse.json(schema);
  } catch (err) {
    console.error("Schema discovery error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
