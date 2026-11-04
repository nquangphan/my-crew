# Gom Bug Finding vào 2P Crew và luồng review ticket tổng — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Trạng thái: kế hoạch, chờ owner duyệt · 04/11/2026 · yêu cầu TPS-643, việc lập kế hoạch TPS-644.

**Goal:** Nhúng app Bug Finding vào 2P Crew (đồng bộ project, nhận MR từ Crew) và đổi ticket tổng code/bug sang luồng
gom code + PR → review Bug Finding → Trợ Lý xử lý finding → owner duyệt → integrator merge.

**Architecture:** Ba repo. `bug-finding` thêm cầu nối file (inbox/outbox trong thư mục dữ liệu của app) và nhãn Crew.
`my-crew` build và nhúng `Bug Finding.app`, ghi danh sách project, nhận việc máy `bug-finding-review`, chuyển kết quả
về server. Fork Paperclip thêm policy `root-bf` (`integrator → reviewer cầu nối → owner → integrator merge`), gate,
bảng `crew_bug_finding_runs`, route, UI và template vai trò.

**Tech Stack:** Swift 6 / SwiftUI (Swift Testing), Electron + TypeScript (Vitest, electron-builder), Paperclip fork
(Node/TS, Drizzle/SQL migration, Vitest, React crew-web).

**Spec:** [`spec.md`](spec.md) (đọc trước). Mockup: [`mockups/index.html`](mockups/index.html).

## Mục tiêu

- App Bug Finding đi kèm 2P Crew, cài/cập nhật cùng nhau, mở từ mục **Bug Finding** (owner Q1 = b).
- Project Crew tự có bên Bug Finding; thêm project trong Crew tự thêm sang.
- Ticket tổng code/bug: bỏ reviewer Claude cấp gốc (Q2 = a); integrator gom code + mở PR trước review; Bug Finding
  review qua hàng đợi app trên Mac, UI Bug Finding hiện tiến độ (Q5 = a); Trợ Lý tự sửa finding được, hỏi owner phần còn
  lại; Bug Finding chạy lại **một lần** sau khi **toàn bộ** con sửa của lô xong (Q4); integrator merge ngay sau owner
  duyệt (Q3 = a).
- Phần BA và mockup do executor việc lập kế hoạch làm, owner duyệt cả gói (Q6 = a): `spec.md`, `mockups/`.

## Phạm vi và ngoài phạm vi

Phạm vi và ngoài phạm vi đúng như `spec.md` mục 3 và 4. Tóm tắt ngoài phạm vi: luồng research/docs/plan, ticket tổng đã
tạo trước khi bật cờ, MR GitLab do Crew mở, viết lại Bug Finding, đổi skill `bug-finding`, Bug Finding cho việc con.

## Global Constraints

- UI và docs tiếng Việt; identifier, path, route, key YAML/JSON tiếng Anh. Giờ hiển thị `Asia/Ho_Chi_Minh`.
- Conventional Commits; không `--no-verify`; không commit credential.
- `my-crew`: Biome; docs theo flow (`docs/flows.yaml`, R2/R3), `crew-docs generate` sau khi sửa `flows.yaml`.
- Fork: token-only UI (`DESIGN.md`), copy dùng "task" ở chỗ mới của Paperclip core; phần crew-web dùng tiếng Việt như
  hiện có. Migration mới kế tiếp số cuối hiện có (hiện `0023_model_settings.sql`; plan 261103 dự kiến `0024`, lấy số
  kế tiếp lúc làm).
- Bundle id Bug Finding giữ `local.mrreviewqueue`, thư mục dữ liệu giữ `~/Library/Application Support/MRReviewQueue`.
- Bug Finding chạy tối đa 3 lượt mỗi vòng duyệt owner (lần 1 + tối đa 2 lô sửa tự động).
- Hết giờ lượt Bug Finding: 30 phút chưa máy nào nhận job, 8 giờ chưa có kết quả.
- Chỉ ticket tổng không nhãn `research`/`docs`/`plan`, project có `origin` GitHub, tạo sau khi company bật
  `bugFinding.enabled`, mới nhận policy `root-bf`.
- Không chạy full test suite; chỉ test của file đổi (luật Crew).

## Review Focus

1. Hai bản Bug Finding cùng bundle id chạy cùng lúc (bản riêng ở `/Applications` và bản nhúng) → ghi đè `state.json`.
   Mong đợi: 2P Crew không mở bản nhúng khi bản riêng đang chạy, báo thoát trước. Test ở Task B2.
2. Head PR đổi giữa lúc xếp và lúc Bug Finding chạy (integrator cập nhật PR, người push tay) → báo cáo cho commit khác.
   Mong đợi: lượt `failed` lý do `head_mismatch`, server từ chối kết quả có head khác. Test ở Task A2 và C3.
3. Trợ Lý gửi `done` khi lô sửa mới xong một phần, hoặc khi thẻ hỏi chưa trả lời → Bug Finding chạy sớm. Mong đợi:
   gate chặn `done` của ticket tổng khi còn con `bf-fix` của lô hiện tại chưa `done` hoặc thẻ hỏi `crew-bf` còn mở.
   Test ở Task C2.
4. Mac tắt, mất mạng, Bug Finding treo → stage 2 kẹt im lặng. Mong đợi: hết giờ đánh dấu `timeout`, đánh thức reviewer,
   lần hai hỏi owner bỏ qua. Test ở Task C3.
5. Cập nhật 2P Crew khi Bug Finding đang review → binary bị thay giữa chừng. Mong đợi: drain chờ `running == 0`. Test ở
   Task B5.

---

## Bản đồ file

| Repo | File | Trách nhiệm |
|---|---|---|
| bug-finding | `apps/mr-review-queue/Sources/MRQueueCore/CrewBridge.swift` (mới) | Đường dẫn, kiểu JSON, đọc/ghi atomic file cầu nối, áp danh sách project |
| bug-finding | `apps/mr-review-queue/Sources/MRQueueCore/Models.swift` | `Project.crewProjectId`, `Project.crewRemovedAt`, `CrewRequestRef` trên `QueueItem`/`ReviewRound` |
| bug-finding | `apps/mr-review-queue/Sources/MRReviewQueue/CrewBridgeController.swift` (mới) | Theo dõi thư mục, xử lý request, ghi response và heartbeat, gọi `AppModel` |
| bug-finding | `apps/mr-review-queue/Sources/MRReviewQueue/{AppModel,ProjectSidebar,QueueView,MRDetailView}.swift` | Nối controller, nhãn Crew |
| bug-finding | `apps/mr-review-queue/scripts/build-app.sh`, `scripts/entitlements.plist` (mới) | `--out`, `--sign`, `--hardened-runtime` |
| bug-finding | `docs/mr-review-queue.md` | Mục "Chạy cùng 2P Crew" |
| my-crew | `apps/mac-app/bug-finding.pin.json` (mới), `scripts/release-lib.mjs`, `scripts/release.mjs`, `electron-builder.yml` | Build và nhúng Bug Finding |
| my-crew | `apps/mac-app/src/main/bug-finding/{paths,state,launch,sync-projects,results,register}.ts` (mới) | Mục Bug Finding, đồng bộ project, chuyển kết quả |
| my-crew | `apps/mac-app/src/main/jobs/{types,validate,executors}.ts` | Việc máy `bug-finding-review` |
| my-crew | `apps/mac-app/src/main/update/drain.ts` | Chờ Bug Finding rảnh |
| my-crew | `apps/mac-app/src/shared/ipc-contract.ts`, `src/renderer/app.tsx`, `src/renderer/routes/bug-finding.tsx` (mới) | IPC và màn hình |
| my-crew | `apps/mac-app/src/main/projects/templates/*.md` | Đồng bộ template vai với fork |
| my-crew | `docs/flows.yaml`, `docs/flows/mac-bug-finding.md` (mới), `docs/flows/mac-app*.md` | Docs |
| fork | `server/src/crew/issue-policy.ts`, `issue-create-policy.ts`, `issue-gate.ts` | Policy `root-bf`, gate |
| fork | `packages/crew-plugin/src/shared/policy.ts` | `crewPolicyKind` nhận `code-bf` |
| fork | `packages/crew-plugin/migrations/00NN_bug_finding.sql` (mới) | Bảng `crew_bug_finding_runs`, kind job mới |
| fork | `packages/crew-plugin/src/jobs/{types,validate}.ts`, `src/bug-finding/{api,enqueue,watchdog}.ts` (mới), `src/manifest.ts` | Job, route, xếp tự động, hết giờ |
| fork | `crew/agents/{integrator,reviewer,assistant,executor}.md` | Template vai |
| fork | `packages/crew-web/src/ds/widgets/stage-badge.tsx`, `features/issues/detail/crew/{bug-finding-panel.tsx (mới),gate-dialogs.tsx,summary-slot.tsx}`, `packages/crew-plugin/src/handlers/map.ts` | UI |
| fork | `docs/flows/{issue-gate,machine-jobs,issues-web,agent-roles}.md`, `docs/flows.yaml` | Docs |

---

## Phase A — repo `bug-finding` (`/Volumes/CORSAIR/Projects/bug-finding`)

Làm trên nhánh `feat/crew-bridge`. Lệnh kiểm chạy trong `apps/mr-review-queue`.

### Task A1: Kiểu cầu nối và áp danh sách project

**Files:**
- Create: `apps/mr-review-queue/Sources/MRQueueCore/CrewBridge.swift`
- Modify: `apps/mr-review-queue/Sources/MRQueueCore/Models.swift` (struct `Project` dòng 85-183, `QueueItem` 379-411, `ReviewRound` 184-271)
- Test: `apps/mr-review-queue/Tests/MRQueueCoreTests/CrewBridgeTests.swift`

**Interfaces:**
- Produces: `CrewBridgePaths(root: URL)` với `projectsFile`, `requestsDir`, `responsesDir`, `heartbeatFile`;
  `CrewProjectList` (`schema == "crew-projects/1"`), `CrewProjectEntry {crewProjectId: String, key, name, repoPath}`;
  `CrewBridge.applyProjects(_ list: CrewProjectList, to projects: [Project], now: Date, makeProject: (CrewProjectEntry) throws -> Project) -> [Project]`;
  `CrewRequestRef {requestId: String, identifier: String, run: Int}`; `Project.crewProjectId: String?`,
  `Project.crewRemovedAt: Date?`; `QueueItem.crewRequest: CrewRequestRef?`, `ReviewRound.crewRequest: CrewRequestRef?`.

- [ ] **Step 1: Viết test thất bại**

```swift
import Foundation
import Testing
@testable import MRQueueCore

@Suite struct CrewBridgeTests {
    func project(_ name: String, repo: String, crew: String? = nil) -> Project {
        var p = Project(name: name, repoPath: repo, gitlabBaseURL: "https://github.com", gitlabProjectPath: "o/\(name)")
        p.crewProjectId = crew
        return p
    }
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    @Test func linksExistingProjectByRepoPath() throws {
        let list = CrewProjectList(schema: "crew-projects/1", projects: [
            CrewProjectEntry(crewProjectId: "p-1", key: "shop", name: "shop", repoPath: "/r/shop")])
        let out = CrewBridge.applyProjects(list, to: [project("Shop cũ", repo: "/r/shop")], now: now) { _ in
            Issue.record("không được tạo mới"); throw CancellationError()
        }
        #expect(out.count == 1)
        #expect(out[0].crewProjectId == "p-1")
        #expect(out[0].name == "shop")
    }

    @Test func createsMissingAndMarksRemoved() throws {
        let list = CrewProjectList(schema: "crew-projects/1", projects: [
            CrewProjectEntry(crewProjectId: "p-2", key: "app", name: "app", repoPath: "/r/app")])
        let old = project("gone", repo: "/r/gone", crew: "p-9")
        let out = CrewBridge.applyProjects(list, to: [old], now: now) { e in
            var p = project(e.name, repo: e.repoPath); p.crewProjectId = e.crewProjectId; return p
        }
        #expect(out.map(\.crewProjectId) == ["p-9", "p-2"])
        #expect(out[0].crewRemovedAt == now)
        #expect(out[1].crewRemovedAt == nil)
    }

    @Test func keepsUserFieldsAndClearsRemovedWhenBack() throws {
        var p = project("app", repo: "/r/app", crew: "p-2")
        p.maxConcurrentReviews = 3
        p.crewRemovedAt = now
        let list = CrewProjectList(schema: "crew-projects/1", projects: [
            CrewProjectEntry(crewProjectId: "p-2", key: "app", name: "app mới", repoPath: "/r/app")])
        let out = CrewBridge.applyProjects(list, to: [p], now: now) { _ in throw CancellationError() }
        #expect(out[0].maxConcurrentReviews == 3)
        #expect(out[0].name == "app mới")
        #expect(out[0].crewRemovedAt == nil)
    }

    @Test func oldStateDecodesWithoutCrewFields() throws {
        let json = #"{"id":"6F1C2C1E-0000-4000-8000-000000000001","name":"a","repoPath":"/r/a","worktreeRoot":"/r/a-reviews","maxConcurrentReviews":1,"remoteName":"origin","gitlabBaseURL":"https://g","gitlabProjectPath":"a/a","refactorDocs":[],"platform":"other"}"#
        let p = try JSONDecoder().decode(Project.self, from: Data(json.utf8))
        #expect(p.crewProjectId == nil)
    }
}
```

- [ ] **Step 2: Chạy test, phải fail** — `swift test --filter CrewBridgeTests`; mong đợi lỗi biên dịch "cannot find
  'CrewProjectList' in scope".

- [ ] **Step 3: Viết code tối thiểu**

`Models.swift`: thêm `public var crewProjectId: String?` và `public var crewRemovedAt: Date?` vào `Project` (khai báo,
`init` mặc định `nil`, `CodingKeys`, `decodeIfPresent` trong `init(from:)` theo cách các trường tùy chọn khác đang làm);
thêm `public var crewRequest: CrewRequestRef?` vào `QueueItem` và `ReviewRound` cùng kiểu.

`CrewBridge.swift`:

```swift
import Foundation

public struct CrewRequestRef: Codable, Equatable, Sendable {
    public var requestId: String
    public var identifier: String
    public var run: Int
    public init(requestId: String, identifier: String, run: Int) {
        self.requestId = requestId; self.identifier = identifier; self.run = run
    }
}

public struct CrewProjectEntry: Codable, Equatable, Sendable {
    public var crewProjectId: String
    public var key: String
    public var name: String
    public var repoPath: String
}

public struct CrewProjectList: Codable, Equatable, Sendable {
    public var schema: String
    public var writtenAt: Date?
    public var companyId: String?
    public var projects: [CrewProjectEntry]
    public init(schema: String, writtenAt: Date? = nil, companyId: String? = nil, projects: [CrewProjectEntry]) {
        self.schema = schema; self.writtenAt = writtenAt; self.companyId = companyId; self.projects = projects
    }
}

public struct CrewBridgePaths: Sendable {
    public let root: URL
    public init(root: URL) { self.root = root }
    public var dir: URL { root.appendingPathComponent("crew") }
    public var projectsFile: URL { dir.appendingPathComponent("projects.json") }
    public var requestsDir: URL { dir.appendingPathComponent("requests") }
    public var responsesDir: URL { dir.appendingPathComponent("responses") }
    public var heartbeatFile: URL { dir.appendingPathComponent("heartbeat.json") }
}

public enum CrewBridge {
    static func canonical(_ path: String) -> String {
        URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL.path
    }

    /// Áp danh sách project của Crew. Chỉ `name`, `repoPath` do Crew quản; trường người dùng sửa giữ nguyên.
    public static func applyProjects(_ list: CrewProjectList, to projects: [Project], now: Date,
                                     makeProject: (CrewProjectEntry) throws -> Project) -> [Project] {
        guard list.schema == "crew-projects/1" else { return projects }
        var out = projects
        let wanted = Set(list.projects.map(\.crewProjectId))
        for entry in list.projects {
            if let i = out.firstIndex(where: { $0.crewProjectId == entry.crewProjectId }) {
                out[i].name = entry.name; out[i].repoPath = entry.repoPath; out[i].crewRemovedAt = nil
            } else if let i = out.firstIndex(where: { $0.crewProjectId == nil && canonical($0.repoPath) == canonical(entry.repoPath) }) {
                out[i].crewProjectId = entry.crewProjectId; out[i].name = entry.name; out[i].crewRemovedAt = nil
            } else if let created = try? makeProject(entry) {
                out.append(created)
            }
        }
        for i in out.indices where out[i].crewProjectId.map({ !wanted.contains($0) }) == true && out[i].crewRemovedAt == nil {
            out[i].crewRemovedAt = now
        }
        return out
    }
}
```

- [ ] **Step 4: Chạy test, phải pass** — `swift test --filter CrewBridgeTests` và `swift test --filter StoreTests`.
- [ ] **Step 5: Commit** — `git add Sources/MRQueueCore Tests/MRQueueCoreTests/CrewBridgeTests.swift && git commit -m "feat(app): kiểu cầu nối Crew và áp danh sách project"`

### Task A2: Nhận yêu cầu review, trả tiến độ/kết quả, nhãn Crew trên UI

**Files:**
- Modify: `Sources/MRQueueCore/CrewBridge.swift` (thêm request/response/heartbeat)
- Create: `Sources/MRReviewQueue/CrewBridgeController.swift`
- Modify: `Sources/MRReviewQueue/AppModel.swift` (khởi động controller; `requestReview` dòng 349 dùng chung đường xếp),
  `ProjectSidebar.swift`, `QueueView.swift`, `MRDetailView.swift` (nhãn và dải ghi chú như mockup 5)
- Test: `Tests/MRQueueCoreTests/CrewBridgeTests.swift`

**Interfaces:**
- Consumes: Task A1.
- Produces: `CrewReviewRequest {schema "crew-review-request/1", requestId, crewProjectId, identifier, run, prNumber, headSha, baseBranch, reviewerInputText?}`;
  `CrewReviewResponse {schema "crew-review-response/1", requestId, state: CrewResponseState, round?, headSha, lanesDone?, lanesTotal?, startedAt?, finishedAt?, verdict?, costUsd?, tokens?, resultDir?, reportPath?, error?}`;
  `CrewResponseState: queued|running|succeeded|failed|cancelled`;
  `CrewBridge.decide(request:, projects:, mergeRequests:) -> CrewRequestDecision` (`.enqueue(MergeRequest.Key)`, `.needsFetch(projectId)`, `.fail(code)` với code `project_missing`, `mr_missing`, `head_mismatch`);
  `CrewBridge.response(for item: QueueItem?, round: ReviewRound?, request:) -> CrewReviewResponse`;
  `CrewBridge.writeAtomic<T: Encodable>(_:to:)`; heartbeat `{pid, version, at, running, waiting}`.

- [ ] **Step 1: Viết test thất bại** (thêm vào `CrewBridgeTests`)

```swift
    func mr(_ project: UUID, iid: Int, head: String) -> MergeRequest {
        MergeRequest(projectId: project, iid: iid, title: "t", author: "a", sourceBranch: "crew/req/TPS-1",
                     targetBranch: "main", webURL: "https://github.com/o/r/pull/\(iid)", headSHA: head, state: .opened)
    }
    func request(head: String = "aaa") -> CrewReviewRequest {
        CrewReviewRequest(schema: "crew-review-request/1", requestId: "r-1", crewProjectId: "p-1", identifier: "TPS-1",
                          run: 1, prNumber: 87, headSha: head, baseBranch: "main", reviewerInputText: nil)
    }

    @Test func decideEnqueuesMatchingHead() {
        let p = project("a", repo: "/r/a", crew: "p-1")
        #expect(CrewBridge.decide(request: request(), projects: [p], mergeRequests: [mr(p.id, iid: 87, head: "aaa")])
                == .enqueue(MergeRequest.Key(projectId: p.id, iid: 87)))
    }
    @Test func decideAsksFetchWhenMRMissingThenFailsAfterFetch() {
        let p = project("a", repo: "/r/a", crew: "p-1")
        #expect(CrewBridge.decide(request: request(), projects: [p], mergeRequests: []) == .needsFetch(p.id))
        #expect(CrewBridge.decide(request: request(), projects: [p], mergeRequests: [], afterFetch: true) == .fail("mr_missing"))
    }
    @Test func decideRejectsHeadMismatchAndUnknownProject() {
        let p = project("a", repo: "/r/a", crew: "p-1")
        #expect(CrewBridge.decide(request: request(head: "bbb"), projects: [p], mergeRequests: [mr(p.id, iid: 87, head: "aaa")], afterFetch: true) == .fail("head_mismatch"))
        #expect(CrewBridge.decide(request: request(), projects: [], mergeRequests: []) == .fail("project_missing"))
    }
    @Test func responseFromSucceededRound() {
        var round = ReviewRound(number: 1, headSHA: "aaa", mode: .diff, startedAt: now, logPath: "/l")
        round.outcome = .succeeded; round.verdict = .block; round.finishedAt = now
        round.snapshotDir = "/d/result"; round.reportPath = "/d/result/mr-87-r1.md"
        let r = CrewBridge.response(for: nil, round: round, request: request())
        #expect(r.state == .succeeded); #expect(r.verdict == "BLOCK"); #expect(r.resultDir == "/d/result")
    }
```

(Dùng đúng `init` hiện có của `MergeRequest`/`ReviewRound` trong `Models.swift`; nếu tham số khác thứ tự thì sửa test
theo `init` thật, không thêm `init` mới.)

- [ ] **Step 2: Chạy test, phải fail** — `swift test --filter CrewBridgeTests`.
- [ ] **Step 3: Viết code**: các kiểu trên trong `CrewBridge.swift`; `decide` theo thứ tự: không có project
  `crewProjectId` → `project_missing`; không có MR `iid == prNumber` → `afterFetch ? .fail("mr_missing") : .needsFetch`;
  `headSHA != headSha` → `afterFetch ? .fail("head_mismatch") : .needsFetch`; còn lại `.enqueue`. `response` ánh xạ
  `QueueItemState.waiting → queued`, `running → running`, `paused/failed → failed` (kèm `failureReason`),
  `RoundOutcome.succeeded → succeeded`, `cancelled → cancelled`. `writeAtomic` ghi file tạm rồi `replaceItemAt` như
  `Store.save`.
  `CrewBridgeController` (`@MainActor`): `DispatchSource.makeFileSystemObjectSource` trên `crew/` và `crew/requests/`
  + `Timer` 60 giây (đọc lại `projects.json`) + 15 giây (heartbeat); request đã xử lý thì đổi tên thành
  `<id>.json.done`; gọi `FetchService.fetch(projectId:)` khi `.needsFetch` rồi `decide(afterFetch: true)`; `.enqueue`
  thì `ReviewQueue.enqueue(key, input:)` với `ReviewerInput` từ `reviewerInputText` và gắn `crewRequest`; quan sát
  `state` để ghi response khi đổi trạng thái, tối đa 1 lần/phút khi `running` (đếm lane từ `LaneMapFollower`).
  `makeProject` dùng đúng hàm dò remote của luồng **Thêm project** hiện có trong `AppModel`.
  UI: `Text("Crew")` badge ở `ProjectSidebar` khi `crewProjectId != nil`, "Crew đã gỡ" khi `crewRemovedAt != nil`; dòng MR
  và hàng đợi hiện `Crew <identifier> · lần <run>`; `MRDetailView` hiện dải ghi chú khi round có `crewRequest`.
- [ ] **Step 4: Chạy test** — `swift test --filter CrewBridgeTests` pass; `swift test --filter ReviewQueueTests` pass;
  `swift build -c release` không lỗi.
- [ ] **Step 5: Kiểm tay** — tạo `crew/projects.json` và một `requests/r-1.json` bằng tay cho repo thử có PR mở; mở app
  bằng `swift run`; thấy project có nhãn Crew, lượt vào hàng đợi, `responses/r-1.json` đổi `queued → running →
  succeeded`. Chụp màn hình so với mockup 5.
- [ ] **Step 6: Commit** — `git commit -m "feat(app): nhận yêu cầu review từ 2P Crew, trả tiến độ và nhãn Crew"`

### Task A3: Build ký Developer ID cho bản nhúng, docs

**Files:**
- Modify: `apps/mr-review-queue/scripts/build-app.sh`
- Create: `apps/mr-review-queue/scripts/entitlements.plist`
- Modify: `docs/mr-review-queue.md` (mục mới "Chạy cùng 2P Crew": cầu nối, nhãn, bản riêng ở `/Applications`)

- [ ] **Step 1**: thêm cờ `--out <dir>` (đặt app ra đó thay vì `release/`), `--sign "<identity>"` (bỏ qua
  `signing-identity.sh`), `--hardened-runtime` (`codesign --force --options runtime --timestamp --entitlements
  scripts/entitlements.plist --sign "<identity>"`, ký mọi `.dylib`/framework bên trong trước, rồi app). `entitlements.plist`
  chỉ có `com.apple.security.network.client` (không sandbox, như hiện nay). Không cờ thì giữ hành vi cũ.
- [ ] **Step 2: Kiểm** — `bash apps/mr-review-queue/scripts/build-app.sh --out /tmp/bf-out --sign "Apple Development: <tên>" --hardened-runtime`
  rồi `codesign --verify --deep --strict --verbose=2 "/tmp/bf-out/Bug Finding.app"` đạt; mở app chạy được, WebKit đăng
  nhập GitLab vẫn mở được. Dọn `/tmp/bf-out`.
- [ ] **Step 3: Commit** — `git commit -m "build(app): ký Developer ID và hardened runtime cho bản nhúng 2P Crew"`;
  ghi lại SHA cho Task B1. Không tăng version plugin (không đổi kit).

## Phase B — repo `my-crew` (`apps/mac-app`)

Đọc `docs/flows/mac-app.md`, `mac-app-paperclip.md`, `mac-app-update.md` trước. Lệnh kiểm:
`pnpm --filter @crew/mac-app test -- <file>` và `pnpm --filter @crew/mac-app typecheck`.

### Task B1: Ghim, build và nhúng Bug Finding khi phát hành

**Files:**
- Create: `apps/mac-app/bug-finding.pin.json`
- Modify: `apps/mac-app/scripts/release-lib.mjs`, `apps/mac-app/scripts/release.mjs`, `apps/mac-app/electron-builder.yml`
- Test: `apps/mac-app/scripts/release-lib.test.mjs`

**Interfaces:**
- Produces: `readBugFindingPin(dir) -> {repo, commit, version}` (ném khi `commit` không đủ 40 hex hay `repo` rỗng);
  `bugFindingBuildCommands({checkout, outDir, identity}) -> string[][]`; thư mục ra `apps/mac-app/build/bug-finding/Bug Finding.app`.

- [ ] **Step 1: Test thất bại** (thêm vào `release-lib.test.mjs`)

```js
import { test, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readBugFindingPin, bugFindingBuildCommands } from './release-lib.mjs';

test('readBugFindingPin đọc file ghim hợp lệ', () => {
  const d = mkdtempSync(join(tmpdir(), 'pin-'));
  writeFileSync(join(d, 'bug-finding.pin.json'), JSON.stringify({ repo: 'git@github.com:nquangphan/bug-finding.git', commit: 'a'.repeat(40), version: '0.2.0' }));
  expect(readBugFindingPin(d)).toEqual({ repo: 'git@github.com:nquangphan/bug-finding.git', commit: 'a'.repeat(40), version: '0.2.0' });
});

test('readBugFindingPin từ chối commit không đủ 40 hex', () => {
  const d = mkdtempSync(join(tmpdir(), 'pin-'));
  writeFileSync(join(d, 'bug-finding.pin.json'), JSON.stringify({ repo: 'x', commit: 'abc', version: '0.2.0' }));
  expect(() => readBugFindingPin(d)).toThrow(/commit/);
});

test('bugFindingBuildCommands build đúng commit và ký bằng danh tính phát hành', () => {
  const cmds = bugFindingBuildCommands({ checkout: '/t/bf', outDir: '/o', identity: 'Developer ID Application: 2P' });
  expect(cmds.at(-1)).toEqual(['bash', '/t/bf/apps/mr-review-queue/scripts/build-app.sh', '--out', '/o', '--sign', 'Developer ID Application: 2P', '--hardened-runtime']);
});
```

- [ ] **Step 2**: `pnpm --filter @crew/mac-app exec vitest run scripts/release-lib.test.mjs` → fail (chưa export).
- [ ] **Step 3**: viết hai hàm trong `release-lib.mjs`; `release.mjs` thêm bước trước `electron-builder`: `D=$(mktemp -d)`,
  `git clone --no-checkout <repo> $D/bf && git -C $D/bf checkout <commit>`, chạy lệnh của `bugFindingBuildCommands` với
  `CSC_NAME` (chế độ `--dry-run` thì không ký: bỏ `--sign`/`--hardened-runtime`), kiểm `CFBundleShortVersionString`
  bằng `version` của file ghim, chép vào `build/bug-finding/`, xóa `$D`. Thiếu `swift` thì dừng với mã thoát mới và câu
  "Cần Swift 6 (Command Line Tools) để build Bug Finding". `electron-builder.yml` thêm vào `extraResources`:
  `- from: build/bug-finding/Bug Finding.app` / `to: Bug Finding.app`. Ghi file ghim với SHA của Task A3.
- [ ] **Step 4**: test pass; `pnpm --filter @crew/mac-app release --dry-run` tạo được gói có
  `Contents/Resources/Bug Finding.app`.
- [ ] **Step 5: Commit** — `git commit -m "build(mac-app): nhúng Bug Finding theo commit ghim khi phát hành"`

### Task B2: Mục Bug Finding — tìm app, trạng thái, mở, bản cài riêng cũ

**Files:**
- Create: `apps/mac-app/src/main/bug-finding/paths.ts`, `state.ts`, `launch.ts`, `register.ts`
- Create: `apps/mac-app/src/renderer/routes/bug-finding.tsx`
- Modify: `apps/mac-app/src/shared/ipc-contract.ts`, `src/renderer/app.tsx` (`ROUTES`, sau `projects`), `src/main/index.ts` (gọi `registerBugFinding(ctx)`)
- Test: `apps/mac-app/test/bug-finding-state.test.ts`, `test/bug-finding-launch.test.ts`, `test/renderer/bug-finding.test.tsx`

**Interfaces:**
- Produces: `bugFindingPaths(home: string) -> {dataDir, bridgeDir, projectsFile, requestsDir, responsesDir, heartbeatFile}`;
  `embeddedAppPath(resourcesPath: string) -> string`; `readBugFindingState(deps) -> BugFindingView`
  `{installed, version, running, pid, heartbeatAgeSec, runningReviews, waitingReviews, standaloneApp: {path, running} | null, requests: BugFindingRequestRow[]}`;
  `launchBugFinding(deps, {background: boolean}) -> {ok: true} | {ok: false, reason: 'standalone_running' | 'missing'}`;
  kênh IPC `bugFinding:state`, `bugFinding:open`, `bugFinding:syncNow`, `bugFinding:trashStandalone`.

- [ ] **Step 1: Test thất bại**

```ts
import { describe, expect, it } from 'vitest';
import { launchBugFinding } from '../src/main/bug-finding/launch';

describe('launchBugFinding', () => {
  const base = { embedded: '/A/2P Crew.app/Contents/Resources/Bug Finding.app', exists: () => true, run: async () => ({ code: 0 }) };
  it('không mở bản nhúng khi bản riêng ở /Applications đang chạy', async () => {
    const r = await launchBugFinding({ ...base, runningAppPaths: async () => ['/Applications/Bug Finding.app'] }, { background: false });
    expect(r).toEqual({ ok: false, reason: 'standalone_running' });
  });
  it('mở nền bằng open -g', async () => {
    const calls: string[][] = [];
    const r = await launchBugFinding({ ...base, runningAppPaths: async () => [], run: async (a: string[]) => { calls.push(a); return { code: 0 }; } }, { background: true });
    expect(r).toEqual({ ok: true });
    expect(calls[0]).toEqual(['/usr/bin/open', '-g', base.embedded]);
  });
  it('báo missing khi không có app nhúng', async () => {
    const r = await launchBugFinding({ ...base, exists: () => false, runningAppPaths: async () => [] }, { background: false });
    expect(r).toEqual({ ok: false, reason: 'missing' });
  });
});
```

`bug-finding-state.test.ts`: heartbeat 20 giây trước với `running: 1` → `running: true, runningReviews: 1`; heartbeat 5
phút trước → `running: false`; có `/Applications/Bug Finding.app` → `standaloneApp` khác `null`; response
`crew/responses/*.json` thành `requests` sắp theo giờ mới nhất.

- [ ] **Step 2**: chạy `pnpm --filter @crew/mac-app test -- test/bug-finding-launch.test.ts test/bug-finding-state.test.ts` → fail.
- [ ] **Step 3**: viết code. `runningAppPaths` dùng `pgrep -fl 'Bug Finding.app/Contents/MacOS/MRReviewQueue'`.
  `trashStandalone`: bản riêng đang chạy thì từ chối "Thoát Bug Finding (bản cài riêng) rồi thử lại"; không thì
  `shell.trashItem`. Màn hình theo mockup 1 (trạng thái, đồng bộ project, bảng project, bảng "MR do Crew xếp"); nghe
  `state:changed`, gọi lại `bugFinding:state` mỗi 10 giây khi màn đang mở. Dev (`!app.isPackaged`): đường dẫn app lấy từ
  biến `CREW_BUG_FINDING_APP`, không có thì `installed: false`.
- [ ] **Step 4**: test pass; `pnpm --filter @crew/mac-app test -- test/ipc-contract.test.ts test/renderer/bug-finding.test.tsx`; typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(mac-app): mục Bug Finding mở app nhúng và hiện trạng thái"`

### Task B3: Đồng bộ project Crew sang Bug Finding

**Files:**
- Create: `apps/mac-app/src/main/bug-finding/sync-projects.ts`
- Modify: `src/main/bug-finding/register.ts` (lịch 10 phút, khi mở app, `bugFinding:syncNow`), `src/main/projects/register.ts`
  (sau `projects:add`/`projects:remove`), `src/main/jobs/register.ts` (sau job tạo/gỡ checkout, cùng chỗ gọi `ctx.sendStatusSoon`)
- Test: `apps/mac-app/test/bug-finding-sync.test.ts`

**Interfaces:**
- Consumes: `ProjectRow` (`shared/ipc-contract.ts:37-45`), `bugFindingPaths` (B2).
- Produces: `buildCrewProjectList(rows: ProjectRow[], resolveRepo: (row) => Promise<string | null>, companyId: string) -> CrewProjectList`;
  `syncProjects(deps) -> {written: boolean, count: number}` (không ghi khi `projects` giống bản đang có, bỏ qua `writtenAt`).

- [ ] **Step 1: Test thất bại**

```ts
import { describe, expect, it } from 'vitest';
import { buildCrewProjectList } from '../src/main/bug-finding/sync-projects';

const row = (id: string, name: string, docsRepo: string | null, onMac = true) =>
  ({ projectId: id, name, onMac, checkouts: [], docsRepo, lastSentCommit: null, progress: null });

describe('buildCrewProjectList', () => {
  it('chỉ lấy project có repo trên máy, giữ đúng id Crew', async () => {
    const list = await buildCrewProjectList(
      [row('p-1', 'my-crew', '/r/my-crew'), row('p-2', 'web-only', null, false)],
      async (r) => r.docsRepo, 'c-1');
    expect(list.schema).toBe('crew-projects/1');
    expect(list.projects).toEqual([{ crewProjectId: 'p-1', key: 'my-crew', name: 'my-crew', repoPath: '/r/my-crew' }]);
  });
  it('dùng repo chính của checkout khi không có docsRepo', async () => {
    const list = await buildCrewProjectList([row('p-3', 'shop', null)], async () => '/r/shop', 'c-1');
    expect(list.projects[0]?.repoPath).toBe('/r/shop');
  });
});
```

(`key` lấy từ `progress.key` nếu có, không thì tên thư mục `~/crew-agents/<key>` của checkout, không thì `name`.)

- [ ] **Step 2**: chạy test → fail.
- [ ] **Step 3**: viết code; `resolveRepo`: `docsRepo` → `progress.folder` → `git -C <checkout> rev-parse --path-format=absolute --git-common-dir` bỏ `/.git`; ghi atomic (file tạm + `rename`).
- [ ] **Step 4**: test pass; kiểm tay: sau ≤ 60 giây Bug Finding có đủ project của Crew (mockup 1, bảng project).
- [ ] **Step 5: Commit** — `git commit -m "feat(mac-app): đồng bộ project Crew sang Bug Finding"`

### Task B4: Việc máy `bug-finding-review` và chuyển kết quả về server

**Files:**
- Modify: `apps/mac-app/src/main/jobs/types.ts`, `validate.ts`, `executors.ts`, `register.ts`
- Create: `apps/mac-app/src/main/bug-finding/results.ts`
- Modify: `apps/mac-app/src/main/paperclip/client.ts` (thêm `postBugFindingResult`)
- Modify: nơi gửi `jobsAgent` vào `app.json`/bản tin máy (`src/main/jobs/poller.ts`): thêm `capabilities: ['bug-finding-review']`
- Test: `apps/mac-app/test/jobs/bug-finding-review.test.ts`, `test/bug-finding-results.test.ts`

**Interfaces:**
- Consumes: B2 (`launchBugFinding`, `bugFindingPaths`), B3 (`syncProjects`).
- Produces: payload `BugFindingReviewPayload {requestId, issueId, identifier, run, projectId, projectKey, repoPath, provider: 'github', prNumber, prUrl, headSha, baseBranch, reviewerInputText?}`;
  kết quả job `{accepted: true}`; mã lỗi `project_missing`, `bug_finding_missing`, `standalone_running`;
  `relayResponses(deps) -> {sent: number, pending: number}`; body `POST /api/plugins/crew.core/api/bug-finding/results`
  `{companyId, machineId, requestId, state, round?, headSha, lanesDone?, lanesTotal?, verdict?, costUsd?, error?, findings?, reportMarkdown?}`.

- [ ] **Step 1: Test thất bại** — validate: `headSha` 40 hex, `prNumber` nguyên dương, `repoPath` tuyệt đối, `run` 1–3,
  `reviewerInputText` ≤ 20 000 ký tự, `requestId` UUID; executor ghi đúng `requests/<requestId>.json` với
  `schema: 'crew-review-request/1'` và gọi `launchBugFinding({background: true})`; chạy lại cùng `requestId` không ghi
  lần hai. Results: response `succeeded` → đọc `review-result.json` trong `resultDir`, rút gọn finding đúng 12 trường
  (`id, rule, title, severity, certainty, status, action, mr_relation, location, fix, accept, question`), báo cáo > 2 MB
  thì cắt và thêm dòng "(báo cáo bị cắt, xem đầy đủ trong Bug Finding)"; gửi lỗi mạng thì giữ trong hàng đợi gửi, lần
  sau gửi lại; `running` gửi tối đa 1 lần/phút mỗi `requestId`.

```ts
it('rút gọn finding và giữ hàng đợi khi gửi lỗi', async () => {
  const sent: unknown[] = [];
  const deps = fakeResultsDeps({ responses: [succeededResponse('r-1', '/res')], files: { '/res/review-result.json': JSON.stringify(sampleResult) },
    post: async (b) => { sent.push(b); throw new Error('ECONNRESET'); } });
  expect(await relayResponses(deps)).toEqual({ sent: 0, pending: 1 });
  deps.post = async (b) => { sent.push(b); };
  expect(await relayResponses(deps)).toEqual({ sent: 1, pending: 0 });
  expect(Object.keys((sent[1] as any).findings[0]).sort()).toEqual(['accept','action','certainty','fix','id','location','mr_relation','question','rule','severity','status','title']);
});
```

(`fakeResultsDeps`, `succeededResponse`, `sampleResult` viết trong file test, theo kiểu `test/projects-fixture.ts`.)

- [ ] **Step 2**: chạy hai file test → fail.
- [ ] **Step 3**: viết code; `relayResponses` chạy trong Main (cần board key), theo `fs.watch(responsesDir)` + 30 giây;
  hàng đợi gửi lưu `bugFindingOutbox` trong `app.json` (giới hạn 200 mục, bỏ mục cũ nhất).
- [ ] **Step 4**: test pass; `pnpm --filter @crew/mac-app test -- test/jobs` (chỉ thư mục jobs); typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(mac-app): việc máy bug-finding-review và gửi kết quả Bug Finding về server"`

### Task B5: Cập nhật chờ Bug Finding rảnh

**Files:**
- Modify: `apps/mac-app/src/main/update/drain.ts`, `src/main/update/register.ts`
- Test: `apps/mac-app/test/update-drain.test.ts`

- [ ] **Step 1: Test thất bại** — heartbeat `running: 1` → drain trả "chờ Bug Finding review xong"; `running: 0` → cho cài
  và gọi `quitBugFinding` (gửi `osascript -e 'quit app id "local.mrreviewqueue"'`, chờ tối đa 30 giây); trước đó đang chạy
  thì đặt cờ `reopenBugFinding` trong `app.json`, sau khởi động bản mới thì mở lại và xóa cờ.
- [ ] **Step 2–4**: chạy test fail → viết code → pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(mac-app): updater chờ Bug Finding rảnh rồi mới cài"`

### Task B6: Template vai và docs `my-crew`

**Files:**
- Modify: `apps/mac-app/src/main/projects/templates/{assistant,reviewer,integrator,executor}.md` (chép từ fork sau Task C4)
- Create: `docs/flows/mac-bug-finding.md`; Modify: `docs/flows.yaml` (flow `mac-bug-finding` gồm mọi file `src/main/bug-finding/*`, route, `bug-finding.pin.json`), `docs/flows/mac-app.md` (route mới), `docs/flows/mac-app-update.md` (nhúng, drain), `docs/flows/mac-app-paperclip.md` (job kind mới), `docs/index.md` (bảng flow sinh lại)

- [ ] **Step 1**: chép template, kiểm `pnpm --filter @crew/mac-app test -- test/projects-instructions.test.ts`.
- [ ] **Step 2**: viết docs; `pnpm --filter @crew/docs-kit build && node packages/docs-kit/dist/crew-docs.cjs generate`.
- [ ] **Step 3: Kiểm** — `node packages/docs-kit/dist/crew-docs.cjs check --range origin/main..HEAD`; `pnpm lint`.
- [ ] **Step 4: Commit** — `git commit -m "docs(mac-app): flow Bug Finding nhúng, đồng bộ template vai"`

## Phase C — fork Paperclip (`/Volumes/CORSAIR/Projects/2p-crew/paperclip`)

Đọc `docs/flows/issue-gate.md`, `machine-jobs.md`, `agent-roles.md` trước. Làm trong worktree riêng của fork.

### Task C1: Policy `root-bf` và nhận dạng

**Files:**
- Modify: `server/src/crew/issue-policy.ts` (`buildCrewPolicy` dòng 196-217; config `bugFinding.enabled` trong `parseCrewPolicyConfig`)
- Modify: `server/src/crew/issue-create-policy.ts` (`decideCreatePolicy` dòng 89-165, nơi gọi dòng 402-431)
- Modify: `packages/crew-plugin/src/shared/policy.ts` (`CrewPolicyKind`, `crewPolicyKind`)
- Test: `server/src/__tests__/crew-issue-create-policy.test.ts`, `packages/crew-plugin/src/__tests__/policy.test.ts` (tạo nếu chưa có)

**Interfaces:**
- Produces: `buildCrewPolicy("root-bf", roles, owner)` → stages `[review integrator, review reviewer, approval owner, review integrator]`;
  `crewPolicyKind(...) → "code" | "code-bf" | "research" | null`; `CrewCompanyConfig.bugFinding.enabled: boolean`.

- [ ] **Step 1: Test thất bại**

```ts
it('root-bf: integrator, reviewer cầu nối, owner, integrator', () => {
  const p = buildCrewPolicy('root-bf', roles, OWNER);
  expect(p.stages.map((s) => [s.type, s.participants[0]?.agentId ?? s.participants[0]?.userId])).toEqual([
    ['review', roles.integratorAgentId], ['review', roles.reviewerAgentId], ['approval', OWNER], ['review', roles.integratorAgentId],
  ]);
});
it('ticket tổng không nhãn, cờ bật, origin GitHub → root-bf; nhãn docs → root', () => {
  expect(decide({ labels: [], bugFindingEnabled: true, originHost: 'github.com' }).kind).toBe('root-bf');
  expect(decide({ labels: ['docs'], bugFindingEnabled: true, originHost: 'github.com' }).kind).toBe('root');
  expect(decide({ labels: [], bugFindingEnabled: false, originHost: 'github.com' }).kind).toBe('root');
  expect(decide({ labels: [], bugFindingEnabled: true, originHost: 'gitlab.corp.vn' }).kind).toBe('root');
});
it('crewPolicyKind nhận cả code cũ và code-bf', () => {
  expect(crewPolicyKind(buildCrewPolicy('root', roles, OWNER))).toBe('code');
  expect(crewPolicyKind(buildCrewPolicy('root-bf', roles, OWNER))).toBe('code-bf');
});
```

(`decide` là helper trong file test bọc `decideCreatePolicy` với fixture issue/project có sẵn trong file test đó; origin
lấy từ `project_repos.origin_url`.)

- [ ] **Step 2**: `pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-create-policy.test.ts` → fail.
- [ ] **Step 3**: code. `crewPolicyKind`: 4 stage, stage 0 và 3 cùng agent, stage 2 approval user → `code-bf`; giữ nhánh
  `code` cũ. Mọi chỗ so `=== "code"` trong plugin/web (`grep -rn "crewPolicyKind\|=== 'code'\|=== \"code\"" packages`)
  xử lý thêm `code-bf`.
- [ ] **Step 4**: test pass; `pnpm --filter @crew/paperclip-plugin typecheck`; `pnpm --filter @paperclipai/server typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat(crew): policy ticket tổng root-bf cho code/bug khi bật Bug Finding"`

### Task C2: Gate cho `root-bf`

**Files:**
- Modify: `server/src/crew/issue-gate.ts` (`docsGateStages` 178-185, `pushGateStages` 188-192, `ownerRestartStages` 198-203,
  `evaluateIssueGate` 280+, đọc comment 593-600)
- Modify: `server/src/crew/issue-policy.ts` (thêm `CREW_PR_RE`/`parseCrewPrEvidence`; `parseCrewMergeEvidence` nhận `pushed=merged merge=<sha>`)
- Test: `server/src/__tests__/crew-issue-gate.test.ts`

**Interfaces:**
- Produces: `prGateStages(policy)` (stage 0 của `code-bf`); `bugFindingGateStages(policy)` (stage 1 của `code-bf`);
  `bugFindingRestartStages(policy)`; mã vi phạm mới `pr_missing`, `pr_sha_mismatch`, `bf_missing`, `bf_batch_open`,
  `bf_questions_open`, `merge_missing`.

- [ ] **Step 1: Test thất bại** — các ca:
  1. `code-bf` stage 0 `done` có `crew-docs-check commit=X` mà không có `crew-pr sha=X pr=<url>` mới hơn → `pr_missing`;
     `crew-pr sha=Y` → `pr_sha_mismatch`; đủ → qua.
  2. `docsGateStages(code-bf)` là stage 0 (không phải stage 1).
  3. Stage 1 `done` khi `crew_bug_finding_runs` chưa có lượt `succeeded`/`skipped` cho head PR hiện tại → `bf_missing`.
  4. Reviewer "cần sửa" ở stage 1 → state dựng lại để lần nộp của Trợ Lý bắt đầu từ stage 0 (như `ownerRestartStages`).
  5. Trợ Lý `PATCH done` ticket tổng khi lô `bf-fix-<k>` mới nhất (theo comment `crew-bf-triage` của Trợ Lý) còn con chưa
     `done` → `bf_batch_open`; còn interaction `ask_user_questions` của Trợ Lý có `idempotencyKey` bắt đầu `crew-bf:` chưa
     trả lời → `bf_questions_open`.
  6. Stage 3 `done` khi chưa có `crew-merge sha=T … pushed=merged pr=<url> merge=<sha>` mới hơn quyết định owner →
     `merge_missing`; `pushed=pr` (luồng cũ) không đủ cho `code-bf`.
  7. Policy `code` cũ: mọi gate cũ giữ nguyên (chạy lại các ca hiện có).

```ts
it('code-bf: stage gộp đòi crew-pr đúng merged commit', async () => {
  const issue = rootBfIssue({ currentStage: 0 });
  const comments = [agentComment(INTEGRATOR, `crew-docs-check commit=${X} range=${BASE}..${X} exit=0`)];
  expect(await gate(issue, comments, { status: 'done' })).toMatchObject({ violations: [expect.objectContaining({ code: 'pr_missing' })] });
  comments.push(agentComment(INTEGRATOR, `crew-pr sha=${X} pr=https://github.com/o/r/pull/87`));
  expect(await gate(issue, comments, { status: 'done' })).toMatchObject({ violations: [] });
});
```

(`rootBfIssue`, `agentComment`, `gate` là helper sẵn có hoặc thêm trong file test, theo mẫu các ca stage 2/4 hiện có.)

- [ ] **Step 2**: `pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-gate.test.ts` → fail.
- [ ] **Step 3**: code. Nhận dạng stage theo vị trí trong policy ghim khi `crewPolicyKind === 'code-bf'`; gate stage 1
  đọc bảng `crew_bug_finding_runs` qua service của plugin (Task C3) — nếu Task C3 chưa xong thì để hàm đọc nhận qua
  tham số và test bằng fake.
- [ ] **Step 4**: test pass; `pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-gate.db.test.ts`.
- [ ] **Step 5: Commit** — `git commit -m "feat(crew): gate PR, Bug Finding và merge cho ticket tổng root-bf"`

### Task C3: Bảng, job, route, xếp tự động, hết giờ

**Files:**
- Create: `packages/crew-plugin/migrations/00NN_bug_finding.sql`
- Modify: `packages/crew-plugin/src/jobs/types.ts` (`MACHINE_JOB_KINDS`, `JobPayload`, `JobResult`), `src/jobs/validate.ts` (`KEYS`, `validateJobPayload`, `validateJobResult`)
- Create: `packages/crew-plugin/src/bug-finding/api.ts`, `enqueue.ts`, `watchdog.ts`
- Modify: `packages/crew-plugin/src/manifest.ts` (route), nơi đăng ký job/lịch của plugin; nơi bắt sự kiện đổi stage của issue (điểm móc giống `issue_children_completed` ở `server/src/routes/issues.ts:14827-14858` và `services/native-runtime/status-decision-committer.ts:1941-2015`)
- Test: `packages/crew-plugin/src/__tests__/machine-jobs-validate.test.ts`, `src/__tests__/bug-finding.db.test.ts` (mới)

**Interfaces:**
- Consumes: C1 (`code-bf`), C2 (gate đọc lượt).
- Produces:
  - SQL:

```sql
CREATE TABLE crew_bug_finding_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  approval_round int NOT NULL,          -- vòng duyệt owner (0 = trước lần yêu cầu sửa đầu)
  run int NOT NULL CHECK (run BETWEEN 1 AND 3),
  request_id uuid NOT NULL UNIQUE,
  machine_job_id uuid,
  machine_id uuid,
  head_sha text NOT NULL CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  pr_url text NOT NULL,
  state text NOT NULL CHECK (state IN ('requested','queued','running','succeeded','failed','timeout','cancelled','skipped')),
  verdict text CHECK (verdict IN ('APPROVE','APPROVE WITH CONDITIONS','BLOCK')),
  lanes_done int, lanes_total int,
  findings jsonb, feedback_text text, report_attachment_id uuid,
  cost_usd numeric(10,4), error text,
  created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
  UNIQUE (issue_id, approval_round, head_sha, run)
);
CREATE INDEX crew_bug_finding_runs_issue ON crew_bug_finding_runs (issue_id, created_at DESC);
-- thêm 'bug-finding-review' vào CHECK crew_machine_jobs_kind_check (danh sách cứng, xem 0022_multi_machine.sql)
```

  - Route plugin: `POST /bug-finding/request {issueId}` (agent reviewer của stage 1, idempotent theo issue + vòng + head);
    `POST /bug-finding/results` (board key của máy được giao); `GET /issues/:id/bug-finding` → `{runs, batchesUsed, maxBatches: 2, currentHead}`;
    `POST /bug-finding/skip {issueId}` (chỉ khi interaction xác nhận của owner đã chấp nhận).
  - `enqueueBugFinding(issue) -> run | null`: đọc `crew-pr` mới nhất (sha, URL, số PR), máy từ `issue_machine_pins`
    rồi `project_machines` (`ready`, `capabilities` có `bug-finding-review`), `run` = số lượt trong vòng + 1 (hết 3 thì
    không xếp), `reviewerInputText` = khối `crew-bf-feedback` trong comment `PATCH done` mới nhất của Trợ Lý.
  - Khi kết quả cuối: lưu, đính báo cáo `.md` vào issue, comment hệ thống `crew-bugfinding run=<n> sha=<head>
    verdict=<v> open=<k>`, `addWakeup` cho `executionState.currentParticipant` reason `crew_bug_finding_result`.

- [ ] **Step 1: Test thất bại** — validate payload/result của kind mới (ca hợp lệ và ca sai từng trường); DB test:
  1. issue `code-bf` vào stage 1 → có đúng một job `bug-finding-review` + một lượt `requested`; vào lại cùng head → không
     xếp thêm.
  2. kết quả `succeeded` từ máy khác máy được giao → 403; `head_sha` khác lượt → 422 `head_mismatch`; `request_id` lạ → 404.
  3. kết quả `succeeded` hợp lệ → lượt `succeeded`, có attachment, có wake `crew_bug_finding_result` cho reviewer.
  4. watchdog: lượt `requested` 31 phút không máy nhận → `timeout`; lượt `running` 8 giờ 1 phút → `timeout`; cả hai đánh thức reviewer.
  5. vòng có 3 lượt → `enqueueBugFinding` trả `null`.
- [ ] **Step 2**: `pnpm --filter @crew/paperclip-plugin test -- src/__tests__/machine-jobs-validate.test.ts src/__tests__/bug-finding.db.test.ts` → fail.
- [ ] **Step 3**: code + migration.
- [ ] **Step 4**: test pass; `pnpm --filter @crew/paperclip-plugin typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat(crew-plugin): lượt Bug Finding, việc máy bug-finding-review và route kết quả"`

### Task C4: Template vai trò

**Files:**
- Modify: `crew/agents/integrator.md`, `crew/agents/reviewer.md`, `crew/agents/assistant.md`, `crew/agents/executor.md`
- Modify: `crew/agents/render-instructions.mjs` nếu cần nối thêm dữ liệu; test render hiện có của thư mục `crew/agents`

Nội dung bắt buộc:
- **integrator.md**: mục mới "Ticket tổng `code-bf`": stage 1 = gộp (như stage 2 cũ) + kiểm + bằng chứng docs + đẩy
  `crew/req/<identifier>` + mở/cập nhật PR (dùng lại script `crew-pr.sh`, bỏ điều kiện "sau owner duyệt"), comment
  `crew-pr sha=<merged commit> pr=<URL>` rồi `PATCH done`; stage 4 = kiểm PR head đúng `T` (commit owner duyệt), `gh pr
  merge <url> --merge --match-head-commit <T>` (repo cấm merge commit thì `--squash`), comment `crew-merge sha=<T>
  branch=<mặc định> pushed=merged pr=<URL> merge=<sha>`, deploy như cũ, `PATCH done`; conflict thì comment
  `Integrator: chưa merge được — conflict` và dừng (spec G8). Giữ nguyên phần luồng cũ cho policy `code`.
- **reviewer.md**: mục mới "Ticket tổng `code-bf`: cầu nối Bug Finding" đúng luật `spec.md` mục 5.5 và 5.6; không đọc
  code; dùng `GET /api/plugins/crew.core/api/issues/<id>/bug-finding`, không tin comment.
- **assistant.md**: mục mới "Xử lý finding Bug Finding" đúng bảng `spec.md` mục 5.3 (tự sửa / hỏi owner / bỏ qua), lô
  `bf-fix-<k>`, comment `crew-bf-triage`, thẻ hỏi `idempotencyKey` `crew-bf:<issueId>:<run>`, chỉ `PATCH done` khi mọi con
  của lô `done` và thẻ hỏi đã trả lời, khối `crew-bf-feedback`; mục "Đóng issue gốc" nói rõ với `code-bf` server chuyển
  sang integrator (không còn reviewer cấp gốc).
- **executor.md**: con có dòng `crew-bf finding=<F-xx> run=<n>`: nền `crew-fix base=`, tiêu chí từ `accept`, test chứng
  minh từ `test` của finding.

- [ ] **Step 1**: sửa template; thêm ca vào `crew/agents/integrator-pr.test.mjs` (script PR chạy được ở stage 1, không đòi
  quyết định owner) rồi chạy `node --test crew/agents/render-instructions.test.mjs crew/agents/instructions.test.mjs crew/agents/integrator-pr.test.mjs`.
- [ ] **Step 2: Commit** — `git commit -m "docs(agents): vai trò cho luồng ticket tổng root-bf và Bug Finding"`

### Task C5: UI crew-web

**Files:**
- Modify: `packages/crew-web/src/ds/widgets/stage-badge.tsx` (thứ tự `code-bf`: `integratorPr`, `bugFinding`, `owner`, `integratorMerge`; nhãn tiếng Việt như mockup 2)
- Modify: `packages/crew-plugin/src/handlers/map.ts` (`kind` `code-bf` cho bản đồ)
- Create: `packages/crew-web/src/features/issues/detail/crew/bug-finding-panel.tsx` (+ hook đọc `GET …/issues/:id/bug-finding` trong `src/api/crew/`)
- Modify: `packages/crew-web/src/features/issues/detail/crew/summary-slot.tsx` (tab/khối Bug Finding), `gate-dialogs.tsx` và `gate-actions.ts` (nút **Duyệt và merge**, ghi chú merge ngay, thẻ Bug Finding trong màn duyệt), `src/ds/widgets/summary-panel.tsx` nếu cần
- Test: `packages/crew-web/src/ds/widgets/stage-badge.test.tsx` (mới), `src/features/issues/detail/crew/bug-finding-panel.test.tsx`

- [ ] **Step 1: Test thất bại** — stage badge `code-bf` vị trí 1 ra nhãn "Review Bug Finding"; panel: lượt `running`
  hiện thanh tiến độ `lanesDone/lanesTotal`; lượt `succeeded` chia ba nhóm theo triage (đọc comment `crew-bf-triage`
  qua dữ liệu route); màn duyệt của `code-bf` có nút "Duyệt và merge", của `code` giữ "Duyệt".
- [ ] **Step 2**: `pnpm --filter @crew/paperclip-web exec vitest run src/ds/widgets/stage-badge.test.tsx src/features/issues/detail/crew/bug-finding-panel.test.tsx` → fail.
- [ ] **Step 3**: code theo mockup 2, 3, 4; chỉ dùng token và component có sẵn.
- [ ] **Step 4**: test pass; `pnpm --filter @crew/paperclip-web typecheck`; chụp màn hình dev so với mockup.
- [ ] **Step 5: Commit** — `git commit -m "feat(crew-web): dải giai đoạn, tab Bug Finding và màn duyệt cho ticket tổng root-bf"`

### Task C6: Docs fork

**Files:** `docs/flows/issue-gate.md`, `machine-jobs.md`, `issues-web.md`, `agent-roles.md`, `docs/flows.yaml` (file mới của C3, C5), hướng dẫn `packages/crew-web/src/features/guide/content/huong-dan.vi.md` (mục luồng duyệt mới)

- [ ] **Step 1**: viết docs; chạy `crew-docs generate` và `crew-docs check --range origin/main..HEAD` của fork.
- [ ] **Step 2: Commit** — `git commit -m "docs: luồng ticket tổng root-bf và Bug Finding"`

## Phase D — lên bản và nghiệm thu thật

### Task D1: Lên bản theo thứ tự và chạy thử trên company dogfood

- [ ] **Step 1**: merge Phase A (bug-finding), cập nhật `bug-finding.pin.json` đúng SHA đã merge.
- [ ] **Step 2**: phát hành 2P Crew (`pnpm --filter @crew/mac-app release`) và cập nhật mọi Mac; kiểm `codesign --verify
  --deep --strict "/Applications/2P Crew.app"` và `spctl -a -vv "/Applications/2P Crew.app"`; mục Bug Finding mở được app;
  dữ liệu cũ còn.
- [ ] **Step 3**: deploy fork với `bugFinding.enabled: false` (đường deploy hiện có, không push khi owner chưa bảo);
  `crew/agents/apply-roles.sh` cho company; đồng bộ template mac-app (Task B6).
- [ ] **Step 4**: bật `bugFinding.enabled` cho company dogfood; tạo một yêu cầu code nhỏ trên project `my-crew`; đi hết
  vòng: gộp + PR → Bug Finding lần 1 (thấy trên UI app) → Trợ Lý lô sửa → chạy lại 1 lần → owner duyệt → merge. Ghi
  bằng chứng và ảnh vào ticket nghiệm thu.
- [ ] **Step 5**: kiểm ticket research/docs/plan mới vẫn luồng cũ; ticket tổng tạo trước khi bật cờ chạy hết luồng cũ.

## Tiêu chí nghiệm thu

Đúng 14 tiêu chí ở `spec.md` mục 11. Ánh xạ:

| Tiêu chí spec | Task |
|---|---|
| 1 gói nhúng, ký, mở được, dữ liệu còn | A3, B1, B2, D1 |
| 2 đồng bộ project | A1, A2, B3 |
| 3 policy 4 stage mới | C1 |
| 4 gộp + PR + gate `crew-pr` | C2, C4 |
| 5 job tới đúng Mac, UI app và web hiện tiến độ | A2, B4, C3, C5 |
| 6 báo cáo đính kèm, reviewer quyết đúng luật | C3, C4 |
| 7 Trợ Lý phân loại đúng | C4 |
| 8 chạy lại đúng một lần sau cả lô | C2 (`bf_batch_open`, `bf_questions_open`), C3, C4 |
| 9 tối đa 2 lô | C3 (`run` ≤ 3), C4 |
| 10 Duyệt và merge, gate `pushed=merged` | C2, C4, C5 |
| 11 owner yêu cầu sửa chạy lại từ stage 1 | C2 |
| 12 luồng cũ không đổi | C1, C2, D1 |
| 13 hỏng/hết giờ không kẹt | C3, C4 |
| 14 updater chờ | B5 |

## Rủi ro

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Notarize gói có app Swift lồng bên trong | Không phát hành được | A3 ký hardened runtime + timestamp; thử `release --dev-sign --no-publish` rồi `notarytool` trước khi phát hành thật |
| Đổi người ký Bug Finding (tự ký → Developer ID) | Keychain hỏi lại token GitHub, quyền Documents hỏi lại một lần | Báo trước trong ghi chú phát hành; bundle id và thư mục dữ liệu giữ nguyên |
| Hai bản Bug Finding cùng bundle id | Ghi đè `state.json` | B2 chặn mở khi bản riêng chạy; nút chuyển bản riêng vào Thùng rác |
| Stage 2 do reviewer (LLM) làm cầu nối | Tốn token, có thể quyết lệch luật | Luật cố định, đọc route thay vì comment; gate C2 chặn `done` sai; chọn model rẻ cho vai reviewer nếu cần |
| Gate cũ giả định PR sau owner duyệt (`push_stale`, `push_sha_mismatch`) | Chặn nhầm `code-bf` | C2 tách theo `crewPolicyKind`, test cả policy cũ |
| Bug Finding nặng, máy yếu, chờ mạng | Ticket tổng chờ lâu | Hàng đợi chung của app, hết giờ 8 giờ, hỏi owner bỏ qua sau 2 lần lỗi |
| Máy phát hành thiếu Swift | Không build được gói | `release.mjs` báo lỗi rõ; Mac mini cài Command Line Tools |
| Mac chạy bản 2P Crew cũ khi server bật cờ | Job bị từ chối | Server chỉ chọn máy có `capabilities` `bug-finding-review`; bật cờ sau khi mọi Mac lên bản |
| `gh pr merge` bị branch protection chặn (cần review/check) | Stage 4 kẹt | Integrator báo `Integrator: chưa merge được — <lý do gh>`, owner chỉnh protection hoặc merge tay; integrator nhận PR đã merge đúng `T` thì hoàn tất |
| Trợ Lý phân loại sai (tự sửa việc cần owner) | Đổi hành vi sản phẩm không hỏi | Bảng luật cứng trong template; owner thấy toàn bộ ở màn duyệt và yêu cầu sửa được |

## Giả định

Ngoài G1–G9 ở `spec.md` mục 10:

- A1. Repo `bug-finding` ở `git@github.com:nquangphan/bug-finding.git` (theo README); máy phát hành clone được.
- A2. Mỗi project chỉ có một Mac giữ repo cho ticket tổng (đã có `issue_machine_pins`); Bug Finding chạy trên máy đó.
- A3. `claude` trên Mac dùng chung tài khoản với agent Crew; quota review Bug Finding tính vào cùng tài khoản đó.
- A4. Kết quả Bug Finding gửi lên server là bản rút gọn (12 trường mỗi finding + báo cáo `.md` ≤ 2 MB); log và lane chi
  tiết chỉ ở trên Mac.
- A5. Không đổi luồng của việc con và con E2E; lô sửa từ finding dùng cơ chế lô sửa hiện có (`crew-fix base=`,
  `e2e-fix-<n>`).
- A6. Không push hay deploy khi owner chưa bảo; từng phase merge riêng theo thứ tự Phase D.
