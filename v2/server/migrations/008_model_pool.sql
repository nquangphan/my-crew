-- Additive model protocol; frozen 007 bytes and 005 claim semantics stay intact.
alter table gateway_commands drop constraint gateway_commands_type_check;
alter table gateway_commands add constraint gateway_commands_type_check check(type in ('sync_workflows','probe','reconcile_host','sync_models'));
create table model_source_configs (
 machine_id uuid primary key references machines(id) on delete restrict,
 revision integer not null check(revision>0), enabled jsonb not null check(jsonb_typeof(enabled)='object' and enabled=jsonb_build_object('claude',enabled->'claude','codex',enabled->'codex','api',enabled->'api') and jsonb_typeof(enabled->'claude')='boolean' and jsonb_typeof(enabled->'codex')='boolean' and jsonb_typeof(enabled->'api')='boolean'), updated_at timestamptz not null
);
create table api_providers (
 id uuid not null, machine_id uuid not null references machines(id) on delete restrict,
 endpoint text not null, protocol text not null check(protocol in ('responses','chat-completions')),
 model_ids jsonb not null check(jsonb_typeof(model_ids)='array' and jsonb_array_length(model_ids)>0), local_http jsonb null,
 declared boolean not null default true, credential_ref text null, status text not null check(status in ('missing','pending','stored')),
 primary key(machine_id,id)
);
create table model_report_receipts (
 id uuid primary key, machine_id uuid not null references machines(id) on delete restrict,
 boot_id uuid not null, boot_generation bigint not null, sequence bigint not null check(sequence>0),
 kind text not null check(kind in ('inventory','applied')), config_revision integer not null check(config_revision>0),
 body_hash char(64) not null check(body_hash ~ '^[0-9a-f]{64}$'), body jsonb not null, response jsonb not null, received_at timestamptz not null,
 unique(machine_id,boot_generation,sequence), unique(id,machine_id),
 foreign key(machine_id,boot_id,boot_generation) references gateway_boots(machine_id,boot_id,boot_generation) on delete restrict
);
create table model_source_applied (
 machine_id uuid primary key references machines(id) on delete restrict,
 revision integer not null check(revision>0), report_id uuid not null, boot_generation bigint not null,
 sequence bigint not null check(sequence>0), inventory_report_id uuid not null,
 reported_at timestamptz not null, source_status jsonb not null,
 foreign key(report_id,machine_id) references model_report_receipts(id,machine_id) deferrable initially deferred,
 foreign key(inventory_report_id,machine_id) references model_report_receipts(id,machine_id)
);
create table model_probe_receipts (
 id uuid primary key, machine_id uuid not null references machines(id) on delete restrict,
 runtime text not null check(runtime in ('claude','codex','api')), provider_id text not null, model_id text not null,
 config_revision integer not null check(config_revision>0), inventory_report_id uuid not null,
 context jsonb not null, context_sha256 char(64) not null check(context_sha256 ~ '^[0-9a-f]{64}$'),
 boot_generation bigint not null, sequence bigint not null check(sequence>0), observed_at timestamptz not null,
 received_at timestamptz not null, expires_at timestamptz not null check(expires_at>received_at and expires_at<=received_at+interval '15 minutes'),
 status text not null check(status in ('pass','fail','unverified')), capabilities jsonb not null check(jsonb_typeof(capabilities)='array'),
 evidence_digest char(64) not null check(evidence_digest ~ '^[0-9a-f]{64}$'), error_code text null, runtime_version text null,
 unique(inventory_report_id,runtime,provider_id,model_id,context_sha256),
 foreign key(inventory_report_id,machine_id) references model_report_receipts(id,machine_id) deferrable initially deferred
);
create index model_probe_key on model_probe_receipts(machine_id,runtime,provider_id,model_id,received_at desc);
create table model_certification_challenges (
 id uuid primary key, machine_id uuid not null references machines(id), project_id uuid not null references projects(id),
 nonce_hash char(64) not null check(nonce_hash ~ '^[0-9a-f]{64}$'), context jsonb not null,
 expires_at timestamptz not null, max_turns integer not null check(max_turns between 1 and 20),
 max_tools integer not null check(max_tools between 1 and 100), max_cost_usd numeric not null check(max_cost_usd>=0 and max_cost_usd<=10),
 state text not null check(state in ('issued','admitted','verified','failed')),
 admitted_command_id uuid null references commands(id), admitted_decision_id uuid null references decisions(id),
 attempt_id uuid null references attempts(id), process_instance_id text null, admitted_fence bigint null,
 created_at timestamptz not null, check(expires_at>created_at and expires_at<=created_at+interval '15 minutes'),
 check((state='issued')=(attempt_id is null)), check(state='issued' or (admitted_command_id is not null and admitted_decision_id is not null and process_instance_id is not null and admitted_fence>0))
);
create table runtime_certification_receipts (
 id uuid primary key, challenge_id uuid not null unique references model_certification_challenges(id), attempt_id uuid not null references attempts(id),
 machine_id uuid not null references machines(id), runtime text not null check(runtime in ('claude','codex','api')),
 source_tree_sha256 char(64) not null, projection_manifest_sha256 char(64) not null, projection_tree_sha256 char(64) not null,
 derivation_hash char(64) not null, binary_hash char(64) not null, policy_hash char(64) not null, os_version text not null,
 evidence_digest char(64) not null, body_hash char(64) not null, status text not null check(status in ('PASS','UNVERIFIED','FAIL')),
 received_at timestamptz not null, expires_at timestamptz not null check(expires_at>received_at and expires_at<=received_at+interval '15 minutes')
);
create index model_cert_pair on runtime_certification_receipts(machine_id,runtime,source_tree_sha256,projection_tree_sha256,binary_hash,received_at desc);
create table credential_keys (
 machine_id uuid not null references machines(id), key_id uuid not null, public_key_x25519 text not null,
 state text not null check(state in ('pending','active','retired')), created_at timestamptz not null, confirmed_at timestamptz null,
 primary key(machine_id,key_id), check((state='pending')=(confirmed_at is null))
);
create unique index credential_keys_one_active on credential_keys(machine_id) where state='active';
create table credential_key_challenges (
 id uuid primary key, machine_id uuid not null, key_id uuid not null, challenge_hash char(64) not null,
 encrypted_challenge jsonb not null, expires_at timestamptz not null, consumed_at timestamptz null,
 foreign key(machine_id,key_id) references credential_keys(machine_id,key_id)
);
create table api_secret_cursor(singleton boolean primary key check(singleton),value bigint not null check(value>=0));
insert into api_secret_cursor values(true,0);
create table api_secret_envelopes (
 id uuid primary key, cursor bigint not null unique check(cursor>0), machine_id uuid not null, provider_id uuid not null, key_id uuid not null,
 config_revision integer not null check(config_revision>0), operation_id uuid not null unique,
 expires_at timestamptz not null, ephemeral_public_key text not null, nonce text not null,
 ciphertext text null, tag text null, ciphertext_sha256 char(64) not null,
 state text not null check(state in ('pending','acked','expired','key_lost')), created_at timestamptz not null, acked_at timestamptz null,
 request_hash char(64) not null, ack_hash char(64) null,
 foreign key(machine_id,provider_id) references api_providers(machine_id,id),
 foreign key(machine_id,key_id) references credential_keys(machine_id,key_id),
 check((state='acked')=(acked_at is not null)), check(state<>'acked' or (ciphertext is null and tag is null))
);
create trigger model_report_immutable before update or delete on model_report_receipts for each row execute function gateway_immutable_record();
create trigger model_probe_immutable before update or delete on model_probe_receipts for each row execute function gateway_immutable_record();
create trigger model_cert_immutable before update or delete on runtime_certification_receipts for each row execute function gateway_immutable_record();
create function model_canonical_json(j jsonb) returns text language plpgsql immutable strict as $$
declare result text;
begin
 if jsonb_typeof(j)='object' then
  select '{'||coalesce(string_agg(to_json(key)::text||':'||model_canonical_json(value),',' order by key collate "C"),'')||'}' into result from jsonb_each(j);
 elsif jsonb_typeof(j)='array' then
  select '['||coalesce(string_agg(model_canonical_json(value),',' order by ordinal),'')||']' into result from jsonb_array_elements(j) with ordinality a(value,ordinal);
 else result:=j::text; end if;
 return result;
end; $$;
-- Authority is an explicit transaction-local marker set only by a trusted admission port.
create function model_bind_test_admission() returns trigger language plpgsql as $$
declare cmd record; dec record; ch record; admission jsonb; cid uuid;
begin
 select * into cmd from commands where id=new.command_id;
 admission:=cmd.payload->'certificationAdmission';
 if admission is null then return new; end if;
 cid:=(admission->>'challengeId')::uuid;
 if current_setting('crew.model_admission',true) is distinct from cid::text then raise exception 'MODEL_ADMISSION_DENIED' using errcode='23514'; end if;
 select * into ch from model_certification_challenges where id=cid for update;
 select * into dec from decisions where id=(cmd.payload->'selection'->>'decisionId')::uuid;
 if ch.id is null or ch.state<>'issued' or ch.expires_at<=now() or ch.machine_id<>new.machine_id
 or ch.project_id<>(select project_id from tickets where id=new.ticket_id)
 or dec.kind<>'dispatch' or dec.ticket_id<>new.ticket_id
 or cmd.payload->'selection' is distinct from dec.scope->'selection'
 or cmd.payload->'modelChoice' is distinct from dec.scope->'modelChoice'
 or dec.scope->>'certificationChallengeId' is distinct from cid::text
 or encode(sha256(convert_to(admission->>'nonce','UTF8')),'hex') is distinct from ch.nonce_hash
 then raise exception 'MODEL_ADMISSION_DENIED' using errcode='23514'; end if;
 if not exists(
 select 1 from model_probe_receipts pr join model_source_configs mc on mc.machine_id=pr.machine_id
 join model_report_receipts mr on mr.id=pr.inventory_report_id
 join model_source_applied ma on ma.machine_id=pr.machine_id and ma.inventory_report_id=mr.id and ma.revision=mc.revision and ma.boot_generation=mr.boot_generation
 join gateway_boots gb on gb.machine_id=mr.machine_id and gb.boot_generation=mr.boot_generation and gb.retired_at is null
 join gateway_configs gc on gc.machine_id=pr.machine_id
 join gateway_applied ga on ga.machine_id=gc.machine_id and ga.revision=gc.revision
 join gateway_install_reports ir on ir.id=ga.latest_report_id and ir.machine_id=gc.machine_id
 where pr.id=(cmd.payload->'modelChoice'->>'probeReceiptId')::uuid and pr.machine_id=new.machine_id
 and pr.context=ch.context and pr.context_sha256=cmd.payload->'modelChoice'->>'probeContextSha256'
 and pr.config_revision=mc.revision and mc.revision=(cmd.payload->'modelChoice'->>'modelConfigRevision')::integer
 and mc.enabled->>pr.runtime='true' and ma.source_status->pr.runtime->>'state'='ready' and pr.status<>'fail' and pr.expires_at>now()
 and cmd.payload->'modelChoice'->'certificationReceiptId'='null'::jsonb
 and cmd.payload->'modelChoice'->'model'->>'machineId'=new.machine_id::text
 and cmd.payload->'modelChoice'->'model'->>'runtime'=pr.runtime
 and cmd.payload->'modelChoice'->'model'->>'providerId'=pr.provider_id
 and cmd.payload->'modelChoice'->'model'->>'modelId'=pr.model_id
 and mr.sequence=(select max(sequence) from model_report_receipts where machine_id=new.machine_id and boot_generation=gb.boot_generation and config_revision=mc.revision and kind='inventory')
 and gc.enabled and ir.response->>'accepted'='true' and ir.config_revision=gc.revision
 and cmd.payload->'selection'->>'installReportId'=ir.id::text
 and (cmd.payload->'selection'->>'configRevision')::integer=gc.revision
 and cmd.payload->'selection'->>'sourceTreeSha256'=ch.context->>'sourceTreeSha256'
 and cmd.payload->'selection'->>'projectionManifestSha256'=ch.context->>'projectionManifestSha256'
 and cmd.payload->'selection'->>'projectionTreeSha256'=ch.context->>'projectionTreeSha256'
 and gc.desired->(new.workflow_pin->>'workflow')->'source'->>'sourceTreeSha256'=ch.context->>'sourceTreeSha256'
 and gc.desired->(new.workflow_pin->>'workflow')->'projections'->pr.runtime->>'manifestSha256'=ch.context->>'projectionManifestSha256'
 and gc.desired->(new.workflow_pin->>'workflow')->'projections'->pr.runtime->>'treeSha256'=ch.context->>'projectionTreeSha256'
 and encode(sha256(convert_to(model_canonical_json(gc.desired->(new.workflow_pin->>'workflow')->'projections'->pr.runtime->'derivation'),'UTF8')),'hex')=ch.context->>'derivationSha256'
 ) then raise exception 'MODEL_ADMISSION_CONTEXT_INVALID' using errcode='23514'; end if;
 update model_certification_challenges set state='admitted',admitted_command_id=new.command_id,admitted_decision_id=dec.id,
 attempt_id=new.id,process_instance_id=new.process_instance_id,admitted_fence=new.fence where id=cid;
 return new;
end; $$;
create trigger model_test_admission_binding after insert on attempts for each row execute function model_bind_test_admission();
-- Guard the 007 generic ACK path too; this never changes the prior three command types.
create function model_sync_completion_guard() returns trigger language plpgsql as $$
begin
 if old.type<>'sync_models' then return new; end if;
 if old.state='completed' and new is distinct from old then raise exception 'MODEL_COMMAND_IMMUTABLE' using errcode='23514'; end if;
 if new.state='completed' and old.state<>'completed' then
   if new.result = '{"ok":false,"code":"SUPERSEDED"}'::jsonb then
     if not exists(select 1 from model_source_configs where machine_id=new.machine_id and revision>(new.payload->>'configRevision')::integer)
       then raise exception 'MODEL_REVISION_NOT_SUPERSEDED' using errcode='23514'; end if;
   elsif not exists(select 1 from model_source_applied a join gateway_boots b on b.machine_id=a.machine_id and b.boot_generation=a.boot_generation and b.retired_at is null where a.machine_id=new.machine_id and a.revision=(new.payload->>'configRevision')::integer)
     then raise exception 'MODEL_CONFIG_NOT_APPLIED' using errcode='23514';
   end if;
 end if;
 return new;
end; $$;
create trigger model_sync_completion before update on gateway_commands for each row execute function model_sync_completion_guard();
