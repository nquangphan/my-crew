create table event_cursor (
  singleton boolean primary key check (singleton),
  value bigint not null check (value >= 0)
);
insert into event_cursor (singleton, value) values (true, 0);

create table events (
  cursor bigint primary key,
  type text not null,
  project_id uuid,
  ticket_id uuid,
  audience_machine_id uuid,
  data jsonb not null,
  occurred_at timestamptz not null
);
create index events_project_cursor_idx on events (project_id, cursor);
create index events_audience_cursor_idx on events (audience_machine_id, cursor);

create table idempotency (
  actor_kind text not null,
  actor_id text not null,
  route text not null,
  key text not null,
  body_hash char(64) not null,
  status integer not null,
  response jsonb not null,
  created_at timestamptz not null,
  primary key (actor_kind, actor_id, route, key)
);
