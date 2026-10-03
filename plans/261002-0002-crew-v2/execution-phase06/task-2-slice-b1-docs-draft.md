# Draft server-tickets — T2 B1

**Chưa áp dụng vào flow; chỉ tích hợp sau implementation và independent review.**

Bổ sung `server/test/assistant-orchestration.test.ts` vào flow server-tickets qua PM integration. `TicketServiceDependencies` có captured optional `ProjectOrchestrationAuthority`; entry `assistantCreateTicket(tx,actor,proof,input)` dành riêng machine giữ nguyên actorA audit dù project gắn B. Generic create/HTTP ACL giữ nguyên. Thiếu authority trả503 và không tạo ticket; owner không dùng scoped entry.

Implementation mục tiêu snapshot input/actor/proof trước await; SHA256 canonical tuple `['crew-v2:orchestration-target:1','create_ticket',exactSubmittedCreateTicket]` trước default/inherited pin. Optional omitted khác null, workflowPin phải explicit null/pin. Prefix root/parent/project locks trước captured verify; private runtime token chỉ mint sau verify, bound cùng Tx/actor/action/hash/root/project. Shared invariant core duy nhất giữ hierarchy, closed state, pin, safe JSON và exact deploy owner approval; không synthetic owner hoặc boolean bypass. Không thêm guard/input lock trong core.

Test port là trust fixture có allowlist exact Tx/actor/proof/action/hash và DB scope, dùng actual provision/bind/journal/owner decision. Đây chưa là native admission hay production scope certification. Production persisted resolver vẫn deny; frozen scope thiếu exact routing-decision linkage chưa được lấp. Không có HTTP endpoint mới hay live native success từ B1.

Bằng chứng B1: semantic RED39 có12 pass/27 fail trên scaffold; sau implementation một affected run55/55 gồm39 B1 và16 existing tickets/deploy/dependencies, skip0/exit0. Scoped strict own files/dependency closure dùng external skipLibCheck và scoped Biome đều exit0. Full-server check không được suy ra từ scoped result. Raw log/hashes/source freeze nằm trong task-2-slice-b1-report.md; chờ independent review trước tích hợp flow.

FIX1 bổ sung: so sánh project UUID bằng canonical identity nhưng hash/journal giữ exact spelling. B1 snapshot kiểm descriptors/prototypes/symbols của array trước serialization; getter/custom iterator không được thực thi để đổi actor/proof. Targeted RED8 xác nhận defects; final affected63/63 (47 B1 +16 existing) và scoped strict/Biome pass, chờ scoped re-review. Production authority/current input/native receipt vẫn chưa được chứng nhận.
