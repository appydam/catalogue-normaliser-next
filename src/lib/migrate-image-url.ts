/**
 * One-time migration: add image_url column to product_search_index.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */
import { getSupabase } from "./supabase";

export async function ensureImageUrlColumn(): Promise<void> {
  const sb = getSupabase();
  await sb.rpc("exec_sql", {
    query: `
      ALTER TABLE product_search_index
      ADD COLUMN IF NOT EXISTS image_url TEXT;
    `,
  });
}
