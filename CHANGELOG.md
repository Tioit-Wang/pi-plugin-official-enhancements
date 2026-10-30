# Changelog

## 0.8.0 — 2026-10-30

- Keep only the user and project memory levels. The session level is removed:
  mid-task context already lives in the transcript, and a second copy only
  added staleness and a session-switch race.
- Add per-entry labels with supersession. Saving the same label with new content
  retires the earlier row (`validUntil` + `supersededBy`) instead of deleting
  it, so facts stay auditable, revertible, and queryable as of a past moment.
- Make user-level assistant writes proposals. A user preference shapes every
  conversation, so the assistant now returns a proposal the user confirms in
  settings instead of writing it directly.
- Split limits per level: 500 characters / 50 entries for the profile, 2,000
  characters / 32 KB / 100 entries per project. Capacity errors are explicit
  rather than silent truncation.
- Migrate 0.7.0 files by dropping session entries and the `sessionEnabled`
  switch while keeping user and project rows. A read never rewrites the file.
- Fix the panel dropping `expectedRevision` on edit, which turned an edit into
  an insert.

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
