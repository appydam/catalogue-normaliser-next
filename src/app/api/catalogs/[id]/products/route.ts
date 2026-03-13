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
  const sortBy = searchParams.get("sort_by");
  const sortDir = searchParams.get("sort_dir") === "desc" ? false : true; // true = ascending
  const sb = getSupabase();

  const { data: catalog } = await sb
    .from("master_catalogs")
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

  // Validate sort column against schema to prevent injection
  const schemaColumns = (catalog.schema_definition as { columns: { name: string }[] })?.columns?.map((c) => c.name) ?? [];
  const safeSortBy = sortBy && schemaColumns.includes(sortBy) ? sortBy : null;

  let query = sb
    .from(catalog.table_name)
    .select("*", { count: "exact" })
    .eq("catalog_id", catalogId);

  if (safeSortBy) {
    query = query.order(safeSortBy, { ascending: sortDir });
  }

  const { data, count, error } = await query.range(offset, offset + pageSize - 1);

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
