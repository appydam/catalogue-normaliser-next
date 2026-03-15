/**
 * Specialized extraction prompt templates based on catalog type.
 *
 * Instead of a single one-size-fits-all prompt, we use catalog type detection
 * to select the most effective prompt. This dramatically improves extraction
 * accuracy for edge cases (dense price grids, image-heavy catalogs, mixed formats).
 */

import type { CatalogType, PageClassification } from "./catalog-classifier";
import type { ColumnDefinition } from "./types";

interface PromptContext {
  company_name: string;
  columns: ColumnDefinition[];
  category_context: string;
  catalog_type: CatalogType;
  page_classifications?: PageClassification[];
}

function buildColumnDescription(columns: ColumnDefinition[]): string {
  return columns.map((c) => `  - ${c.name} (${c.type}): ${c.description}`).join("\n");
}

// ─── Tabular catalog prompt ──────────────────────────────────────────────────
// Optimized for price lists, pipe fittings, building materials with size grids

function tabularPrompt(ctx: PromptContext): string {
  const columnDesc = buildColumnDescription(ctx.columns);
  const contextNote = ctx.category_context
    ? `\nPrevious category context: ${ctx.category_context}\nContinue with this context if the current pages don't specify a new category.\n`
    : "";

  return `You are extracting product data from a TABULAR PRICE LIST catalog by ${ctx.company_name}.

The table schema is:
${columnDesc}
${contextNote}
Extract ALL products. Return a JSON array of objects, one per product row.

CRITICAL RULES FOR TABULAR CATALOGS:

1. PRICE GRIDS (size × type matrix):
   - Each cell with a price is a SEPARATE row
   - Read column headers carefully — they define the size/type/variant
   - Read row headers carefully — they define the other dimension
   - A 20-row × 5-column grid with 80 filled cells = 80 rows
   - Empty cells = skip (no row)
   - Example: "UPVC Pipes" table with sizes 20mm-110mm and pressure ratings 2.5-10 kgf/cm² → one row per size×pressure combination that has a price

2. MULTI-SECTION PAGES:
   - A single page may contain MULTIPLE independent tables/sections
   - Each section usually has its own header (e.g., "PLAIN PIPES", "QUICKFIT PIPES")
   - Use the section header as category or sub_category
   - Process each section independently — don't mix data between sections

3. SIZE VARIANTS:
   - Fittings (reducers, elbows, tees) listed across size columns (e.g., 20×15, 25×20)
   - Each size with a price = one row
   - Include BOTH the fitting type AND the size in product_description
   - Example: "Reducer TEE" with sizes 25×20, 32×20, 40×25 = 3 rows

4. RATE NOTES & UNITS:
   - Watch for headers: "RATE RS. PER LENGTH", "RATE RS. PER PIECE", "PER 3 MTR"
   - Capture as price_unit if available in schema
   - Different sections may have different units — use the correct one per section

5. SPARSE TABLES:
   - Not every cell has a value. Only create rows for cells with actual prices
   - Don't interpolate or fill in missing values
   - A dash (-) or blank means no data — skip it

6. FOOTNOTES & DISCLAIMERS:
   - Ignore footnotes, terms & conditions, disclaimers
   - Only extract actual product/price data

7. INDEX / TOC / COVER pages: return []

8. Prices: numeric only, no currency symbols (₹, Rs., etc.)
9. If a field is not applicable, use null
10. Include page_number for every product
11. Return ONLY a valid JSON array. No markdown fences, no explanation.`;
}

// ─── Image-based catalog prompt ──────────────────────────────────────────────
// Optimized for sanitaryware, faucets, tiles — products shown with photos

function imageBasedPrompt(ctx: PromptContext): string {
  const columnDesc = buildColumnDescription(ctx.columns);
  const contextNote = ctx.category_context
    ? `\nPrevious category context: ${ctx.category_context}\nContinue with this context if the current pages don't specify a new category.\n`
    : "";

  return `You are extracting product data from an IMAGE-BASED PRODUCT CATALOG by ${ctx.company_name}.

The table schema is:
${columnDesc}
${contextNote}
Extract ALL products visible on these pages. Return a JSON array of objects, one per product.

CRITICAL RULES FOR IMAGE-BASED CATALOGS:

1. PRODUCT IDENTIFICATION:
   - Each distinct product shown with its own photo = a separate row
   - Even if 6-18 products appear on one page in a grid layout
   - Look carefully at ALL products on the page, not just the prominent ones
   - Products may be shown as small thumbnails in a grid — extract ALL of them

2. PRODUCT NAMES:
   - ALWAYS include the series/collection name + model name
   - Example: "CALIBRE Two Piece Wall Hung EWC", "RUBY Black Matte Basin Mixer"
   - The series name is usually the large bold text above/beside the product
   - If a page header says "CHANEL" and products are listed below, prefix each with "CHANEL"

3. CATALOG NUMBERS / PRODUCT CODES:
   - Extract ALL catalog/article numbers visible
   - Look for patterns like: "Cat. No. S1031101", "#Cat. No. S1013210", "Art. No. F1005451BM"
   - These are CRITICAL for identification — never skip them
   - Some products have multiple codes (different colors/variants) — capture each

4. COLOR / MATERIAL VARIANTS:
   - If a product is shown in multiple colors (e.g., Snow White ₹16,990 / Ivory ₹20,560)
   - Create ONE row per color-price combination
   - Include the color/finish in the appropriate field

5. COMPONENT SETS:
   - Some products list components AND a set price
   - Example: EWC ₹6,570 + Cistern ₹5,230 + Seat Cover ₹860 = Set ₹12,660
   - Create a row for the SET (with set price)
   - Create individual rows ONLY if they have separate catalog/product codes

6. SPECIFICATIONS:
   - Extract dimensions (e.g., "655 x 350 x 735 mm")
   - Trap type (S Trap / P Trap), trap size
   - Flush type, seat cover type, finish
   - Feature icons/descriptions if readable

7. PAGE-LEVEL CATEGORY:
   - If a page has a category header (e.g., "ONE PIECE EWCs WITH SEAT COVER")
   - Use it as the category for all products on that page
   - Sub-headers become sub_category

8. INDEX / TOC / COVER / lifestyle-only pages: return []

9. Prices: numeric only, no currency symbols (₹, Rs., etc.)
10. If a field is not applicable, use null
11. Include page_number for every product
12. Return ONLY a valid JSON array. No markdown fences, no explanation.`;
}

// ─── Mixed catalog prompt ────────────────────────────────────────────────────
// Handles catalogs with both tabular and image sections

function mixedPrompt(ctx: PromptContext): string {
  const columnDesc = buildColumnDescription(ctx.columns);
  const contextNote = ctx.category_context
    ? `\nPrevious category context: ${ctx.category_context}\nContinue with this context if the current pages don't specify a new category.\n`
    : "";

  // Check if these specific pages are tabular or image-based
  const pageHints = ctx.page_classifications
    ?.map((p) => {
      if (p.has_table_structure) return `Page ${p.page_number}: likely tabular/price grid`;
      if (p.has_product_codes) return `Page ${p.page_number}: likely image-based with product codes`;
      return null;
    })
    .filter(Boolean);

  const pageHintText = pageHints && pageHints.length > 0
    ? `\nPage type hints (use these to guide your extraction approach):\n${pageHints.join("\n")}\n`
    : "";

  return `You are extracting product data from a MIXED FORMAT catalog by ${ctx.company_name}.
This catalog contains BOTH tabular price grids AND image-based product pages.

The table schema is:
${columnDesc}
${contextNote}${pageHintText}
Extract ALL products. Return a JSON array of objects, one per product.

CRITICAL: This catalog has mixed formats. Adapt your approach per page:

=== FOR TABULAR PAGES (price grids, size tables) ===
- Each cell with a price = a SEPARATE row
- Multi-section pages: each section independently
- Size variants: each size with a price = one row
- Sparse tables: only create rows for filled cells
- Capture rate notes as price_unit

=== FOR IMAGE-BASED PAGES (product photos) ===
- Each product with its own photo = a separate row
- Include series/collection name + model name
- Extract ALL catalog/product codes
- Color/material variants: one row per color-price combo
- Component sets: row for set + individual rows if separate codes
- Extract dimensions, specs, features

=== GENERAL RULES ===
- INDEX / TOC / COVER / lifestyle pages: return []
- Include page_number for every product
- Prices: numeric only, no currency symbols
- If a field is not applicable, use null
- Return ONLY a valid JSON array. No markdown fences, no explanation.`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build the extraction prompt based on catalog type and context.
 */
export function buildExtractionPrompt(ctx: PromptContext): string {
  switch (ctx.catalog_type) {
    case "tabular":
      return tabularPrompt(ctx);
    case "image_based":
      return imageBasedPrompt(ctx);
    case "mixed":
    default:
      return mixedPrompt(ctx);
  }
}

/**
 * Get the recommended max_tokens for extraction based on catalog type and page count.
 */
export function getExtractionMaxTokens(catalogType: CatalogType, pageCount: number): number {
  // Dense tabular catalogs need more output tokens
  if (catalogType === "tabular") {
    return pageCount === 1 ? 32000 : 64000;
  }
  // Image-based catalogs typically have fewer products per page
  if (catalogType === "image_based") {
    return pageCount <= 2 ? 16000 : 32000;
  }
  // Mixed — be generous
  return 64000;
}
