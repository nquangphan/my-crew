# Kiến trúc Crew v2: thư viện miền và nền tảng server

## Thành phần

`v2/` là package TypeScript độc lập. Các module trong `src/` cung cấp hàm thuần để đánh giá quy tắc miền;
`test/` chạy trực tiếp bằng `node:test`. Thư viện không import ứng dụng Crew v1 và không dùng dependency runtime.

## Ranh giới xử lý

Thư viện trả về quyết định dựa trên dữ liệu đầu vào. Package `server/` có nền tảng cấu hình, pool PostgreSQL riêng và migration tường minh. Journal đã triển khai mutation idempotent, event cursor theo thứ tự commit và SSE replay; factory route nhận bộ xác thực cùng scope reader được tiêm vào. Phần 02 đã có xác thực owner/machine, binding project, cây ticket/dependency/deploy approval/repair cycle, command/attempt/fence/guard và original docs snapshots. Quyền dispatch và final result production mặc định deny, chờ authority06/08. Thư viện không mô phỏng các trách nhiệm đó
bằng trạng thái trong bộ nhớ.

## Dữ liệu và dịch vụ ngoài

Thư viện miền không có bảng dữ liệu, credential hoặc lời gọi mạng. Nền tảng server kết nối DB v2 riêng, kiểm tra marker/tên DB và checksum migration; fixture kiểm thử tạo rồi xóa đúng DB/container do lượt chạy sở hữu. Migration không tự chạy khi import hay khởi động app. Khóa session được cấp qua biến môi trường v2, không lấy cấu hình v1. Khi chạy, Node.js dùng type
stripping; TypeScript chỉ kiểm tra kiểu và không phát sinh mã JavaScript.

## Kiểm tra

Từ gốc repo, chạy `pnpm --dir v2 test` và `pnpm --dir v2 typecheck`. Lockfile trong `v2/` chỉ phục vụ
workspace này.

Kiểm tra nền tảng server bằng `pnpm --dir v2/server test` (cần Docker) và `pnpm --dir v2/server typecheck`. Runner dùng container PostgreSQL tạm trên cổng loopback ngẫu nhiên; không đụng DB đang chạy ở cổng 5432/55432.

Flow `server-journal` mô tả khóa idempotency theo actor/route, transaction dùng global cursor lock trước khóa nghiệp vụ và event metadata có schema riêng. API đọc event trả `{items,cursor}`; SSE xác thực trước khi mở stream, đọc backlog trước khi poll và dừng timer khi socket đóng. `server/src/app.ts` tổng hợp route qua `buildApp`; `server/src/main.ts` mở listener tường minh, không auto-migrate. Scope và actual credential được kiểm trong cùng read snapshot; SSE kiểm lại credential ở từng backlog/poll. Search dùng transaction budget2s và statement timeout giảm dần, giới hạn này không gồm auth/network/pool acquisition.

## Cổng macOS và control plane

`gateway/` giữ host Node độc lập với cửa sổ `desktop/` Electron. IPC, process/HTTP journal, capacity sampler và owned-resource registry đã có task review. Process gate fsync identity trước RELEASE; fork hoặc thiếu native witness giữ UNKNOWN, không suy process chết từ heartbeat/lease. Host shell hiện chưa nối các journal/sync/model vào entrypoint; phần03 tiếp tục tích hợp.

Candidate migration007 tạo namespace boot/heartbeat/desired/applied/install report/management command/attempt projection riêng. Machine current credential và machine row khóa trước cached mutation; companion giữ exact005 attempt/fence/process và server-stored selection. Config có hai workflow source bắt buộc cùng ba projection slot nullable; trước owner cấu hình desiredConfig/applied là null. Latest applied report có FK cùng máy, heartbeat/report không đổi005guard/attempt/command. ProjectionPolicy mặc định SELECTION_NOT_CONFIGURED đến producer06;007 đang chờ independent review, không phải quyền runtime production.

Registry source ghim payload/npm integrity/revision và canonical tree độc lập với runtime projection. Candidate4cbf581 đã có source verification/immutable publish/Superpowers Claude layout; actual BMAD installer/API artifact, stage reclamation và canceled-cache activation đang sửa theo independent review. Không báo source installed tương đương runtime certified. Runtime adapters/credential/tool loop/isolation certificate ở04, Trợ lý điều phối ở06; signed packaged helpers/updater ở09.
