-- Schema: minimal tables to store chats/messages linked to wallet user
create table if not exists public.profiles (
  id text primary key,
  wallet text unique not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(id) on delete cascade,
  title text,
  created_at timestamp with time zone default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamp with time zone default now()
);

-- Store per-user Aster API credentials (encrypted at rest by Supabase)
create table if not exists public.aster_credentials (
  user_id text primary key references public.profiles(id) on delete cascade,
  api_key text not null,
  api_secret text not null,
  passphrase text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.aster_credentials enable row level security;

-- Only owner can select/insert/update/delete their credentials
drop policy if exists select_aster_credentials on public.aster_credentials;
create policy select_aster_credentials on public.aster_credentials for select using (user_id = auth.uid()::text);
drop policy if exists insert_aster_credentials on public.aster_credentials;
create policy insert_aster_credentials on public.aster_credentials for insert with check (user_id = auth.uid()::text);
drop policy if exists update_aster_credentials on public.aster_credentials;
create policy update_aster_credentials on public.aster_credentials for update using (user_id = auth.uid()::text);
drop policy if exists delete_aster_credentials on public.aster_credentials;
create policy delete_aster_credentials on public.aster_credentials for delete using (user_id = auth.uid()::text);

-- RLS
alter table public.chats enable row level security;
alter table public.messages enable row level security;

-- Simple RLS using a custom claim 'wallet' equals user id; adjust if using Auth.
drop policy if exists select_chats on public.chats;
create policy select_chats on public.chats for select using (user_id = auth.uid()::text);
drop policy if exists insert_chats on public.chats;
create policy insert_chats on public.chats for insert with check (user_id = auth.uid()::text);
drop policy if exists select_messages on public.messages;
create policy select_messages on public.messages for select using (
  chat_id in (select id from public.chats where user_id = auth.uid()::text)
);
drop policy if exists insert_messages on public.messages;
create policy insert_messages on public.messages for insert with check (
  chat_id in (select id from public.chats where user_id = auth.uid()::text)
);


