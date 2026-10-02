# Crew v2 attachments — khảo sát kỹ thuật

Ngày kiểm chứng: 2026-10-02, Asia/Ho_Chi_Minh. Phạm vi: lập kế hoạch phase05, chưa cài package, chưa chạy extractor, chưa chứng nhận sandbox hoặc model.

## Kết luận kiến trúc

Server lưu original bất biến theo attachment UUID/owner/checksum; project ACL qua live links/routes, không deduplicate payload giữa project. Owner inbox message/compose identity tồn tại trước project; routing/re-routing chỉ thay links có revision. Upload streaming vào staging owner/compose; fsync blob trước transaction liên kết ticket/comment. Parser độc lập model chạy trong worker container không mạng, chỉ mount một job scratch. PDF scan tạo ảnh từng trang để model vision đọc; không gọi OCR cloud hoặc giả định OCR là bằng chứng đọc hết. DOCX/XLSX đọc OOXML dưới giới hạn ZIP/XML; text/code/CSV có locator byte/line/cell. Trích xuất và model đọc là hai trạng thái riêng.

Không dùng multipart: reserve slot bằng JSON rồi PUT application/octet-stream giúp Fastify kiểm soát byte limit/hash và retry mà không thêm parser multipart. Fastify cho phép custom content-type parser nhận stream; encapsulation giữ parser upload tách khỏi route JSON ([Fastify content-type parser](https://fastify.dev/docs/latest/Reference/ContentTypeParser/)).

## Package đã kiểm tra từ publisher

Đọc release/repository chính thức và metadata publisher tại registry.npmjs.org qua HTTP GET, không tải tarball/cài dependency. Đây là phiên bản chọn chính xác, không tuyên bố tất cả là latest. Ghi integrity dưới đây vào đối chiếu lockfile lúc controller cài. Runtime Node >=24.12, server hiện pin Fastify 5.12.5/postgres 3.4.9, TypeScript 7.0.2; không đổi chúng trong phase05.

| Package pin | Căn cứ API/engine | Quyết định và test bắt buộc |
|---|---|---|
| `pdfjs-dist@6.3.289` | [Mozilla release v6.3.289](https://github.com/mozilla/pdf.js/releases/tag/v6.3.289), [API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html), [publisher metadata](https://registry.npmjs.org/pdfjs-dist/6.3.289); engine >=22.13.0 hoặc >=24; types có sẵn, optional canvas ^1.0.0 | `getDocument({data})`, page text + render; không chạy PDF scripting/viewer. Test PDF text, scan, rotation, font, annotation, encrypted, truncated, page cap; worker và main cùng package version. |
| `@napi-rs/canvas@1.0.3` | [changelog](https://github.com/Brooooooklyn/canvas/blob/main/CHANGELOG.md), [publisher metadata](https://registry.npmjs.org/@napi-rs/canvas/1.0.3), [API examples/support matrix](https://github.com/Brooooooklyn/canvas); Node >=10, typed, native optional package đúng version | Canvas raster PDF và decode PNG/JPEG; chỉ truyền buffer, không URL/path từ file. Test Linux x64/arm64 đúng deployment target, font fallback và native OOM. Không suy Node compatibility thành binary đã chạy. |
| `yauzl@3.4.0` | [maintainer README/change history](https://github.com/thejoshwolfe/yauzl), [publisher metadata](https://registry.npmjs.org/yauzl/3.4.0); Node >=12 | lazy entries, strict filenames, declared size + measured expanded byte caps; đọc ZIP entry vào memory bounded, không giải nén theo entry path. API callback có local declaration tối thiểu do phase05 viết; không thêm @types ngầm. Test traversal, duplicate entry, ZIP64/size overflow, encrypted and overlap/corrupt entries. |
| `saxes@6.0.0` | [tag package](https://github.com/lddubeau/saxes/blob/v6.0.0/package.json), [README](https://github.com/lddubeau/saxes), [publisher metadata](https://registry.npmjs.org/saxes/6.0.0); Node >=12.22.7, types có sẵn | Namespace-aware XML events; reject DOCTYPE/entity declaration, enforce depth/text/input byte caps externally. Repo archived 2025-12-31: pin deliberately small strict parser; maintenance limit recorded. Không coi parser tự cung cấp memory/security isolation. Test entity/DTD/deep XML/malformed namespaces. |

Publisher tarball integrity đã nhận:

```text
pdfjs-dist 6.3.289 sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==
@napi-rs/canvas 1.0.3 sha512-OlI657a5XXvKGFX7kNeIzJ8rO7IXt87Mqu2H8rXE46viAuOfum/JA7ysX7+eBhxNKznT+RCZh418mndlcFX3+w==
yauzl 3.4.0 sha512-jIH9yLR9wqr0wOS0TpBvo/g/2UgZH5qePVbjgRliiF0BYvOZyaBknKsF+x9Iht0O6sqgnB93rCICdOZFecJuDw==
saxes 6.0.0 sha512-xAg7SOnEhrm5zI3puOOKyy1OMcMlIJZYNJY7xLBwSze0UjhPLnWfj2GF2EpT0jmzaJKIWKHLsaSSajf35bcYnA==
```

`pdfjs-dist` GitHub repository cũ là archive chứa 3.2.146: không dùng repository đó làm latest evidence. Dùng mozilla/pdf.js release cùng npm metadata. Không dùng Office automation, LibreOffice, Excel formula evaluation, mammoth HTML hoặc thumbnail service remote. Saxes chỉ kiểm XML well-formed; Crew tự kiểm parts/relationships của [ECMA-376](https://ecma-international.org/publications-and-standards/standards/ecma-376/). Đọc giá trị cached của XLSX phải ghi rõ không recalculated; chart/drawing không được silently coi là text đã đầy đủ. DOCX paragraph/part locator không là page number giả.

## Worker image và persistence

[Official Node image source](https://github.com/nodejs/docker-node). Đã HEAD official registry manifest `library/node:24.14.0-bookworm-slim` bằng token public pull scope, HTTP 200, multi-platform index digest:

```text
node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8
```

Chưa pull/build/run image. Worker build dùng base này và lockfile đã kiểm integrity, không tải runtime package lúc nhận file. [Docker run reference](https://docs.docker.com/reference/cli/docker/container/run/) hỗ trợ network none, read-only, memory/CPU/pids limit, cap-drop và security-opt. Crew phải chứng minh cấu hình thực tế qua inspect + canary network/foreign path/process/memory trong test, không gọi nó certification workflow/runtime phase04. Thiếu worker engine/image/capacity thì extraction pending với `EXTRACTOR_UNAVAILABLE`, original vẫn giữ. Không mount Docker socket, DB URL, server env hoặc owner home vào worker. Host executor dùng argv, không shell nội suy file name.

Node [filehandle.sync](https://nodejs.org/api/fs.html#filehandlesync) cung cấp flush file descriptor. Thiết kế cần fsync cả file và directory sau rename trên filesystem đã test. PostgreSQL transaction không rollback rename; crash matrix ở plan phân biệt intent DB, durable bytes, linked DB refs, tombstone cleanup. Không suy DB commit thành blob durable; restore kiểm manifest và checksum.

## Hợp đồng hiện có và chỗ bàn giao

Đã đọc docs/index, v2/docs/index, flow server-platform/identity/journal/tickets; where của v1 bundle từ cwd v2 trỏ git root v1 nên không resolve source v2, đã dùng manifest/flow page v2 làm mapping, không chạy build hoặc sửa tooling. Worktree không có .codegraph.

- Source `createTicket(tx,input,actor)` có transaction do caller sở hữu: wrapper mới có thể gọi createTicket rồi linkAll trong một mutator mà không đổi CreateTicket.
- `appendComment(tx,ticketId,text,actor)` cấm text rỗng và factory đóng deps: cần producer review optional `commentAttachments` dependency + method mới, giữ API cũ default deny empty text. Không tạo comment ảnh bằng dấu cách giả.
- `SourceRef.kind` phase02 chưa có attachment. Handoff phase06 dùng evidence artifact ID với locator `attachment-manifest:<manifestId>:<sha256>` được server ghi nhận trong cùng tree; không cast attachment UUID thành artifact evidence.
- Phase04 đã được controller báo independent review đạt/frozen f4d03c0 trong lúc lập kế hoạch. RuntimeCheckpoint literal chỉ có `attachmentIds`, còn prose cần derivative refs. Dùng immutable input-manifest artifact trong `artifactIds`, giữ original IDs trong `attachmentIds`, và bridge resolve manifest. Không đổi field/signature phase04 đã frozen; giao owner runtime review wiring.
- Phase04 adapter start/sendInput chưa công bố hook materialize derivative: phase05 xuất typed resolver; runtime owner phải review wiring tại phase04 adapter tool boundary trước claim consumed capability PASS. Không coi một URL attachment hoặc Markdown link là bytes model đã nhận.
- Phase06 central Assistant có grant hẹp do owner/owner submission ủy quyền: selected submitted original IDs, exact snapshot/input revision, current designation/machine, expiry/revoke. A nhận representation bytes trực tiếp qua AssistantReadSession riêng trước routing; không project attempt giả, không proxy owner credential hoặc summary-as-original-read. Executor vẫn dùng current project binding+attempt/fence. Metadata preclaim snapshot không cần attempt và không tự cấp byte access.

## Giới hạn đã biết và evidence cần trước nghiệm thu

Không có OCR text mặc định: scan/ảnh cần vision PASS; text-only fallback chờ nếu thiếu representation đủ thông tin. OOXML có unsupported visual/embedded features trả partial explicit; original giữ nguyên. PDF page render verification là integrity/coverage kỹ thuật, không chứng minh model đã hiểu trang. Mọi read receipt phải ghi segment ID và modality model đã tiêu thụ; tổng hợp full chỉ khi toàn bộ required units có receipt phù hợp và không còn missing.

Kế hoạch yêu cầu fixture do test tạo/fixture có giấy phép, corpus âm, Docker canary, cross-project same-hash isolation, compose race, process kill ở từng storage stage, resume/fallback cùng IDs, data loss/staleness, paused source. Chưa chạy các bài này trong planner; readiness chỉ là sẵn sàng review kế hoạch.


## Bổ sung sau review round1 — primary evidence và giới hạn

[Docker multi-platform build](https://docs.docker.com/build/building/multi-platform/) quy định target-platform RUN; [pnpm install](https://pnpm.io/cli/install) có frozen-lockfile. Build baseline linux/amd64/glibc trong target Node image, không COPY node_modules Darwin. Arm64 Linux là build/receipt riêng. Package optional native được xác minh lại từ publisher metadata:

```text
@napi-rs/canvas-linux-x64-gnu 1.0.3 os=linux cpu=x64 libc=glibc
sha512-jtfzAHFp+FRaR7zGT4jyCe6wUgAG/dVb5A4Apd8FY9jKarntDfUAlJXscugiH7ZF5kKnu7/lHFk9LaDPcrGEVQ==
@napi-rs/canvas-linux-arm64-gnu 1.0.3 os=linux cpu=arm64 libc=glibc
sha512-GVSjntxKeA+/y/ZKf1F+cmUw1WeIkE5aMRPqnZUlBTBvBcrvgWccJAWuYCKPX4QJQwZILIIwhgdAbl51yj6fpA==
```

Nguồn: [x64 publisher metadata](https://registry.npmjs.org/@napi-rs/canvas-linux-x64-gnu/1.0.3), [arm64 publisher metadata](https://registry.npmjs.org/@napi-rs/canvas-linux-arm64-gnu/1.0.3), [maintainer native loader](https://raw.githubusercontent.com/Brooooooklyn/canvas/main/js-binding.js). Không pull/install/build. Task4 diagnostic entrypoint do chính Task4 sở hữu; Task5 rebuild final production image rồi kiểm PNG/PDF/corpus cùng boundary, không lấy canary làm bằng chứng parser.

Linux receiver stop proof dựa exact host/boot/proc namespace/PID/starttime và operation close ACK sau mọi writable FD đã đóng. [Linux proc_pid_stat](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html) mô tả starttime field22. Đây là thiết kế identity để không nhầm PID reuse; chưa chạy native recovery test. Không chọn flock-only làm proof: [Linux flock](https://man7.org/linux/man-pages/man2/flock.2.html) có semantics theo open file description, cần cơ chế nắm lock đúng suốt FD lifecycle; plan chọn explicit process/operation proof thay vì tự giả Node có flock primitive. Topology upload giới hạn cùng Linux host/proc namespace/local filesystem; missing proc evidence giữ unknown. A còn sống/mất DB thì B không takeover/unlink; A chết được xác minh mới recovery. Quota released_at latch cùng submitted/deleted transaction chống giữ quota sau terminal hoặc trừ hai lần.

Preclaim InputSnapshot lưu original hashes/coverage/capability/input revision trước model choice; command+decision+dispatch-input row ghi exact snapshot pin và claim revalidates bằng CAS trong Tx. Grant Assistant chỉ metadata trước bind, byte access sau snapshot/session policy kiểm đủ. Receipt runtime/model khớp stored attempt/session, partial/empty không thành all-selected; trust là reported_transport. Cache broker revoke chặn request mới; native path/open FD cần stop-and-revoke process tree và unknown giữ pending. Bytes đã giao không thể thu hồi khỏi memory/provider; không khẳng định được “unread”.


## Bổ sung review round2 — hợp đồng nội bộ R1/R2

Kiểm actual `v2/server/src/tickets/decisions.ts` xác nhận legacy appendComment INSERT comments rồi appendEvent trong caller Tx; `journal/mutation.ts` khóa event_cursor trước callback và actual claim khóa root/target trước project. Plan chọn additive BEFORE INSERT trigger009 làm comment revision writer duy nhất, bao phủ legacy + attachment method; không sửa004/signature hoặc dùng fixture bump. Counter của ticket bao phủ comments chính nó và ancestor; comment A tăng A cùng descendants hiện tồn tại dưới root lock, child mới đọc ancestor history. Event cursor chỉ wake/replay, không là revision CAS. Tests phải dùng actual legacy service và actual mutator, đảo barrier claim/reply, ancestor/child và exactly-once rollback. Đây là source review, chưa chạy migration/test.

Source OFF là admission policy: pin model/config/turn khi start session hợp lệ, exact session đó vẫn hoàn tất bytes/receipt/reply nếu grant/input/designation/security còn current. New selection/session/turn/fallback dùng current source ON; owner revoke, pause/cancel, designation/input/route/security revoke vẫn chặn và stop/reconcile. Đây là đồng bộ spec/frozen phase04, không đổi dependency/pin hay cam kết bytes đã giao có thể thu hồi. Phase06 owns actual authority/driver và phải chạy integration cases trước enable.
