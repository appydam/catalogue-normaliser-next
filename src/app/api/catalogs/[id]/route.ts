import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { dropDynamicTable } from "@/lib/schema-manager";

// GET /api/catalogs/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sb = getSupabase();
  const { data, error } = await sb
    .from("catalogs")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data)
    return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
  return NextResponse.json(data);
}

// DELETE /api/catalogs/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sb = getSupabase();

  const { data: catalog } = await sb
    .from("catalogs")
    .select("table_name")
    .eq("id", id)
    .single();

  if (!catalog)
    return NextResponse.json({ error: "Catalog not found" }, { status: 404 });

  await sb.from("product_search_index").delete().eq("catalog_id", id);
  await dropDynamicTable(catalog.table_name);
  await sb.from("catalogs").delete().eq("id", id);

  return NextResponse.json({ message: "Deleted" });
}
