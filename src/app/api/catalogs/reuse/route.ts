import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

/**
 * POST /api/catalogs/reuse
 *
 * Returns catalog data for reuse (no new processing needed).
 * In Phase 1 (no auth), this simply fetches the existing catalog.
 * In Phase 2 (with auth), this will also create a user_catalog link.
 */
export async function POST(req: NextRequest) {
  const { master_catalog_id } = await req.json();

  if (!master_catalog_id) {
    return NextResponse.json({ error: "master_catalog_id is required" }, { status: 400 });
  }

  const sb = getSupabase();

  const { data: catalog, error } = await sb
    .from("master_catalogs")
    .select("*")
    .eq("id", master_catalog_id)
    .single();

  if (error || !catalog) {
    return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
  }

  if (catalog.processing_status !== "completed") {
    return NextResponse.json(
      { error: `Catalog is still ${catalog.processing_status}. Cannot reuse.` },
      { status: 400 }
    );
  }

  return NextResponse.json({
    catalog_id: catalog.id,
    catalog_name: catalog.catalog_name,
    company_name: catalog.company_name,
    total_products: catalog.total_products,
    reused: true,
  });
}
