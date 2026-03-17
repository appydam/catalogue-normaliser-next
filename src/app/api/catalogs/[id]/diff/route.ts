import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { computeCatalogDiff } from "@/lib/catalog-diff";
import { isValidUUID } from "@/lib/types";

export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid catalog ID" }, { status: 400 });
  }

  const sb = getSupabase();

  // Fetch the current catalog
  const { data: currentCatalog, error: currentError } = await sb
    .from("master_catalogs")
    .select("*")
    .eq("id", id)
    .single();

  if (currentError || !currentCatalog) {
    return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
  }

  if (!currentCatalog.parent_catalog_id) {
    return NextResponse.json(
      { error: "No previous version to compare" },
      { status: 404 }
    );
  }

  // Fetch the parent catalog
  const { data: parentCatalog, error: parentError } = await sb
    .from("master_catalogs")
    .select("*")
    .eq("id", currentCatalog.parent_catalog_id)
    .single();

  if (parentError || !parentCatalog) {
    return NextResponse.json(
      { error: "Parent catalog not found" },
      { status: 404 }
    );
  }

  // Fetch products from both catalogs using query_sql RPC
  const oldTableName = parentCatalog.table_name;
  const newTableName = currentCatalog.table_name;

  const [oldResult, newResult] = await Promise.all([
    sb.rpc("query_sql", {
      query: `SELECT * FROM "${oldTableName}" WHERE catalog_id = '${parentCatalog.id}' ORDER BY id`,
    }),
    sb.rpc("query_sql", {
      query: `SELECT * FROM "${newTableName}" WHERE catalog_id = '${currentCatalog.id}' ORDER BY id`,
    }),
  ]);

  if (oldResult.error) {
    return NextResponse.json(
      { error: `Failed to fetch old catalog products: ${oldResult.error.message}` },
      { status: 500 }
    );
  }

  if (newResult.error) {
    return NextResponse.json(
      { error: `Failed to fetch new catalog products: ${newResult.error.message}` },
      { status: 500 }
    );
  }

  const oldProducts = Array.isArray(oldResult.data) ? oldResult.data : [];
  const newProducts = Array.isArray(newResult.data) ? newResult.data : [];

  // Run the diff engine
  const diff = computeCatalogDiff(
    oldProducts as Record<string, unknown>[],
    newProducts as Record<string, unknown>[]
  );

  return NextResponse.json({
    current_catalog: {
      id: currentCatalog.id,
      catalog_name: currentCatalog.catalog_name,
      company_name: currentCatalog.company_name,
      version: currentCatalog.version,
      total_products: currentCatalog.total_products,
      created_at: currentCatalog.created_at,
    },
    parent_catalog: {
      id: parentCatalog.id,
      catalog_name: parentCatalog.catalog_name,
      company_name: parentCatalog.company_name,
      version: parentCatalog.version,
      total_products: parentCatalog.total_products,
      created_at: parentCatalog.created_at,
    },
    summary: {
      total_matched: diff.matched.length,
      total_added: diff.added.length,
      total_removed: diff.removed.length,
      price_changes: diff.priceChanges,
    },
    matched: diff.matched,
    added: diff.added,
    removed: diff.removed,
  });
}
