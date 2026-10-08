# AC-3 lần 3 — timeline đầy đủ

Tất cả thời điểm 08/10/2026 Asia/Ho_Chi_Minh (+07). UUID đầy đủ đối chiếu trong ac-3-r3-evidence.json. Run finish trước lease release là hiện tượng đã đo, không coi finish thay cho release.

| +07 | Issue | Run | Sự kiện | Record |
|---|---|---|---|---|
| 16:26:30.576443 | CRE-36 | 810519fe | wake issue_assigned | 14bd194d |
| 16:30:00.433 | CRE-36 | 810519fe | run started; wake=issue_assigned | 810519fe |
| 16:30:01.243 | CRE-36 | 810519fe | lease acquired | 978c6762 |
| 16:34:41.663716 | CRE-37 | 3b8508e9 | wake issue_assigned | 773f1bf2 |
| 16:34:44.552 | CRE-37 | 3b8508e9 | run started; wake=issue_assigned | 3b8508e9 |
| 16:34:45.82 | CRE-37 | 3b8508e9 | lease acquired | e162d2d3 |
| 16:35:00.916985 | CRE-38 | — | wake issue_dependencies_blocked | da3a8491 |
| 16:35:00.952 | CRE-38 | — | SKIP issue_dependencies_blocked | da3a8491 |
| 16:35:09.829255 | CRE-39 | 4d800afe | wake issue_assigned | 9d1a52f6 |
| 16:35:10.815 | CRE-39 | 4d800afe | run started; wake=issue_assigned | 4d800afe |
| 16:35:13.03 | CRE-39 | 4d800afe | lease acquired | 0d5af677 |
| 16:35:29.574762 | CRE-38 | — | wake issue_dependencies_blocked | 7425b1f5 |
| 16:35:29.597 | CRE-38 | — | SKIP issue_dependencies_blocked | 7425b1f5 |
| 16:36:54.576 | CRE-36 | 810519fe | run succeeded;  | 810519fe |
| 16:36:54.786132 | CRE-36 | 29f12e6f | wake finish_successful_run_handoff | d77f9861 |
| 16:36:55.543 | CRE-36 | 29f12e6f | run started; wake=finish_successful_run_handoff | 29f12e6f |
| 16:36:55.693 | CRE-36 | 810519fe | lease released; status=released | 978c6762 |
| 16:36:58.135 | CRE-36 | 29f12e6f | lease acquired | d714c626 |
| 16:38:56.186081 | CRE-37 | — | wake issue_execution_deferred | 3e709edb |
| 16:38:57.478243 | CRE-39 | — | wake issue_execution_deferred | 854e2bb8 |
| 16:38:59.387 | CRE-37 | 3b8508e9 | run cancelled; issue_reassigned | 3b8508e9 |
| 16:38:59.482901 | CRE-37 | 3b8508e9 | stage 0 review | 5ffd33ed |
| 16:38:59.6193 | CRE-37 | — | wake execution_reconciliation_required | a490c1be |
| 16:38:59.636 | CRE-37 | — | SKIP The previous execution has not released its environment lease. Wait for cleanup before continuing this task. | a490c1be |
| 16:39:04.816 | CRE-37 | 3b8508e9 | lease released; status=expired | e162d2d3 |
| 16:39:04.883911 | CRE-37 | 97bde774 | wake execution_review_requested | 22c17cf8 |
| 16:39:05.608 | CRE-37 | 97bde774 | run started; wake=execution_review_requested | 97bde774 |
| 16:39:05.630123 | CRE-37 | 3b8508e9 | crew.handoff_rewake; skippedWake=a490c1be-f1d3-4b41-a66c-900f9f62aa79 | af1527c6 |
| 16:39:06.572 | CRE-37 | 97bde774 | lease acquired | 3311a970 |
| 16:39:08.089 | CRE-36 | 29f12e6f | run succeeded;  | 29f12e6f |
| 16:39:08.359 | CRE-36 | 29f12e6f | lease released; status=released | d714c626 |
| 16:39:08.879 | CRE-39 | 4d800afe | run cancelled; issue_reassigned | 4d800afe |
| 16:39:08.958204 | CRE-39 | 4d800afe | stage 0 review | 29a6aba6 |
| 16:39:09.127732 | CRE-39 | — | wake execution_reconciliation_required | 668ae6b8 |
| 16:39:09.144 | CRE-39 | — | SKIP The previous execution has not released its environment lease. Wait for cleanup before continuing this task. | 668ae6b8 |
| 16:39:13.777 | CRE-39 | 4d800afe | lease released; status=expired | 0d5af677 |
| 16:39:13.875413 | CRE-39 | 2e649005 | wake execution_review_requested | 53c78f06 |
| 16:39:13.939817 | CRE-39 | 4d800afe | crew.handoff_rewake; skippedWake=668ae6b8-049c-4016-8548-7944064c49b5 | 18888280 |
| 16:39:37.1647 | CRE-37 | 97bde774 | stage None completed | 58b5a6a8 |
| 16:39:37.248477 | CRE-38 | 8abd92ca | wake issue_blockers_resolved | 67e91f02 |
| 16:39:38.338 | CRE-38 | 8abd92ca | run started; wake=issue_blockers_resolved | 8abd92ca |
| 16:39:39.87 | CRE-38 | 8abd92ca | lease acquired | 094f6380 |
| 16:39:45.306 | CRE-37 | 97bde774 | run succeeded;  | 97bde774 |
| 16:39:45.517 | CRE-37 | 97bde774 | lease released; status=released | 3311a970 |
| 16:39:59.997 | CRE-39 | 2e649005 | run started; wake=execution_review_requested | 2e649005 |
| 16:40:01.197 | CRE-39 | 2e649005 | lease acquired | 1b33ee80 |
| 16:40:47.452845 | CRE-39 | 2e649005 | stage None completed | 105bdf83 |
| 16:40:55.988 | CRE-39 | 2e649005 | run succeeded;  | 2e649005 |
| 16:40:56.251 | CRE-39 | 2e649005 | lease released; status=released | 1b33ee80 |
| 16:41:09.251152 | CRE-40 | 8a2e62c4 | wake issue_assigned | cdb7f121 |
| 16:41:10.234 | CRE-40 | 8a2e62c4 | run started; wake=issue_assigned | 8a2e62c4 |
| 16:41:11.831 | CRE-40 | 8a2e62c4 | lease acquired | 3c4eaa99 |
| 16:42:33.085 | CRE-38 | 8abd92ca | run cancelled; issue_reassigned | 8abd92ca |
| 16:42:33.224403 | CRE-38 | 8abd92ca | stage 0 review | 7475ebc3 |
| 16:42:33.500374 | CRE-38 | — | wake execution_reconciliation_required | 1e69a143 |
| 16:42:33.522 | CRE-38 | — | SKIP The previous execution has not released its environment lease. Wait for cleanup before continuing this task. | 1e69a143 |
| 16:42:38.797 | CRE-38 | 8abd92ca | lease released; status=expired | 094f6380 |
| 16:42:38.86143 | CRE-38 | b4810ca1 | wake execution_review_requested | 17b01f0d |
| 16:42:40.027 | CRE-38 | b4810ca1 | run started; wake=execution_review_requested | b4810ca1 |
| 16:42:40.043563 | CRE-38 | 8abd92ca | crew.handoff_rewake; skippedWake=1e69a143-5f8b-445f-94a7-0cdd8da71787 | afb93665 |
| 16:42:40.94 | CRE-38 | b4810ca1 | lease acquired | 6dd30a54 |
| 16:43:39.976777 | CRE-41 | afb94770 | wake issue_assigned | 136850dd |
| 16:43:40.918 | CRE-41 | afb94770 | run started; wake=issue_assigned | afb94770 |
| 16:43:42.092 | CRE-41 | afb94770 | lease acquired | 5a207cba |
| 16:43:45.40142 | CRE-38 | b4810ca1 | stage None completed | 1509438b |
| 16:43:45.49234 | CRE-36 | dc80a67f | wake issue_children_completed | d775a151 |
| 16:43:55.026 | CRE-38 | b4810ca1 | run succeeded;  | b4810ca1 |
| 16:43:55.464 | CRE-38 | b4810ca1 | lease released; status=released | 6dd30a54 |
| 16:44:27.475 | CRE-40 | 8a2e62c4 | run succeeded;  | 8a2e62c4 |
| 16:44:27.624857 | CRE-40 | ec50e871 | wake finish_successful_run_handoff | fe65899a |
| 16:44:28.873 | CRE-40 | ec50e871 | run started; wake=finish_successful_run_handoff | ec50e871 |
| 16:44:29.364 | CRE-40 | 8a2e62c4 | lease released; status=released | 3c4eaa99 |
| 16:44:30.941 | CRE-40 | ec50e871 | lease acquired | c7caba86 |
| 16:44:50.004 | CRE-41 | afb94770 | run cancelled; issue_reassigned | afb94770 |
| 16:44:50.056993 | CRE-41 | afb94770 | stage 0 review | 4a8f2360 |
| 16:44:50.220709 | CRE-41 | — | wake execution_reconciliation_required | f80873ff |
| 16:44:50.239 | CRE-41 | — | SKIP The previous execution has not released its environment lease. Wait for cleanup before continuing this task. | f80873ff |
| 16:44:54.957 | CRE-41 | afb94770 | lease released; status=expired | 5a207cba |
| 16:44:55.040905 | CRE-41 | ac18de6e | wake execution_review_requested | acf7ab65 |
| 16:44:56.176 | CRE-41 | ac18de6e | run started; wake=execution_review_requested | ac18de6e |
| 16:44:56.195774 | CRE-41 | afb94770 | crew.handoff_rewake; skippedWake=f80873ff-cfb6-4358-887e-6273d7623326 | 7684bf59 |
| 16:44:57.214 | CRE-41 | ac18de6e | lease acquired | 7deaf725 |
| 16:45:41.652 | CRE-41 | ac18de6e | run cancelled; issue_reassigned | ac18de6e |
| 16:45:41.738641 | CRE-41 | ac18de6e | stage 0 review | fe42b083 |
| 16:45:41.855553 | CRE-41 | — | wake execution_reconciliation_required | ca1c0050 |
| 16:45:41.871 | CRE-41 | — | SKIP The previous execution has not released its environment lease. Wait for cleanup before continuing this task. | ca1c0050 |
| 16:45:44.746 | CRE-41 | ac18de6e | lease released; status=expired | 7deaf725 |
| 16:45:44.836542 | CRE-41 | b026b9ea | wake execution_changes_requested | 36c6544a |
| 16:45:45.399 | CRE-41 | b026b9ea | run started; wake=execution_changes_requested | b026b9ea |
| 16:45:45.419764 | CRE-41 | ac18de6e | crew.handoff_rewake; skippedWake=ca1c0050-55fc-4ec4-b58b-6cbd81ad0421 | f992ee25 |
| 16:45:45.99 | CRE-41 | b026b9ea | lease acquired | c60762aa |
| 16:45:50.641 | CRE-40 | ec50e871 | run succeeded;  | ec50e871 |
| 16:45:50.848 | CRE-40 | ec50e871 | lease released; status=released | c7caba86 |
| 16:46:00.077 | CRE-36 | dc80a67f | run started; wake=issue_children_completed | dc80a67f |
| 16:46:01.12 | CRE-36 | dc80a67f | lease acquired | 552686f7 |
| 16:46:35.137 | CRE-41 | b026b9ea | run cancelled; issue_reassigned | b026b9ea |
| 16:46:35.190642 | CRE-41 | b026b9ea | stage 0 review | 769534cb |
| 16:46:35.347187 | CRE-41 | — | wake execution_reconciliation_required | 543b1bd0 |
| 16:46:35.365 | CRE-41 | — | SKIP The previous execution has not released its environment lease. Wait for cleanup before continuing this task. | 543b1bd0 |
| 16:46:37.805 | CRE-41 | b026b9ea | lease released; status=expired | c60762aa |
| 16:46:37.929873 | CRE-41 | 582491cb | wake execution_review_requested | 58ffe2c4 |
| 16:46:38.898 | CRE-41 | 582491cb | run started; wake=execution_review_requested | 582491cb |
| 16:46:38.915274 | CRE-41 | b026b9ea | crew.handoff_rewake; skippedWake=543b1bd0-8b40-4f44-bc3b-ecbceb28ee65 | 845171ff |
| 16:46:39.647 | CRE-41 | 582491cb | lease acquired | 2820588c |
| 16:47:30.308532 | CRE-41 | 582491cb | stage None completed | bd8b467f |
| 16:47:30.401982 | CRE-40 | 0cc23bf5 | wake issue_children_completed | cfff7b32 |
| 16:47:35.55 | CRE-36 | dc80a67f | run cancelled; issue_reassigned | dc80a67f |
| 16:47:37.997 | CRE-40 | 0cc23bf5 | run started; wake=issue_children_completed | 0cc23bf5 |
| 16:47:38.027166 | CRE-36 | dc80a67f | stage 0 review | 6e8345c2 |
| 16:47:38.197566 | CRE-36 | — | wake execution_reconciliation_required | fc4f390a |
| 16:47:38.218 | CRE-36 | — | SKIP The previous execution has not released its environment lease. Wait for cleanup before continuing this task. | fc4f390a |
| 16:47:38.864 | CRE-40 | 0cc23bf5 | lease acquired | d23946c0 |
| 16:47:38.897 | CRE-41 | 582491cb | run succeeded;  | 582491cb |
| 16:47:39.118 | CRE-41 | 582491cb | lease released; status=released | 2820588c |
| 16:47:41.211 | CRE-36 | dc80a67f | lease released; status=expired | 552686f7 |
| 16:47:41.279705 | CRE-36 | a54480ab | wake execution_review_requested | 4df35406 |
| 16:47:42.569 | CRE-36 | a54480ab | run started; wake=execution_review_requested | a54480ab |
| 16:47:42.586537 | CRE-36 | dc80a67f | crew.handoff_rewake; skippedWake=fc4f390a-2bca-44ca-b8aa-840d473f14a2 | 56100509 |
| 16:47:43.312 | CRE-36 | a54480ab | lease acquired | cad5f37c |
| 16:48:36.465 | CRE-40 | 0cc23bf5 | run cancelled; issue_reassigned | 0cc23bf5 |
| 16:48:36.510076 | CRE-40 | 0cc23bf5 | stage 0 review | 59a48f83 |
| 16:48:36.640113 | CRE-40 | — | wake execution_reconciliation_required | 0ac32f8e |
| 16:48:36.661 | CRE-40 | — | SKIP The previous execution has not released its environment lease. Wait for cleanup before continuing this task. | 0ac32f8e |
| 16:48:41.873 | CRE-40 | 0cc23bf5 | lease released; status=expired | d23946c0 |
| 16:48:41.967263 | CRE-40 | 91f4b2ba | wake execution_review_requested | 07852997 |
| 16:48:42.029343 | CRE-40 | 0cc23bf5 | crew.handoff_rewake; skippedWake=0ac32f8e-4040-416f-b72c-1e240d7090ae | fea9039c |
| 16:49:36.22 | CRE-36 | a54480ab | run cancelled; issue_reassigned | a54480ab |
| 16:49:37.413 | CRE-40 | 91f4b2ba | run started; wake=execution_review_requested | 91f4b2ba |
| 16:49:37.490003 | CRE-36 | a54480ab | stage 1 review | 5ed74e8d |
| 16:49:37.593384 | CRE-36 | — | wake execution_reconciliation_required | f0721932 |
| 16:49:37.61 | CRE-36 | — | SKIP The previous execution has not released its environment lease. Wait for cleanup before continuing this task. | f0721932 |
| 16:49:39.45 | CRE-40 | 91f4b2ba | lease acquired | e167105d |
| 16:49:43.047 | CRE-36 | a54480ab | lease released; status=expired | cad5f37c |
| 16:49:43.114654 | CRE-36 | a8988bc1 | wake execution_review_requested | 2a126c0a |
| 16:49:43.749 | CRE-36 | a8988bc1 | run started; wake=execution_review_requested | a8988bc1 |
| 16:49:43.76799 | CRE-36 | a54480ab | crew.handoff_rewake; skippedWake=f0721932-0f30-4d5c-b6e4-4d4416106553 | 386e2229 |
| 16:49:44.977 | CRE-36 | a8988bc1 | lease acquired | 41a9a872 |
| 16:50:52.894 | CRE-40 | 91f4b2ba | run cancelled; issue_reassigned | 91f4b2ba |
| 16:50:52.971387 | CRE-40 | 91f4b2ba | stage 1 approval | 97f8a9b8 |
| 16:50:56.672 | CRE-40 | 91f4b2ba | lease released; status=expired | e167105d |
| 16:51:59.447464 | CRE-40 | — | stage None completed | 381ff877 |
| 16:53:17.523 | CRE-36 | a8988bc1 | run cancelled; issue_reassigned | a8988bc1 |
| 16:53:17.605722 | CRE-36 | a8988bc1 | stage 2 approval | 3f29d650 |
| 16:53:22.274 | CRE-36 | a8988bc1 | lease released; status=expired | 41a9a872 |
| 16:53:59.797482 | CRE-36 | — | stage 3 review | 9acdb91a |
| 16:53:59.859121 | CRE-36 | 40839288 | wake execution_review_requested | c8d55eb1 |
| 16:54:00.277 | CRE-36 | 40839288 | run started; wake=execution_review_requested | 40839288 |
| 16:54:00.922 | CRE-36 | 40839288 | lease acquired | 473e7bba |
| 16:56:15.095466 | CRE-36 | 40839288 | stage None completed | 7aecdec2 |
| 16:56:25.589 | CRE-36 | 40839288 | run succeeded;  | 40839288 |
| 16:56:25.833 | CRE-36 | 40839288 | lease released; status=released | 473e7bba |
| 16:57:22.019029 | CRE-42 | 9590bf4b | wake issue_assigned | d87a0146 |
| 16:57:24.152 | CRE-42 | 9590bf4b | run started; wake=issue_assigned | 9590bf4b |
| 16:57:26.313 | CRE-42 | 9590bf4b | lease acquired | d56c7df5 |
| 17:00:41.318591 | CRE-43 | c7bc6a40 | wake issue_assigned | 1b5fa891 |
| 17:00:42.048 | CRE-43 | c7bc6a40 | run started; wake=issue_assigned | c7bc6a40 |
| 17:00:42.791 | CRE-43 | c7bc6a40 | lease acquired | bda59a85 |
| 17:01:37.593 | CRE-42 | 9590bf4b | run succeeded;  | 9590bf4b |
| 17:01:37.815522 | CRE-42 | 69452213 | wake finish_successful_run_handoff | f3e6f273 |
| 17:01:38.387 | CRE-42 | 69452213 | run started; wake=finish_successful_run_handoff | 69452213 |
| 17:01:38.626 | CRE-42 | 9590bf4b | lease released; status=released | d56c7df5 |
| 17:01:39.392 | CRE-42 | 69452213 | lease acquired | 980746b5 |
| 17:02:35.331 | CRE-43 | c7bc6a40 | run cancelled; issue_reassigned | c7bc6a40 |
| 17:02:35.381311 | CRE-43 | c7bc6a40 | stage 0 review | 4eb8f612 |
| 17:02:35.510145 | CRE-43 | — | wake execution_reconciliation_required | ea4a9307 |
| 17:02:35.529 | CRE-43 | — | SKIP The previous execution has not released its environment lease. Wait for cleanup before continuing this task. | ea4a9307 |
| 17:02:36.995 | CRE-43 | c7bc6a40 | lease released; status=expired | bda59a85 |
| 17:02:37.059452 | CRE-43 | 12c48123 | wake execution_review_requested | 18be3cb2 |
| 17:02:37.576 | CRE-43 | 12c48123 | run started; wake=execution_review_requested | 12c48123 |
| 17:02:37.59612 | CRE-43 | c7bc6a40 | crew.handoff_rewake; skippedWake=ea4a9307-d1cf-45f3-8b3e-d1b1fec308d8 | 48d6df8a |
| 17:02:38.787 | CRE-43 | 12c48123 | lease acquired | 12fc19ff |
| 17:03:00.744 | CRE-42 | 69452213 | run succeeded;  | 69452213 |
| 17:03:01.005 | CRE-42 | 69452213 | lease released; status=released | 980746b5 |
| 17:03:42.262395 | CRE-43 | 12c48123 | stage None completed | 8a7d0363 |
| 17:03:42.390041 | CRE-42 | c3e1937a | wake issue_children_completed | 741735d9 |
| 17:03:42.778 | CRE-42 | c3e1937a | run started; wake=issue_children_completed | c3e1937a |
| 17:03:43.9 | CRE-42 | c3e1937a | lease acquired | 1a0118fb |
| 17:03:48.521 | CRE-43 | 12c48123 | run succeeded;  | 12c48123 |
| 17:03:48.894 | CRE-43 | 12c48123 | lease released; status=released | 12fc19ff |
| 17:04:33.569 | CRE-42 | c3e1937a | run cancelled; issue_reassigned | c3e1937a |
| 17:04:33.623129 | CRE-42 | c3e1937a | stage 0 review | 7bdc701f |
| 17:04:33.748133 | CRE-42 | — | wake execution_reconciliation_required | 694a7104 |
| 17:04:33.763 | CRE-42 | — | SKIP The previous execution has not released its environment lease. Wait for cleanup before continuing this task. | 694a7104 |
| 17:04:35.326 | CRE-42 | c3e1937a | lease released; status=expired | 1a0118fb |
| 17:04:35.395786 | CRE-42 | fe18274f | wake execution_review_requested | 74c9383b |
| 17:04:36.037 | CRE-42 | fe18274f | run started; wake=execution_review_requested | fe18274f |
| 17:04:36.058471 | CRE-42 | c3e1937a | crew.handoff_rewake; skippedWake=694a7104-4ef2-4743-affe-7af26196b8c1 | a191668b |
| 17:04:36.892 | CRE-42 | fe18274f | lease acquired | 7ea6431e |
| 17:06:11.63 | CRE-42 | fe18274f | run cancelled; issue_reassigned | fe18274f |
| 17:06:11.750946 | CRE-42 | fe18274f | stage 1 review | abe4d9c0 |
| 17:06:11.892839 | CRE-42 | — | wake execution_reconciliation_required | 6ca5f2e1 |
| 17:06:11.916 | CRE-42 | — | SKIP The previous execution has not released its environment lease. Wait for cleanup before continuing this task. | 6ca5f2e1 |
| 17:06:12.922 | CRE-42 | fe18274f | lease released; status=expired | 7ea6431e |
| 17:06:13.00513 | CRE-42 | 6d9798bb | wake execution_review_requested | 574fc750 |
| 17:06:13.343 | CRE-42 | 6d9798bb | run started; wake=execution_review_requested | 6d9798bb |
| 17:06:13.369115 | CRE-42 | fe18274f | crew.handoff_rewake; skippedWake=6ca5f2e1-cf37-4355-bcde-5f1ceba55b97 | cfd3ade5 |
| 17:06:14.257 | CRE-42 | 6d9798bb | lease acquired | 62e07114 |
| 17:08:21.413 | CRE-42 | 6d9798bb | run cancelled; issue_reassigned | 6d9798bb |
| 17:08:21.543962 | CRE-42 | 6d9798bb | stage 2 approval | e59fb9c4 |
| 17:08:23.621 | CRE-42 | 6d9798bb | lease released; status=expired | 62e07114 |
| 17:08:43.957128 | CRE-42 | — | stage 3 review | ae691898 |
| 17:08:44.029213 | CRE-42 | 06108dbb | wake execution_review_requested | 286ead93 |
| 17:08:44.944 | CRE-42 | 06108dbb | run started; wake=execution_review_requested | 06108dbb |
| 17:08:45.514 | CRE-42 | 06108dbb | lease acquired | 3a687d89 |
| 17:11:55.301343 | CRE-42 | 06108dbb | stage None completed | 1ec15458 |
| 17:12:03.118 | CRE-42 | 06108dbb | run succeeded;  | 06108dbb |
| 17:12:03.427 | CRE-42 | 06108dbb | lease released; status=released | 3a687d89 |
