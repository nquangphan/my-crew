# Pulse

**Default frequency:** 20 phút khi đang có việc chạy; ngoài ra không thức.

## On Quiet Waking

When invoked via `--pulse` without a specific task, load `references/memory-guidance.md` for memory discipline, then work through these in priority order.

### Memory Curation

Your goal: when your owner activates you next session and you read MEMORY.md, you should have everything you need to be effective and nothing you don't. MEMORY.md is the single most important file in your sanctum — it determines how smart you are on waking.

**What good curation looks like:**
- A new session could start with any request and MEMORY.md gives you the context to be immediately useful — past work to reference, preferences to respect, patterns to leverage
- No entry exists that you'd skip over because it's stale, resolved, or obvious
- Patterns across sessions are surfaced — recurring themes, things the owner keeps circling back to
- The file stays near or under roughly 1500 tokens. If it has grown well past that, you're hoarding rather than curating.

**Source material:** Read recent session logs in `sessions/`. These are raw notes from past sessions — the unprocessed experience. Your job is to extract what matters and let the rest go. Session logs older than 14 days can be pruned once their value is captured.

**Also maintain:** Update INDEX.md if new organic files have appeared. Check BOND.md — has anything about the owner changed that should be reflected?

### Canh việc đang chạy

Nếu có kế hoạch đang chạy: đọc checkbox trong plan và `can-dai-ca-chot.md`, kiểm agent nền còn sống. Task xong thì điều reviewer; hết task thì review toàn nhánh, nghiệm thu, cho ghi doc rồi báo Đại Ca. Khi Paperclip R1 đã chạy, đọc trạng thái issue trên Paperclip thay cho checkbox.

Không có việc nào chạy thì **đừng bịa việc ra làm**. Ngủ tiếp rẻ hơn.

### Dọn tài nguyên

Xem `memory_pressure`, `sysctl vm.swapusage` và `df -h /`. Tắt process nền mình bật mà không còn task nào dùng (theo `.claude/rules/process-management.md`). Đừng giết process của phiên khác, server Paperclip đang phục vụ nghiệm thu, hay container `crew-dev-postgres`.

### Chốt sổ lỗi

Lỗi nào ghi trong buổi mà chưa định tuyến thì quyết dứt điểm: chung của dự án thì đẩy vào project context, riêng của mình thì gọn lại vào MEMORY.

### Self-Improvement (if owner has enabled)
Reflect on recent sessions. What worked well? What fell flat? Are there capability gaps — things the owner keeps needing that you don't have a capability for? Consider proposing new capabilities, refining existing ones, or innovating your approach. Note findings in session log for discussion with owner next session.

## Task Routing

| Task | Action |
|------|--------|
| Canh kế hoạch đang chạy | Đọc plan + agent nền, điều chặng tiếp theo |
| Dọn tài nguyên | Xem pressure/swap/đĩa, tắt process mình bỏ quên |
| Chốt sổ lỗi | Định tuyến lỗi chưa xử: project context hay MEMORY |
| Không có việc | Ngủ tiếp, không bịa việc |

## Quiet Hours
23:00 – 07:00 giờ Việt Nam. Trong khung này chỉ thức khi có việc đang chạy dở, và chỉ báo Đại Ca nếu hỏng thứ đang chặn cả kế hoạch.

## State
_Maintained by the agent. Last check timestamps, pending items._
