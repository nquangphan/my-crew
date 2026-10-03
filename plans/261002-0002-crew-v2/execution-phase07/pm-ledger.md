# Phase07 PM ledger

## CREWV2-701 — Task1 bootstrap

Status: static preflight, no web implementation accepted.

Ruling: owner authorized complete v2 web rewrite, approved UI and docs/plans in worktree; adding necessary web source coverage is within that approved scope. CREWV2-701 is the PM-assigned actual local work-item key (not a remote ticket). Source/shared/unassigned changes will be limited to web/src and web/scripts coverage, tied to this work item, reviewed and committed with Crew-Owner-Approved: CREWV2-701; protection must be validated explicitly. Wrong ruling costs reversible manifest/source rework, not a deployment.

Detailed plan FIX1 review APPROVED R1–R5; report phase-07-plan-fix1-re-review.md SHA d1f1d4ca741a259bdcdb6b5819ae93fec0644d422c458f2af1bd986747f23364. All live producer gates stay pending. T1 accepted feaea55 only storage/schema/inbox.

Task1 preflight must freeze actual buildApp/captureMigrations/databaseFixture/bootstrapOwner contracts and exact migration prefix001–011. Missing contract or lifecycle ownership blocks its integration acceptance; source milestone never counts as API/DB/browser acceptance.
