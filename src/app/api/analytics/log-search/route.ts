import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { escapeSQLString } from "@/lib/types";

let tableEnsured = false;

/**
 * Ensure the search_logs table exists (idempotent, runs once per cold start).
 */
async function ensureTable() {
  if (tableEnsured) return;
  const sb = getSupabase();
  await sb.rpc("exec_sql", {
    query: `
      CREATE TABLE IF NOT EXISTS search_logs (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        query TEXT NOT NULL,
        results_count INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'web',
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_search_logs_created_at ON search_logs (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_search_logs_query ON search_logs (lower(trim(query)));
    `,
  });
  tableEnsured = true;
}

/**
 * POST /api/analytics/log-search
 *
 * Logs a search event for demand intelligence analytics.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const resultsCount = typeof body.results_count === "number" ? body.results_count : 0;
    const source = typeof body.source === "string" ? body.source : "web";

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    await ensureTable();

    const sb = getSupabase();
    await sb.rpc("exec_sql", {
      query: `
        INSERT INTO search_logs (query, results_count, source)
        VALUES ('${escapeSQLString(query)}', ${Math.max(0, Math.floor(resultsCount))}, '${escapeSQLString(source)}')
      `,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[log-search] Error:", err);
    return NextResponse.json({ success: false, error: "Failed to log search" }, { status: 500 });
  }
}
