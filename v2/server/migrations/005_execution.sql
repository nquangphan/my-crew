create table commands (
  id uuid primary key,
  machine_id uuid not null references machines(id) on delete restrict,
  ticket_id uuid not null references tickets(id) on delete restrict,
  binding_revision integer not null check (binding_revision>0),
  type text not null check (type in ('start','pause','cancel','resume','reconcile')),
  payload jsonb not null,
  state text not null check (state in ('queued','received','completed')),
  result jsonb null,
  created_at timestamptz not null default now(),
  received_at timestamptz null,
  completed_at timestamptz null
);
create index commands_machine_created on commands(machine_id,created_at,id);
create index commands_ticket_created on commands(ticket_id,created_at,id);

create table execution_guards (
  ticket_id uuid primary key references tickets(id) on delete restrict,
  fence bigint not null default 0 check (fence>=0),
  active_attempt_id uuid null
);
create table attempts (
  id uuid primary key,
  ticket_id uuid not null references tickets(id) on delete restrict,
  machine_id uuid not null references machines(id) on delete restrict,
  command_id uuid not null unique references commands(id) on delete restrict,
  fence bigint not null check (fence>0),
  binding_revision integer not null check (binding_revision>0),
  process_instance_id text not null check (length(process_instance_id) between 1 and 200),
  state text not null check (state in ('active','uncertain','finalizing','stopped')),
  lease_expires_at timestamptz not null,
  workflow_pin jsonb not null,
  checkpoint jsonb not null default '{}'::jsonb,
  checkpoint_sequence bigint not null default 0 check (checkpoint_sequence>=0),
  stopped_at timestamptz null,
  stop_reason text null check (stop_reason in ('pause','cancel','exit')),
  terminal_intent text not null default 'complete' check (terminal_intent in ('complete','retry','pause','cancel','needs_input')),
  terminal_reason text null,
  terminal_result jsonb null,
  finalized_at timestamptz null,
  unique(ticket_id,fence),
  check ((state='stopped')=(finalized_at is not null)),
  check ((state in ('finalizing','stopped'))=(stopped_at is not null))
);
create unique index attempts_one_reserved on attempts(ticket_id) where state in ('active','uncertain','finalizing');
alter table execution_guards add constraint execution_guards_active_fk
  foreign key(active_attempt_id) references attempts(id) on delete restrict deferrable initially deferred;
alter table evidence add constraint evidence_attempt_fk foreign key(attempt_id)
  references attempts(id) on delete restrict;

create table reconciliation_observations (
  id uuid primary key,
  attempt_id uuid not null references attempts(id) on delete restrict,
  machine_id uuid not null references machines(id) on delete restrict,
  fence bigint not null check (fence>0),
  process_instance_id text not null,
  observation text not null check (observation in ('running','stopped')),
  artifact_ids jsonb not null,
  stop_reason text null check (stop_reason in ('pause','cancel','exit')),
  observed_at timestamptz not null default clock_timestamp(),
  check ((observation='running')=(stop_reason is null))
);
create index reconciliation_observations_attempt_time on reconciliation_observations(attempt_id,observed_at,id);
