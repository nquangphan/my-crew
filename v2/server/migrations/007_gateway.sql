create table gateway_configs (
  machine_id uuid primary key references machines(id) on delete restrict,
  revision integer not null check(revision>0),
  desired jsonb not null check(jsonb_typeof(desired)='object' and desired ?& array['bmad','superpowers']),
  max_jobs integer not null check(max_jobs between 1 and 64),
  enabled boolean not null,
  updated_at timestamptz not null
);
create table gateway_applied (
  machine_id uuid primary key references machines(id) on delete restrict,
  revision integer not null check(revision>=0),
  inventory jsonb not null check(jsonb_typeof(inventory)='object'),
  latest_report_id uuid not null,
  workflow_status jsonb not null check(jsonb_typeof(workflow_status)='object'),
  applied_at timestamptz null,
  check((revision=0)=(applied_at is null))
);
create table gateway_boots (
  machine_id uuid not null references machines(id) on delete restrict,
  boot_id uuid not null,
  boot_generation bigint not null check(boot_generation>0),
  previous_generation bigint not null check(previous_generation>=0 and boot_generation=previous_generation+1),
  retired_at timestamptz null,
  created_at timestamptz not null,
  primary key(machine_id,boot_id),
  unique(machine_id,boot_generation),
  unique(machine_id,boot_id,boot_generation)
);
create unique index gateway_boots_one_current on gateway_boots(machine_id) where retired_at is null;
create table gateway_heartbeats (
  machine_id uuid primary key references machines(id) on delete restrict,
  boot_id uuid not null,
  boot_generation bigint not null check(boot_generation>0),
  sequence bigint not null check(sequence>0),
  received_at timestamptz not null,
  telemetry jsonb not null check(jsonb_typeof(telemetry)='object'),
  host_version text not null check(length(host_version) between 1 and 200),
  app_version text null check(length(app_version) between 1 and 200),
  inventory jsonb not null check(jsonb_typeof(inventory)='object'),
  processes jsonb not null check(jsonb_typeof(processes)='array'),
  observed_at timestamptz not null,
  foreign key(machine_id,boot_id,boot_generation) references gateway_boots(machine_id,boot_id,boot_generation) on delete restrict
);
create table gateway_heartbeat_receipts (
  machine_id uuid not null,
  boot_generation bigint not null,
  sequence bigint not null check(sequence>0),
  body_hash char(64) not null check(body_hash ~ '^[0-9a-f]{64}$'),
  response jsonb not null,
  received_at timestamptz not null,
  primary key(machine_id,boot_generation,sequence),
  foreign key(machine_id,boot_generation) references gateway_boots(machine_id,boot_generation) on delete restrict
);
create table gateway_install_reports (
  id uuid primary key,
  machine_id uuid not null references machines(id) on delete restrict,
  boot_generation bigint not null,
  config_revision integer not null check(config_revision>0),
  body_hash char(64) not null check(body_hash ~ '^[0-9a-f]{64}$'),
  report jsonb not null check(jsonb_typeof(report)='object'),
  response jsonb not null check(jsonb_typeof(response)='object'),
  received_at timestamptz not null,
  unique(id,machine_id),
  foreign key(machine_id,boot_generation) references gateway_boots(machine_id,boot_generation) on delete restrict
);
alter table gateway_applied add constraint gateway_applied_report_fk foreign key(latest_report_id,machine_id) references gateway_install_reports(id,machine_id) on delete restrict deferrable initially deferred;
create table gateway_attempt_projections (
  attempt_id uuid primary key references attempts(id) on delete restrict,
  machine_id uuid not null references machines(id) on delete restrict,
  install_report_id uuid not null,
  fence bigint not null check(fence>0),
  process_instance_id text not null check(process_instance_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  source_tree_sha256 char(64) not null check(source_tree_sha256 ~ '^[0-9a-f]{64}$'),
  runtime text not null check(runtime in ('claude','codex','api')),
  projection_manifest_sha256 char(64) not null check(projection_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  projection_tree_sha256 char(64) not null check(projection_tree_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null,
  foreign key(install_report_id,machine_id) references gateway_install_reports(id,machine_id) on delete restrict
);
create table gateway_command_cursor (
  singleton boolean primary key check(singleton),
  value bigint not null check(value>=0)
);
insert into gateway_command_cursor(singleton,value) values(true,0);
create table gateway_commands (
  id uuid primary key,
  machine_id uuid not null references machines(id) on delete restrict,
  type text not null check(type in ('sync_workflows','probe','reconcile_host')),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  state text not null check(state in ('queued','received','completed')),
  result jsonb null check(result is null or jsonb_typeof(result)='object'),
  created_at timestamptz not null,
  received_at timestamptz null,
  completed_at timestamptz null,
  cursor bigint not null unique check(cursor>0),
  check((state='completed')=(completed_at is not null)),
  check((state='completed')=(result is not null)),
  check(state='queued' or received_at is not null)
);
create index gateway_commands_machine_cursor on gateway_commands(machine_id,cursor);

create function gateway_immutable_record() returns trigger language plpgsql as $$
begin
  raise exception 'GATEWAY_IMMUTABLE' using errcode='23514';
end;
$$;
create trigger gateway_receipt_immutable before update or delete on gateway_heartbeat_receipts
  for each row execute function gateway_immutable_record();
create trigger gateway_report_immutable before update or delete on gateway_install_reports
  for each row execute function gateway_immutable_record();
create trigger gateway_projection_immutable before update or delete on gateway_attempt_projections
  for each row execute function gateway_immutable_record();
create function gateway_boot_retirement_only() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'GATEWAY_IMMUTABLE' using errcode='23514'; end if;
  if (to_jsonb(new)-'retired_at') is distinct from (to_jsonb(old)-'retired_at')
     or old.retired_at is not null or new.retired_at is null then
    raise exception 'GATEWAY_IMMUTABLE' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger gateway_boot_immutable before update or delete on gateway_boots
  for each row execute function gateway_boot_retirement_only();
