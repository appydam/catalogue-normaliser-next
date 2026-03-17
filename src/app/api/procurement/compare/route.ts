import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { escapeSQLString } from "@/lib/types";

export const maxDuration = 60;

interface ProductRow {
  id: string;
  catalog_id: string;
  product_name: string | null;
  category: string | null;
  sub_category: string | null;
  description: string | null;
  price: number | null;
  price_unit: string | null;
  company_name: string;
  catalog_name: string;
}

interface ProductComparison {
  catalog_id: string;
  product_name: string;
  company_name: string;
  catalog_name: string;
  price: number;
  price_unit: string | null;
  diff_from_cheapest: number;
  is_cheapest: boolean;
}

interface ProductGroup {
  representative_name: string;
  variants: ProductComparison[];
  cheapest_price: number;
  most_expensive_price: number;
  savings: number;
}

/**
 * Compute word-overlap similarity between two product names.
 */
function nameSimilarity(a: string, b: string): number {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2);

  const wordsA = normalize(a);
  const wordsB = normalize(b);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const setB = new Set(wordsB);
  const overlap = wordsA.filter((w) => setB.has(w)).length;
  return (2 * overlap) / (wordsA.length + wordsB.length);
}

/**
 * POST /api/procurement/compare
 *
 * Returns detailed product-level comparison across all suppliers
 * for a given category (and optional sub_category).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { category, sub_category } = body as {
    category?: string;
    sub_category?: string;
  };

  if (!category) {
    return NextResponse.json(
      { error: "category is required" },
      { status: 400 }
    );
  }

  const sb = getSupabase();

  const escapedCategory = escapeSQLString(category);
  let subCategoryCondition = "";
  if (sub_category) {
    const escapedSub = escapeSQLString(sub_category);
    subCategoryCondition = `AND psi.sub_category = '${escapedSub}'`;
  }

  const sql = `
    SELECT
      psi.id,
      psi.catalog_id,
      psi.product_name,
      psi.category,
      psi.sub_category,
      psi.description,
      psi.price,
      psi.price_unit,
      c.company_name,
      c.catalog_name
    FROM product_search_index psi
    JOIN master_catalogs c ON c.id = psi.catalog_id
    WHERE c.processing_status = 'completed'
      AND psi.category = '${escapedCategory}'
      ${subCategoryCondition}
      AND psi.price IS NOT NULL
      AND psi.price > 0
    ORDER BY psi.product_name, psi.price
  `;

  const { data, error } = await sb.rpc("query_sql", { query: sql });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const products = (Array.isArray(data) ? data : []) as ProductRow[];

  if (products.length === 0) {
    return NextResponse.json({
      category,
      sub_category: sub_category ?? null,
      product_groups: [],
      total_products: 0,
    });
  }

  // Cluster products by name similarity
  const assigned = new Set<number>();
  const groups: ProductGroup[] = [];

  for (let i = 0; i < products.length; i++) {
    if (assigned.has(i)) continue;
    const p = products[i];
    if (!p.product_name || !p.price) continue;

    const cluster: ProductRow[] = [p];
    assigned.add(i);

    for (let j = i + 1; j < products.length; j++) {
      if (assigned.has(j)) continue;
      const q = products[j];
      if (!q.product_name || !q.price) continue;

      // Products from same supplier should not be grouped unless they're truly duplicates
      if (
        q.catalog_id === p.catalog_id &&
        nameSimilarity(p.product_name, q.product_name) < 0.8
      ) {
        continue;
      }

      if (nameSimilarity(p.product_name, q.product_name) >= 0.5) {
        cluster.push(q);
        assigned.add(j);
      }
    }

    // Only include groups with products from multiple suppliers
    const uniqueSuppliers = new Set(cluster.map((x) => x.catalog_id));
    if (uniqueSuppliers.size < 2) continue;

    const prices = cluster.map((x) => x.price!);
    const cheapest = Math.min(...prices);
    const mostExpensive = Math.max(...prices);

    const variants: ProductComparison[] = cluster
      .map((x) => ({
        catalog_id: x.catalog_id,
        product_name: x.product_name!,
        company_name: x.company_name,
        catalog_name: x.catalog_name,
        price: x.price!,
        price_unit: x.price_unit ?? null,
        diff_from_cheapest: Math.round(x.price! - cheapest),
        is_cheapest: x.price === cheapest,
      }))
      .sort((a, b) => a.price - b.price);

    groups.push({
      representative_name: p.product_name,
      variants,
      cheapest_price: cheapest,
      most_expensive_price: mostExpensive,
      savings: Math.round(mostExpensive - cheapest),
    });
  }

  // Sort groups by savings descending
  groups.sort((a, b) => b.savings - a.savings);

  return NextResponse.json({
    category,
    sub_category: sub_category ?? null,
    product_groups: groups,
    total_products: products.length,
  });
}
