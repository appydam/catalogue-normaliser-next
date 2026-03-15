import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const maxDuration = 10;

/**
 * GET /api/search/suggestions
 *
 * Returns dynamic search suggestions based on actual products in the database.
 * Pulls top categories and sample product names to build relevant suggestions.
 */
export async function GET() {
  const sb = getSupabase();

  const [categoriesResult, productsResult] = await Promise.all([
    // Top categories by product count
    sb.rpc("query_sql", {
      query: `
        SELECT category, COUNT(*)::int as cnt
        FROM product_search_index
        WHERE category IS NOT NULL AND category != ''
        GROUP BY category
        ORDER BY cnt DESC
        LIMIT 8
      `,
    }),
    // Sample product names (distinct, non-null, with good variety)
    sb.rpc("query_sql", {
      query: `
        SELECT DISTINCT ON (category) product_name, category, price
        FROM product_search_index
        WHERE product_name IS NOT NULL AND product_name != '' AND category IS NOT NULL
        ORDER BY category, price DESC NULLS LAST
        LIMIT 8
      `,
    }),
  ]);

  const categories: string[] = Array.isArray(categoriesResult.data)
    ? categoriesResult.data.map((r: { category: string }) => r.category)
    : [];

  const products: { product_name: string; category: string; price: number | null }[] =
    Array.isArray(productsResult.data) ? productsResult.data : [];

  // Build suggestions from real data
  const suggestions: string[] = [];

  // Add category-based suggestions (e.g., "wall hung EWC", "PVC pipes")
  for (const cat of categories.slice(0, 3)) {
    if (cat && !suggestions.includes(cat)) {
      suggestions.push(cat);
    }
  }

  // Add product-name-based suggestions
  for (const p of products) {
    if (suggestions.length >= 6) break;
    // Use first 4-5 words of product name for a concise suggestion
    const words = p.product_name.split(/\s+/).slice(0, 5).join(" ");
    if (words && !suggestions.some((s) => s.toLowerCase() === words.toLowerCase())) {
      suggestions.push(words);
    }
  }

  // If we still have fewer than 3, add more categories
  if (suggestions.length < 3) {
    for (const cat of categories) {
      if (suggestions.length >= 5) break;
      if (!suggestions.includes(cat)) {
        suggestions.push(cat);
      }
    }
  }

  return NextResponse.json({ suggestions });
}
