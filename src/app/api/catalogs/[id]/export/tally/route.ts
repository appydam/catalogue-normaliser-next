import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { generateTallyXML, type TallyFieldMapping, type TallyExportOptions } from "@/lib/tally-export";

const EXPORT_PAGE_SIZE = 200;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: catalogId } = await params;
  const { searchParams } = new URL(req.url);

  const mappingParam = searchParams.get("mapping");
  if (!mappingParam) {
    return NextResponse.json({ error: "Missing mapping parameter" }, { status: 400 });
  }

  let mapping: TallyFieldMapping;
  try {
    mapping = JSON.parse(mappingParam);
  } catch {
    return NextResponse.json({ error: "Invalid mapping JSON" }, { status: 400 });
  }

  if (!mapping.stockItemName || !mapping.parent || !mapping.category || !mapping.baseUnit || !mapping.rate) {
    return NextResponse.json(
      { error: "Mapping must include stockItemName, parent, category, baseUnit, and rate" },
      { status: 400 }
    );
  }

  const sb = getSupabase();

  const { data: catalog } = await sb
    .from("master_catalogs")
    .select("table_name, processing_status, schema_definition, catalog_name")
    .eq("id", catalogId)
    .single();

  if (!catalog) {
    return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
  }

  if (catalog.processing_status !== "completed" && catalog.processing_status !== "completed_with_warnings") {
    return NextResponse.json(
      { error: `Catalog is still ${catalog.processing_status}` },
      { status: 400 }
    );
  }

  const schemaColumns = (catalog.schema_definition as { columns: { name: string }[] })?.columns?.map((c) => c.name) ?? [];
  const allMappedFields = [
    mapping.stockItemName,
    mapping.parent,
    mapping.category,
    mapping.baseUnit,
    mapping.rate,
    mapping.hsnCode,
    mapping.gstRate,
  ].filter(Boolean) as string[];

  for (const field of allMappedFields) {
    if (!schemaColumns.includes(field)) {
      return NextResponse.json(
        { error: `Mapped field "${field}" does not exist in catalog schema` },
        { status: 400 }
      );
    }
  }

  const allProducts: Record<string, unknown>[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const offset = (page - 1) * EXPORT_PAGE_SIZE;
    const { data, error } = await sb
      .from(catalog.table_name)
      .select("*")
      .eq("catalog_id", catalogId)
      .range(offset, offset + EXPORT_PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (data && data.length > 0) {
      allProducts.push(...data);
      if (data.length < EXPORT_PAGE_SIZE) {
        hasMore = false;
      } else {
        page++;
      }
    } else {
      hasMore = false;
    }
  }

  const options: TallyExportOptions = {
    gstApplicable: searchParams.get("gst_applicable") !== "false",
    defaultStockGroup: searchParams.get("default_stock_group") || undefined,
    defaultCategory: searchParams.get("default_category") || undefined,
    defaultUnit: searchParams.get("default_unit") || undefined,
  };

  const xml = generateTallyXML(allProducts, mapping, options);
  const fileName = `${catalog.catalog_name || "catalog"}_tally_import.xml`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
