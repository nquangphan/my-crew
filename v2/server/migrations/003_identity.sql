create table owners (
  id text primary key check (id = 'owner'),
  password_salt text not null,
  password_hash text not null
);

create table sessions (
  id_hash char(64) primary key,
  owner_id text not null references owners(id),
  csrf_hash char(64) not null,
  csrf_ciphertext text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz null
);
create index sessions_owner_expires on sessions (owner_id, expires_at);

create table machines (
  id uuid primary key,
  name text not null,
  token_hash char(64) not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null
);

create table projects (
  id uuid primary key,
  key text not null unique,
  name text not null,
  repository_url text null,
  machine_id uuid null references machines(id),
  checkout_path text null,
  binding_revision integer not null default 1 check (binding_revision > 0),
  expected_commit text null,
  created_at timestamptz not null default now(),
  check ((machine_id is null) = (checkout_path is null))
);
create index projects_machine on projects (machine_id);

create table legacy_projects (
  source_system text not null,
  legacy_id text not null,
  project_id uuid not null unique references projects(id),
  primary key (source_system, legacy_id)
);
