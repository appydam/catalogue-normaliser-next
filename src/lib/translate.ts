import { getClaudeClient, CLAUDE_MODEL, stripMarkdownFences } from "./claude";

/**
 * Detect if a query contains Hindi (Devanagari script) or Hinglish
 * (Hindi written in Latin script), and translate to English product keywords.
 *
 * Returns null if the query is already in English.
 */

// Devanagari Unicode range
const DEVANAGARI_RE = /[\u0900-\u097F]/;

// Common Hinglish words used in product queries
const HINGLISH_MARKERS = new Set([
  "ka", "ki", "ke", "hai", "hain", "mein", "me", "se", "ko", "pe",
  "kya", "koi", "aur", "ya", "nahi", "nhi", "wala", "wali", "wale",
  "chahiye", "chahie", "dikhao", "dikha", "do", "batao", "bata",
  "kitna", "kitne", "kitni", "keemat", "kimat", "daam", "rate",
  "sasta", "saste", "sasti", "mehenga", "mehnge", "accha", "ache",
  "sabse", "jaise", "jaisa", "jaisi", "inch", "inka", "uska",
  "pipe", "nali", "tatti", "dhakkan", "jod", "jodh",
]);

/**
 * Check if the query needs translation (Hindi/Hinglish → English)
 */
export function needsTranslation(query: string): boolean {
  // Check for Devanagari script
  if (DEVANAGARI_RE.test(query)) return true;

  // Check for Hinglish: if query has 2+ Hinglish marker words
  const words = query.toLowerCase().split(/\s+/);
  let hinglishCount = 0;
  for (const word of words) {
    if (HINGLISH_MARKERS.has(word)) hinglishCount++;
  }
  return hinglishCount >= 2;
}

/**
 * Translate a Hindi/Hinglish query to English product search terms using Claude.
 */
export async function translateToEnglish(
  query: string
): Promise<{ translated: string; original: string; language: string }> {
  const client = getClaudeClient();

  const stream = client.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 256,
    system: `You are a translator for an Indian product search system (building materials, plumbing, sanitaryware, hardware, electrical, FMCG).

The user's query is in Hindi or Hinglish (Hindi written in English script). Translate it to English product search keywords.

Rules:
1. Extract ONLY the product-relevant terms. Drop filler words like "ka", "ki", "hai", "mein", "chahiye", "batao", "dikhao".
2. Convert Hindi product names to their English equivalents:
   - "नल" / "nal" → "tap" or "faucet"
   - "पाइप" / "pipe" → "pipe"
   - "टॉयलेट" / "toilet" / "sandas" → "toilet" or "EWC"
   - "बेसिन" / "basin" → "wash basin"
   - "टंकी" / "tanki" / "tanki" → "cistern" or "tank"
   - "कीमत" / "keemat" / "rate" / "daam" → (price indicator, ignore in keywords)
3. Keep sizes, numbers, and measurements as-is: "3 inch", "25mm", "180mm"
4. Keep brand names as-is: "Hindware", "Parryware", "Astral", "Supreme"
5. If query asks for "sasta" (cheap) or price comparison, ignore the price part, just extract the product

Return ONLY valid JSON:
{
  "translated": "English product search keywords",
  "language": "hindi" or "hinglish"
}`,
    messages: [{ role: "user", content: query }],
  });

  const response = await stream.finalMessage();
  const rawText = (response.content[0] as { type: string; text: string }).text;

  try {
    const parsed = JSON.parse(stripMarkdownFences(rawText));
    return {
      translated: parsed.translated ?? query,
      original: query,
      language: parsed.language ?? "hinglish",
    };
  } catch {
    // Fallback: return original
    return { translated: query, original: query, language: "unknown" };
  }
}
