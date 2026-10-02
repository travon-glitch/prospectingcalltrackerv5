-- Stage 2: schema foundations.
-- pg_trgm powers the fuzzy name/address/email/city search filteredLeads() does
-- (state.q free-text search across full name, address, city, zip, email).
create extension if not exists pg_trgm;

-- Every table gets created_at/updated_at (per stage instructions). updated_at
-- is maintained by this trigger, attached to each table below.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function set_updated_at() is
  'Keeps updated_at current on every UPDATE. Attached as a BEFORE UPDATE trigger to every table in this schema.';
