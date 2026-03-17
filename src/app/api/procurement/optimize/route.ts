import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { escapeSQLString } from "@/lib/types";

export const maxDuration = 60;

interface CatalogRow {
  id: string;
  company_name: string;
  catalog_name: string;
}

interface ProductRow {
  catalog_id: string;
  product_name: string | null;
  category: string | null;
  sub_category: string | null;
  price: number | null;
  company_name: string;
  catalog_name: string;
}

interface SupplierInfo {
  company_name: string;
  catalog_name: string;
  catalog_id: string;
  avg_price: number;
  product_count: number;
  cheapest_count: number;
}

interface CategoryGroup {
  category: string;
  sub_category: string;
  product_count: number;
  suppliers: SupplierInfo[];
  potential_savings: number;
  best_supplier: string;
}

/**
 * Compute word-overlap similarity between two product names.
 * Returns a value between 0 and 1.
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
 * POST /api/procurement/optimize
 *
 * Analyzes all completed catalogs to find the best supplier per product category.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const categoryFilter: string | undefined = body.category;

  const sb = getSupabase();

  // 1. Fetch all completed catalogs
  const { data: catalogs, error: catError } = await sb
    .from("master_catalogs")
    .select("id, company_name, catalog_name")
    .eq("processing_status", "completed");

  if (catError) {
    return NextResponse.json({ error: catError.message }, { status: 500 });
  }

  const completedCatalogs = (catalogs ?? []) as CatalogRow[];

  if (completedCatalogs.length < 2) {
    return NextResponse.json({
      categories: [],
      total_catalogs_analyzed: completedCatalogs.length,
      total_products_compared: 0,
      total_potential_savings: 0,
      message: "Need at least 2 completed catalogs to compare suppliers.",
    });
  }

  // 2. Fetch all products with prices from product_search_index
  let categoryCondition = "";
  if (categoryFilter) {
    const escaped = escapeSQLString(categoryFilter);
    categoryCondition = `AND (psi.category ILIKE '%${escaped}%' OR psi.sub_category ILIKE '%${escaped}%')`;
  }

  const productSql = `
    SELECT
      psi.catalog_id,
      psi.product_name,
      psi.category,
      psi.sub_category,
      psi.price,
      c.company_name,
      c.catalog_name
    FROM product_search_index psi
    JOIN master_catalogs c ON c.id = psi.catalog_id
    WHERE c.processing_status = 'completed'
      AND psi.price IS NOT NULL
      AND psi.price > 0
      ${categoryCondition}
    ORDER BY psi.category, psi.sub_category, psi.product_name
  `;

  const { data: productData, error: prodError } = await sb.rpc("query_sql", {
    query: productSql,
  });

  if (prodError) {
    return NextResponse.json({ error: prodError.message }, { status: 500 });
  }

  const products = (Array.isArray(productData) ? productData : []) as ProductRow[];

  if (products.length === 0) {
    return NextResponse.json({
      categories: [],
      total_catalogs_analyzed: completedCatalogs.length,
      total_products_compared: 0,
      total_potential_savings: 0,
      message: "No products with prices found across catalogs.",
    });
  }

  // 3. Group products by category + sub_category
  const groupMap = new Map<
    string,
    { category: string; sub_category: string; products: ProductRow[] }
  >();

  for (const p of products) {
    const cat = p.category || "Uncategorized";
    const subCat = p.sub_category || "General";
    const key = `${cat}|||${subCat}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, { category: cat, sub_category: subCat, products: [] });
    }
    groupMap.get(key)!.products.push(p);
  }

  // 4. For each category group, analyze suppliers
  const categoryResults: CategoryGroup[] = [];
  let totalProductsCompared = 0;
  let totalPotentialSavings = 0;

  for (const [, group] of groupMap) {
    // Group products by supplier (catalog_id)
    const supplierProducts = new Map<
      string,
      {
        company_name: string;
        catalog_name: string;
        catalog_id: string;
        products: ProductRow[];
      }
    >();

    for (const p of group.products) {
      if (!supplierProducts.has(p.catalog_id)) {
        supplierProducts.set(p.catalog_id, {
          company_name: p.company_name,
          catalog_name: p.catalog_name,
          catalog_id: p.catalog_id,
          products: [],
        });
      }
      supplierProducts.get(p.catalog_id)!.products.push(p);
    }

    // Skip categories that only have one supplier
    if (supplierProducts.size < 2) continue;

    // Find similar products across suppliers and count cheapest
    // Build a list of "product clusters" (similar products across suppliers)
    const allProducts = group.products.filter(
      (p) => p.product_name && p.price != null
    );

    // Simple approach: for each product from one supplier, find best match from other suppliers
    // Track which supplier is cheapest for each matched product pair
    const cheapestCounts = new Map<string, number>();
    const matchedProductCount = new Set<string>();

    // Initialize cheapest counts
    for (const [catalogId] of supplierProducts) {
      cheapestCounts.set(catalogId, 0);
    }

    // For each pair of suppliers, compare similar products
    const supplierEntries = Array.from(supplierProducts.entries());
    const productClusters: {
      name: string;
      prices: { catalog_id: string; price: number }[];
    }[] = [];

    // Build clusters by matching products across suppliers using name similarity
    const assigned = new Set<string>();

    for (const product of allProducts) {
      const productKey = `${product.catalog_id}:${product.product_name}`;
      if (assigned.has(productKey)) continue;

      const cluster: {
        name: string;
        prices: { catalog_id: string; price: number }[];
      } = {
        name: product.product_name!,
        prices: [{ catalog_id: product.catalog_id, price: product.price! }],
      };
      assigned.add(productKey);

      // Find similar products from OTHER suppliers
      for (const other of allProducts) {
        if (other.catalog_id === product.catalog_id) continue;
        const otherKey = `${other.catalog_id}:${other.product_name}`;
        if (assigned.has(otherKey)) continue;

        if (nameSimilarity(product.product_name!, other.product_name!) >= 0.5) {
          cluster.prices.push({
            catalog_id: other.catalog_id,
            price: other.price!,
          });
          assigned.add(otherKey);
        }
      }

      if (cluster.prices.length >= 2) {
        productClusters.push(cluster);
      }
    }

    // Count cheapest wins per supplier from clusters
    let categorySavings = 0;
    for (const cluster of productClusters) {
      const sorted = [...cluster.prices].sort((a, b) => a.price - b.price);
      const cheapestId = sorted[0].catalog_id;
      cheapestCounts.set(
        cheapestId,
        (cheapestCounts.get(cheapestId) ?? 0) + 1
      );
      // Potential savings = difference between most expensive and cheapest
      if (sorted.length >= 2) {
        categorySavings += sorted[sorted.length - 1].price - sorted[0].price;
      }
      for (const p of cluster.prices) {
        matchedProductCount.add(`${p.catalog_id}:${cluster.name}`);
      }
    }

    // Build supplier info for this category
    const suppliers: SupplierInfo[] = [];
    for (const [catalogId, info] of supplierProducts) {
      const pricesArr = info.products
        .filter((p) => p.price != null && p.price > 0)
        .map((p) => p.price!);
      const avgPrice =
        pricesArr.length > 0
          ? Math.round(
              pricesArr.reduce((s, v) => s + v, 0) / pricesArr.length
            )
          : 0;

      suppliers.push({
        company_name: info.company_name,
        catalog_name: info.catalog_name,
        catalog_id: catalogId,
        avg_price: avgPrice,
        product_count: info.products.length,
        cheapest_count: cheapestCounts.get(catalogId) ?? 0,
      });
    }

    // Sort suppliers: most "cheapest wins" first, then by avg price
    suppliers.sort((a, b) => {
      if (b.cheapest_count !== a.cheapest_count)
        return b.cheapest_count - a.cheapest_count;
      return a.avg_price - b.avg_price;
    });

    const bestSupplier = suppliers[0]?.company_name ?? "N/A";
    totalProductsCompared += matchedProductCount.size;
    totalPotentialSavings += categorySavings;

    categoryResults.push({
      category: group.category,
      sub_category: group.sub_category,
      product_count: group.products.length,
      suppliers,
      potential_savings: Math.round(categorySavings),
      best_supplier: bestSupplier,
    });
  }

  // Sort categories by potential savings descending
  categoryResults.sort((a, b) => b.potential_savings - a.potential_savings);

  return NextResponse.json({
    categories: categoryResults,
    total_catalogs_analyzed: completedCatalogs.length,
    total_products_compared: totalProductsCompared,
    total_potential_savings: Math.round(totalPotentialSavings),
  });
}
