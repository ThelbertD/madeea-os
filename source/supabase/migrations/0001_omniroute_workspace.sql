-- ===========================================================================
-- OmniRoute workspace storage.
--
-- Replaces the on-disk store at ~/.agentic-os/omniroute-workspace/{builds,sessions}
-- so saved builds and chat sessions survive the machine and follow the user
-- across browsers and devices.
--
-- Run this once in the Supabase SQL editor (or `supabase db push`).
--
-- SECURITY: the anon key is public by design — it identifies the project, it
-- does not grant access. RLS below is the only thing protecting these rows, so
-- it is enabled on both tables and every policy is scoped to auth.uid(). Do not
-- add a policy that omits the user_id predicate.
-- ===========================================================================

-- ── builds ────────────────────────────────────────────────────────────────
-- `file` keeps the same "<stamp>-<slug>.html" identity the filesystem store
-- used, so the UI's existing per-build links keep working unchanged.
create table if not exists public.omniroute_builds (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  file       text not null,
  title      text not null default 'build',
  html       text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists omniroute_builds_user_file_idx
  on public.omniroute_builds (user_id, file);

create index if not exists omniroute_builds_user_created_idx
  on public.omniroute_builds (user_id, created_at desc);

-- ── sessions ──────────────────────────────────────────────────────────────
-- `id` is the client-generated session id (e.g. s-1785133247764). It is only
-- unique per user, hence the composite primary key.
create table if not exists public.omniroute_sessions (
  id         text not null,
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null default 'Session',
  messages   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists omniroute_sessions_user_updated_idx
  on public.omniroute_sessions (user_id, updated_at desc);

-- ── row level security ────────────────────────────────────────────────────
alter table public.omniroute_builds   enable row level security;
alter table public.omniroute_sessions enable row level security;

-- `for all` covers select/insert/update/delete. `using` gates the rows a
-- statement may see or change; `with check` gates the rows it may write, so a
-- user cannot insert or update a row onto someone else's user_id.
drop policy if exists "omniroute_builds are private" on public.omniroute_builds;
create policy "omniroute_builds are private"
  on public.omniroute_builds
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "omniroute_sessions are private" on public.omniroute_sessions;
create policy "omniroute_sessions are private"
  on public.omniroute_sessions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
