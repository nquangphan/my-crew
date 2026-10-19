# Audit tiến độ Crew v2 và khả năng mở rộng Paperclip

Ngày kiểm tra: 05/10/2026, Asia/Ho_Chi_Minh.

## Git được kiểm tra

- Repo chính: `main`, `7c090b8`; pull `--ff-only` báo Already up to date.
- Worktree triển khai: `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`.
- Nhánh triển khai: `codex/crew-v2-server`, pull fast-forward từ `615618b` tới `51907858d0c8cdb7329759f22104f0727dbe6751` (265 commit).
- Sau pull, HEAD bằng origin cùng nhánh; worktree sạch. Không merge nhánh v2 vào main.

## Phương pháp và giới hạn

Đánh giá source, production entrypoint, roadmap, handover và ledger/review được commit. Đây là audit tiến độ, không phải whole-branch security review hoặc nghiệm thu sản phẩm.

Phần trăm là ước lượng phạm vi triển khai, không phải số dòng code, số commit, xác suất chạy đúng hoặc phần thời gian còn lại. Với roadmap v2 gốc, dùng chín phase trọng số bằng nhau để có thước đo tạm thời; điểm phase phản ánh phạm vi còn thiếu và assembly. Slice đã được review chỉ được tính trong phạm vi đó. Phần lớn evidence DB/browser/native bên dưới là evidence lịch sử trong ledger, chưa chạy lại trên máy này.

## Roadmap v2 gốc

| Phase | Điểm phạm vi tạm tính | Căn cứ và phần còn thiếu |
|---|---:|---|
| 01 Domain | 100% | Policy và test có source; lượt audit chạy lại 14/14 và typecheck đạt |
| 02 Server/docs | 90% | Ledger ghi Task1–7 complete trong phạm vi; API/DB/auth/ticket/docs có source; producer và assembly toàn hệ thống chưa đầy đủ |
| 03 Gateway/workflow | 75% | Host, journal, registry, bridge, isolation có source/review; host entrypoint chưa nối các class thành vòng vận hành đầy đủ; native certificate và recovery render còn thiếu |
| 04 Runtime/model | 35% | Switch/catalogue/broker/runtime boundary có source/review; native adapter, API agent loop, fallback và attempt thật còn thiếu |
| 05 Attachment | 55% | Storage/submission/access/worker và extractor source đã có; corpus/boundary certification, runtime input/checkpoint và acceptance chưa đủ |
| 06 Assistant | 40% | Schema/inbox/authority, một số tool, workflow run/gate và render slices đã có; assessment/admission, driver/dispatch/monitor và production assembly chưa xong |
| 07 Web | 65% | Shell/auth/events, ticket/list/dialog/create, docs/map và onboarding basic có source/evidence; assistant attention, máy/model full, runtime controls và file acceptance còn thiếu |
| 08 Integration | 0% | Có plan; chưa có nghiệm thu review/test/docs/merge/recovery xuyên hệ thống |
| 09 Operations | 5% | Có desktop shell và plan; signed updater/release/rollback v2 chưa nghiệm thu |

Trung bình tạm tính khoảng 52%: báo bằng khoảng **50–55%**. Các bổ sung MVP2 (docs graph/freshness sâu, content dedup, usage ledger và agent reuse registry) còn chủ yếu ở plan; đánh giá toàn phạm vi mở rộng khoảng **40–45%**, độ tin cậy thấp hơn vì chưa có breakdown task và effort được duyệt cho chúng.

Không tính implementation v1 hoặc signed updater v1 như phần đã hoàn thành của v2.

## Căn cứ production quan trọng

- `v2/server/src/main.ts` chỉ gọi `buildApp` với DB/auth/origin/time, chưa cấp runtime/assistant/attachment assembly.
- `v2/server/src/app.ts`: thiếu authorizeDispatch/verifyFinalResult thì dùng denyDispatch/denyFinalResult; không đăng ký assistant routes. Attachment routes chỉ mount khi được cấp assembly; entrypoint hiện không cấp.
- `v2/server/src/assistant/tools.ts`: một số tool vẫn trả TOOL_NOT_RELEASED; thiếu assembly trả ASSISTANT_TOOLS_NOT_CONFIGURED.
- `v2/gateway/src/host/main.ts` khởi động GatewayHost; `gateway-host.ts` hiện chủ yếu lock/status/IPC, chưa nối model broker/workflow registry/ticket bridge/runtime thành host production đầy đủ.
- Handover mới nhất còn S6b-iii/server receipt/reconcile, S6b-iv uv integration, Phase06 T4–T7, web S6assistant/S7full/Task8 và file acceptance.
- Một số trang docs tổng quan cũ hơn ledger; không lấy câu trạng thái trong index làm nguồn duy nhất.

## Nếu Paperclip là lõi

Đây là khả năng tái dùng trong kiến trúc đề xuất, không phải compatibility đã kiểm chứng. Không có dependency hay tham chiếu Paperclip trong source được tìm ở `v2/server/src`, `v2/gateway/src`, `v2/web/src`, `v2/desktop/src` hoặc manifest đã đọc.

| Phần Crew cần thêm | Trọng số | Mức có nền tái dùng ước lượng | Khoảng trống |
|---|---:|---:|---|
| Gateway/local execution | 25% | 65% | Đổi transport và authority sang Paperclip; nối host; reconnect/cancel/resume thật |
| BMAD/Superpowers workflow controller | 25% | 45% | Ánh xạ issue/run/approval, materialize/receipt, pin/isolation thật và gates xuyên hệ thống |
| Trợ Lý/model/resource routing | 20% | 35% | Driver, admission/dispatch/monitor còn thiếu; bỏ phụ thuộc trực tiếp Crew ticket/attempt DB |
| Docs chuẩn/graph/freshness | 15% | 35% | CLI/validator/import/search có nền; graph và freshness semantic/merged-commit gate chưa đủ |
| Paperclip integration | 10% | 0% | Chưa adapter/plugin, ID mapping, event/run protocol hoặc E2E |
| Crew UI bổ sung | 5% | 50% | Map/dialog/docs có thể chuyển; query/auth/route/CSS cần nối host Paperclip |

Điểm trọng số khoảng 42%: báo **40–45% phần mở rộng Crew có nền tái dùng**. Không cộng ticket/auth/journal server Crew như giá trị tích hợp miễn phí: chúng trùng trách nhiệm Paperclip và phải được thay thế hoặc ánh xạ, không giữ hai nguồn trạng thái song song.

**Đường tích hợp thực tế với Paperclip hiện 0% được chứng minh.** Chưa cài/chạy Paperclip, chưa audit API/plugin/adapter source của nó hoặc test end-to-end. Nghiên cứu tài liệu trước đó chỉ chứng minh điểm mở rộng có tồn tại.

## Verification trong lượt audit

- Node v24.14.0, pnpm 10.32.1.
- `pnpm --dir v2 typecheck`: exit 0.
- `pnpm --dir v2 test`: 14/14, exit 0.
- `pnpm --dir v2/server typecheck`: exit 1; thiếu canvas/pdfjs/pdf-lib và có các lỗi any/unknown ở PDF. Chưa tách lỗi dependency với lỗi source bằng install/build chuẩn.
- `pnpm --dir v2/web typecheck`: exit 1; thiếu @testing-library/react.
- Không chạy lại DB/native/browser acceptance hoặc install dependency trong lượt audit; không thay DB.
- Hook chặn lệnh kiểm tra thư mục dependency và một lệnh search có glob build output. Không đổi hook/config hoặc đi vòng truy cập; các lượt source audit sau dùng đúng source directory được phép.
- Không tạo dev server/container/model session; các lệnh pull/typecheck/test đã kết thúc, không còn process do lượt audit cần giữ.

## Kết luận quyết định

Chưa có cơ sở để kết luận chuyển sang Paperclip sẽ nhanh hơn hoàn thiện Crew. Phần có giá trị riêng (gateway, workflow, docs) đã có nền nhưng chưa vận hành đầy đủ; phần đã xây nhiều (ticket/server/web nền) lại trùng Paperclip. Cần thử adapter xuyên suốt trên một project trước khi chọn hướng và chỉ có một bên sở hữu queue/run authority.

## Câu hỏi chưa được xác minh

- Paperclip extension API có đủ để cưỡng chế gates và giữ run sống qua disconnect của gateway không?
- Chi phí đổi các hợp đồng DB/attempt/command hiện tại so với hoàn thiện hệ thống Crew độc lập là bao nhiêu?
- Source hiện tại có qua full typecheck và native/API/DB/browser acceptance trên môi trường chuẩn sau khi đủ dependency không?
