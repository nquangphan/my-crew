create table system_identity (
  singleton boolean primary key default true check (singleton),
  system_name text not null check (system_name = 'crew-v2'),
  created_at timestamptz not null default now()
);
insert into system_identity (singleton, system_name) values (true, 'crew-v2');
