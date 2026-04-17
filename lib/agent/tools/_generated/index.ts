/**
 * Auto-import barrel for tools the agent writes itself via the self-coding
 * pack (`repo_propose_change`).
 *
 * This file is maintained by the agent and re-deployed automatically when a
 * self-coding PR is merged. Each file in this folder should export a tool via
 * `registerTool(...)` at module load time.
 *
 * ⚠ Do not put hand-written tools here — they live in the parent `tools/`
 * folder. This barrel exists only so the runtime picks up agent-authored
 * files without needing to edit the main tool index.
 */

// Agent-authored imports (managed by repo_propose_change). Do not edit by hand
// unless you really know what you're doing — the agent will rewrite this file.
// Format: one `import "./tool-name";` per generated tool.
