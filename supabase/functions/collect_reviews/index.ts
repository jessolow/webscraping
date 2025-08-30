// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

async function sha256(text: string) {
  const buf = new TextEncoder().encode(text ?? "")
  const hash = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("")
}

type ReviewRow = {
  source: string
  platform_app_id: string
  review_id: string
  author_name: string | null
  author_hash: string | null
  rating: number | null
  title: string | null
  content: string | null
  posted_at: string | null
  thumbs_up: number | null
  data: unknown
}

async function insertBatch(supabase: any, rows: ReviewRow[]): Promise<{count: number, error?: string}> {
  if (!rows.length) return { count: 0 }
  const { error } = await supabase.from("raw_reviews").upsert(rows, { onConflict: "source,review_id", ignoreDuplicates: true })
  if (error) return { count: 0, error: error.message }
  return { count: rows.length }
}

async function collectAppStoreRSS(appId: string, countryCode: string): Promise<ReviewRow[]> {
  const rows: ReviewRow[] = []
  // Apple RSS: https://itunes.apple.com/{cc}/rss/customerreviews/page={n}/id={APPID}/sortby=mostrecent/json
  for (let page = 1; page <= 10; page++) {
    const url = `https://itunes.apple.com/${countryCode}/rss/customerreviews/page=${page}/id=${appId}/sortby=mostrecent/json`
    const res = await fetch(url)
    if (!res.ok) break
    const json = await res.json()
    const entries = json?.feed?.entry
    if (!entries || entries.length <= 1) break
    // First entry is the app, reviews start from index 1
    for (let i = 1; i < entries.length; i++) {
      const e = entries[i]
      const reviewId = e?.id?.label ?? `${e?.author?.name?.label}-${e?.updated?.label}`
      const author = e?.author?.name?.label ?? null
      const rating = Number(e?.['im:rating']?.label ?? e?.rating?.label ?? null) || null
      const title = e?.title?.label ?? null
      const content = e?.content?.label ?? e?.summary?.label ?? null
      const updated = e?.updated?.label ? new Date(e.updated.label).toISOString() : null
      rows.push({
        source: "app_store",
        platform_app_id: appId,
        review_id: String(reviewId),
        author_name: author,
        author_hash: await sha256(author ?? ""),
        rating,
        title,
        content,
        posted_at: updated,
        thumbs_up: 0,
        data: e
      })
    }
  }
  return rows
}

Deno.serve(async () => {
  const url = Deno.env.get("PROJECT_URL")
  const key = Deno.env.get("SERVICE_ROLE_KEY")
  if (!url || !key) {
    return new Response(JSON.stringify({ error: "Missing PROJECT_URL or SERVICE_ROLE_KEY" }), { status: 500 })
  }
  const supabase = createClient(url, key)

  const APP_STORE_APP_ID = "1541576007"
  const COUNTRY = "ph"

  // Collect (App Store only for Edge compatibility)
  const [asRows] = await Promise.all([
    collectAppStoreRSS(APP_STORE_APP_ID, COUNTRY).catch((e) => { console.error(e); return [] as ReviewRow[] })
  ])

  // Upsert in chunks to avoid payload size issues
  const chunkSize = 500
  let inserted = 0
  for (let i = 0; i < asRows.length; i += chunkSize) {
    const { count } = await insertBatch(supabase, asRows.slice(i, i + chunkSize))
    inserted += count
  }

  return new Response(JSON.stringify({ ok: true, inserted, sources: { app_store: asRows.length } }), { headers: { "Content-Type": "application/json" } })
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/collect_reviews' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json'

*/
