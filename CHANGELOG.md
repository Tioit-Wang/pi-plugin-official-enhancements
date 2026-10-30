# Changelog

## 0.7.0 — 2026-10-30

- Add optional local user, project, and session memories with separate level,
  AI recall, and AI write switches. Existing enhancements keep their defaults.
- Add English and Simplified Chinese memory management with add, edit, search,
  explicit delete confirmation, context-switch protection, and visible errors.
- Add a host-bound memory agent tool with bounded local retrieval and revision
  checks. The new `agent.tool.register` permission requires a grant when loading
  this version. Memory and AI writes start disabled.
- Persist versioned private records with serialized writes and atomic rename;
  reject corrupt or future-version storage without clearing it.
- Document source research and behavior contracts. Memory retrieval is on demand;
  no background extraction, cloud service, or automatic per-turn injection.
- Fix HTML generation so literal JavaScript dollar tokens survive template
  insertion; cover the generated script with a syntax regression test.
