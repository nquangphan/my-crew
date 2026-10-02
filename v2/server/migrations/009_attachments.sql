-- Attachment originals are owned by an immutable upload UUID. Hashes never confer access.
create table attachment_conversations (
 id uuid primary key, owner_id text not null default 'owner' check(owner_id='owner'), created_at timestamptz not null default now()
);
create table attachment_compose_sessions (
 id uuid primary key, owner_id text not null default 'owner' check(owner_id='owner'),
 project_id uuid null references projects(id) on delete restrict,
 ticket_id uuid null references tickets(id) on delete restrict,
 conversation_id uuid null references attachment_conversations(id) on delete restrict,
 purpose text not null check(purpose in ('ticket','comment','assistant_message')),
 state text not null check(state in ('open','submitted','abandoned')),
 revision integer not null default 1 check(revision>=1),
 expires_at timestamptz not null, created_at timestamptz not null default now(),
 check((purpose='ticket' and project_id is not null and ticket_id is null and conversation_id is null)
    or (purpose='comment' and project_id is not null and ticket_id is not null and conversation_id is null)
    or (purpose='assistant_message' and project_id is null and ticket_id is null and conversation_id is not null))
);
create index attachment_compose_owner_state_expiry on attachment_compose_sessions(owner_id,state,expires_at);
create table attachment_server_writers (
 instance_id uuid primary key,storage_host_id uuid not null,linux_boot_id text not null,
 proc_namespace_inode text not null,pid integer not null check(pid>0),start_ticks text not null,
 started_at timestamptz not null default now()
);
create table attachment_uploads (
 id uuid primary key,compose_id uuid not null references attachment_compose_sessions(id) on delete restrict,
 initial_project_id uuid null references projects(id) on delete restrict,
 owner_id text not null default 'owner' check(owner_id='owner'),
 file_name text not null check(length(file_name) between 1 and 1024),declared_mime text not null,
 detected_mime text null,expected_bytes bigint not null check(expected_bytes>=0),
 expected_sha256 char(64) not null check(expected_sha256 ~ '^[0-9a-f]{64}$'),
 storage_key text not null unique,stage_key text null unique,ownership_nonce uuid not null,
 policy_sha256 char(64) not null check(policy_sha256 ~ '^[0-9a-f]{64}$'),accepted_config jsonb not null,
 state text not null check(state in ('reserved','receiving','ready','rejected','abandoned','deleting','deleted','missing')),
 generation bigint not null default 0 check(generation>=0),receive_lease_until timestamptz null,
 receiver_id uuid null,durable_at timestamptz null,linked_at timestamptz null,
 quota_released_at timestamptz null,rejection_code text null,abandoned_at timestamptz null,
 expires_at timestamptz not null,created_at timestamptz not null default now(),
 check(state<>'ready' or durable_at is not null),
 check(storage_key ~ '^uploads/[0-9a-f-]{36}/original$')
);
create index attachment_uploads_compose_state on attachment_uploads(compose_id,state,id);
create index attachment_uploads_owner_quota on attachment_uploads(owner_id,quota_released_at,state);
create index attachment_uploads_state_expiry on attachment_uploads(state,expires_at,id);
create table attachment_receivers (
 id uuid primary key,attachment_id uuid not null references attachment_uploads(id) on delete restrict,
 generation bigint not null check(generation>0),instance_id uuid not null references attachment_server_writers(instance_id) on delete restrict,
 stage_key text not null unique,operation_nonce uuid not null,
 state text not null check(state in ('registered','writing','closing','closed')),
 abort_requested boolean not null default false,registered_at timestamptz not null default now(),
 closed_ack_sha256 char(64) null check(closed_ack_sha256 ~ '^[0-9a-f]{64}$'),closed_at timestamptz null,
 stop_proof jsonb null,unique(attachment_id,generation)
);
alter table attachment_uploads add constraint attachment_upload_receiver_fk foreign key(receiver_id) references attachment_receivers(id) on delete restrict;
create table attachment_submissions (
 compose_id uuid primary key references attachment_compose_sessions(id) on delete restrict,
 payload_sha256 char(64) not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
 target_kind text not null check(target_kind in ('ticket','comment','message')),target_id uuid not null,
 response jsonb not null,created_at timestamptz not null default now()
);
create table attachment_extractions (
 id uuid primary key,attachment_id uuid not null references attachment_uploads(id) on delete restrict,
 original_sha256 char(64) not null check(original_sha256 ~ '^[0-9a-f]{64}$'),
 extractor_version text not null,config_sha256 char(64) not null check(config_sha256 ~ '^[0-9a-f]{64}$'),
 status text not null check(status in ('pending','running','complete','partial','encrypted','corrupt','unsupported','blocked','failed')),
 generation bigint not null default 0 check(generation>=0),lease_until timestamptz null,worker_id text null,
 manifest jsonb null,manifest_sha256 char(64) null check(manifest_sha256 ~ '^[0-9a-f]{64}$'),
 error_code text null,created_at timestamptz not null default now(),completed_at timestamptz null,
 unique(attachment_id,extractor_version,config_sha256)
);
create index attachment_extractions_state_lease on attachment_extractions(status,lease_until,id);
create table attachment_derivatives (
 id uuid primary key,extraction_id uuid not null references attachment_extractions(id) on delete restrict,
 attachment_id uuid not null references attachment_uploads(id) on delete restrict,
 blob_key text not null unique,sha256 char(64) not null check(sha256 ~ '^[0-9a-f]{64}$'),
 byte_length bigint not null check(byte_length>=0),mime text not null check(mime in ('text/plain','image/png')),
 kind text not null check(kind in ('text','image')),unit_ids jsonb not null,
 verification text not null check(verification in ('verified','failed')),created_at timestamptz not null default now()
);
create table attachment_messages (
 id uuid primary key,conversation_id uuid not null references attachment_conversations(id) on delete restrict,
 owner_id text not null default 'owner' check(owner_id='owner'),client_message_id uuid not null,
 text text not null,canonical_payload_sha256 char(64) not null check(canonical_payload_sha256 ~ '^[0-9a-f]{64}$'),
 input_revision bigint not null default 1 check(input_revision>=1),route_revision integer not null default 0 check(route_revision>=0),
 created_at timestamptz not null default now(),unique(owner_id,client_message_id)
);
create table attachment_message_links (
 message_id uuid not null references attachment_messages(id) on delete restrict,
 attachment_id uuid not null references attachment_uploads(id) on delete restrict,
 sha256 char(64) not null check(sha256 ~ '^[0-9a-f]{64}$'),primary key(message_id,attachment_id)
);
create table attachment_message_decisions (
 id uuid primary key,message_id uuid not null references attachment_messages(id) on delete restrict,
 input_revision bigint not null check(input_revision>=1),snapshot_id uuid null,grant_id uuid null,receipt_id uuid null,
 actor_kind text not null check(actor_kind in ('owner','machine')),actor_id text not null,
 kind text not null check(kind in ('routing','scope','reply')),body jsonb not null,
 sha256 char(64) not null check(sha256 ~ '^[0-9a-f]{64}$'),created_at timestamptz not null default now()
);
create table attachment_message_routes (
 id uuid primary key,message_id uuid not null references attachment_messages(id) on delete restrict,
 revision integer not null check(revision>=1),project_id uuid not null references projects(id) on delete restrict,
 ticket_id uuid not null references tickets(id) on delete restrict,decision_id uuid not null references attachment_message_decisions(id) on delete restrict,
 supersedes_route_id uuid null references attachment_message_routes(id) on delete restrict,
 revoked_at timestamptz null,unique(message_id,revision)
);
create unique index attachment_message_routes_current on attachment_message_routes(message_id) where revoked_at is null;
create table attachment_links (
 id uuid primary key,attachment_id uuid not null references attachment_uploads(id) on delete restrict,
 project_id uuid not null references projects(id) on delete restrict,
 ticket_id uuid not null references tickets(id) on delete restrict,
 comment_id uuid null references comments(id) on delete restrict,
 message_route_id uuid null references attachment_message_routes(id) on delete restrict,
 revoked_at timestamptz null,inherited_from_link_id uuid null references attachment_links(id) on delete restrict,
 created_at timestamptz not null default now(),unique nulls not distinct(attachment_id,ticket_id,comment_id),
 check(not(comment_id is not null and message_route_id is not null))
);
create index attachment_links_ticket_live on attachment_links(ticket_id,revoked_at,attachment_id);
create table attachment_input_revisions (
 target_kind text not null check(target_kind in ('ticket','message')),
 target_id uuid not null,revision bigint not null default 1 check(revision>=1),
 route_revision integer not null default 0 check(route_revision>=0),primary key(target_kind,target_id)
);
insert into attachment_input_revisions(target_kind,target_id,revision,route_revision)
 select 'ticket',id,1,0 from tickets;
create table attachment_input_snapshots (
 id uuid primary key,target_kind text not null check(target_kind in ('ticket','message')),
 target_id uuid not null,input_revision bigint not null check(input_revision>=1),route_revision integer not null check(route_revision>=0),
 canonical jsonb not null,sha256 char(64) not null check(sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(),unique(target_kind,target_id,input_revision,sha256)
);
create table attachment_input_manifests (
 id uuid primary key,ticket_id uuid not null references tickets(id) on delete restrict,
 input_revision bigint not null check(input_revision>=1),snapshot_id uuid not null references attachment_input_snapshots(id) on delete restrict,
 snapshot_sha256 char(64) not null check(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
 canonical jsonb not null,sha256 char(64) not null check(sha256 ~ '^[0-9a-f]{64}$'),
 evidence_id uuid not null references evidence(id) on delete restrict,created_at timestamptz not null default now(),
 unique(ticket_id,input_revision,sha256)
);
create table attachment_dispatch_inputs (
 command_id uuid primary key references commands(id) on delete restrict,
 decision_id uuid not null references decisions(id) on delete restrict,
 snapshot_id uuid not null references attachment_input_snapshots(id) on delete restrict,
 sha256 char(64) not null check(sha256 ~ '^[0-9a-f]{64}$'),input_revision bigint not null check(input_revision>=1),
 selection_sha256 char(64) not null check(selection_sha256 ~ '^[0-9a-f]{64}$')
);
create table attachment_read_receipts (
 id uuid primary key,manifest_id uuid not null references attachment_input_manifests(id) on delete restrict,
 attempt_id uuid not null references attempts(id) on delete restrict,fence bigint not null check(fence>0),
 process_instance_id text not null,receipt_sha256 char(64) not null check(receipt_sha256 ~ '^[0-9a-f]{64}$'),
 body jsonb not null,coverage text not null check(coverage in ('all_selected','partial','none')),
 trust text not null default 'reported_transport' check(trust='reported_transport'),created_at timestamptz not null default now(),
 unique(manifest_id,attempt_id,receipt_sha256)
);
create table attachment_submission_authorizations (
 id uuid primary key,owner_id text not null default 'owner' check(owner_id='owner'),
 target_kind text not null check(target_kind in ('ticket','message')),target_id uuid not null,
 originals jsonb not null,authorization_sha256 char(64) not null check(authorization_sha256 ~ '^[0-9a-f]{64}$'),
 allow_original boolean not null default false,expires_at timestamptz not null,revoked_at timestamptz null,
 created_at timestamptz not null default now()
);
create table attachment_assistant_grants (
 id uuid primary key,authorization_id uuid not null references attachment_submission_authorizations(id) on delete restrict,
 target_kind text not null check(target_kind in ('ticket','message')),target_id uuid not null,
 originals jsonb not null,input_revision bigint not null check(input_revision>=1),route_revision integer not null check(route_revision>=0),
 designation_id uuid not null,designation_revision integer not null check(designation_revision>0),
 machine_id uuid not null references machines(id) on delete restrict,
 snapshot_id uuid null references attachment_input_snapshots(id) on delete restrict,
 snapshot_sha256 char(64) null check(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
 derivative_ids jsonb not null default '[]'::jsonb,allow_original boolean not null default false,
 expires_at timestamptz not null,revoked_at timestamptz null,
 check((snapshot_id is null)=(snapshot_sha256 is null))
);
create table attachment_assistant_sessions (
 id uuid primary key,grant_id uuid not null references attachment_assistant_grants(id) on delete restrict,
 snapshot_id uuid not null references attachment_input_snapshots(id) on delete restrict,
 snapshot_sha256 char(64) not null check(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
 designation_revision integer not null check(designation_revision>0),machine_id uuid not null references machines(id) on delete restrict,
 runtime text not null check(runtime in ('claude','codex','api')),model_key text not null,
 model_selection_id uuid not null,policy_receipt_id uuid not null,process_instance_id uuid not null,
 admission_id uuid not null unique,admitted_at timestamptz not null,model_config_revision bigint not null check(model_config_revision>0),
 source_enabled_at_admission boolean not null check(source_enabled_at_admission=true),
 state text not null check(state in ('reserved','running','stopped','unknown')),
 expires_at timestamptz not null,unique(grant_id,snapshot_id,model_selection_id,process_instance_id)
);
create table attachment_assistant_receipts (
 id uuid primary key,session_id uuid not null references attachment_assistant_sessions(id) on delete restrict,
 grant_id uuid not null references attachment_assistant_grants(id) on delete restrict,
 snapshot_id uuid not null references attachment_input_snapshots(id) on delete restrict,
 receipt_sha256 char(64) not null check(receipt_sha256 ~ '^[0-9a-f]{64}$'),body jsonb not null,
 coverage text not null check(coverage in ('all_selected','partial','none')),
 trust text not null default 'reported_transport' check(trust='reported_transport'),
 created_at timestamptz not null default now(),unique(session_id,receipt_sha256)
);
alter table attachment_message_decisions add constraint attachment_message_decision_snapshot_fk foreign key(snapshot_id) references attachment_input_snapshots(id) on delete restrict;
alter table attachment_message_decisions add constraint attachment_message_decision_grant_fk foreign key(grant_id) references attachment_assistant_grants(id) on delete restrict;
alter table attachment_message_decisions add constraint attachment_message_decision_receipt_fk foreign key(receipt_id) references attachment_assistant_receipts(id) on delete restrict;
create table attachment_gc (
 id uuid primary key,attachment_id uuid null references attachment_uploads(id) on delete restrict,
 extraction_id uuid null references attachment_extractions(id) on delete restrict,
 kind text not null check(kind in ('upload','job_scratch','orphan_derivative')),
 owned_key text not null unique,ownership_nonce uuid not null,
 state text not null check(state in ('candidate','claimed','deleted','failed')),
 generation bigint not null check(generation>=0),not_before timestamptz not null,
 lease_until timestamptz null,error_code text null,created_at timestamptz not null default now(),deleted_at timestamptz null
);
create index attachment_gc_state_deadline on attachment_gc(state,not_before,id);
-- Legacy and attachment comments share the same inherited-input invalidation producer.
create function attachment_comment_revision() returns trigger language plpgsql as $$
declare root_uuid uuid;affected_ids uuid[];
begin
 select root_id into strict root_uuid from tickets where id=new.ticket_id;
 perform 1 from tickets where id=root_uuid for update;
 with recursive affected(id) as (
  select id from tickets where id=new.ticket_id
  union all select t.id from tickets t join affected a on t.parent_id=a.id
 ) select array_agg(id order by id) into affected_ids from affected;
 perform 1 from tickets where id=any(affected_ids) order by id for update;
 perform 1 from attachment_input_revisions where target_kind='ticket' and target_id=any(affected_ids) order by target_id for update;
 insert into attachment_input_revisions(target_kind,target_id,revision,route_revision)
  select 'ticket',id,2,0 from unnest(affected_ids) as targets(id) where true
  on conflict(target_kind,target_id) do update set revision=attachment_input_revisions.revision+1;
 return new;
end; $$;
create trigger attachment_comments_revision_before_insert before insert on comments
 for each row execute function attachment_comment_revision();

-- Các latch retention/quota không được mở lại sau commit; original identity bất biến.
alter table attachment_uploads add constraint attachment_upload_retained_not_gc
 check(linked_at is null or state not in ('deleting','deleted'));
alter table attachment_uploads add constraint attachment_upload_quota_release_terminal
 check(quota_released_at is null or linked_at is not null or state='deleted');
alter table attachment_submission_authorizations add column scope text not null default 'submitted-inputs'
 check(scope='submitted-inputs');
create function attachment_preserve_upload_identity() returns trigger language plpgsql as $$
begin
 if row(new.id,new.compose_id,new.initial_project_id,new.owner_id,new.file_name,new.declared_mime,
         new.expected_bytes,new.expected_sha256,new.storage_key,new.ownership_nonce,new.policy_sha256,new.accepted_config,new.created_at)
    is distinct from
    row(old.id,old.compose_id,old.initial_project_id,old.owner_id,old.file_name,old.declared_mime,
         old.expected_bytes,old.expected_sha256,old.storage_key,old.ownership_nonce,old.policy_sha256,old.accepted_config,old.created_at)
    or (old.linked_at is not null and new.linked_at is distinct from old.linked_at)
    or (old.quota_released_at is not null and new.quota_released_at is distinct from old.quota_released_at)
 then raise exception 'ATTACHMENT_IDENTITY_IMMUTABLE'; end if;
 return new;
end; $$;
create trigger attachment_upload_identity_before_update before update on attachment_uploads
 for each row execute function attachment_preserve_upload_identity();
create function attachment_immutable_record() returns trigger language plpgsql as $$
begin raise exception 'ATTACHMENT_RECORD_IMMUTABLE'; end; $$;
create trigger attachment_snapshot_immutable before update or delete on attachment_input_snapshots
 for each row execute function attachment_immutable_record();
create trigger attachment_manifest_immutable before update or delete on attachment_input_manifests
 for each row execute function attachment_immutable_record();
create trigger attachment_receipt_immutable before update or delete on attachment_read_receipts
 for each row execute function attachment_immutable_record();
create trigger attachment_assistant_receipt_immutable before update or delete on attachment_assistant_receipts
 for each row execute function attachment_immutable_record();
create trigger attachment_submission_immutable before update or delete on attachment_submissions
 for each row execute function attachment_immutable_record();
create trigger attachment_message_immutable before update of text,canonical_payload_sha256,client_message_id,owner_id,conversation_id on attachment_messages
 for each row execute function attachment_immutable_record();
create trigger attachment_original_comment_immutable before update or delete on comments
 for each row execute function attachment_immutable_record();
