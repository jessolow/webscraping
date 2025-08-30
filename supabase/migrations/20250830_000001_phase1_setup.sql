-- Phase 1: Supabase setup for credit-builder feedback analysis
-- Extensions
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- Raw reviews table
create table if not exists public.raw_reviews (
  id uuid primary key default gen_random_uuid(),
  source text check (source in ('google_play','app_store')) not null,
  platform_app_id text not null,
  review_id text not null,
  author_name text,
  author_hash text,
  rating int check (rating between 1 and 5),
  title text,
  content text,
  posted_at timestamptz,
  thumbs_up int,
  data jsonb,
  inserted_at timestamptz default now(),
  unique (source, review_id)
);

-- Indexes
create index if not exists raw_reviews_posted_at_idx on public.raw_reviews(posted_at);
create index if not exists raw_reviews_content_trgm_idx on public.raw_reviews using gin (lower(content) gin_trgm_ops);

-- RLS: enable and restrict writes to service role
alter table public.raw_reviews enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'raw_reviews' and policyname = 'service_role_full_access_raw_reviews'
  ) then
    create policy "service_role_full_access_raw_reviews"
      on public.raw_reviews
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;


