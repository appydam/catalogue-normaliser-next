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
    .from("master_catalogs")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data)
    return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
  return NextResponse.json(data);
}

// PATCH /api/catalogs/[id] — update catalog name or company name
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const sb = getSupabase();

  const updates: Record<string, unknown> = {};
  if (typeof body.catalog_name === "string" && body.catalog_name.trim()) {
    updates.catalog_name = body.catalog_name.trim();
  }
  if (typeof body.company_name === "string" && body.company_name.trim()) {
    updates.company_name = body.company_name.trim();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await sb
    .from("master_catalogs")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
    .from("master_catalogs")
    .select("table_name")
    .eq("id", id)
    .single();

  if (!catalog)
    return NextResponse.json({ error: "Catalog not found" }, { status: 404 });

  await sb.from("product_search_index").delete().eq("catalog_id", id);
  await dropDynamicTable(catalog.table_name);
  await sb.from("master_catalogs").delete().eq("id", id);

  return NextResponse.json({ message: "Deleted" });
}
