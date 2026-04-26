create table public.expense_items (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  expense_id   uuid not null references public.expenses(id) on delete cascade,
  product_id   uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity     integer not null check (quantity > 0),
  unit_cost    numeric not null check (unit_cost >= 0),
  subtotal     numeric generated always as (quantity * unit_cost) stored,
  update_cost  boolean not null default false,
  created_at   timestamptz default now()
);

alter table public.expense_items enable row level security;

create policy "owner_manage_expense_items"
  on public.expense_items
  for all
  using (business_id = get_business_id());

create index idx_expense_items_expense_id  on public.expense_items(expense_id);
create index idx_expense_items_product_id  on public.expense_items(product_id);
create index idx_expense_items_business_id on public.expense_items(business_id);
