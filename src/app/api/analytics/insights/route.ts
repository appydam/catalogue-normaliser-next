import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

const PERIOD_MAP: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * GET /api/analytics/insights?period=30d
 *
 * Returns demand intelligence analytics from search_logs.
 */
export async function GET(req: NextRequest) {
  try {
    const periodParam = req.nextUrl.searchParams.get("period") ?? "30d";
    const days = PERIOD_MAP[periodParam] ?? 30;
    const period = Object.keys(PERIOD_MAP).includes(periodParam) ? periodParam : "30d";

    const sb = getSupabase();

    // Check if the table exists — if not, return empty data
    const { data: tableCheck } = await sb.rpc("query_sql", {
      query: `
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'search_logs'
        ) AS table_exists
      `,
    });

    const exists = Array.isArray(tableCheck) && tableCheck.length > 0 && tableCheck[0].table_exists === true;
    if (!exists) {
      return NextResponse.json({
        period,
        total_searches: 0,
        unique_queries: 0,
        zero_result_searches: [],
        top_searches: [],
        trending_categories: [],
        search_volume_by_day: [],
      });
    }

    const intervalClause = `created_at >= now() - interval '${days} days'`;

    // Run all queries in parallel
    const [summaryResult, zeroResultsResult, topSearchesResult, volumeResult, trendingResult] =
      await Promise.all([
        // Summary counts
        sb.rpc("query_sql", {
          query: `
            SELECT
              COUNT(*)::int AS total_searches,
              COUNT(DISTINCT lower(trim(query)))::int AS unique_queries
            FROM search_logs
            WHERE ${intervalClause}
          `,
        }),

        // Zero-result searches (products not in catalog)
        sb.rpc("query_sql", {
          query: `
            SELECT
              lower(trim(query)) AS query,
              COUNT(*)::int AS count,
              MAX(created_at)::date::text AS last_searched
            FROM search_logs
            WHERE ${intervalClause} AND results_count = 0
            GROUP BY lower(trim(query))
            ORDER BY count DESC
            LIMIT 20
          `,
        }),

        // Top searches
        sb.rpc("query_sql", {
          query: `
            SELECT
              lower(trim(query)) AS query,
              COUNT(*)::int AS count,
              ROUND(AVG(results_count))::int AS avg_results
            FROM search_logs
            WHERE ${intervalClause}
            GROUP BY lower(trim(query))
            ORDER BY count DESC
            LIMIT 15
          `,
        }),

        // Search volume by day
        sb.rpc("query_sql", {
          query: `
            SELECT
              created_at::date::text AS date,
              COUNT(*)::int AS count
            FROM search_logs
            WHERE ${intervalClause}
            GROUP BY created_at::date
            ORDER BY created_at::date ASC
          `,
        }),

        // Trending categories — extract common word patterns from recent searches
        // Compare the last half of the period against the first half
        sb.rpc("query_sql", {
          query: `
            WITH recent AS (
              SELECT lower(trim(query)) AS q
              FROM search_logs
              WHERE created_at >= now() - interval '${Math.floor(days / 2)} days'
            ),
            older AS (
              SELECT lower(trim(query)) AS q
              FROM search_logs
              WHERE created_at >= now() - interval '${days} days'
                AND created_at < now() - interval '${Math.floor(days / 2)} days'
            ),
            recent_words AS (
              SELECT unnest(string_to_array(q, ' ')) AS word, COUNT(*)::int AS cnt
              FROM recent
              GROUP BY word
              HAVING LENGTH(unnest(string_to_array(q, ' '))) >= 3
            ),
            older_words AS (
              SELECT unnest(string_to_array(q, ' ')) AS word, COUNT(*)::int AS cnt
              FROM older
              GROUP BY word
              HAVING LENGTH(unnest(string_to_array(q, ' '))) >= 3
            )
            SELECT
              rw.word AS category,
              rw.cnt AS search_count,
              CASE
                WHEN COALESCE(ow.cnt, 0) = 0 THEN 100
                ELSE ROUND(((rw.cnt - ow.cnt)::numeric / ow.cnt) * 100)::int
              END AS growth_pct
            FROM recent_words rw
            LEFT JOIN older_words ow ON ow.word = rw.word
            WHERE rw.cnt >= 2
            ORDER BY growth_pct DESC, rw.cnt DESC
            LIMIT 10
          `,
        }),
      ]);

    const summary =
      Array.isArray(summaryResult.data) && summaryResult.data.length > 0
        ? summaryResult.data[0]
        : { total_searches: 0, unique_queries: 0 };

    return NextResponse.json({
      period,
      total_searches: summary.total_searches ?? 0,
      unique_queries: summary.unique_queries ?? 0,
      zero_result_searches: Array.isArray(zeroResultsResult.data) ? zeroResultsResult.data : [],
      top_searches: Array.isArray(topSearchesResult.data) ? topSearchesResult.data : [],
      trending_categories: Array.isArray(trendingResult.data) ? trendingResult.data : [],
      search_volume_by_day: Array.isArray(volumeResult.data) ? volumeResult.data : [],
    });
  } catch (err) {
    console.error("[insights] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch insights" },
      { status: 500 }
    );
  }
}
