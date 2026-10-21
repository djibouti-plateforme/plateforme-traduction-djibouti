-- Atelier Afar : schéma, contrôle d'accès et stockage audio.

-- Membres autorisés (liste blanche). Un compte Supabase Auth sans ligne ici ne voit rien.
create table public.members (
  email text primary key check (email = lower(email)),
  display_name text not null,
  code text not null unique,
  role text not null default 'linguiste' check (role in ('admin', 'linguiste')),
  created_at timestamptz not null default now()
);

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.email = lower(coalesce(auth.jwt() ->> 'email', '')) and m.role = 'admin');
$$;

revoke execute on function public.is_member() from anon;
revoke execute on function public.is_admin() from anon;

create or replace function public.touch_updated() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

-- Segments sources (traduction automatique d'origine, jamais modifiée par les linguistes).
create table public.segments (
  id text primary key,
  lot text not null,
  domaine text not null,
  source_fr text not null,
  mt_afar text not null,
  mt_model text not null,
  mt_prompt_version text not null,
  created_at timestamptz not null,
  demo boolean not null default false,
  position integer not null default 0
);

-- Révision humaine (une par segment).
create table public.reviews (
  segment_id text primary key references public.segments (id) on delete cascade,
  status text not null default 'a_reviser' check (status in ('a_reviser', 'en_cours', 'valide', 'corrige', 'rejete', 'signale')),
  corrected_afar text,
  last_approved_text text,
  draft_afar text,
  draft_saved_at timestamptz,
  reviewer_id text,
  reviewed_at timestamptz,
  flag_comment text,
  annotations jsonb not null default '[]'::jsonb,
  duration_seconds numeric not null default 0,
  text_version integer not null default 0,
  history jsonb not null default '[]'::jsonb,
  simulated boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create trigger reviews_touch before insert or update on public.reviews for each row execute function public.touch_updated();

create table public.glossary (
  id text primary key,
  fr text not null,
  afar text not null default '',
  domaine text not null default '',
  notes text not null default '',
  status text not null default 'non_verifie' check (status in ('non_verifie', 'propose', 'valide_linguiste')),
  source text not null default 'linguiste' check (source in ('demo', 'linguiste')),
  validated_by text,
  validated_at timestamptz,
  proposals jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create trigger glossary_touch before insert or update on public.glossary for each row execute function public.touch_updated();

create table public.speakers (
  id text primary key check (id ~ '^[A-Za-z0-9_-]+$'),
  name text not null,
  sexe text,
  age_range text,
  dialect text not null,
  region text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.consents (
  speaker_id text primary key references public.speakers (id) on delete cascade,
  speaker_name text not null,
  consent_given boolean not null,
  training_reuse boolean not null,
  consent_date date not null,
  text_version text not null,
  recorded_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  recorded_by uuid default auth.uid()
);

create table public.recordings (
  id text primary key,
  segment_id text not null references public.segments (id) on delete cascade,
  speaker_id text not null references public.speakers (id) on delete cascade,
  text_display text not null,
  text_spoken text not null,
  text_version integer not null,
  duration_seconds numeric not null,
  sample_rate integer not null,
  format text not null,
  size_bytes integer not null,
  storage_path text not null unique,
  recorded_at timestamptz not null default now(),
  quality_status text not null default 'brouillon' check (quality_status in ('brouillon', 'valide', 'a_refaire')),
  "current" boolean not null default true,
  confirmed boolean not null default false,
  flags jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  warning_messages jsonb not null default '[]'::jsonb,
  peak_dbfs numeric,
  rms_dbfs numeric,
  invalidated_reason text,
  validated_at timestamptz,
  created_by uuid default auth.uid()
);
create index recordings_segment_speaker on public.recordings (segment_id, speaker_id);
create index recordings_speaker on public.recordings (speaker_id);

-- RLS : réservé aux membres authentifiés.
alter table public.members enable row level security;
alter table public.segments enable row level security;
alter table public.reviews enable row level security;
alter table public.glossary enable row level security;
alter table public.speakers enable row level security;
alter table public.consents enable row level security;
alter table public.recordings enable row level security;

create policy members_select on public.members for select to authenticated using ((select public.is_member()));
create policy members_admin_insert on public.members for insert to authenticated with check ((select public.is_admin()));
create policy members_admin_update on public.members for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy members_admin_delete on public.members for delete to authenticated using ((select public.is_admin()));

create policy segments_select on public.segments for select to authenticated using ((select public.is_member()));
create policy segments_admin_insert on public.segments for insert to authenticated with check ((select public.is_admin()));
create policy segments_admin_update on public.segments for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy reviews_select on public.reviews for select to authenticated using ((select public.is_member()));
create policy reviews_insert on public.reviews for insert to authenticated with check ((select public.is_member()));
create policy reviews_update on public.reviews for update to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy reviews_admin_delete on public.reviews for delete to authenticated using ((select public.is_admin()));

create policy glossary_select on public.glossary for select to authenticated using ((select public.is_member()));
create policy glossary_insert on public.glossary for insert to authenticated with check ((select public.is_member()));
create policy glossary_update on public.glossary for update to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy glossary_admin_delete on public.glossary for delete to authenticated using ((select public.is_admin()));

create policy speakers_all on public.speakers for all to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy consents_all on public.consents for all to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy recordings_all on public.recordings for all to authenticated using ((select public.is_member())) with check ((select public.is_member()));

-- Stockage audio privé (WAV uniquement, 50 Mo max par fichier).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recordings', 'recordings', false, 52428800, array['audio/wav']);

create policy recordings_objects_select on storage.objects for select to authenticated using (bucket_id = 'recordings' and (select public.is_member()));
create policy recordings_objects_insert on storage.objects for insert to authenticated with check (bucket_id = 'recordings' and (select public.is_member()));
create policy recordings_objects_update on storage.objects for update to authenticated using (bucket_id = 'recordings' and (select public.is_member())) with check (bucket_id = 'recordings' and (select public.is_member()));
create policy recordings_objects_delete on storage.objects for delete to authenticated using (bucket_id = 'recordings' and (select public.is_member()));
