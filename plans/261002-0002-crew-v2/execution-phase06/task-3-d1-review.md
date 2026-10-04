# T3 D1 — task review

### Spec Compliance

- ❌ **Issues found.** The pure inspector has the requested two-file scope and leaves BMAD admission denied (`v2/gateway/src/assistant/render-artifacts.ts:1`, `v2/gateway/test/render-artifacts.test.ts:338`). Three contract gaps remain: the supplied byte maps can disagree about the same `customize.toml` path (`render-artifacts.ts:237`, `render-artifacts.ts:309`); `resolved_values` accepts arrays and nested objects beyond supported official string values (`render-artifacts.ts:153`, `render-artifacts.ts:342`); and an accessor can return different bytes between the cap pass and copy pass (`render-artifacts.ts:264`, `render-artifacts.ts:277`). The last gap defeats the required cap-before-copy guarantee for an accepted plain-record supplier.
- ⚠️ **Cannot verify from this diff:** selected-file completeness against a pinned projection manifest, host path confinement/file type, actual renderer execution, operational project-root equivalence, receipt/admission, and the historical RED transcript. These are explicitly outside D1 (`task-3-d1-render-inspection-plan.md:24`, `task-3-d1-render-inspection-plan.md:28`); the RED log exists only in the calling task transcript (`task-3-d1-report.md:21`). The pinned official `render_skill.py` archive is not in the review package, so the fixture's root/generation geometry and Unicode/control vector can be compared to the plan's quoted script lines (`task-3-d1-render-inspection-plan.md:16`), but this review cannot independently attest the archive or execution. The schema, destination shape and Python-style string JSON algorithm in `render-artifacts.ts:322`, `render-artifacts.ts:391`, `render-artifacts.ts:399` align with that quoted evidence.

### Strengths

- `render-artifacts.ts:217` validates and clones expected pins and nested options; `render-artifacts.test.ts:150` exercises mutation after capture.
- `render-artifacts.ts:301` hashes selected projected bytes; `render-artifacts.ts:309` hashes all seven raw layer states; `render-artifacts.ts:359` and `render-artifacts.ts:369` check exact source/output names and hashes. This keeps equal token values from hiding a changed optional layer (`render-artifacts.test.ts:169`).
- `render-artifacts.ts:404` returns inspection data only. The adapter denial test at `render-artifacts.test.ts:338` guards the D1 boundary.

### Issues

#### Important (Should Fix)

1. **Conflicting bytes for one path can pass** — `render-artifacts.ts:237`, `render-artifacts.ts:309`. `customize.toml` is both a selected projected file and a required layer. The factory never requires its two expected digests to agree, and inspection checks each independently. A caller can supply byte A as projected content and byte B as current layer content for the same path and get a positive result. Require equal expected digests and equal copied bytes for that shared path; add a contradiction test.
2. **The cap pass does not bind the bytes copied** — `render-artifacts.ts:264`, `render-artifacts.ts:277`, `render-artifacts.ts:281`. `isPlainRecord` permits accessors. A getter can return a small `Uint8Array` during `preflight` and a much larger one during `Buffer.from`, including for `manifestBytes`, layers and outputs. Read each value once into a local, check its size, then copy that same value while tracking the total; reject accessors or ensure field/key checks cannot be invalidated by them. Add a getter regression test covering a layer or manifest.
3. **Official `resolved_values` shape is too broad** — `render-artifacts.ts:153`, `render-artifacts.ts:342`. The validator accepts a top-level string, arrays, and nested records if their leaves are strings. The D1 ruling limits the official values to supported strings; accepting these alternate shapes lets a fabricated schema-1 manifest acquire an inspection result and makes the claimed format check unsound. Require the official key/value map shape with string values and test array/nested-object rejection. Numeric rejection at `render-artifacts.test.ts:327` alone does not cover this.
4. **Malformed Unicode can enter the Python identity through paths** — `render-artifacts.ts:113`, `render-artifacts.ts:391`. `validUnicode` is applied to `resolved_values` but not `projectRoot`, `generationRoot`, or `generationPath`. An unpaired surrogate in a parent component survives the lexical path check; Node UTF-8 encoding replaces it, whereas Python's strict UTF-8 encoding for the official root hash cannot produce that identity. Reject lone surrogates in every path identity string and test one in a parent directory.

### Assessment

**Task quality:** Needs fixes.

**Reasoning:** The narrow inspection boundary, explicit deferred authority and reported 13/13 fixture tests are sound directionally. The four input-consistency and validation gaps above can produce a positive inspection or an unbounded copy from inputs the API currently accepts, so D1 should be corrected before it becomes a host-consumed kernel.

**Checks:** SHA-256 matched the supplied plan, report and diff (`bd24b8d8…`, `d03e722c…`, `1c7da445…`) and the two candidate source hashes in the report. The retained final log reports 13 pass/0 fail with no warnings; scoped Biome reports two files checked with no fixes; the retained typecheck log is empty. Their SHA-256 values match the report. No tests, Node, Git, renderer or external operation was run in this static review.
