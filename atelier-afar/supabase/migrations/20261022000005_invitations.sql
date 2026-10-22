-- Invitations par lien : date d'activation, modification de son propre nom, jetons à usage unique.
alter table public.members add column if not exists activated_at timestamptz default now();

create policy members_self_update on public.members for update to authenticated
  using (email = lower(coalesce((select auth.jwt()) ->> 'email', '')))
  with check (email = lower(coalesce((select auth.jwt()) ->> 'email', '')));

-- Un membre peut modifier son nom, jamais son rôle, son code ni son adresse.
create or replace function private.members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.role is distinct from old.role or new.code is distinct from old.code or new.email is distinct from old.email)
     and auth.uid() is not null and not private.is_admin() then
    raise exception 'Modification non autorisée';
  end if;
  return new;
end;
$$;
revoke execute on function private.members_guard() from public, anon, authenticated;
create trigger members_guard before update on public.members for each row execute function private.members_guard();

-- Liens d'activation / de réinitialisation (jetons stockés hachés, accessibles uniquement à la fonction serveur).
create table public.member_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null unique,
  purpose text not null check (purpose in ('invite', 'reset')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text
);
create index member_invites_email on public.member_invites (email);
alter table public.member_invites enable row level security;
