-- Travail à plusieurs : répartition des lots, verrous de segment, synchronisation en temps réel.
alter table public.segments add column if not exists assigned_to text references public.members (code) on update cascade on delete set null;
create index if not exists segments_assigned_to on public.segments (assigned_to);

create table public.segment_locks (
  segment_id text primary key references public.segments (id) on delete cascade,
  member_code text not null,
  member_name text not null,
  user_id uuid not null default auth.uid(),
  locked_at timestamptz not null default now()
);
alter table public.segment_locks enable row level security;
create policy segment_locks_select on public.segment_locks for select to authenticated using ((select private.is_member()));
create policy segment_locks_insert on public.segment_locks for insert to authenticated with check ((select private.is_member()) and user_id = (select auth.uid()));
create policy segment_locks_update on public.segment_locks for update to authenticated using ((select private.is_member())) with check ((select private.is_member()) and user_id = (select auth.uid()));
create policy segment_locks_delete on public.segment_locks for delete to authenticated using ((select private.is_member()));

create policy segments_admin_delete on public.segments for delete to authenticated using ((select private.is_admin()));

alter table public.recordings add column if not exists updated_at timestamptz not null default now();

alter publication supabase_realtime add table public.reviews, public.recordings, public.glossary, public.segment_locks, public.segments, public.members, public.speakers, public.consents;
alter table public.reviews replica identity full;
alter table public.segment_locks replica identity full;
alter table public.recordings replica identity full;
