import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

let _client: AnthropicBedrock | null = null;

export function getClaudeClient(): AnthropicBedrock {
  if (!_client) {
    _client = new AnthropicBedrock({
      awsAccessKey: process.env.AWS_ACCESS_KEY_ID!,
      awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY!,
      awsRegion: process.env.AWS_REGION ?? "us-east-1",
    });
  }
  return _client;
}

export const CLAUDE_MODEL =
  process.env.CLAUDE_MODEL ?? "us.anthropic.claude-sonnet-4-20250514-v1:0";

export function stripMarkdownFences(text: string): string {
  text = text.trim();
  if (text.startsWith("```")) {
    const lines = text.split("\n");
    lines.shift();
    text = lines.join("\n");
    if (text.endsWith("```")) text = text.slice(0, -3).trim();
  }
  return text;
}

export function repairTruncatedJsonArray(text: string): unknown[] {
  text = stripMarkdownFences(text);
  try {
    const result = JSON.parse(text);
    return Array.isArray(result) ? result : [];
  } catch {}

  // Handle case where Claude returns just "[]" with extra whitespace/text
  if (text.trim() === "[]") return [];

  const lastComma = text.lastIndexOf("},");
  if (lastComma > 0) {
    try {
      const repaired = JSON.parse(text.slice(0, lastComma + 1) + "]");
      console.warn(`[repairJSON] Truncated response repaired: recovered ${repaired.length} items from ${text.length} chars`);
      return repaired;
    } catch {}
  }

  const lastBrace = text.lastIndexOf("}");
  if (lastBrace > 0) {
    try {
      const repaired = JSON.parse(text.slice(0, lastBrace + 1) + "]");
      console.warn(`[repairJSON] Truncated response repaired: recovered ${repaired.length} items from ${text.length} chars`);
      return repaired;
    } catch {}
  }

  // If nothing works, return empty rather than throwing — don't lose the whole chunk
  console.error(`[repairJSON] Could not parse response (${text.length} chars). Preview: ${text.slice(0, 300)}`);
  return [];
}

/**
 * Build Claude content blocks from page data.
 * Bedrock doesn't support URL image sources, so when a URL is provided
 * the image is fetched and converted to base64.
 */
export async function buildPageContentBlocks(
  pages: Array<{ page_number: number; image_url?: string; image_base64?: string; text: string }>,
  textLimit = 8000
) {
  const blocks: object[] = [];
  for (const page of pages) {
    blocks.push({ type: "text", text: `--- Page ${page.page_number} ---` });

    let base64 = page.image_base64;

    if (page.image_url && !base64) {
      // Fetch image from S3 URL and convert to base64 for Bedrock
      try {
        const res = await fetch(page.image_url);
        const arrayBuffer = await res.arrayBuffer();
        base64 = Buffer.from(arrayBuffer).toString("base64");
      } catch {
        // Non-critical — skip image
      }
    }

    if (base64) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: base64 },
      });
    }

    if (page.text) {
      blocks.push({
        type: "text",
        text: `[Extracted text from page ${page.page_number}]:\n${page.text.slice(0, textLimit)}`,
      });
    }
  }
  return blocks;
}
