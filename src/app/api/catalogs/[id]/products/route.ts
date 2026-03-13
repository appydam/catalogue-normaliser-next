import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: catalogId } = await params;
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("page_size") ?? "50")));
  const sb = getSupabase();

  const { data: catalog } = await sb
    .from("catalogs")
    .select("table_name, processing_status, schema_definition")
    .eq("id", catalogId)
    .single();

  if (!catalog) {
    return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
  }
  if (catalog.processing_status !== "completed") {
    return NextResponse.json(
      { error: `Catalog is still ${catalog.processing_status}` },
      { status: 400 }
    );
  }

  const offset = (page - 1) * pageSize;
  const { data, count, error } = await sb
    .from(catalog.table_name)
    .select("*", { count: "exact" })
    .eq("catalog_id", catalogId)
    .range(offset, offset + pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    catalog_id: catalogId,
    page,
    page_size: pageSize,
    total: count ?? 0,
    products: data ?? [],
    schema: catalog.schema_definition,
  });
}
