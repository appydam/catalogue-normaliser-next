import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import {
  normalizeCompanyName,
  normalizeCatalogName,
  normalizeFileName,
  stringSimilarity,
  type FingerprintMatch,
  type FingerprintCheckRequest,
} from "@/lib/fingerprint";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as FingerprintCheckRequest;
  const { file_hash, content_hash, file_name, page_count } = body;

  if (!file_hash) {
    return NextResponse.json({ error: "file_hash is required" }, { status: 400 });
  }

  const sb = getSupabase();
  const matches: FingerprintMatch[] = [];

  // ── Signal 1: Exact file hash match (100% confidence) ───────────────────
  const { data: exactMatches } = await sb
    .from("catalog_fingerprints")
    .select("master_catalog_id, file_hash_sha256, page_count, company_name_normalized, catalog_name_normalized")
    .eq("file_hash_sha256", file_hash);

  if (exactMatches && exactMatches.length > 0) {
    for (const fp of exactMatches) {
      const catalog = await fetchCatalogInfo(sb, fp.master_catalog_id);
      if (catalog) {
        matches.push({
          master_catalog_id: fp.master_catalog_id,
          confidence: 100,
          match_type: "exact",
          match_details: "Identical PDF file (byte-for-byte match)",
          catalog_name: catalog.catalog_name,
          company_name: catalog.company_name,
          total_products: catalog.total_products ?? 0,
          version: catalog.version ?? 1,
          processing_status: catalog.processing_status,
        });
      }
    }
  }

  // If exact match found, return immediately
  if (matches.length > 0) {
    return NextResponse.json({
      matches,
      best_match: matches[0],
    });
  }

  // ── Signal 2: Content hash match (95% confidence) ──────────────────────
  if (content_hash) {
    const { data: contentMatches } = await sb
      .from("catalog_fingerprints")
      .select("master_catalog_id, content_hash, company_name_normalized, catalog_name_normalized")
      .eq("content_hash", content_hash);

    if (contentMatches && contentMatches.length > 0) {
      for (const fp of contentMatches) {
        const catalog = await fetchCatalogInfo(sb, fp.master_catalog_id);
        if (catalog) {
          matches.push({
            master_catalog_id: fp.master_catalog_id,
            confidence: 95,
            match_type: "content",
            match_details: "Same content detected (re-exported or re-scanned PDF)",
            catalog_name: catalog.catalog_name,
            company_name: catalog.company_name,
            total_products: catalog.total_products ?? 0,
            version: catalog.version ?? 1,
            processing_status: catalog.processing_status,
          });
        }
      }
    }
  }

  if (matches.length > 0) {
    matches.sort((a, b) => b.confidence - a.confidence);
    return NextResponse.json({ matches, best_match: matches[0] });
  }

  // ── Signal 3: Company + catalog name similarity (60-85%) ───────────────
  const normalizedFileName = normalizeFileName(file_name);

  // Get all fingerprints and check for similarity
  const { data: allFingerprints } = await sb
    .from("catalog_fingerprints")
    .select("master_catalog_id, company_name_normalized, catalog_name_normalized, page_count, file_name_normalized");

  if (allFingerprints && allFingerprints.length > 0) {
    for (const fp of allFingerprints) {
      const companySim = stringSimilarity(
        normalizeCompanyName(file_name),
        fp.company_name_normalized
      );

      // Also check filename similarity against stored catalog name
      const catalogNameSim = stringSimilarity(normalizedFileName, fp.catalog_name_normalized);
      const fileNameSim = stringSimilarity(normalizedFileName, fp.file_name_normalized || "");

      // Only consider if company or catalog name has some similarity
      const bestNameSim = Math.max(catalogNameSim, fileNameSim);

      if (companySim > 0.3 || bestNameSim > 0.4) {
        let confidence = 50;
        confidence += companySim * 15;
        confidence += bestNameSim * 15;

        // Page count similarity bonus
        if (fp.page_count && page_count) {
          const pageDelta = Math.abs(fp.page_count - page_count);
          if (pageDelta < 10) confidence += 5;
          if (pageDelta < 3) confidence += 5;
        }

        confidence = Math.min(Math.round(confidence), 85);

        if (confidence >= 60) {
          const catalog = await fetchCatalogInfo(sb, fp.master_catalog_id);
          if (catalog) {
            matches.push({
              master_catalog_id: fp.master_catalog_id,
              confidence,
              match_type: confidence >= 75 ? "version_update" : "similar",
              match_details:
                confidence >= 75
                  ? "Likely an updated version of an existing catalog"
                  : "Similar catalog found in the system",
              catalog_name: catalog.catalog_name,
              company_name: catalog.company_name,
              total_products: catalog.total_products ?? 0,
              version: catalog.version ?? 1,
              processing_status: catalog.processing_status,
            });
          }
        }
      }
    }
  }

  matches.sort((a, b) => b.confidence - a.confidence);

  return NextResponse.json({
    matches: matches.slice(0, 5), // Top 5 matches
    best_match: matches.length > 0 ? matches[0] : null,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchCatalogInfo(sb: any, catalogId: string) {
  const { data } = await sb
    .from("master_catalogs")
    .select("company_name, catalog_name, total_products, version, processing_status")
    .eq("id", catalogId)
    .single();
  return data;
}
