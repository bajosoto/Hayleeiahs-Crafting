-- Core tables
create table if not exists public.ingredients (
  name text primary key,
  potency integer not null default 0,
  resonance integer not null default 0,
  entropy integer not null default 0,
  rarity text,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists public.recipes (
  id bigserial primary key,
  discipline text not null,
  recipe_no integer not null,
  name text not null,
  category text,
  quality_category text not null,
  rarity text,
  effect text,
  description text,
  source text,
  created_at timestamptz not null default now()
);

create unique index if not exists recipes_unique_key
  on public.recipes (discipline, quality_category, recipe_no);

create table if not exists public.inventory (
  name text primary key references public.ingredients(name) on delete cascade,
  quantity integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('dm', 'party'))
);

-- Role helper
create or replace function public.has_role(role_name text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and role = role_name
  );
$$;

-- Enable RLS
alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.inventory enable row level security;
alter table public.user_roles enable row level security;

-- Public read policies
create policy "public read ingredients"
  on public.ingredients for select
  using (true);

create policy "public read recipes"
  on public.recipes for select
  using (true);

create policy "public read inventory"
  on public.inventory for select
  using (true);

-- DM write policies
create policy "dm insert ingredients"
  on public.ingredients for insert
  with check (public.has_role('dm'));

create policy "dm update ingredients"
  on public.ingredients for update
  using (public.has_role('dm'))
  with check (public.has_role('dm'));

create policy "dm delete ingredients"
  on public.ingredients for delete
  using (public.has_role('dm'));

create policy "dm insert recipes"
  on public.recipes for insert
  with check (public.has_role('dm'));

create policy "dm update recipes"
  on public.recipes for update
  using (public.has_role('dm'))
  with check (public.has_role('dm'));

create policy "dm delete recipes"
  on public.recipes for delete
  using (public.has_role('dm'));

-- Inventory write policies (DM + party)
create policy "party insert inventory"
  on public.inventory for insert
  with check (public.has_role('dm') or public.has_role('party'));

create policy "party update inventory"
  on public.inventory for update
  using (public.has_role('dm') or public.has_role('party'))
  with check (public.has_role('dm') or public.has_role('party'));

create policy "dm delete inventory"
  on public.inventory for delete
  using (public.has_role('dm'));

-- Allow authenticated users to read their role
create policy "self read roles"
  on public.user_roles for select
  using (auth.uid() = user_id);
