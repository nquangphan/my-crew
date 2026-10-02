create table docs_imports (
  id uuid primary key,
  source_system text not null check (source_system='crew-v1'),
  backup_manifest_sha char(64) not null check (backup_manifest_sha ~ '^[0-9a-f]{64}$'),
  bundle_sha char(64) not null check (bundle_sha ~ '^[0-9a-f]{64}$'),
  report jsonb not null,
  created_at timestamptz not null default now(),
  unique(source_system,bundle_sha)
);
create table docs_snapshots (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete restrict,
  import_id uuid null references docs_imports(id) on delete restrict,
  source_commit text null check (source_commit ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  snapshot_sha char(64) not null check (snapshot_sha ~ '^[0-9a-f]{64}$'),
  source_kind text not null check (source_kind in ('legacy_import','checkout_sync')),
  audit_state text not null check (audit_state in ('unverified','invalid','verified')),
  audit_report jsonb not null,
  content_class text not null check (content_class in ('implemented','workflow_artifact','mixed')),
  received_at timestamptz not null default now(),
  unique(id,project_id),
  check ((source_kind='legacy_import')=(import_id is not null)),
  check (source_kind<>'checkout_sync' or source_commit is not null),
  check (source_kind<>'legacy_import' or audit_state<>'verified')
);
create unique index docs_snapshot_provenance on docs_snapshots(project_id,source_kind,snapshot_sha,content_class,coalesce(source_commit,''));
create table docs_files (
  snapshot_id uuid not null references docs_snapshots(id) on delete restrict,
  path text not null check (length(path) between 1 and 1024),
  content_class text not null check (content_class in ('implemented','workflow_artifact')),
  bytes bytea not null check (octet_length(bytes)<=1048576),
  sha char(64) not null check (sha ~ '^[0-9a-f]{64}$'),
  title text not null,
  search_text text not null,
  search_vector tsvector generated always as (to_tsvector('simple',left(search_text,8192))) stored,
  primary key(snapshot_id,path)
);
create index docs_files_search on docs_files using gin(search_vector);
create table docs_links (
  snapshot_id uuid not null,
  from_path text not null,
  occurrence integer not null check (occurrence>=0),
  original_href text not null,
  to_path text not null,
  fragment text null,
  status text not null check (status in ('ok','missing','external','unverified')),
  primary key(snapshot_id,from_path,occurrence),
  foreign key(snapshot_id,from_path) references docs_files(snapshot_id,path) on delete restrict
);
alter table ticket_docs add constraint ticket_docs_file_fk foreign key(snapshot_id,path) references docs_files(snapshot_id,path) on delete restrict;
alter table projects add column latest_imported_snapshot_id uuid null;
alter table projects add column latest_verified_snapshot_id uuid null;
alter table projects add constraint projects_imported_snapshot_fk foreign key(latest_imported_snapshot_id,id) references docs_snapshots(id,project_id) on delete restrict;
alter table projects add constraint projects_verified_snapshot_fk foreign key(latest_verified_snapshot_id,id) references docs_snapshots(id,project_id) on delete restrict;
create table docs_sync_receipts (
  attempt_id uuid not null references attempts(id) on delete restrict,
  merged_commit text not null check (merged_commit ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  snapshot_id uuid not null references docs_snapshots(id) on delete restrict,
  input_sha256 char(64) not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  primary key(attempt_id,merged_commit)
);
create function reject_docs_change() returns trigger language plpgsql as $$
begin
  raise exception 'DOCS_IMMUTABLE' using errcode='55000';
end;
$$;
create trigger docs_snapshots_immutable before update or delete on docs_snapshots for each row execute function reject_docs_change();
create trigger docs_files_immutable before update or delete on docs_files for each row execute function reject_docs_change();
create trigger docs_links_immutable before update or delete on docs_links for each row execute function reject_docs_change();
create trigger docs_imports_immutable before update or delete on docs_imports for each row execute function reject_docs_change();
create trigger docs_sync_receipts_immutable before update or delete on docs_sync_receipts for each row execute function reject_docs_change();
