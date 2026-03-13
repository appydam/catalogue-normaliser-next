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
    return JSON.parse(text);
  } catch {}

  const lastComma = text.lastIndexOf("},");
  if (lastComma > 0) {
    try {
      return JSON.parse(text.slice(0, lastComma + 1) + "]");
    } catch {}
  }

  const lastBrace = text.lastIndexOf("}");
  if (lastBrace > 0) {
    try {
      return JSON.parse(text.slice(0, lastBrace + 1) + "]");
    } catch {}
  }

  throw new Error("Could not repair truncated JSON array");
}

export function buildPageContentBlocks(
  pages: Array<{ page_number: number; image_base64: string; text: string }>
) {
  const blocks: object[] = [];
  for (const page of pages) {
    blocks.push({ type: "text", text: `--- Page ${page.page_number} ---` });
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: page.image_base64 },
    });
    if (page.text) {
      blocks.push({
        type: "text",
        text: `[Extracted text from page ${page.page_number}]:\n${page.text.slice(0, 2000)}`,
      });
    }
  }
  return blocks;
}
