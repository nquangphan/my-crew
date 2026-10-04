# Checkpoint PM Crew v2 — 04/10/2026 14:35 (Claude Code)

Bổ sung cho `handover-261004-0913-crew-v2.md`. Nhánh `codex/crew-v2-server`, worktree `/Volumes/CORSAIR/Projects/my-crew-v2`. Các commit dưới đây **chưa push** (chờ owner bảo "push"). Ledger chi tiết và mọi ruling: `plans/261002-0002-crew-v2/execution-phase06/progress.md` và `execution-phase07/pm-ledger.md`. Không redispatch task đã có dòng `complete`.

## Quy tắc vận hành đang áp dụng

- Quota: chạy tới khi quota tuần còn 5% thì dừng dispatch (owner sửa từ 25%). Đọc `$TMPDIR/ck-usage-limits-cache.json` → `data.seven_day.utilization`.
- Slot nặng: `mkdir $TMPDIR/crew-v2-heavy-slot.lock`, chỉ chạy khi `pm-telemetry.py` trả `heavyEligible=true`; nối lệnh bằng `&&`.
- Manifest docs: lock riêng `$TMPDIR/crew-v2-manifest.lock`, chỉ thêm hunk của mình.
- Mỗi worker một scratch riêng `$TMPDIR/crew-v2-<owner>/`; kiểm import không trỏ file chưa track; commit theo pathspec; không amend; không ghi vào log của task khác.
- Node v24.21.0 (Homebrew `node@24`). Owner đã duyệt: nút "Bỏ" draft có cảnh báo trùng; devDeps jsdom 30.1.1, @testing-library/react 16.3.3, @testing-library/dom 10.4.2.

## Đã nghiệm thu trong phiên này

Phase06 (server Trợ lý), production vẫn deny/503:

| Slice | Commit cuối | Ghi chú |
|---|---|---|
| T2 B2a scoped decision/dependency | `213cc5d` | GREEN 118 |
| T2 B2b-i scoped signal | `e9cdd37` | running wait_owner → 409 |
| T2-C (S2) positive resolver + port | `c54efb5` | single-use op cùng Tx, grant check |
| T3-D2 gateway definition hai tầng | `57601b9` | BMAD chỉ runtime claude |
| S3b install report definition | `963dc31` | phase03-owner chấp thuận |
| T3-S1 (S4) createRun + graph auth | `01367a9` | request_hash tag `crew-v2:operation-request:1` |
| T3-S2 (S5) gates | `cb02a7d` | một artifact hiện hành mỗi gate |
| B3a route tool server | `c348950` | read_catalog/read_docs/create_run/ask_owner; còn lại TOOL_NOT_RELEASED |

Phase07 (web) + producer:

| Mục | Commit cuối |
|---|---|
| Task1 FIX2 (A1) | `d3f092f` |
| Task2 auth/transport/SSE (A2) + follow-up | `6c35218`, `c4ab472` |
| Nối router | `e2dd3e4` |
| S3a tickets đọc | `167f79c` |
| S5a composer + API discardDraft | `cccbae1`, `bdf277d` |
| S6docs | `cfc233c` |
| S3b create-request/compose | `ab1bb3a` |
| Controller integration (routes, providers, fixture attachments) | `30a1d54` |
| Producer P-G2 (mount attachments, by-comment) | `b39f2fb` |
| Producer P-G1a (level/history/docs-links/latest) + P-G1a2 (graph snapshot) | `78bf6c3`, `148875a` |
| A5/A3 text-only E2E thật | `62fd150` |

## Việc kế tiếp (thứ tự đề xuất)

1. Phase06: B3b gateway `tool-client.ts` (carrier `x-crew-provider-call-id`, không dấu phẩy; băm bằng `operationRequestSha256`), rồi S6 render executor uv + workspace (cần transfer phase03), T4 assessment/admission (checklist N1/N2/W2/W7 trong progress.md), T5–T7.
2. Phase07: S4 graph/map (cần A3), S6assistant/attention (chờ G3), S7 onboarding/machines, A5/A3 với file (chờ phase05 extractor certified), lượt minor C1–C3/D1–D4 composer.
3. Assembly/T7: nối `main.ts` attachments (Linux host), mount port/resolver/tool route, `createWorkflowManifest(registry)`, chạy lại test dưới AJV của buildApp.
4. Trước merge: whole-branch review + triage toàn bộ dòng `minor (deferred)` trong hai ledger (đặc biệt Task2 B1, S5a C1–C3/D1–D4, S3b N1–N5).

## Cần owner

- Push các commit trên khi owner đồng ý.
- Máy dự án cần `uv` cho BMAD (S6); máy hiện tại đã có `~/.local/bin/uv`.

## Cập nhật 04/10 19:40

Đã push lần 1 (`0c35a43..5e852b5`). Sau đó nghiệm thu thêm (chưa push, 32 commit):

| Mục | Commit cuối | Ghi chú |
|---|---|---|
| B3a route tool server | `c348950` | catalog `truncated`, latestSnapshotId verified |
| B3b gateway tool-client | `586da9c` | carrier `x-crew-provider-call-id` không dấu phẩy; `classifyError` + test chống trôi mã |
| Task2 follow-up (503 cấu hình, Date header, `/v2/events/latest`) | `c4ab472` | |
| A5/A3 text-only E2E thật | `62fd150` | |
| S7basic + A7basic onboarding | `3b202e9` | |
| Producer G4 đọc (status/workflows/retry/commands) | `f100caf` | retry khi disabled → 409 |
| S6a render executor (unit) | `10b2e64` | render thật vẫn HALT |
| Task4 sơ đồ ticket + A4 | `00aeace` | route `/requests/$rootId/map` |

Việc kế tiếp và ruling còn chờ:
- **S6b** cần ruling trước khi làm: (Q1) closure tiến trình con của `uv` → Python; (Q2) nguồn Python ≥3.11 không đổi argv; (N1) tập đóng `_bmad` so với tập materialize A4. Xem `execution-phase06/progress.md` mục 07:55 và 08:20.
- **G4w**: config gateway chỉ có một cờ `enabled`; S7full cần ba switch độc lập Claude/Codex/API.
- Producer thiếu: route thu hồi máy; `GET tools/:operationId`; wait intent `ask_owner`.
- T4–T7 phase06, S6assistant (G3), S7full (G4w), Task8 (G5/G6), A3/A5 có file (extractor phase05).
- Trước merge: triage toàn bộ dòng `minor (deferred)` hai ledger + checklist T7; full `tsc` web/server.

Cần owner: gửi lại ảnh tham chiếu map `IMG_6454.JPG` (không còn trong repo/~/Downloads); máy dự án chạy BMAD cần `uv` + Python ≥3.11.
