/**
 * Search query enhancement for building materials / sanitary ware domain.
 *
 * Handles:
 * 1. Domain-specific synonyms and abbreviations
 * 2. Plural → singular normalization
 * 3. Query intent detection (product code vs description vs brand)
 * 4. Multi-signal relevance scoring
 */

// ─── Domain synonym map ──────────────────────────────────────────────────────
// Maps user-friendly terms to canonical product database terms

const SYNONYMS: Record<string, string[]> = {
  // Sanitaryware
  toilet: ["ewc", "water closet", "commode", "wc"],
  ewc: ["toilet", "water closet", "commode", "wc"],
  "water closet": ["ewc", "toilet", "commode"],
  commode: ["ewc", "toilet", "water closet"],
  "wash basin": ["basin", "washbasin", "lavatory", "sink"],
  washbasin: ["basin", "wash basin", "lavatory", "sink"],
  basin: ["wash basin", "washbasin", "lavatory", "sink"],
  sink: ["basin", "wash basin", "washbasin"],
  urinal: ["urinal pot"],
  bidet: ["health faucet"],
  cistern: ["flush tank", "flushing cistern"],

  // Faucets
  tap: ["faucet", "cock", "mixer"],
  faucet: ["tap", "cock", "mixer"],
  mixer: ["tap", "faucet"],
  cock: ["tap", "faucet", "bib cock"],
  "bib cock": ["bib tap", "garden tap"],
  "pillar cock": ["pillar tap"],
  "angle cock": ["angle valve", "angle tap"],

  // Pipes & fittings
  pipe: ["tube", "conduit"],
  elbow: ["bend", "el"],
  tee: ["t-piece", "t piece"],
  reducer: ["reducing", "reduction"],
  coupling: ["coupler", "connector"],
  valve: ["cock", "stopcock"],
  flange: ["flanged"],
  nipple: ["connector"],

  // Materials
  pvc: ["polyvinyl chloride", "upvc", "cpvc"],
  upvc: ["pvc", "unplasticized pvc"],
  cpvc: ["chlorinated pvc"],
  gi: ["galvanized iron", "galvanised iron"],
  ss: ["stainless steel", "steel"],
  brass: ["chrome plated brass"],
  copper: ["cu"],

  // Types
  "wall hung": ["wall mounted", "wall mount"],
  "wall mounted": ["wall hung", "wall mount"],
  "floor mounted": ["floor standing", "floor mount"],
  "table top": ["counter top", "above counter"],
  "counter top": ["table top", "above counter"],
  "one piece": ["single piece", "1 piece"],
  "two piece": ["2 piece", "coupled"],
  rimless: ["rim free", "rimfree"],

  // Specs
  "s trap": ["s-trap", "floor outlet"],
  "p trap": ["p-trap", "wall outlet"],
};

// ─── Abbreviation expansion ─────────────────────────────────────────────────

const ABBREVIATIONS: Record<string, string> = {
  wh: "wall hung",
  wm: "wall mounted",
  fm: "floor mounted",
  tt: "table top",
  ct: "counter top",
  bc: "bib cock",
  ac: "angle cock",
  pc: "pillar cock",
  sc: "seat cover",
  tf: "twin flush",
  sf: "single flush",
  sw: "snow white",
  bm: "black matte",
  sst: "stainless steel",
  cp: "chrome plated",
  hm: "half turn",
  qt: "quarter turn",
};

// ─── Plural normalization ────────────────────────────────────────────────────

const IRREGULAR_PLURALS: Record<string, string> = {
  ewcs: "ewc",
  basins: "basin",
  sinks: "sink",
  toilets: "toilet",
  faucets: "faucet",
  pipes: "pipe",
  fittings: "fitting",
  valves: "valve",
  elbows: "elbow",
  tees: "tee",
  reducers: "reducer",
  couplings: "coupling",
  flanges: "flange",
  mixers: "mixer",
  commodes: "commode",
  urinals: "urinal",
  cisterns: "cistern",
  nipples: "nipple",
  adapters: "adapter",
  adaptors: "adapter",
  connectors: "connector",
  bends: "bend",
  crosses: "cross",
  bushes: "bush",
  plugs: "plug",
  caps: "cap",
  unions: "union",
  traps: "trap",
};

function singularize(word: string): string {
  const lower = word.toLowerCase();
  if (IRREGULAR_PLURALS[lower]) return IRREGULAR_PLURALS[lower];
  // Basic English plurals
  if (lower.endsWith("ies") && lower.length > 4) return lower.slice(0, -3) + "y";
  if (lower.endsWith("ses") || lower.endsWith("xes") || lower.endsWith("zes")) return lower.slice(0, -2);
  if (lower.endsWith("s") && !lower.endsWith("ss") && lower.length > 3) return lower.slice(0, -1);
  return lower;
}

// ─── Query Intent Detection ─────────────────────────────────────────────────

export type QueryIntent = "product_code" | "description" | "brand_product" | "category";

const PRODUCT_CODE_RE = /^[A-Z]{1,4}\d{4,}[A-Z]*$/i;
const BRAND_INDICATORS = ["series", "collection", "range"];

export function detectQueryIntent(query: string): QueryIntent {
  const trimmed = query.trim();
  const words = trimmed.split(/\s+/);

  // Single word that looks like a product code
  if (words.length === 1 && PRODUCT_CODE_RE.test(trimmed)) {
    return "product_code";
  }

  // Multiple words with a product code
  if (words.some((w) => PRODUCT_CODE_RE.test(w)) && words.length <= 3) {
    return "product_code";
  }

  // Single common category term
  const categories = ["pipe", "ewc", "basin", "faucet", "tap", "valve", "fitting", "toilet"];
  if (words.length <= 2 && words.some((w) => categories.includes(w.toLowerCase()))) {
    return "category";
  }

  // Brand + product (e.g., "CHANEL EWC", "CERA wash basin")
  if (words.length >= 2 && words[0].length >= 3 && /^[A-Z]/.test(words[0])) {
    const restWords = words.slice(1).map((w) => w.toLowerCase());
    if (restWords.some((w) => categories.includes(singularize(w)))) {
      return "brand_product";
    }
  }

  return "description";
}

// ─── Query Normalization ────────────────────────────────────────────────────

export interface NormalizedQuery {
  original: string;
  normalized: string;
  expanded_terms: string[];
  intent: QueryIntent;
  brand: string | null;
  product_code: string | null;
}

/**
 * Normalize and expand a search query for better matching.
 */
export function normalizeQuery(query: string): NormalizedQuery {
  const original = query.trim();
  const intent = detectQueryIntent(original);
  const words = original.split(/\s+/);

  let brand: string | null = null;
  let productCode: string | null = null;
  const expandedTerms: string[] = [];

  // Detect product code
  for (const word of words) {
    if (PRODUCT_CODE_RE.test(word)) {
      productCode = word.toUpperCase();
    }
  }

  // Detect brand (first capitalized word that isn't a known category)
  if (intent === "brand_product" && words.length >= 2) {
    brand = words[0];
  }

  // Normalize each word
  const normalizedWords: string[] = [];
  for (const word of words) {
    const lower = word.toLowerCase();

    // Expand abbreviations
    if (ABBREVIATIONS[lower]) {
      const expanded = ABBREVIATIONS[lower];
      normalizedWords.push(expanded);
      expandedTerms.push(`${word} → ${expanded}`);
      continue;
    }

    // Singularize
    const singular = singularize(lower);
    if (singular !== lower) {
      normalizedWords.push(singular);
      expandedTerms.push(`${word} → ${singular}`);
    } else {
      normalizedWords.push(lower);
    }

    // Add synonyms
    const synonyms = SYNONYMS[singular] || SYNONYMS[lower];
    if (synonyms) {
      for (const syn of synonyms.slice(0, 2)) { // Limit to 2 synonyms per term
        expandedTerms.push(`${word} ≈ ${syn}`);
      }
    }
  }

  return {
    original,
    normalized: normalizedWords.join(" "),
    expanded_terms: expandedTerms,
    intent,
    brand,
    product_code: productCode,
  };
}

/**
 * Build a PostgreSQL tsquery that incorporates synonyms and normalization.
 * Returns a websearch-compatible query string.
 */
export function buildEnhancedTsquery(normalized: NormalizedQuery): string {
  const words = normalized.normalized.split(/\s+/).filter(Boolean);

  if (normalized.intent === "product_code" && normalized.product_code) {
    // For product codes, use exact match
    return normalized.product_code;
  }

  // Build query with original + synonym expansion
  const terms: string[] = [...words];

  // Add key synonyms
  for (const word of words) {
    const lower = word.toLowerCase();
    const singular = singularize(lower);
    const synonyms = SYNONYMS[singular] || SYNONYMS[lower];
    if (synonyms) {
      // Add first synonym as OR alternative
      const synWords = synonyms[0].split(/\s+/);
      if (synWords.length === 1) {
        terms.push(synWords[0]);
      }
    }
  }

  return terms.join(" ");
}

/**
 * Build ILIKE search terms from normalized query — includes synonym expansion.
 */
export function getExpandedKeywords(normalized: NormalizedQuery): string[] {
  const words = normalized.normalized.split(/\s+/).filter(Boolean);
  const keywords = new Set<string>(words);

  // Add synonyms as additional search terms
  for (const word of words) {
    const singular = singularize(word);
    const synonyms = SYNONYMS[singular] || SYNONYMS[word];
    if (synonyms) {
      for (const syn of synonyms.slice(0, 2)) {
        for (const synWord of syn.split(/\s+/)) {
          keywords.add(synWord);
        }
      }
    }
  }

  return Array.from(keywords);
}
