import { NextRequest, NextResponse } from "next/server";
import { getClaudeClient, CLAUDE_MODEL, stripMarkdownFences } from "@/lib/claude";

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
    return NextResponse.json(
      { error: "Unsupported image type. Use JPEG, PNG, WebP, or GIF." },
      { status: 400 },
    );
  }

  const client = getClaudeClient();

  const stream = client.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
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
            text: `You are a scheme circular extraction assistant for Indian distributors / dealers in building materials, FMCG, plumbing, sanitary ware, and similar industries.

Look at this image carefully. It is a scheme circular / offer announcement from a supplier or manufacturer, typically forwarded via WhatsApp or printed as a flyer.

Extract the following fields from the circular:

1. scheme_title — a short descriptive title for the scheme
2. supplier_name — the company/brand offering the scheme
3. products_covered — which products/categories this scheme applies to
4. offer_type — one of: "buy_x_get_y", "percentage_discount", "flat_discount", "cashback", "other"
5. offer_details — the actual offer description (e.g., "Buy 10 get 1 free", "5% extra discount on MRP")
6. minimum_order — minimum order requirement if mentioned, or null
7. valid_from — start date in ISO format (YYYY-MM-DD) if mentioned, or null
8. valid_until — end date in ISO format (YYYY-MM-DD) if mentioned, or null. If only a month is mentioned (e.g., "valid till March"), assume the last day of that month. Use year 2025 or 2026 as contextually appropriate.
9. terms — any terms, conditions, or fine print, or null

Return ONLY valid JSON (no markdown, no explanation):
{
  "scheme_title": "...",
  "supplier_name": "...",
  "products_covered": "...",
  "offer_type": "buy_x_get_y" | "percentage_discount" | "flat_discount" | "cashback" | "other",
  "offer_details": "...",
  "minimum_order": "..." | null,
  "valid_from": "YYYY-MM-DD" | null,
  "valid_until": "YYYY-MM-DD" | null,
  "terms": "..." | null
}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any[],
      },
    ],
  });

  const response = await stream.finalMessage();
  const rawText = (response.content[0] as { type: string; text: string }).text;
  const parsed = JSON.parse(stripMarkdownFences(rawText));

  return NextResponse.json(parsed);
}
