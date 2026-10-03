-- Persistence only. Admission/certification and external proof verification remain deny by default.
create table assistant_designations (
 id uuid primary key, owner_id text not null check(owner_id='owner'),
 machine_id uuid not null references machines(id) on delete restrict,
 revision integer not null unique check(revision>=1), retired_at timestamptz,
 unique(id,revision)
);
create unique index assistant_designation_current on assistant_designations(owner_id) where retired_at is null;
create table assistant_config (
 singleton boolean primary key check(singleton), deployment_id uuid not null unique,
 revision bigint not null check(revision>=1), designation_id uuid references assistant_designations(id) on delete restrict,
 preferred_model jsonb, policy jsonb not null check(jsonb_typeof(policy)='object'), pending_designation jsonb,
 check(preferred_model is null or jsonb_typeof(preferred_model)='object'),
 check(pending_designation is null or jsonb_typeof(pending_designation)='object')
);
insert into assistant_config(singleton,deployment_id,revision,policy) values(true,gen_random_uuid(),1,
 '{"maxJobs":1,"telemetryMaxAgeMs":15000,"maxLoadPerCpu":1,"minMemoryBytes":"4294967296","minDiskBytes":"8589934592","maxTurnsPerRun":1,"maxToolsPerTurn":1,"maxCostUsdPerRun":0,"maxTurnMs":60000,"maxRecoveryAttempts":0,"parallelApprovalId":null}'::jsonb);
create table assistant_monitor (
 singleton boolean primary key check(singleton), cursor bigint not null default 0 check(cursor>=0),
 generation bigint not null default 0 check(generation>=0), lease_owner uuid, lease_expires_at timestamptz,
 next_tick_at timestamptz not null default now(), check((lease_owner is null)=(lease_expires_at is null))
);
insert into assistant_monitor(singleton) values(true);
create table routing_certification_challenges (
 id uuid primary key, deployment_id uuid not null references assistant_config(deployment_id) on delete restrict,
 context jsonb not null check(jsonb_typeof(context)='object'),
 nonce_hash text not null check(nonce_hash ~ '^[0-9a-f]{64}$'), expires_at timestamptz not null,
 budgets jsonb not null check(jsonb_typeof(budgets)='object'),
 fixture_sha256 text not null check(fixture_sha256 ~ '^[0-9a-f]{64}$'),
 state text not null check(state in ('issued','admitted','verified','failed')),
 launch jsonb unique, receipt_id uuid, check(launch is null or jsonb_typeof(launch)='object')
);
create table assistant_calibration_guard (
 singleton boolean primary key check(singleton),
 challenge_id uuid unique references routing_certification_challenges(id) on delete restrict
);
insert into assistant_calibration_guard(singleton) values(true);
create table routing_certification_evidence (
 id uuid primary key, challenge_id uuid not null references routing_certification_challenges(id) on delete restrict,
 body_hash text not null check(body_hash ~ '^[0-9a-f]{64}$'), body jsonb not null check(jsonb_typeof(body)='object'),
 created_at timestamptz not null default now(), unique(challenge_id,body_hash)
);
create table assistant_policy_receipts (
 id uuid primary key, deployment_id uuid not null references assistant_config(deployment_id) on delete restrict,
 challenge_id uuid not null references routing_certification_challenges(id) on delete restrict,
 verifier_build_sha256 text not null check(verifier_build_sha256 ~ '^[0-9a-f]{64}$'),
 machine_id uuid not null references machines(id) on delete restrict,
 model_key jsonb not null check(jsonb_typeof(model_key)='object'), os_version text not null,
 binary_sha256 text not null check(binary_sha256 ~ '^[0-9a-f]{64}$'),
 policy_sha256 text not null check(policy_sha256 ~ '^[0-9a-f]{64}$'),
 probe_context_sha256 text not null check(probe_context_sha256 ~ '^[0-9a-f]{64}$'),
 status text not null check(status in ('PASS','FAIL','UNVERIFIED')),
 evidence_ids jsonb not null check(jsonb_typeof(evidence_ids)='array'), expires_at timestamptz not null, revoked_at timestamptz
);
alter table routing_certification_challenges add constraint assistant_challenge_receipt_fk
 foreign key(receipt_id) references assistant_policy_receipts(id) on delete restrict deferrable initially deferred;
create table routing_capability_receipts (
 id uuid primary key, certification_receipt_id uuid not null references assistant_policy_receipts(id) on delete restrict,
 model_key jsonb not null check(jsonb_typeof(model_key)='object'),
 context_sha256 text not null check(context_sha256 ~ '^[0-9a-f]{64}$'),
 capabilities jsonb not null check(jsonb_typeof(capabilities)='array'),
 received_at timestamptz not null, expires_at timestamptz not null check(expires_at>received_at),
 unique(id,certification_receipt_id)
);
create table assistant_turns (
 id uuid primary key, conversation_id uuid not null references attachment_conversations(id) on delete restrict,
 message_id uuid references attachment_messages(id) on delete restrict,
 designation_id uuid not null, designation_revision integer not null check(designation_revision>=1),
 generation bigint not null unique check(generation>=1), process_instance_id uuid not null unique,
 model_selection_id uuid not null unique, admission_id uuid unique,
 read_session_id uuid references attachment_assistant_sessions(id) on delete restrict,
 state text not null check(state in ('reserved','running','uncertain','finalizing','stopped')),
 checkpoint_artifact_id uuid, stop_evidence_id uuid,
 created_at timestamptz not null default now(), finalized_at timestamptz,
 foreign key(designation_id,designation_revision) references assistant_designations(id,revision) on delete restrict,
 foreign key(admission_id) references attachment_assistant_sessions(admission_id) on delete restrict deferrable initially deferred,
 check((state='stopped')=(finalized_at is not null)), check(state<>'stopped' or stop_evidence_id is not null),
 unique(id,generation)
);
create unique index assistant_single_live_turn on assistant_turns((true)) where state<>'stopped';
create table assistant_model_selections (
 id uuid primary key, turn_id uuid not null unique references assistant_turns(id) on delete restrict deferrable initially deferred,
 model_key jsonb not null check(jsonb_typeof(model_key)='object'), model_config_revision bigint not null check(model_config_revision>=1),
 probe_receipt_id uuid not null, policy_receipt_id uuid not null,
 required jsonb not null check(jsonb_typeof(required)='array'), rationale text not null, created_at timestamptz not null default now(),
 foreign key(probe_receipt_id,policy_receipt_id) references routing_capability_receipts(id,certification_receipt_id) on delete restrict,
 unique(id,turn_id)
);
alter table assistant_turns add constraint assistant_turn_selection_fk
 foreign key(model_selection_id,id) references assistant_model_selections(id,turn_id) on delete restrict deferrable initially deferred;
create table assistant_scopes (
 id uuid primary key, turn_id uuid not null references assistant_turns(id) on delete restrict,
 root_ticket_id uuid references tickets(id) on delete restrict, message_id uuid references attachment_messages(id) on delete restrict,
 project_id uuid references projects(id) on delete restrict,
 actions jsonb not null check(jsonb_typeof(actions)='array'), tool_names jsonb not null check(jsonb_typeof(tool_names)='array'),
 input_snapshot_id uuid not null references attachment_input_snapshots(id) on delete restrict,
 scope_sha256 text not null check(scope_sha256 ~ '^[0-9a-f]{64}$'), owner_authorization_id uuid not null, expires_at timestamptz not null,
 check((root_ticket_id is null)<>(message_id is null)), check(project_id is not null or message_id is not null),
 check(actions <@ '["create_ticket","decision","dependency","command","signal"]'::jsonb),
 check(tool_names <@ '["read_catalog","read_docs","route_message","read_execution_candidates","assess_ticket","ask_owner","create_run","request_dispatch","request_review","publish_reply"]'::jsonb)
);
create table assistant_work_inbox (
 id uuid primary key, logical_key text not null unique, source_cursor bigint references events(cursor) on delete restrict,
 target_kind text not null check(target_kind in ('ticket','message')), target_id uuid not null,
 input_revision bigint check(input_revision>=1), state text not null check(state in ('pending','claimed','acked')),
 turn_id uuid, claim_generation bigint, next_due_at timestamptz not null default now(),
 attempts integer not null default 0 check(attempts>=0), acked_at timestamptz,
 foreign key(turn_id,claim_generation) references assistant_turns(id,generation) on delete restrict,
 check((turn_id is null)=(claim_generation is null)), check((state='pending')=(turn_id is null)),
 check((state='acked')=(acked_at is not null))
);
create unique index assistant_input_work_revision on assistant_work_inbox(target_kind,target_id,input_revision) where input_revision is not null;
create index assistant_work_due on assistant_work_inbox(state,next_due_at,id);
create table workflow_runs (
 id uuid primary key, root_ticket_id uuid not null references tickets(id) on delete restrict,
 source jsonb not null check(jsonb_typeof(source)='object'), projection jsonb not null check(jsonb_typeof(projection)='object'),
 definition_sha256 text not null check(definition_sha256 ~ '^[0-9a-f]{64}$'),
 customization_sha256 text not null check(customization_sha256 ~ '^[0-9a-f]{64}$'), rendered_artifact_id uuid,
 path text not null check(path in ('architectural','bounded','bug','spike','bmad-dispatch','bmad-oneshot')),
 revision integer not null check(revision>=1), parallel_approval_id uuid references decisions(id) on delete restrict
);
create table workflow_steps (
 id uuid primary key, run_id uuid not null references workflow_runs(id) on delete restrict,
 ticket_id uuid not null unique references tickets(id) on delete restrict, skill text not null, source_path text not null,
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 predecessor_ids jsonb not null check(jsonb_typeof(predecessor_ids)='array'), acceptance jsonb not null check(jsonb_typeof(acceptance)='array'),
 output_kinds jsonb not null check(jsonb_typeof(output_kinds)='array'), gate_ids jsonb not null check(jsonb_typeof(gate_ids)='array'),
 ownership_keys jsonb not null check(jsonb_typeof(ownership_keys)='array'), role text not null check(role in ('implement','review','fix','research')),
 unique(id,run_id)
);
create table workflow_gates (
 id uuid primary key, run_id uuid not null references workflow_runs(id) on delete restrict, step_id uuid not null,
 kind text not null, source_path text not null, source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 artifact_sha256 text not null check(artifact_sha256 ~ '^[0-9a-f]{64}$'), scope_sha256 text not null check(scope_sha256 ~ '^[0-9a-f]{64}$'),
 required_actor text not null check(required_actor in ('owner','delegated')), decision_id uuid references decisions(id) on delete restrict,
 state text not null check(state in ('pending','approved','rejected','superseded')),
 foreign key(step_id,run_id) references workflow_steps(id,run_id) on delete restrict, unique(id,step_id,run_id)
);
create table assistant_questions (
 id uuid primary key, conversation_id uuid not null references attachment_conversations(id) on delete restrict,
 ticket_id uuid references tickets(id) on delete restrict, run_id uuid references workflow_runs(id) on delete restrict,
 step_id uuid, gate_id uuid, cycle_id uuid, artifact_sha256 text check(artifact_sha256 ~ '^[0-9a-f]{64}$'),
 question text not null, options jsonb not null check(jsonb_typeof(options)='array'),
 scope_sha256 text not null check(scope_sha256 ~ '^[0-9a-f]{64}$'), revision integer not null check(revision>=1),
 state text not null check(state in ('open','answered','superseded')),
 foreign key(step_id,run_id) references workflow_steps(id,run_id) on delete restrict,
 foreign key(gate_id,step_id,run_id) references workflow_gates(id,step_id,run_id) on delete restrict,
 check(step_id is null or run_id is not null), check(gate_id is null or step_id is not null)
);
create table assistant_answers (
 id uuid primary key, question_id uuid not null references assistant_questions(id) on delete restrict,
 question_revision integer not null check(question_revision>=1), body jsonb not null,
 actor_kind text not null check(actor_kind in ('owner','machine')), decision_id uuid references decisions(id) on delete restrict,
 created_at timestamptz not null default now(), unique(question_id,question_revision)
);
create table assistant_assessments (
 id uuid primary key, ticket_id uuid not null references tickets(id) on delete restrict,
 input_snapshot_id uuid not null references attachment_input_snapshots(id) on delete restrict,
 body jsonb not null check(jsonb_typeof(body)='object'), hash text not null check(hash ~ '^[0-9a-f]{64}$')
);
create table assistant_dispatches (
 command_id uuid primary key references commands(id) on delete restrict, decision_id uuid not null references decisions(id) on delete restrict,
 run_id uuid not null references workflow_runs(id) on delete restrict, step_id uuid not null,
 assessment_id uuid not null references assistant_assessments(id) on delete restrict,
 permit jsonb not null check(jsonb_typeof(permit)='object'), admitted_at timestamptz,
 foreign key(step_id,run_id) references workflow_steps(id,run_id) on delete restrict
);
create table assistant_capacity_requests (
 id uuid primary key, machine_id uuid not null references machines(id) on delete restrict,
 ticket_id uuid not null references tickets(id) on delete restrict, kind text not null check(kind in ('implement','review','fix')),
 ownership_keys jsonb not null check(jsonb_typeof(ownership_keys)='array'), boot_generation text not null,
 requested_at timestamptz not null, expires_at timestamptz not null check(expires_at>requested_at), receipt_id uuid unique,
 request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
 unique(id,machine_id)
);
create table assistant_capacity_receipts (
 id uuid primary key, request_id uuid not null, machine_id uuid not null references machines(id) on delete restrict,
 boot_generation text not null, ticket_id uuid not null references tickets(id) on delete restrict,
 kind text not null check(kind in ('implement','review','fix')), ownership_keys jsonb not null check(jsonb_typeof(ownership_keys)='array'),
 telemetry jsonb not null check(jsonb_typeof(telemetry)='object'), received_at timestamptz not null,
 expires_at timestamptz not null check(expires_at>received_at), allowed boolean not null, reason text not null,
 receipt_sha256 text not null check(receipt_sha256 ~ '^[0-9a-f]{64}$'),
 foreign key(request_id,machine_id) references assistant_capacity_requests(id,machine_id) on delete restrict,
 unique(machine_id,request_id), unique(id,request_id), unique(id,machine_id)
);
alter table assistant_capacity_requests add constraint assistant_capacity_request_receipt_fk
 foreign key(receipt_id,id) references assistant_capacity_receipts(id,request_id) on delete restrict deferrable initially deferred;
create table assistant_reservations (
 id uuid primary key, command_id uuid not null unique references commands(id) on delete restrict,
 receipt_id uuid not null, machine_id uuid not null references machines(id) on delete restrict,
 ownership_keys jsonb not null check(jsonb_typeof(ownership_keys)='array'),
 state text not null check(state in ('reserved','active','retiring','released')),
 foreign key(receipt_id,machine_id) references assistant_capacity_receipts(id,machine_id) on delete restrict
);
create table assistant_interventions (
 id uuid primary key, work_id uuid not null references assistant_work_inbox(id) on delete restrict,
 action text not null, reason text not null, policy_receipt_ids jsonb not null check(jsonb_typeof(policy_receipt_ids)='array'),
 state_digest text not null check(state_digest ~ '^[0-9a-f]{64}$'), operation_id uuid not null unique,
 next_retry_at timestamptz, attempts integer not null default 0 check(attempts>=0), unique(work_id,action,state_digest)
);
create table assistant_operation_ids (
 id uuid primary key, run_id uuid not null references workflow_runs(id) on delete restrict,
 step_id uuid not null, action_kind text not null, target_identity text not null,
 precondition_sha256 text not null check(precondition_sha256 ~ '^[0-9a-f]{64}$'),
 effect_id text not null unique check(effect_id ~ '^[0-9a-f]{64}$'),
 foreign key(step_id,run_id) references workflow_steps(id,run_id) on delete restrict,
 unique(step_id,action_kind,target_identity,precondition_sha256)
);
create table assistant_text_receipts (
 id uuid primary key, session_id uuid not null references attachment_assistant_sessions(id) on delete restrict,
 snapshot_id uuid not null references attachment_input_snapshots(id) on delete restrict,
 snapshot_sha256 text not null check(snapshot_sha256 ~ '^[0-9a-f]{64}$'), comments jsonb not null check(jsonb_typeof(comments)='array'),
 message_sha256 text check(message_sha256 ~ '^[0-9a-f]{64}$'), transport_sha256 text not null check(transport_sha256 ~ '^[0-9a-f]{64}$'),
 trust text not null check(trust='reported_transport'), created_at timestamptz not null default now()
);
create table assistant_budget_reservations (
 id uuid primary key, scope_kind text not null check(scope_kind in ('conversation','run')), scope_id uuid not null,
 turn_id uuid references assistant_turns(id) on delete restrict, command_id uuid unique references commands(id) on delete restrict,
 reserved_usd numeric not null check(reserved_usd>=0 and reserved_usd<'Infinity'::numeric),
 spent_usd numeric not null default 0 check(spent_usd>=0 and spent_usd<'Infinity'::numeric),
 state text not null check(state in ('reserved','settled','uncertain')), receipt_sha256 text check(receipt_sha256 ~ '^[0-9a-f]{64}$')
);
create table assistant_route_authorizations (
 route_id uuid primary key references attachment_message_routes(id) on delete restrict,
 parent_authorization_id uuid not null references attachment_submission_authorizations(id) on delete restrict,
 derived_authorization_id uuid not null unique references attachment_submission_authorizations(id) on delete restrict,
 parent_scope_sha256 text not null check(parent_scope_sha256 ~ '^[0-9a-f]{64}$'),
 check(parent_authorization_id<>derived_authorization_id)
);
create table assistant_dispatch_retirements (
 command_id uuid primary key references commands(id) on delete restrict, retirement_id uuid not null unique,
 reason text not null check(reason in ('expired','input_changed','source_off','superseded')),
 retired_at timestamptz not null default now(), proof jsonb, released_at timestamptz,
 check(proof is null or jsonb_typeof(proof)='object'), check(released_at is null or proof is not null)
);
create table assistant_launch_authorizations (
 command_id uuid primary key references commands(id) on delete restrict, id uuid not null unique,
 machine_id uuid not null references machines(id) on delete restrict, process_instance_id uuid not null,
 boot_generation text not null, generation bigint not null check(generation>=1), expires_at timestamptz not null,
 state text not null check(state in ('issued','retired','claimed','closed')),
 attempt_id uuid unique references attempts(id) on delete restrict,
 check(state<>'claimed' or attempt_id is not null)
);
create table assistant_tool_operations (
 operation_id uuid primary key, turn_id uuid not null references assistant_turns(id) on delete restrict,
 client_sequence bigint not null check(client_sequence>=1), provider_call_id text not null,
 request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
 input_snapshot_id uuid not null references attachment_input_snapshots(id) on delete restrict,
 state text not null check(state in ('completed','pending','rejected')), response jsonb,
 unique(turn_id,client_sequence), check(response is null or jsonb_typeof(response)='object'),
 check(state='pending' or response is not null)
);
create table assistant_doc_read_receipts (
 id uuid primary key, turn_id uuid not null references assistant_turns(id) on delete restrict,
 snapshot_id uuid not null, path text not null, sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 foreign key(snapshot_id,path) references docs_files(snapshot_id,path) on delete restrict
);

-- Mutable columns are explicit. Immutable history cannot be deleted or reassigned.
create function assistant_keep_record() returns trigger language plpgsql as $$
begin
 if TG_OP='DELETE' then raise exception 'ASSISTANT_RECORD_IMMUTABLE'; end if;
 if (to_jsonb(NEW)-coalesce(TG_ARGV,array[]::text[])) is distinct from (to_jsonb(OLD)-coalesce(TG_ARGV,array[]::text[])) then
  raise exception 'ASSISTANT_RECORD_IMMUTABLE';
 end if;
 return NEW;
end $$;
create trigger assistant_config_identity before update or delete on assistant_config for each row
 execute function assistant_keep_record('revision','designation_id','preferred_model','policy','pending_designation');
create trigger assistant_designation_identity before update or delete on assistant_designations for each row execute function assistant_keep_record('retired_at');
create trigger assistant_turn_identity before update or delete on assistant_turns for each row
 execute function assistant_keep_record('admission_id','read_session_id','state','checkpoint_artifact_id','stop_evidence_id','finalized_at');
create trigger assistant_selection_identity before update or delete on assistant_model_selections for each row execute function assistant_keep_record();
create trigger assistant_policy_identity before update or delete on assistant_policy_receipts for each row execute function assistant_keep_record('revoked_at');
create trigger assistant_capability_identity before update or delete on routing_capability_receipts for each row execute function assistant_keep_record();
create trigger assistant_challenge_identity before update or delete on routing_certification_challenges for each row execute function assistant_keep_record('state','launch','receipt_id');
create trigger assistant_certification_evidence_identity before update or delete on routing_certification_evidence for each row execute function assistant_keep_record();
create trigger assistant_scope_identity before update or delete on assistant_scopes for each row execute function assistant_keep_record();
create trigger assistant_work_identity before update or delete on assistant_work_inbox for each row
 execute function assistant_keep_record('state','turn_id','claim_generation','next_due_at','attempts','acked_at');
create trigger assistant_run_identity before update or delete on workflow_runs for each row execute function assistant_keep_record('rendered_artifact_id','revision');
create trigger assistant_step_identity before update or delete on workflow_steps for each row execute function assistant_keep_record();
create trigger assistant_gate_identity before update or delete on workflow_gates for each row execute function assistant_keep_record('decision_id','state');
create trigger assistant_question_identity before update or delete on assistant_questions for each row execute function assistant_keep_record('state');
create trigger assistant_answer_identity before update or delete on assistant_answers for each row execute function assistant_keep_record();
create trigger assistant_assessment_identity before update or delete on assistant_assessments for each row execute function assistant_keep_record();
create trigger assistant_dispatch_identity before update or delete on assistant_dispatches for each row execute function assistant_keep_record('admitted_at');
create trigger assistant_capacity_request_identity before update or delete on assistant_capacity_requests for each row execute function assistant_keep_record('receipt_id');
create trigger assistant_capacity_receipt_identity before update or delete on assistant_capacity_receipts for each row execute function assistant_keep_record();
create trigger assistant_reservation_identity before update or delete on assistant_reservations for each row execute function assistant_keep_record('state');
create trigger assistant_intervention_identity before update or delete on assistant_interventions for each row execute function assistant_keep_record('next_retry_at','attempts');
create trigger assistant_operation_identity before update or delete on assistant_operation_ids for each row execute function assistant_keep_record();
create trigger assistant_text_receipt_identity before update or delete on assistant_text_receipts for each row execute function assistant_keep_record();
create trigger assistant_budget_identity before update or delete on assistant_budget_reservations for each row execute function assistant_keep_record('spent_usd','state','receipt_sha256');
create trigger assistant_route_authorization_identity before update or delete on assistant_route_authorizations for each row execute function assistant_keep_record();
create trigger assistant_retirement_identity before update or delete on assistant_dispatch_retirements for each row execute function assistant_keep_record('proof','released_at');
create trigger assistant_launch_identity before update or delete on assistant_launch_authorizations for each row execute function assistant_keep_record('state','attempt_id');
create trigger assistant_tool_identity before update or delete on assistant_tool_operations for each row execute function assistant_keep_record('state','response');
create trigger assistant_doc_receipt_identity before update or delete on assistant_doc_read_receipts for each row execute function assistant_keep_record();

create function assistant_check_turn_message() returns trigger language plpgsql as $$
begin
 if NEW.message_id is not null and not exists(select 1 from attachment_messages where id=NEW.message_id and conversation_id=NEW.conversation_id) then
  raise exception 'ASSISTANT_MESSAGE_CONVERSATION_MISMATCH';
 end if;
 return NEW;
end $$;
create trigger assistant_turn_message before insert on assistant_turns for each row execute function assistant_check_turn_message();

-- The additive hook preserves 005 claim and applies only to Assistant dispatches.
create function assistant_bind_claimed_attempt() returns trigger language plpgsql as $$
declare launch assistant_launch_authorizations%rowtype;
begin
 if not exists(select 1 from assistant_dispatches where command_id=NEW.command_id) then return NEW; end if;
 select * into launch from assistant_launch_authorizations where command_id=NEW.command_id for update;
 if not found or launch.machine_id<>NEW.machine_id or launch.process_instance_id::text<>NEW.process_instance_id
   or launch.state<>'issued' or launch.expires_at<=clock_timestamp()
   or exists(select 1 from assistant_dispatch_retirements where command_id=NEW.command_id) then
  raise exception 'ASSISTANT_PRELAUNCH_REQUIRED';
 end if;
 update assistant_reservations set state='active' where command_id=NEW.command_id and machine_id=NEW.machine_id and state='reserved';
 if not found then raise exception 'ASSISTANT_RESERVATION_REQUIRED'; end if;
 update assistant_launch_authorizations set state='claimed',attempt_id=NEW.id where command_id=NEW.command_id;
 return NEW;
end $$;
create trigger assistant_attempt_prelaunch after insert on attempts for each row execute function assistant_bind_claimed_attempt();

create function assistant_latch_fields() returns trigger language plpgsql as $$
declare field_name text;
begin
 foreach field_name in array TG_ARGV loop
  if to_jsonb(OLD)->field_name is distinct from 'null'::jsonb and
     to_jsonb(OLD)->field_name is distinct from to_jsonb(NEW)->field_name then
   raise exception 'ASSISTANT_RECORD_LATCHED';
  end if;
 end loop;
 return NEW;
end $$;
create trigger assistant_challenge_latches before update on routing_certification_challenges for each row execute function assistant_latch_fields('launch','receipt_id');
create trigger assistant_policy_revocation_latch before update on assistant_policy_receipts for each row execute function assistant_latch_fields('revoked_at');
create trigger assistant_designation_retirement_latch before update on assistant_designations for each row execute function assistant_latch_fields('retired_at');
create trigger assistant_turn_admission_latch before update on assistant_turns for each row execute function assistant_latch_fields('admission_id','read_session_id','stop_evidence_id','finalized_at');
create trigger assistant_gate_decision_latch before update on workflow_gates for each row execute function assistant_latch_fields('decision_id');
create trigger assistant_dispatch_admission_latch before update on assistant_dispatches for each row execute function assistant_latch_fields('admitted_at');
create trigger assistant_capacity_receipt_latch before update on assistant_capacity_requests for each row execute function assistant_latch_fields('receipt_id');
create trigger assistant_retirement_proof_latch before update on assistant_dispatch_retirements for each row execute function assistant_latch_fields('proof','released_at');
create trigger assistant_launch_attempt_latch before update on assistant_launch_authorizations for each row execute function assistant_latch_fields('attempt_id');

create function assistant_check_receipt_context() returns trigger language plpgsql as $$
declare context_value jsonb;
begin
 select context into context_value from routing_certification_challenges where id=NEW.challenge_id;
 if context_value->>'deploymentId' is distinct from NEW.deployment_id::text
   or context_value->>'machineId' is distinct from NEW.machine_id::text
   or context_value->'key' is distinct from NEW.model_key
   or context_value->>'binarySha256' is distinct from NEW.binary_sha256
   or context_value->>'policySha256' is distinct from NEW.policy_sha256
   or context_value->>'osVersion' is distinct from NEW.os_version
   or NEW.model_key->>'machineId' is distinct from NEW.machine_id::text then
  raise exception 'ASSISTANT_CERTIFICATION_CONTEXT_MISMATCH';
 end if;
 return NEW;
end $$;
create trigger assistant_receipt_context before insert on assistant_policy_receipts for each row execute function assistant_check_receipt_context();
create function assistant_check_capability_context() returns trigger language plpgsql as $$
declare receipt assistant_policy_receipts%rowtype;
begin
 select * into receipt from assistant_policy_receipts where id=NEW.certification_receipt_id;
 if not found or receipt.model_key is distinct from NEW.model_key
   or receipt.probe_context_sha256 is distinct from NEW.context_sha256
   or NEW.expires_at>receipt.expires_at then raise exception 'ASSISTANT_CAPABILITY_CONTEXT_MISMATCH'; end if;
 return NEW;
end $$;
create trigger assistant_capability_context before insert on routing_capability_receipts for each row execute function assistant_check_capability_context();

create function assistant_check_scope_target() returns trigger language plpgsql as $$
declare snapshot attachment_input_snapshots%rowtype;
begin
 select * into snapshot from attachment_input_snapshots where id=NEW.input_snapshot_id;
 if not found then raise exception 'ASSISTANT_SCOPE_SNAPSHOT_MISSING'; end if;
 if NEW.root_ticket_id is not null then
  if snapshot.target_kind<>'ticket' or snapshot.target_id<>NEW.root_ticket_id or
    not exists(select 1 from tickets where id=NEW.root_ticket_id and root_id=NEW.root_ticket_id and project_id=NEW.project_id) then
   raise exception 'ASSISTANT_SCOPE_TARGET_MISMATCH';
  end if;
 else
  if snapshot.target_kind<>'message' or snapshot.target_id<>NEW.message_id then raise exception 'ASSISTANT_SCOPE_TARGET_MISMATCH'; end if;
  if NEW.project_id is not null and not exists(select 1 from attachment_message_routes where message_id=NEW.message_id and project_id=NEW.project_id and revoked_at is null) then
   raise exception 'ASSISTANT_SCOPE_PROJECT_MISMATCH';
  end if;
 end if;
 return NEW;
end $$;
create trigger assistant_scope_target before insert on assistant_scopes for each row execute function assistant_check_scope_target();

create function assistant_check_work_target() returns trigger language plpgsql as $$
begin
 if (NEW.target_kind='message' and not exists(select 1 from attachment_messages where id=NEW.target_id)) or
    (NEW.target_kind='ticket' and not exists(select 1 from tickets where id=NEW.target_id)) then
  raise exception 'ASSISTANT_WORK_TARGET_MISSING';
 end if;
 return NEW;
end $$;
create trigger assistant_work_target before insert on assistant_work_inbox for each row execute function assistant_check_work_target();

create function assistant_keep_terminal_work() returns trigger language plpgsql as $$
begin
 if OLD.state='acked' and NEW is distinct from OLD then raise exception 'ASSISTANT_ACK_IMMUTABLE'; end if;
 return NEW;
end $$;
create trigger assistant_work_terminal before update on assistant_work_inbox for each row execute function assistant_keep_terminal_work();
create function assistant_keep_tool_result() returns trigger language plpgsql as $$
begin
 if OLD.state<>'pending' and NEW is distinct from OLD then raise exception 'ASSISTANT_TOOL_RESULT_IMMUTABLE'; end if;
 return NEW;
end $$;
create trigger assistant_tool_terminal before update on assistant_tool_operations for each row execute function assistant_keep_tool_result();

create function assistant_check_budget() returns trigger language plpgsql as $$
begin
 if TG_OP='INSERT' then
  if (NEW.scope_kind='conversation' and not exists(select 1 from attachment_conversations where id=NEW.scope_id)) or
     (NEW.scope_kind='run' and not exists(select 1 from workflow_runs where id=NEW.scope_id)) then
   raise exception 'ASSISTANT_BUDGET_SCOPE_MISSING';
  end if;
 else
  if NEW.spent_usd<OLD.spent_usd or (OLD.state='settled' and NEW is distinct from OLD) or
     (OLD.state='uncertain' and NEW.state='reserved') then raise exception 'ASSISTANT_BUDGET_REWIND'; end if;
 end if;
 if NEW.state='settled' and NEW.receipt_sha256 is null then raise exception 'ASSISTANT_BUDGET_RECEIPT_REQUIRED'; end if;
 return NEW;
end $$;
create trigger assistant_budget_guard before insert or update on assistant_budget_reservations for each row execute function assistant_check_budget();

create function assistant_check_reservation_release() returns trigger language plpgsql as $$
declare attempt attempts%rowtype; retirement assistant_dispatch_retirements%rowtype; launch assistant_launch_authorizations%rowtype;
begin
 if OLD.state='released' and NEW.state<>'released' then raise exception 'ASSISTANT_RESERVATION_RELEASED'; end if;
 if NEW.state<>'released' or OLD.state='released' then return NEW; end if;
 select * into attempt from attempts where command_id=NEW.command_id;
 if found then
  if attempt.state<>'stopped' or attempt.stopped_at is null or attempt.finalized_at is null then raise exception 'ASSISTANT_FINALIZATION_REQUIRED'; end if;
  return NEW;
 end if;
 select * into retirement from assistant_dispatch_retirements where command_id=NEW.command_id;
 if not found or retirement.proof is null or retirement.released_at is null or
    retirement.proof->>'commandId' is distinct from NEW.command_id::text then raise exception 'ASSISTANT_RETIREMENT_PROOF_REQUIRED'; end if;
 select * into launch from assistant_launch_authorizations where command_id=NEW.command_id;
 if not found then
  if retirement.proof->>'kind' is distinct from 'never-authorized' or
     retirement.proof->>'retirementId' is distinct from retirement.retirement_id::text then raise exception 'ASSISTANT_NO_LAUNCH_PROOF_REQUIRED'; end if;
 else
  if coalesce(retirement.proof->>'kind','') not in ('journal-no-launch','process-stopped') or launch.state<>'closed' or
    retirement.proof->>'launchAuthorizationId' is distinct from launch.id::text or
    retirement.proof->>'processInstanceId' is distinct from launch.process_instance_id::text or
    retirement.proof->>'bootGeneration' is distinct from launch.boot_generation or
    retirement.proof->>'generation' is distinct from launch.generation::text or
    coalesce(retirement.proof->>'journalSha256','') !~ '^[0-9a-f]{64}$' or
    coalesce(retirement.proof->>'stopEvidenceId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
   raise exception 'ASSISTANT_STOP_PROOF_REQUIRED';
  end if;
 end if;
 return NEW;
end $$;
create trigger assistant_reservation_release before update on assistant_reservations for each row execute function assistant_check_reservation_release();

create function assistant_check_route_consent() returns trigger language plpgsql as $$
declare parent attachment_submission_authorizations%rowtype; derived attachment_submission_authorizations%rowtype; route attachment_message_routes%rowtype;
begin
 select * into route from attachment_message_routes where id=NEW.route_id;
 if not found then raise exception 'ASSISTANT_ROUTE_CONSENT_MISMATCH'; end if;
 select * into parent from attachment_submission_authorizations where id=NEW.parent_authorization_id;
 if not found then raise exception 'ASSISTANT_ROUTE_CONSENT_MISMATCH'; end if;
 select * into derived from attachment_submission_authorizations where id=NEW.derived_authorization_id;
 if not found or route.revoked_at is not null or parent.revoked_at is not null or derived.revoked_at is not null
   or parent.target_kind<>'message' or parent.target_id<>route.message_id
   or derived.target_kind<>'ticket' or derived.target_id<>route.ticket_id
   or parent.authorization_sha256<>NEW.parent_scope_sha256 or parent.owner_id<>derived.owner_id
   or derived.expires_at>parent.expires_at or (derived.allow_original and not parent.allow_original)
   or jsonb_typeof(derived.originals)<>'array' or jsonb_typeof(parent.originals)<>'array' then
  raise exception 'ASSISTANT_ROUTE_CONSENT_MISMATCH';
 end if;
 if exists(select 1 from jsonb_array_elements(derived.originals) d
    where not exists(select 1 from jsonb_array_elements(parent.originals) p where p=d)) then
  raise exception 'ASSISTANT_ROUTE_CONSENT_MISMATCH';
 end if;
 return NEW;
end $$;
create trigger assistant_route_consent before insert on assistant_route_authorizations for each row execute function assistant_check_route_consent();
