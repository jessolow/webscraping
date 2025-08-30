// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

Deno.serve(async () => {
  const url = Deno.env.get("PROJECT_URL")
  const key = Deno.env.get("SERVICE_ROLE_KEY")
  if (!url || !key) {
    return new Response(JSON.stringify({ error: "Missing PROJECT_URL or SERVICE_ROLE_KEY" }), { status: 500 })
  }
  const supabase = createClient(url, key)
  const [{ data: kpis, error: e1 }, { data: aspects, error: e2 }, { data: quotes, error: e3 }] = await Promise.all([
    supabase.from("v_kpis").select("*"),
    supabase.from("v_aspect_sentiment").select("*"),
    supabase.from("v_aspect_quotes").select("*")
  ])
  const error = e1 || e2 || e3
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { headers: { "Content-Type": "application/json" }, status: 500 })
  }
  return new Response(JSON.stringify({ kpis: kpis?.[0] ?? null, aspects, quotes }), { headers: { "Content-Type": "application/json" } })
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/report_api' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json'

*/
