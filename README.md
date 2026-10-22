# Official Enhancements

One plugin for four enhancement capabilities, configured from its own settings
window. **All four start on**; the window is the only place to turn one off.

| Capability | Where it shows | Switch |
|---|---|---|
| Next-message suggestion | The message you are likely to send next, shown in the composer placeholder after a turn ends; <kbd>Tab</kbd> accepts it | `predictionsEnabled` |
| Prompt enhancement | The **Enhance prompt** action on the composer | `promptEnhancementEnabled` |
| Session titles | The session's title in the sidebar, after its first exchange | `titlesEnabled` |
| Changed-files card | The files one reply touched, under the last reply | `fileChangesEnabled` |

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

## Changed-files card

The card is an `entryExtra` block describing the **trailing exchange**: the tool
messages after the newest user message. It reads the session through
`pi.session.listMessages` and counts only file-writing tools (`write`, `edit`,
`multiedit`, `apply_patch`, `notebookedit`, …). Paths are made
workspace-relative and de-duplicated; the status is `A`, `M` or `D`, inferred
from the tool and its answer. A stored transcript keeps the tool's answer text
rather than the call arguments, so the path is taken from the call arguments
when present and parsed out of the answer otherwise.

`entryExtra` mounts under every finished reply, so the plugin also reports
whether the reply being drawn is that trailing one, and the card renders only
there. The reply is recognised by its transcript id, or by its text when the
slot reports the id of the part it rendered instead of a message id.

## Settings

Every value lives in the plugin's own settings record; nothing is declared in
`contributes.settings`. Defaults are in `main.js` and every capability starts
**on**. The window writes through the plugin process, so one sanitizer decides
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
| `fileChangesEnabled` | boolean | `true` |
| `fileChangesMaxFiles` | number | `12`, clamped to 1–50 |

## Permissions

| Permission | Why |
|---|---|
| `renderer.extension` | Draws the changed-files card in the app window |
| `ui.panel` | The settings window |
| `composer.transform` | The **Enhance prompt** action |
| `composer.suggest` | The one-line suggestion offered in the composer placeholder (medium risk) |
| `models.list` | The model pickers list enabled, authenticated models |
| `agent.complete` | The suggestion, enhancement, titles, and the model test |
| `session.read` | The conversation's model and tail, and its tool messages for the card |
| `session.autoTitle` | The bounded first-turn excerpt a title is written from, and the compare-and-set title write |

`renderer.extension`, `agent.complete`, `session.read` and `session.autoTitle`
are high risk and each requires an explicit grant; `composer.suggest` is medium
risk and is confirmed at install, because a suggestion can put text into a draft
the user may send. Only the conversation tail a suggestion is written from, a
draft, and the bounded first-turn excerpt for a title are ever sent to a model;
nothing else leaves the machine.

## Development

```bash
node scripts/build-css.mjs   # compile src/view/styles.css -> dist/view.css
node build.mjs               # bundle the settings window and the renderer module
node scripts/smoke.mjs       # main.js contract against a fake host
node ../../../packages/plugin-devkit/dist/cli.js check .
```

PI-Desktop installs plugins without compiling anything, so `views/index.html`
and `renderer/index.mjs` are committed build output. React stays external in the
renderer module because the host answers the bare `react` specifier through the
import map of its own window; the settings window is a standalone page and
bundles React.

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

