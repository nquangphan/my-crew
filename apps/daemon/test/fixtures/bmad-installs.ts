/**
 * `_bmad` files as the `bmad-method` installer writes them (6.0, 6.10, 6.11, 6.12), trimmed to what the profile
 * reader looks at. Personal answers use made-up values; the tests check that none of them leaks.
 */

export const PERSONAL_NAME = 'Chủ Dự Án Thử';

const header = `# ─────────────────────────────────────────────────────────────────
# Installer-managed. Regenerated on every install — treat as read-only.
# ─────────────────────────────────────────────────────────────────
`;

const userToml = (language: string) => `${header}
[core]
user_name = "${PERSONAL_NAME}"
communication_language = "${language}"

[modules.bmm]
user_skill_level = "intermediate"
`;

const agents = `
[agents.bmad-agent-analyst]
module = "bmm"
team = "software-development"
name = "Mary"
title = "Business Analyst"
icon = "📊"
description = "Channels Porter's strategic rigor, speaks like a treasure hunter."
`;

/** 6.12.0 with external modules (bmb, cis, tea, bmad-loop) and five tools. */
export const BMAD_6_12: Record<string, string> = {
  '_bmad/_config/manifest.yaml': `installation:
  version: 6.12.0
  installDate: 2026-09-24T15:27:41.562Z
  lastUpdated: 2026-09-24T15:27:41.562Z
  installShims: false
modules:
  - name: core
    version: 6.12.0
    installDate: 2026-09-24T15:27:41.144Z
    lastUpdated: 2026-09-24T15:27:41.558Z
    source: built-in
    npmPackage: null
    repoUrl: null
  - name: bmm
    version: 6.12.0
    installDate: 2026-09-24T15:27:41.220Z
    lastUpdated: 2026-09-24T15:27:41.558Z
    source: built-in
    npmPackage: null
    repoUrl: null
  - name: bmb
    version: v2.2.2
    installDate: 2026-09-24T15:27:41.262Z
    lastUpdated: 2026-09-24T15:27:41.559Z
    source: external
    npmPackage: bmad-builder
    repoUrl: https://github.com/bmad-code-org/bmad-builder
    channel: stable
    sha: 4a1422274a2acb0fb0ec0511753da6263948f072
  - name: cis
    version: v0.3.2
    installDate: 2026-09-24T15:27:41.276Z
    lastUpdated: 2026-09-24T15:27:41.560Z
    source: external
    npmPackage: bmad-creative-intelligence-suite
    repoUrl: https://github.com/bmad-code-org/bmad-module-creative-intelligence-suite
    channel: stable
  - name: tea
    version: v1.27.2
    installDate: 2026-09-24T15:27:41.516Z
    lastUpdated: 2026-09-24T15:27:41.561Z
    source: external
    npmPackage: bmad-method-test-architecture-enterprise
    repoUrl: https://github.com/bmad-code-org/bmad-method-test-architecture-enterprise
    channel: stable
  - name: bmad-loop
    version: v0.12.0
    installDate: 2026-09-24T15:27:41.525Z
    lastUpdated: 2026-09-24T15:27:41.562Z
    source: external
    npmPackage: null
    repoUrl: https://github.com/bmad-code-org/bmad-loop
ides:
  - claude-code
  - codex
  - cursor
  - github-copilot
  - opencode
`,
  '_bmad/config.toml': `${header}
[core]
project_name = "kidy_school"
document_output_language = "Vietnamese"
output_folder = "{project-root}/_bmad-output"

[modules.bmm]
planning_artifacts = "{project-root}/_bmad-output/planning-artifacts"
implementation_artifacts = "{project-root}/_bmad-output/implementation-artifacts"
project_knowledge = "{project-root}/docs"

[modules.bmb]
bmad_builder_output_folder = "{project-root}/skills"
bmad_builder_reports = "{project-root}/skills/reports"

[modules.cis]
visual_tools = "intermediate"

[modules.tea]
test_artifacts = "{project-root}/_bmad-output/test-artifacts"
tea_use_playwright_utils = true
tea_use_pactjs_utils = false
tea_pact_mcp = "mcp"
risk_threshold = "p1"
test_design_output = "_bmad-output/test-artifacts/test-design"
${agents}`,
  '_bmad/config.user.toml': userToml('Vietnamese'),
  '_bmad/custom/config.user.toml': `[core]\nuser_name = "${PERSONAL_NAME}"\n`,
  '_bmad/memory/notes.md': `Ghi nhớ riêng của ${PERSONAL_NAME}\n`,
};

/** 6.11.0: two built-in modules plus bmb and the deprecated automator; English documents. */
export const BMAD_6_11: Record<string, string> = {
  '_bmad/_config/manifest.yaml': `installation:
  version: 6.11.0
  installDate: 2026-08-20T03:10:00.000Z
  lastUpdated: 2026-08-21T04:00:00.000Z
modules:
  - name: core
    version: 6.11.0
    source: built-in
    npmPackage: null
    repoUrl: null
  - name: bmm
    version: 6.11.0
    source: built-in
    npmPackage: null
    repoUrl: null
  - name: bmb
    version: v2.2.1
    source: external
    npmPackage: bmad-builder
    repoUrl: https://github.com/bmad-code-org/bmad-builder
  - name: automator
    version: main
    source: external
    npmPackage: bmad-story-automator
    repoUrl: https://github.com/bmad-code-org/bmad-automator
    channel: next
ides:
  - claude-code
  - codex
  - opencode
`,
  '_bmad/config.toml': `${header}
[core]
project_name = "business-app"
document_output_language = "English"
output_folder = "{project-root}/_bmad-output"

[modules.bmm]
planning_artifacts = "{project-root}/_bmad-output/planning-artifacts"
implementation_artifacts = "{project-root}/_bmad-output/implementation-artifacts"
project_knowledge = "{project-root}/docs"

[modules.bmb]
bmad_builder_output_folder = "{project-root}/skills"
bmad_builder_reports = "{project-root}/skills/reports"
${agents}`,
  '_bmad/config.user.toml': userToml('Vietnamese'),
};

/**
 * 6.10.0 with a module table for a module that is not installed, a machine-specific absolute path, a
 * credential-like key and a multi-select answer: only the replayable, shareable answers stay.
 */
export const BMAD_6_10: Record<string, string> = {
  '_bmad/_config/manifest.yaml': `installation:
  version: 6.10.0
  installDate: 2026-08-04T12:56:22.715Z
  lastUpdated: 2026-08-04T13:06:06.622Z
modules:
  - name: core
    version: 6.10.0
    source: built-in
  - name: bmm
    version: 6.10.0
    source: built-in
  - name: tea
    version: v1.21.3
    source: external
    npmPackage: bmad-method-test-architecture-enterprise
  - name: cis
    version: v0.2.1
    source: external
ides:
  - claude-code
`,
  '_bmad/config.toml': `${header}
[core]
project_name = "crazii-signal"
document_output_language = "Vietnamese"
output_folder = "docs/bmad"

[modules.bmm]
planning_artifacts = "{project-root}/docs/bmad/planning-artifacts"
project_knowledge = "/Users/someone/Documents/knowledge"

[modules.tea]
tea_use_playwright_utils = true
tea_pact_mcp = "none"
pact_broker_token = "should-never-leave"
ci_platform = "auto"

[modules.cis]
visual_tools = ["intermediate", "advanced"]

[modules.gds]
game_engine = "godot"
${agents}`,
  '_bmad/config.user.toml': userToml('English'),
};

/** 6.0.0 layout: no config.toml, answers in each module's config.yaml. */
export const BMAD_6_0: Record<string, string> = {
  '_bmad/_config/manifest.yaml': `installation:
  version: 6.0.4
  installDate: 2026-02-10T09:00:00.000Z
  lastUpdated: 2026-02-10T09:00:00.000Z
modules:
  - name: core
    version: 6.0.4
  - name: bmm
    version: 6.0.4
ides:
  - claude-code
  - cursor
`,
  '_bmad/core/config.yaml': `# CORE Module Configuration
user_name: ${PERSONAL_NAME}
communication_language: Vietnamese
document_output_language: English
output_folder: "{project-root}/_bmad-output"
`,
  '_bmad/bmm/config.yaml': `project_name: legacy
user_name: ${PERSONAL_NAME}
user_skill_level: expert
`,
};
