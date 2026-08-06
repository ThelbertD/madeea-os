-- ===========================================================================
-- Team members and invitations.
--
-- Run once in the Supabase SQL editor, after 0002_avatars.sql.
--
-- One shared workspace, not one per user: everyone signed in sees the same
-- member list, which is the point of a team page. Nothing secret lives in
-- these tables — an invite row holds an email address and a token, and the
-- token is what actually grants anything.
-- ===========================================================================

create table if not exists public.workspace_members (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  email     text not null,
  role      text not null default 'member',
  joined_at timestamptz not null default now()
);

create table if not exists public.workspace_invites (
  id          uuid primary key default gen_random_uuid(),
  -- Stored lowercased so acceptance can compare against the JWT email without
  -- a case mismatch quietly refusing a legitimate invite.
  email       text not null,
  token       text not null unique,
  role        text not null default 'member',
  invited_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null
);

create index if not exists workspace_invites_email_idx on public.workspace_invites (lower(email));
create index if not exists workspace_invites_pending_idx on public.workspace_invites (created_at desc) where accepted_at is null;

alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;

-- ── members ───────────────────────────────────────────────────────────────
-- Everyone signed in can see the roster; you may only add or remove yourself.
-- Joining happens when you accept an invite, so the insert is a self-insert.
drop policy if exists "members are visible to the team" on public.workspace_members;
create policy "members are visible to the team"
  on public.workspace_members for select to authenticated using (true);

drop policy if exists "you may add only yourself" on public.workspace_members;
create policy "you may add only yourself"
  on public.workspace_members for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "you may remove only yourself" on public.workspace_members;
create policy "you may remove only yourself"
  on public.workspace_members for delete to authenticated
  using (user_id = auth.uid());

-- ── invites ───────────────────────────────────────────────────────────────
drop policy if exists "invites are visible to the team" on public.workspace_invites;
create policy "invites are visible to the team"
  on public.workspace_invites for select to authenticated using (true);

drop policy if exists "you invite as yourself" on public.workspace_invites;
create policy "you invite as yourself"
  on public.workspace_invites for insert to authenticated
  with check (invited_by = auth.uid());

drop policy if exists "you may revoke your own invites" on public.workspace_invites;
create policy "you may revoke your own invites"
  on public.workspace_invites for delete to authenticated
  using (invited_by = auth.uid());

-- Accepting: only the person the invite names, only while it is still open,
-- and only onto their own id. Without the email predicate any signed-in user
-- who saw a token could claim someone else's invitation.
drop policy if exists "only the invitee may accept" on public.workspace_invites;
create policy "only the invitee may accept"
  on public.workspace_invites for update to authenticated
  using (
    accepted_at is null
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  with check (accepted_by = auth.uid());
