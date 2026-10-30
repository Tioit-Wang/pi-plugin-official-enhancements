# Official Enhancements

One plugin for four enhancement capabilities, configured from its own settings
window. Suggestions, prompt enhancement, and titles start on. **Memory starts
off**, with AI writes separately off; the window is the configuration surface.

| Capability | Where it shows | Switch |
|---|---|---|
| Next-message suggestion | The message you are likely to send next, shown in the composer placeholder after a turn ends; <kbd>Tab</kbd> accepts it | `predictionsEnabled` |
| Prompt enhancement | The **Enhance prompt** action on the composer | `promptEnhancementEnabled` |
| Session titles | The session's title in the sidebar, after its first exchange | `titlesEnabled` |
| Scoped memory | Manual management in settings; on-demand recall and writes through the agent's memory tool | Separate memory switches |
| Changed-files card | **Moved to the host**: rendered natively under the last reply, not by this plugin |

The memory manager is a two-pane surface: entries on the left, the editor on
the right, each scrolling on its own. The panel opens at 960x720 and falls back
to a single column below 720px.

The settings window is a detached panel (`ui.panel`), not a work-panel view: it
opens on its own from the command palette (**Enhancements: Open Settings**) or
the plugin row, so it never occupies the sidebar the conversation is read in.
Each capability has one on/off button, and its controls appear only while it is
on.

The plugin declares **no `contributes.settings`**, so PI-Desktop's generated
plugin settings sheet shows nothing for it: there is exactly one surface, and
it cannot drift out of step with a second copy of the same values. The defaults
therefore live in `main.js`, not in the manifest.

## Editable instruction prompts

The three model-backed capabilities each have one editable instruction. It is
sent as the completion's `system` message; the data it acts on always travels
as the user message, so a prompt can be rewritten without reproducing the
plugin's data layout:

| Capability | Editable prompt | What is sent as the message |
|---|---|---|
| Next-message suggestion | `predictionPrompt` | the tail of the conversation |
| Prompt enhancement | `enhancementPrompt` | the draft |
| Session titles | `titlePrompt` | the first user message and the first reply |

The three editors share **one Save button in the window's top-right corner**:
typing stays local, `Unsaved` appears while a draft differs from what is stored,
and nothing reaches the plugin until Save is clicked — one write covers all
three. **Defaults** loads the built-in text into the editors without saving.
An empty edit is refused: the built-in default comes back, because a capability
whose prompt said nothing would spend a completion and answer nonsense. Each
prompt is capped at 8,000 characters.

## Next-message suggestion

The suggestion is offered when a turn ends — you send, the assistant answers —
and never while you type. One completion per turn, at most one suggestion per
turn, handed to the host's composer suggestion channel: the host draws it in the
composer's placeholder slot, accepts it with `Tab`, drops it with `Esc`, and
clears it as soon as the draft is not empty, the turn goes stale, or the session
changes. The plugin draws nothing itself; the composer has one owner.

Which model writes it, in order:

1. **The model picked in the settings window**, while it is available.
2. **The session's model** — the model this conversation will answer with
   (`session.getActive().modelKey`). This is the default.
3. **The app default model** — only when the conversation has no model of its own.

The data sent is the tail of the conversation (six messages, 400 characters
each, read with `session.listMessages`) and the reply is normalised to one line:
labels, quotes and line breaks are stripped, and it is capped at 120 characters
because a placeholder shows a single ellipsised line. `session.getLlmContext` is
deliberately unused: the host only serves it from inside one of the plugin's own
tool calls, which a turn-end handler is not.

A suggestion is skipped without spending a completion when the switch is off,
the turn did not complete, the turn belongs to a session the user is not looking
at (the host only reports the visible one), a suggestion was already produced
for that turn, or the host predates the channel. The plugin budgets the host's
8 completions per rolling minute itself: suggestions may take 3, titles 3, and
prompt enhancement or the model test are user-initiated. The host still enforces
the real limit.

**Host requirement.** This capability needs the composer suggestion channel
(`composer.suggest`). On a host without it the plugin says so in its window and
never spends a completion on a suggestion it could not show.

**Thinking level.** All three model-backed capabilities can pin a reasoning level. While no model
is pinned the picker offers every level the host knows (`off`, `minimal`, `low`,
`medium`, `high`, `xhigh`, `max`); once a model is pinned it offers only what
that model reports. A level the answering model does not support is snapped to
the nearest one it does, weakest to strongest, instead of being dropped
silently; a stored level outside the host's vocabulary is discarded on write.

## Prompt enhancement

Declared as `contributes.composerTransforms`, so the host invokes it only after
an explicit user action and hands it the draft alone — no transcript, no
attachments, no paths. The plugin sends that draft to the configured model (or
the app default) with a rewrite instruction and returns the rewritten text; the
host applies it to the composer with one-step undo. The **Test model** button
makes one small completion so a misconfigured provider is visible early.

## Session titles

Modelled on `vastsa/pi-session-title-plugin`, and using the host's dedicated
contract (ADR 0323) rather than a general transcript read:

- The plugin listens for `session:turnEnded`. Only `reason: "completed"` turns
  are titled; aborted and failed turns are not.
- `session.getAutoTitleContext({ sessionId })` decides eligibility: it answers
  `null` once the stored title is no longer a placeholder, so a manual rename —
  or an earlier title — always wins. It returns only the first user message and
  the first reply, each bounded.
- The reply is cleaned the way the reference plugin cleans it: a `Title:` label,
  wrapping quotes or brackets, collapsed whitespace and trailing punctuation are
  stripped, then the text is cut to the configured length (48 by default, 16–80,
  and never past the host's own 80-character limit).
- `session.setAutoTitle({ sessionId, expectedTitle, title })` is a
  compare-and-set: a rename that lands while the model is thinking is not
  overwritten, and a refused write is not retried.
- One session titles one turn at a time. A newer turn arriving mid-flight is
  queued and runs after the current one finishes, so two titles never race for
  the same session. A repeated `turnId` is ignored, and the listener is removed
  on unload.

## Changed-files card (moved to the host)

This capability used to live here as an `entryExtra` block. It moved to the
host's own transcript, for a reason worth recording: a plugin cannot read the
conversation the user is having. `pi.session.listMessages` is gated by
`session.read.own` and only answers for sessions the plugin imported itself,
while `pi.session.getLlmContext` is served only from inside one of the plugin's
own tool calls. A card that needs "the tool calls of the turn that just ended"
therefore had no legal data source, and the version that shipped here could
never render.

The host renders it natively instead, beside the parts it already owns, so the
plugin now has no renderer module, no slot registration, and no `session.read`
use for a transcript read.
## User and project memory

Open **Enhancements: Open Settings**, then the **Memory** section (localized to
English or Simplified Chinese). Add, edit, search, or delete entries at either
level. A delete needs a second confirmation and keeps the entry as retired
history. Manual management works even while AI memory is off.

| Level | Visibility | Written by |
|---|---|---|
| User | All projects and sessions in the same local PI profile | The user only; the assistant may propose an entry |
| Project | Sessions in the current host project group; absolute project path on hosts without group IDs | The user or the assistant |

There is no session level. Mid-task context already lives in the transcript, so
a second copy only adds staleness.

Use **Use memory** to allow the AI to use memories, then select the available
levels. **AI recall** and **AI write** have independent switches. Level switches
apply to AI access throughout this profile; they do not erase or hide manually
managed records. The initial switches are:

| Switch | Default |
|---|---|
| Use memory | Off |
| User / Project | On, gated by Use memory |
| AI recall | On, gated by Use memory |
| AI write | Off |

After enabling recall, ask the assistant to look up relevant saved preferences
or project decisions. After additionally enabling writes, requests such as
"Remember for this project that we use pnpm" let it save a project entry. A
user-level save from the assistant is a **proposal**. It is stored as a pending
item and listed under **Awaiting your confirmation**, where you either save it
or dismiss it; nothing reaches the memory levels until you do. This exists
because a user preference shapes every future conversation, so a wrong guess
must not silently apply everywhere. A proposal survives a reload, so closing the
window does not lose it.
instructs the assistant to save only requested facts, choose the narrowest
suitable level, and never treat stored text as system instructions. Model
compliance is not a security boundary: the backend enforces scope, switches,
revisions, and limits.

Recall combines only enabled entries from the current scopes, with project
before user, then lexical relevance and recency within each level. Search
supports English and Chinese locally. Identical content is deduplicated; an
identical label with different content supersedes the earlier entry. Current
user instructions take priority over remembered facts.

### Label supersession

Entries carry a **label** (`title`). Saving again with the same label at the same
level retires the previous entry instead of deleting it: the old row gets a
`validUntil` timestamp and a `supersededBy` pointer, and stays on disk. Recall
and the panel only show active rows, so the visible result is an update, while
the history stays auditable and reversible. Two timestamps are recorded per
entry — `createdAt`/`updatedAt` for when we wrote it, `validUntil` for when it
stopped applying — and they never overwrite each other.

### Retrieval and storage

The plugin provides an on-demand `memory` agent tool with `recall`, `save`, and
`delete` actions. It does **not** automatically inject memories at every turn
or extract whole transcripts: the sandboxed plugin API has no general turn
prompt hook. The conversation model decides when to call the tool; you can ask
it explicitly. No extra model/embedding requests or cloud memory services are
used. Recalled entries travel to the conversation model as tool results.

The local file is `<plugin-private-data>/memory.v1.json`, separate from the
existing enhancement settings. It is ordinary JSON, not encrypted secret
storage. Limits are 500 characters per user entry / 4,000 characters and 50
entries per profile, and 2,000 characters per project entry / 32 KB and 100
entries per project, plus at most 20 pending proposals. A recall returns at most 20 entries / 6,000 content
characters (10 by default). AI update/delete requires the last recalled
revision. Unloading or disabling the plugin stops tool access; reloading
preserves data. Uninstall follows the host's normal plugin-private-data cleanup
policy.

Project entries cannot be managed without a selected project. Context switches
clear the panel's old draft when refreshed or focused. The backend refuses a
stale save rather than moving it to the newly selected scope. Tool access is
limited to the invoking session while it remains selected; background sessions
must become selected before using memory tools.

Files written by 0.7.0 carried a session level. Loading one drops its session
entries and its `sessionEnabled` switch, and keeps the user and project rows; the
file is only rewritten when the next mutation happens, so a read never destroys
the original.

For implementation analysis, sources, contracts, and acceptance scenarios, see
[the memory design](docs/memory-design.md).

For implementation analysis, sources, contracts, and acceptance scenarios, see
[the memory design](docs/memory-design.md).

## Settings

The original three capabilities use the plugin's own settings record; memory
uses its separately versioned private file. Nothing is declared in
`contributes.settings`. Enhancement defaults are in `main.js`; memory defaults
are in `memory/model.js`. The window writes through the plugin process, so one sanitizer decides
what is valid and the page renders the value that came back:

| Key | Type | Default |
|---|---|---|
| `predictionsEnabled` | boolean | `true` |
| `predictionModelKey` | string | `""` (the session model) |
| `predictionThinkingLevel` | string | `""` (the model default) |
| `predictionPrompt` | string | the built-in next-message instruction |
| `promptEnhancementEnabled` | boolean | `true` |
| `enhancementModelKey` | string | `""` (the app default model) |
| `enhancementThinkingLevel` | string | `""` (the model default) |
| `enhancementPrompt` | string | the built-in rewrite instruction |
| `titlesEnabled` | boolean | `true` |
| `titleModelKey` | string | `""` (the session model) |
| `titleThinkingLevel` | string | `""` (the model default) |
| `titlePrompt` | string | the built-in title instruction |
| `titleMaxChars` | number | `48`, clamped to 16–80 |

## Permissions

| Permission | Why |
|---|---|
| `ui.panel` | The settings window |
| `composer.transform` | The **Enhance prompt** action |
| `composer.suggest` | The one-line suggestion offered in the composer placeholder (medium risk) |
| `session.read` | The conversation's model, and the tail a suggestion is written from |
| `agent.complete` | The suggestion, enhancement, titles, and the model test |
| `session.autoTitle` | The bounded first-turn excerpt a title is written from, and the compare-and-set title write |
| `agent.tool.register` | The host-bound memory tool; its backend enforces all memory switches and scopes |

`agent.complete`, `session.read`, `session.autoTitle` and `agent.tool.register`
are high risk and each requires an explicit grant; `composer.suggest` is medium
risk and is confirmed at install, because a suggestion can put text into a draft
the user may send. Bounded enhancement inputs and explicitly recalled memory
entries are sent to the selected model. Memory storage itself stays local.

## Development

Use the existing PI-Desktop development environment for React, esbuild,
Tailwind, and Electron. `PI_DESKTOP_ROOT` below denotes that checkout's path;
the plugin does not include a second dependency installation.

```bash
node scripts/build-css.mjs   # compile src/view/styles.css -> dist/view.css
node build.mjs               # bundle the settings window
node --test --test-timeout=60000 scripts/build.test.mjs # generated page regression
node scripts/smoke.mjs       # main.js contract against a fake host
node --test --test-timeout=60000 scripts/memory.test.mjs scripts/memory-host.test.mjs
node --test --test-timeout=60000 scripts/memory-ui.test.mjs # isolated Electron; no running PI or provider
node "$PI_DESKTOP_ROOT/packages/plugin-devkit/dist/cli.js" check .
```

PI-Desktop installs plugins without compiling anything, so `views/index.html` is
committed build output and the plugin ships no renderer module at all: its only
renderer surface (the changed-files card) moved into the host. React is bundled
into the settings page because that page is standalone.

Changing a manifest permission does not take effect through hot reload: the host
stops the reload of a development plugin whose permission set widened, so the
process keeps running the previous `main.js` while the settings window is
already the new page. Load the plugin folder again after such a change. The
window detects that mismatch itself — `state()` carries `apiVersion`, and a page
that sees a lower number (or a write that comes back without the keys it just
sent) shows a reload banner and locks its controls instead of flipping a switch
back with no explanation.

Tailwind v4 is compiled through `@tailwindcss/node` (the repository has no
standalone CLI). Its `build()` takes candidate class names, so the script scans
the view sources and splits on whitespace — the compiler discards whatever is
not a utility. The compiled sheet is inlined into the page, which may not load a
stylesheet from a CDN, and placed after the page-chrome rules so every utility
wins over them.

