# 00-03 — Review baseline setup

Đọc phase-00-03-brief.md và phase-00-03-report.md, gồm delta retry1. Ownership reviewer chỉ phase-00-03-review.md trong thư mục plan chính. Fork đọc/selected check tại /Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-v3; expected branchv3/fullSHA8f8a0ab7effbd6a0584107d8038736c134ee5047. PM quản lý ledger/Git. Không source/lock/policy edits, DB, native/fullsuite, agents, commit hoặc push.

Kiểm độc lập spec và quality: refs/remotes/toolchain đúng pin; frozen install exit0/postinstall đúng; preflight và SDK build exit0; loader1file/4tests không giả whole-suite pass; hash lock trước/sau không đổi; tracked diff sạch; evidence firstfailure còn giữ, retry không né kernel warning gate; warning native runner chưa build được ghi scope limitation; own process groups không còn.

Logs/metrics: fork .crew-setup/phase00-03/{install-retry1,preflight-retry1,sdk-retry1,loader-retry1}.{log,metrics.json}, measure.py. Không dump secrets/env. Không bypass hook blockedpaths; command package runner hợp lệ nếu cần check.

Có thể chạy lại duy nhất `corepack pnpm --filter @paperclipai/server exec vitest run src/adapters/plugin-loader.test.ts` khi resource normal; không install lại hoặc broad SDKbuild. Ghi actualcount/exits/skips. Worker report không là evidence duy nhất. Nếu môi trường/hook ngăn xác minh, ghi rõ, không suy PASS từ promise.

Gate chỉ scopedsetup00-03; không chứng nhận Phase00/remote/API/DB/native/release. Findings phải có severity/source/evidence và exactfix expectation; verdict spec/quality riêng, process cleanup. Không sửa implementation hoặc ledger.
