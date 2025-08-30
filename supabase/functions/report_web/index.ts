// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

function html(body: string): Response {
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Credit Builder Feedback</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet"><style>body{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin-bottom:8px}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #ddd;padding:8px}th{text-align:left;background:#fafafa}code{background:#f4f4f4;padding:2px 4px;border-radius:4px}</style></head><body>${body}</body></html>`
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } })
}

Deno.serve(async () => {
  const url = Deno.env.get("PROJECT_URL")
  const key = Deno.env.get("SERVICE_ROLE_KEY")
  if (!url || !key) return html(`<p style="color:#b00">Missing PROJECT_URL or SERVICE_ROLE_KEY</p>`)
  const supabase = createClient(url, key)
  const [{ data: kpis }, { data: aspects }] = await Promise.all([
    supabase.from("v_kpis").select("*").single(),
    supabase.from("v_aspect_sentiment").select("*")
  ])
  const k = kpis || { total_with_stance: 0, liked: 0, disliked: 0 }
  const rows = (aspects || []).map((a: any) => `<tr><td>${a.aspect}</td><td>${a.liked_count}</td><td>${a.disliked_count}</td></tr>`).join("")
  const body = `<h1>Credit Builder Feedback</h1><p>Total with stance: <strong>${k.total_with_stance}</strong> · Liked: <strong>${k.liked}</strong> · Disliked: <strong>${k.disliked}</strong></p><table><thead><tr><th>Aspect</th><th>Liked</th><th>Disliked</th></tr></thead><tbody>${rows}</tbody></table><p style="margin-top:12px;color:#666">API: <code>/report_api</code></p>`
  return html(body)
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/report_web' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
