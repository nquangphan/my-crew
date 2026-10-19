# 00-06 — Detailed remote prototype plan

Deliverable riêng: detailed implementation plan trước viết prototype, không coi plan là remote proof. Ownership `phase-00-04-implementation.md` và `phase-00-04-plan-report.md` trong thư mục này. Source fork pinned hiện có, v2 source read-only. Không source/lock/schema/hook/credential writes, service/DB/test build hoặc commit. PM ownsledger; không subagents.

Inputs: spec docs/superpowers/specs/2026-10-05-crew-v3-paperclip-design.md, baseline.md, phase-00-core-findings.md/review.md, phase-00-03-report.md và implementation-map.md. Đọc source liên quan theo upstream prerequisite đã hoàn tất; nếu indexed thì CodeGraph trước search. Dùng writing-plans, official workflow giữ pin. User đã cho PM tự thực thi kế hoạch và review; không hỏi lại chọn phương pháp. No Markdown ngoài primaryplans/docs.

Score9=1+U3+C3+I2, actualA high giữ context. Phải trace đúng workspace/environment realization provider, adapter registration/load, persisted run/session/cancellation và reaper adoption seams trước freeze plan. Không giả outbound target hoặc recover hook tồn tại; chỉ đề xuất corepatch hẹp với exact existingfile/exports đã đọc. API credential vẫn ở Mac, devicecredential tách agentJWT; API token thiếu failclosed trước dispatch.

Chia00-04 thành các gate có test độc lập và successor rõ: adapter contract/auth/session; real outbound Mac process với actual core API/DB IDs; cancel/stop/disconnect/restart/adoption. Setup00-03 độc lập phải accepted trước coding/runtime. Cùng coreworker dùng follow-up giữa gates, không gộp mọi phase hay tạo scheduler mới. Include exact source/destination file map/ownership, interface signatures, meaningful failingtest code, commands/count expected, teardown/process registry. File đích mới phải được nói rõ là mới, không giả sourceexisting.

Local disposable DB dùng cổng riêng tránh5432/55432 đang dùng, backup trước mọi schema/data mutation kể cả test DB; plan phải có concretebackup/restore/cleanup strategy và bind localhost/testcompany. Prototype dùng thựcprocess và transport/API/DB, không mock integration acceptance hoặc thuê provider tốn phí. Xác minh test harness existing trước chọn commands/env; không dump/log credential. Không production/VPS deploy.

Remote target repo chỉ tồn tại Mac, không dựng VPS cwd giả. Result/log/session giữ cùng core run; onCancellationReady + signal đúng pinnedcontract. Unknown disconnectedprocess giữ reservation/hold, không spawnreplacement; stop phải physicalproof. Serverrestart cùng run adoption cần durableverifiedidentity/epoch; tests bao gồm ACKlost/replay/staleepoch/crosscompany/cancelstartup. Nếu seam cần corepatch, đóng riêng patch decision + failingcontract trong plan, không copyv2SQLlifecycle.

Kế hoạch runnable cần package registration/workspace/docs source map được review. Kiểm protected files/docsflow permission trước đề xuất mutate; không coi roadmap là blanketapproval. Nếu cần thayprotectedpath ghi exactreason/evidence để PM xử lý authorization已有. Không bịa docsstandard của fork giốngCrewprimary.

Report ngắn: tracefacts/newdecisions, exact task gates/difficulty/models/contextreuse, selfreview(speccoverage/placeholders/typeconsistency/reviewfocus), limits/unresolvedtechnicalQs. Dùng liên kết source/report thay pastewhole source. Giữ plan vừa đủ để agent thực thi, không rewrite upstreamdocs. Không tự execute prototype hoặc mở task sau.
