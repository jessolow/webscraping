-- Phase 3: Views for cleaning, dedupe, stance, aspects, and aggregates

-- Cleaned feedback with stance from ratings
create or replace view public.v_feedback as
select
  id,
  source,
  platform_app_id,
  review_id,
  author_hash,
  rating,
  posted_at,
  thumbs_up,
  data,
  coalesce(title, '') as title,
  content,
  lower(regexp_replace(unaccent(coalesce(content, '')), '\s+', ' ', 'g')) as content_clean,
  md5(lower(regexp_replace(unaccent(coalesce(content, '')), '\s+', ' ', 'g'))) as dedupe_key,
  case
    when rating >= 4 then 'liked'
    when rating <= 2 then 'disliked'
    else 'neutral'
  end as stance
from public.raw_reviews;

-- Canonical deduped feedback (keep newest per dedupe_key)
create or replace view public.v_feedback_canonical as
select *
from (
  select v.*,
         row_number() over (
           partition by dedupe_key
           order by v.posted_at desc nulls last, r.inserted_at desc
         ) as rn
  from public.v_feedback v
  join public.raw_reviews r on r.id = v.id
) t
where rn = 1;

-- Aspects table
create table if not exists public.aspects (
  aspect text primary key,
  keywords text[] not null
);

insert into public.aspects (aspect, keywords) values
  ('fees_interest', array['interest','fee','fees','charge','rate','apr','monthly interest']),
  ('approval_speed', array['approve','approval','minutes','hours','instant','quick','faster','waiting']),
  ('credit_bureau', array['credit bureau','transunion','cic','report','reported','credit score']),
  ('credit_limit', array['limit','increase','raise','higher limit','credit limit']),
  ('app_ux', array['app','login','bug','crash','slow','ui','ux','interface']),
  ('customer_service', array['support','customer service','response','agent','ticket','contact']),
  ('eligibility', array['requirements','documents','id','eligibility','income','employment']),
  ('transparency', array['hidden','transparent','surprise','disclose','terms','clarity'])
on conflict (aspect) do nothing;

-- Aspect hits based on keyword matching
create or replace view public.v_aspect_hits as
select f.id as review_id, a.aspect
from public.v_feedback_canonical f
join public.aspects a
  on exists (
    select 1
    from unnest(a.keywords) kw
    where f.content_clean like '%' || lower(kw) || '%'
  );

-- KPIs for liked/disliked counts
create or replace view public.v_kpis as
select
  count(*) filter (where stance <> 'neutral') as total_with_stance,
  count(*) filter (where stance = 'liked')    as liked,
  count(*) filter (where stance = 'disliked') as disliked
from public.v_feedback_canonical;

-- Aspect sentiment aggregation
create or replace view public.v_aspect_sentiment as
select
  h.aspect,
  count(*) filter (where f.stance = 'liked')    as liked_count,
  count(*) filter (where f.stance = 'disliked') as disliked_count
from public.v_aspect_hits h
join public.v_feedback_canonical f on f.id = h.review_id
group by h.aspect
order by disliked_count desc nulls last, liked_count desc;

-- Aspect example quotes per stance
create or replace view public.v_aspect_quotes as
select
  h.aspect,
  f.stance,
  string_agg(substr(f.content, 1, 240), ' ||| ' order by f.thumbs_up desc nulls last, f.posted_at desc) as sample_quotes
from public.v_aspect_hits h
join public.v_feedback_canonical f on f.id = h.review_id
where f.content is not null and length(f.content) > 20
group by h.aspect, f.stance;


