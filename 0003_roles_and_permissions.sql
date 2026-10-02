-- core/permissions.js: PERMISSIONS is a flat catalog of 62 capability keys
-- grouped into 8 sections (Leads, Prospecting, CRM Pipeline, Campaigns,
-- Team management, Competitions, Administration). defaultRoles() ships 6
-- built-in roles (owner, manager, isa_manager, agent, re_agent, viewer), each
-- a named set of those 62 switches. Teams can also add their own custom
-- roles (roleDlg in views/admin.js), so `id` is a per-org text slug, not a
-- fixed enum — the demo's built-in ids ("owner", "manager", ...) stay stable
-- so old saves keep working, matching the comment in core/permissions.js.
create table roles (
  org_id      bigint not null references orgs(id) on delete cascade,
  id          text not null,
  name        text not null,
  description text not null default '',
  built_in    boolean not null default false,
  super_admin boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (org_id, id)
);

create trigger set_updated_at before update on roles
  for each row execute function set_updated_at();

-- One row per (role, permission key). Absence of a row for a given key means
-- "not granted" — role_permissions is only ever written for the 62 keys in
-- core/permissions.js's PERMISSIONS catalog, but permission_key is left as
-- free text (not an enum/FK) so the catalog itself can grow without a
-- migration, exactly like the demo's plain-object `perms` map.
create table role_permissions (
  org_id         bigint not null references orgs(id) on delete cascade,
  role_id        text not null,
  permission_key text not null,
  allowed        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (org_id, role_id, permission_key),
  foreign key (org_id, role_id) references roles(org_id, id) on delete cascade
);

create trigger set_updated_at before update on role_permissions
  for each row execute function set_updated_at();
