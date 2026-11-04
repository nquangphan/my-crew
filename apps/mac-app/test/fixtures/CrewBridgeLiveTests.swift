import Foundation
import Testing
@testable import MRQueueCore

/// Đóng vai Bug Finding phía cầu nối: đọc `crew/projects.json` và `crew/requests/*.json` mà 2P Crew đã ghi (thư mục
/// gốc cầu nối lấy từ `CREW_E2E_BRIDGE_ROOT`), quyết định bằng chính `CrewBridge`, rồi ghi `heartbeat.json` và
/// `responses/<id>.json` đúng định dạng thật. Spec `bug-finding-swift-bridge.test.ts` của apps/mac-app chép file này
/// vào một checkout dùng một lần của repo bug-finding rồi chạy `swift test --filter CrewBridgeLiveTests`.
@Suite struct CrewBridgeLiveTests {
    @Test func readsCrewFilesAndWritesResponses() throws {
        let root = try #require(ProcessInfo.processInfo.environment["CREW_E2E_BRIDGE_ROOT"])
        let paths = CrewBridgePaths(root: URL(fileURLWithPath: root))
        let now = Date()

        // 1. Danh sách project do 2P Crew ghi → áp như app thật (gắn crewProjectId, tạo mới nếu chưa có).
        let list = try CrewBridge.readProjects(at: paths.projectsFile)
        let projects = CrewBridge.applyProjects(list, to: [], now: now) { entry in
            var p = Project(name: entry.name, repoPath: entry.repoPath, gitlabBaseURL: "https://github.com",
                            gitlabProjectPath: "o/\(entry.key)")
            p.crewProjectId = entry.crewProjectId
            return p
        }
        #expect(projects.map(\.crewProjectId) == list.projects.map { Optional($0.crewProjectId) })

        // 2. Mỗi yêu cầu: quyết định → xếp hàng (running 2/7) → xong (succeeded APPROVE).
        let names = try FileManager.default.contentsOfDirectory(atPath: paths.requestsDir.path).filter { $0.hasSuffix(".json") }
        #expect(!names.isEmpty)
        var running = 0
        for name in names {
            let request = try CrewBridge.readRequest(at: paths.requestsDir.appendingPathComponent(name))
            let project = try #require(projects.first { $0.crewProjectId == request.crewProjectId })
            let mr = MergeRequest(projectId: project.id, iid: request.prNumber, title: "PR \(request.prNumber)", author: "crew",
                                  sourceBranch: "crew/req/\(request.identifier)", targetBranch: request.baseBranch,
                                  webURL: "https://github.com/o/\(project.name)/pull/\(request.prNumber)",
                                  headSHA: request.headSha, state: .opened)
            #expect(CrewBridge.decide(request: request, projects: projects, mergeRequests: [mr])
                    == .enqueue(MergeRequest.Key(projectId: project.id, iid: request.prNumber)))

            var item = QueueItem(projectId: project.id, iid: request.prNumber)
            item.state = .running; item.startedAt = now; item.roundNumber = request.run
            var round = ReviewRound(number: request.run, headSHA: request.headSha, mode: .diff, startedAt: now, logPath: "/l")
            let responseFile = paths.responsesDir.appendingPathComponent("\(request.requestId).json")
            try CrewBridge.writeAtomic(CrewBridge.response(for: item, round: round, request: request, lanes: (done: 2, total: 7)),
                                       to: responseFile)
            running += 1

            if ProcessInfo.processInfo.environment["CREW_E2E_FINISH"] == "1" {
                let resultDir = URL(fileURLWithPath: root).appendingPathComponent("result-\(request.requestId)")
                try FileManager.default.createDirectory(at: resultDir, withIntermediateDirectories: true)
                let report = resultDir.appendingPathComponent("mr-\(request.prNumber)-r1.md")
                try Data("# Báo cáo Bug Finding (Swift)".utf8).write(to: report)
                try Data(#"{"findings":[{"id":"F-01","rule":"R1","title":"Thiếu kiểm null","severity":"LOW","fix":"thêm guard"}]}"#.utf8)
                    .write(to: resultDir.appendingPathComponent("review-result.json"))
                round.outcome = .succeeded; round.verdict = .approve; round.finishedAt = now
                round.snapshotDir = resultDir.path; round.reportPath = report.path
                try CrewBridge.writeAtomic(CrewBridge.response(for: nil, round: round, request: request), to: responseFile)
                running -= 1
            }
        }

        // 3. Heartbeat.
        try CrewBridge.writeAtomic(CrewHeartbeat(pid: 4242, version: "0.2.0-e2e", at: now, running: running, waiting: 0),
                                   to: paths.heartbeatFile)
    }
}
