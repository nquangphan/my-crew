create table tickets (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete restrict,
  parent_id uuid null references tickets(id) on delete restrict,
  root_id uuid not null,
  level text not null check (level in ('request','step','task')),
  kind text not null check (kind in ('code','research','docs','deploy')),
  title text not null check (length(title) between 1 and 200),
  description text not null,
  status text not null check (status in ('pending','ready','running','needs_input','paused','done','cancelled')),
  wait_reason text null,
  created_actor_kind text not null check (created_actor_kind in ('owner','machine')),
  created_actor_id text not null,
  deploy_definition_hash char(64) null check (deploy_definition_hash ~ '^[0-9a-f]{64}$'),
  deploy_approval_decision_id uuid null unique,
  repair_limit_cycle_id uuid null,
  repair_limit_at timestamptz null,
  repair_limit_consumed_decision_id uuid null,
  revision integer not null default 1 check (revision > 0),
  mandatory boolean not null default true,
  criteria jsonb not null default '{}'::jsonb,
  inputs jsonb not null default '{}'::jsonb,
  outputs jsonb not null default '{}'::jsonb,
  skill text null,
  workflow_pin jsonb null,
  repair_cycles integer not null default 0 check (repair_cycles between 0 and 5),
  merged_commit text null check (merged_commit ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  evidence_id uuid null,
  created_at timestamptz not null default now(),
  unique (id, project_id),
  constraint tickets_root_fk foreign key (root_id) references tickets(id) on delete restrict deferrable initially deferred,
  check ((level='request' and parent_id is null and root_id=id) or (level<>'request' and parent_id is not null and root_id<>id)),
  check ((repair_limit_cycle_id is null) = (repair_limit_at is null)),
  check (deploy_approval_decision_id is null or deploy_definition_hash is not null)
);
create index tickets_project_status_id on tickets(project_id,status,id);
create index tickets_root_id on tickets(root_id,id);

create table dependencies (
  ticket_id uuid not null references tickets(id) on delete restrict,
  predecessor_id uuid not null references tickets(id) on delete restrict,
  primary key(ticket_id,predecessor_id),
  check(ticket_id<>predecessor_id)
);
create table repair_links (
  check_step_id uuid not null references tickets(id) on delete restrict,
  fix_ticket_id uuid not null references tickets(id) on delete restrict,
  cycle_id uuid not null,
  primary key(check_step_id,cycle_id),
  unique(fix_ticket_id)
);
create table comments (
  id uuid primary key,
  ticket_id uuid not null references tickets(id) on delete restrict,
  actor_kind text not null check(actor_kind in ('owner','machine')),
  actor_id text not null,
  text text not null check(length(text) between 1 and 32768),
  created_at timestamptz not null default now()
);
create index comments_ticket_id on comments(ticket_id,id);
create table decisions (
  id uuid primary key,
  ticket_id uuid not null references tickets(id) on delete restrict,
  actor_kind text not null check(actor_kind in ('owner','machine')),
  actor_id text not null,
  kind text not null check(kind in ('assessment','delegated','owner_answer','approval','intervention','dispatch')),
  content text not null,
  rationale text not null,
  sources jsonb not null,
  scope jsonb not null,
  created_at timestamptz not null default now()
);
create index decisions_ticket_id on decisions(ticket_id,id);
alter table tickets add constraint tickets_deploy_approval_fk foreign key(deploy_approval_decision_id)
  references decisions(id) on delete restrict;
alter table tickets add constraint tickets_repair_limit_consumed_fk foreign key(repair_limit_consumed_decision_id)
  references decisions(id) on delete restrict;
create table evidence (
  id uuid primary key,
  ticket_id uuid not null references tickets(id) on delete restrict,
  attempt_id uuid null,
  kind text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index evidence_ticket_kind on evidence(ticket_id,kind);
alter table tickets add constraint tickets_evidence_fk foreign key(evidence_id) references evidence(id) on delete restrict;
create table repair_results (
  check_step_id uuid not null references tickets(id) on delete restrict,
  cycle_id uuid not null,
  classification text not null check(classification in ('initial_review','repair_review','infrastructure','model')),
  passed boolean not null,
  evidence_id uuid not null references evidence(id) on delete restrict,
  primary key(check_step_id,cycle_id)
);
alter table tickets add constraint tickets_repair_limit_cycle_fk
  foreign key(id,repair_limit_cycle_id) references repair_results(check_step_id,cycle_id) on delete restrict;
create table ticket_docs (
  ticket_id uuid not null references tickets(id) on delete restrict,
  snapshot_id uuid not null,
  path text not null,
  primary key(ticket_id,snapshot_id,path)
);
