/**
 * Exercise the plugin's main module against a fake host.
 *
 * This is a smoke test of the contract the renderer and the settings window
 * rely on, not a substitute for the Electron E2E: it proves the settings
 * sanitizer, the prediction flow and its model fallback, the changed-files
 * computation, and the model paths answer what their callers read.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, "..");

/** Stored settings start empty: the defaults live in the plugin, not the host. */
const stored = {};
const completions = [];
/** Every suggestion handed to the host's composer channel, in order. */
const suggestions = [];
const registeredCommands = [];
let openedPanels = 0;
/** Host events this plugin subscribed to, so the test can fire them. */
const eventHandlers = new Map();
/** What `session.getAutoTitleContext` answers while a title is eligible. */
let titleEligible = true;
const titleContext = {
  sessionId: "s1",
  expectedTitle: "New session",
  userPrompt: "please refactor the composer",
  assistantReply: "Refactored the composer and added a preview.",
};
const titleWrites = [];
const autoTitleReads = [];
let titleWriteAccepted = true;
/** The model the open conversation answers with; the test moves it around. */
let sessionModelKey = "acme/session";
/** The session `session.getLlmContext` reports as the one being viewed. */
let llmSessionId = "s1";


const messages = [
  // `order: "desc"`: newest first, in the shape the host really returns 鈥?the
  // call is nested under `tool`, with its arguments and its result.
  {
    id: "m5",
    role: "assistant",
    content: "Done: edited a.ts and created b.ts.",
    createdAt: "t5",
  },
  {
    id: "m4",
    role: "tool",
    content: "Applied 1 edit to /repo/src/a.ts",
    tool: { name: "edit", args: { file_path: "/repo/src/a.ts" }, result: "Applied 1 edit" },
    createdAt: "t4",
  },
  {
    id: "m3",
    role: "tool",
    content: "File created",
    tool: { name: "write", args: { file_path: "/repo/src/b.ts" }, result: "File created" },
    createdAt: "t3",
  },
  { id: "m1", role: "user", content: "please refactor the composer", createdAt: "t1" },
  // The previous exchange ends here: everything below predates the boundary and
  // must stay out of the card.
  {
    id: "m0a",
    role: "tool",
    content: "/repo/src/c.ts",
    tool: { name: "read", args: { file_path: "/repo/src/c.ts" } },
    createdAt: "t0a",
  },
  {
    id: "m0",
    role: "tool",
    content: "File created",
    tool: { name: "write", args: { file_path: "/repo/src/old.ts" }, result: "File created" },
    createdAt: "t0",
  },
];
/** Text of the newest reply, which the card is anchored on. */
const newestReplyText = messages[0].content;

const models = [
  {
    key: "acme/default",
    label: "Default",
    providerId: "acme",
    providerName: "Acme",
    supportsReasoning: false,
    thinkingLevels: [],
    isDefault: true,
  },
  {
    key: "acme/session",
    label: "Session",
    providerId: "acme",
    providerName: "Acme",
    supportsReasoning: true,
    thinkingLevels: ["low", "high"],
    isDefault: false,
  },
  {
    key: "acme/extra",
    label: "Extra",
    providerId: "acme",
    providerName: "Acme",
    supportsReasoning: false,
    thinkingLevels: [],
    isDefault: false,
  },
];

globalThis.pi = {
  plugin: {
    getSettings: async () => ({ ...stored }),
    setSettings: async (partial) => Object.assign(stored, partial),
    getDataPath: async () => pluginRoot,
  },
  models: {
    list: async () => models.filter((model) => model.key !== "acme/gone"),
  },
  agent: {
    complete: async (input) => {
      completions.push(input);
      return { text: '  "Rewrite: do the thing."  ', modelKey: input.modelKey };
    },
  },
  session: {
    /**
     * The transcript the card and the suggestion read, newest first 鈥?the order
     * the host returns for `order: "desc"`.
     */
    listMessages: async (input) =>
      input?.order === "desc" ? { messages } : { messages: messages.slice().reverse() },
    // The session the user is looking at. The plugin reads the tail through
    // `listMessages`: `getLlmContext` is refused outside a tool call.
    getActive: async () =>
      llmSessionId ? { sessionId: llmSessionId, modelKey: sessionModelKey } : null,
    // The host answers null once the title is no longer a placeholder.
    getAutoTitleContext: async ({ sessionId }) => {
      autoTitleReads.push(sessionId);
      return titleEligible ? { ...titleContext } : null;
    },
    setAutoTitle: async (input) => {
      titleWrites.push(input);
      return { updated: titleWriteAccepted };
    },
  },
  events: {
    on: (event, handler) => {
      eventHandlers.set(event, handler);
    },
    off: (event, handler) => {
      if (eventHandlers.get(event) === handler) eventHandlers.delete(event);
    },
  },
  commands: {
    register: async (command) => {
      registeredCommands.push(command.id);
    },
    unregister: async (id) => {
      registeredCommands.push(`-${id}`);
    },
  },
  ui: {
    openPanel: async () => {
      openedPanels += 1;
    },
    showToast: async () => {},
  },
  composer: {
    // The host contract this plugin consumes; `shown` is optional for the test.
    suggest: async (input) => {
      suggestions.push(input);
      return { shown: true };
    },
    clearSuggestion: async () => {
      suggestionClears += 1;
      return { ok: true };
    },
  },
  workspace: {
    get: async () => ({ path: "/repo", name: "repo" }),
  },
};

/** How often the plugin asked the host to drop its suggestion. */
let suggestionClears = 0;

const require = createRequire(import.meta.url);
const plugin = require(join(pluginRoot, "main.js"));

// Loads the module's state and registers the turn listener the tests fire.
await plugin.onLoad();

/** Fire the host event the plugin subscribes to. */
async function fireTurnEnded(payload) {
  const handler = eventHandlers.get("session:turnEnded");
  assert.equal(typeof handler, "function", "the plugin subscribes to completed turns");
  return handler(payload);
}

// --- settings sanitizer and fresh-install defaults ---------------------

// `stored` starts empty: a fresh install has no settings record, so every value
// below comes from the plugin's own defaults.
const initial = await plugin.onPanelInvoke("enhancements.panelState", {});

// The changed-files card is host-native now: the plugin reads no transcript and
assert.equal(initial.settings.predictionsEnabled, true, "the suggestion starts on");
assert.equal(initial.settings.promptEnhancementEnabled, true, "enhancement starts on");
assert.equal(initial.settings.predictionModelKey, "", "suggestions inherit the session model by default");
assert.equal(initial.predictionPhrases, undefined, "no phrase list survives the model rewrite");
assert.equal(initial.suggestionSupported, true, "the window is told the channel exists");
assert.equal(initial.suggestionsPerMinute, 3);
assert.equal(initial.sessionModelKey, "acme/session");
assert.equal(initial.models[0].key, "acme/default");
assert.ok(Array.isArray(initial.thinkingLevels) && initial.thinkingLevels.includes("high"));

const saved = await plugin.onPanelInvoke("enhancements.saveSettings", {
  // Retired keys from earlier shapes must not come back.
  fileChangesMaxFiles: 999,
  predictionDelayMs: 999999,
});
assert.equal(saved.settings.fileChangesMaxFiles, undefined, "the card's limit is gone with the card");
assert.equal(saved.settings.predictionDelayMs, undefined, "the typing-era delay is gone");

// Titles and the suggestion are two consumers of one event and one completion
// budget; this file drives them separately so a failure names one capability.
await plugin.onPanelInvoke("enhancements.saveSettings", { titlesEnabled: false });

// --- suggestion: one per completed turn, on the session model ------------

await fireTurnEnded({ sessionId: "s1", turnId: "t1", reason: "completed" });
assert.equal(suggestions.length, 1, "a completed turn offers one suggestion");
assert.equal(suggestions[0].sessionId, "s1");
assert.equal(suggestions[0].turnId, "t1", "the host can drop it once that turn is stale");
assert.match(suggestions[0].text, /^Rewrite: do the thing\.$/, "quotes and padding are stripped");
assert.equal(suggestions[0].ttlMs, 120_000);
assert.equal(completions.at(-1).modelKey, "acme/session", "no configured model means the session model");
assert.match(
  completions.at(-1).messages[0].content,
  /User: please refactor the composer/,
  "the conversation tail is the data",
);
assert.match(completions.at(-1).system, /next message/i, "the instruction is the system message");

// The same turn must never spend a second completion.
await fireTurnEnded({ sessionId: "s1", turnId: "t1", reason: "completed" });
assert.equal(suggestions.length, 1, "a repeated event for one turn is ignored");

// A turn that ended in a session the user is not looking at is not a prompt.
llmSessionId = "s2";
await fireTurnEnded({ sessionId: "s1", turnId: "t2", reason: "completed" });
assert.equal(suggestions.length, 1, "a background session gets no suggestion");
llmSessionId = "s1";

// Only a completed turn counts.
await fireTurnEnded({ sessionId: "s1", turnId: "t3", reason: "aborted" });
assert.equal(suggestions.length, 1, "an aborted turn gets no suggestion");

// --- suggestion: the switch, and a host without the channel -------------

await plugin.onPanelInvoke("enhancements.saveSettings", { predictionsEnabled: false });
const beforeOff = completions.length;
await fireTurnEnded({ sessionId: "s1", turnId: "t4", reason: "completed" });
assert.equal(suggestions.length, 1, "the switch stops suggestions");
assert.equal(completions.length, beforeOff, "and it stops them before spending a completion");
await plugin.onPanelInvoke("enhancements.saveSettings", { predictionsEnabled: true });

// A host that predates the channel must not be charged for a suggestion it
// cannot show.
const savedComposer = globalThis.pi.composer;
delete globalThis.pi.composer;
assert.equal(
  (await plugin.onPanelInvoke("enhancements.panelState", {})).suggestionSupported,
  false,
  "the window learns the channel is missing",
);
const beforeUnsupported = completions.length;
await fireTurnEnded({ sessionId: "s1", turnId: "t5", reason: "completed" });
assert.equal(suggestions.length, 1, "nothing is shown without a channel");
assert.equal(completions.length, beforeUnsupported, "and no completion is spent");
globalThis.pi.composer = savedComposer;

// --- suggestion: a refused hand-off is reported -------------------------

// The host confirms `composer.suggest` at install, so a plugin loaded before it
// declared the permission is refused. That must reach the window rather than
// look like a suggestion the model never produced.
const refusingComposer = globalThis.pi.composer;
globalThis.pi.composer = {
  suggest: async () => {
    throw Object.assign(new Error("permission denied"), { code: "PERMISSION_DENIED" });
  },
  clearSuggestion: async () => ({ ok: true }),
};
await fireTurnEnded({ sessionId: "s1", turnId: "t-refused", reason: "completed" });
assert.equal(
  (await plugin.onPanelInvoke("enhancements.panelState", {})).suggestionFailure,
  "PERMISSION_DENIED",
  "the window is told why the hand-off was refused",
);
globalThis.pi.composer = refusingComposer;

// --- suggestion: which model answers ------------------------------------

// The completion budget is a rolling minute and `onLoad` resets it, so each
// block that spends more than a handful of slots starts from a clean window.
await plugin.onLoad();

await plugin.onPanelInvoke("enhancements.saveSettings", { predictionModelKey: "acme/extra" });
await fireTurnEnded({ sessionId: "s1", turnId: "t6", reason: "completed" });
assert.equal(completions.at(-1).modelKey, "acme/extra", "a configured model wins while it exists");

await plugin.onPanelInvoke("enhancements.saveSettings", { predictionModelKey: "acme/gone" });
await fireTurnEnded({ sessionId: "s1", turnId: "t7", reason: "completed" });
assert.equal(completions.at(-1).modelKey, "acme/session", "a missing configured model falls back");

sessionModelKey = "";
await plugin.onPanelInvoke("enhancements.saveSettings", { predictionModelKey: "" });
await fireTurnEnded({ sessionId: "s1", turnId: "t8", reason: "completed" });
assert.equal(completions.at(-1).modelKey, "acme/default", "with no session model the app default answers");
sessionModelKey = "acme/session";

// --- suggestion: thinking level -----------------------------------------

// `acme/session` reports ["low", "high"]; a supported level is honoured and an
// unsupported one snaps to the nearest, so the choice is never silently lost.
await plugin.onLoad();
await plugin.onPanelInvoke("enhancements.saveSettings", {
  predictionModelKey: "acme/session",
  predictionThinkingLevel: "high",
});
await fireTurnEnded({ sessionId: "s1", turnId: "t9", reason: "completed" });
assert.equal(completions.at(-1).thinkingLevel, "high", "a supported level is sent as chosen");

await plugin.onPanelInvoke("enhancements.saveSettings", { predictionThinkingLevel: "max" });
await fireTurnEnded({ sessionId: "s1", turnId: "t10", reason: "completed" });
assert.equal(completions.at(-1).thinkingLevel, "high", "an unsupported level snaps to the nearest");

// A level outside the host's vocabulary is not stored at all.
const cleaned = await plugin.onPanelInvoke("enhancements.saveSettings", {
  predictionThinkingLevel: "turbo",
});
assert.equal(cleaned.settings.predictionThinkingLevel, "", "an unknown level is discarded");
await plugin.onPanelInvoke("enhancements.saveSettings", { predictionThinkingLevel: "" });

// --- suggestion: the per-minute budget ----------------------------------

// Three a minute by default; the fourth turn in the same window is skipped
// rather than overspending what titles and the user's own requests need.
await plugin.onLoad();
const beforeBudget = suggestions.length;
for (const turnId of ["b1", "b2", "b3", "b4"]) {
  await fireTurnEnded({ sessionId: "s1", turnId, reason: "completed" });
}
assert.equal(suggestions.length - beforeBudget, 3, "the fourth suggestion in a minute is dropped");

// --- prompt enhancement ------------------------------------------------

// On by default, so the off path has to be created first.
await plugin.onPanelInvoke("enhancements.saveSettings", { promptEnhancementEnabled: false });
await assert.rejects(
  () => plugin.onComposerTransform({ id: "enhance", text: "hello" }),
  /disabled/,
  "the transform refuses while the switch is off",
);

await plugin.onPanelInvoke("enhancements.saveSettings", { promptEnhancementEnabled: true });
const enhanced = await plugin.onComposerTransform({ id: "enhance", text: "fix the bug" });
assert.equal(enhanced, "Rewrite: do the thing.", "wrapping quotes and spaces are stripped");
assert.equal(completions.at(-1).messages[0].content, "fix the bug");

// --- editable instruction prompts --------------------------------------
//
// The three prompts are settings like any other, so the window's Save writes
// them and the next completion uses the stored text as its system message.

const savedPrompts = await plugin.onPanelInvoke("enhancements.saveSettings", {
  predictionPrompt: "  Be terse.  ",
  enhancementPrompt: "Rewrite as a checklist.",
  titlePrompt: "", // an empty edit is refused: the default comes back
});
assert.equal(savedPrompts.settings.predictionPrompt, "Be terse.", "a prompt is trimmed");
assert.equal(savedPrompts.settings.enhancementPrompt, "Rewrite as a checklist.");
assert.match(savedPrompts.settings.titlePrompt, /^You name a conversation/, "an empty edit falls back");

const withPrompts = await plugin.onPanelInvoke("enhancements.panelState", {});
// The window refuses to trust an answer without this marker: it would come from
// an older `main.js`, which discards the setting keys it does not know.
assert.equal(withPrompts.apiVersion, 3, "state carries the shape version");
for (const key of ["predictionPrompt", "enhancementPrompt", "titlePrompt"]) {
  assert.match(withPrompts.promptDefaults[key], /\S/, `${key} ships a built-in instruction`);
  assert.match(withPrompts.settings[key], /\S/, `${key} is never empty in state`);
}
assert.equal(withPrompts.promptMaxChars, 8000);

await plugin.onComposerTransform({ id: "enhance", text: "fix the bug" });
assert.equal(completions.at(-1).system, "Rewrite as a checklist.", "the enhanced prompt is used");

// --- suggestion: the edited instruction is used --------------------------

// A fresh module instance: the suggestion allowance is a rolling minute, and
// this file has already spent this instance's.
delete require.cache[require.resolve(join(pluginRoot, "main.js"))];
const freshPlugin = require(join(pluginRoot, "main.js"));
await freshPlugin.onLoad();

await freshPlugin.onPanelInvoke("enhancements.saveSettings", { titlesEnabled: false });
await freshPlugin.onPanelInvoke("enhancements.saveSettings", { predictionsEnabled: true });
await eventHandlers.get("session:turnEnded")({
  sessionId: "s1",
  turnId: "s-30",
  reason: "completed",
});
assert.equal(completions.at(-1).system, "Be terse.", "the edited suggestion prompt is used");

// Hand the turn back to the titles: one consumer at a time.
await freshPlugin.onPanelInvoke("enhancements.saveSettings", {
  predictionsEnabled: false,
  titlesEnabled: true,
});

// --- session titles -----------------------------------------------------

// The conversation answers with a model again, so the default title model is it.
sessionModelKey = "acme/session";

const onTurnEnded = eventHandlers.get("session:turnEnded");
assert.equal(typeof onTurnEnded, "function", "the plugin subscribes to completed turns");

// A completed turn titles the session, through the session's own model.
await onTurnEnded({ sessionId: "s1", turnId: "t-1", reason: "completed" });
assert.equal(autoTitleReads.at(-1), "s1", "eligibility is decided by the host");
assert.equal(titleWrites.length, 1, "one title is written");
assert.equal(titleWrites[0].sessionId, "s1");
assert.equal(titleWrites[0].expectedTitle, "New session", "the write is a compare-and-set");
assert.equal(titleWrites[0].title, "Rewrite: do the thing", "the label, quotes and full stop are stripped");
assert.equal(completions.at(-1).modelKey, "acme/session", "titles use the session model by default");
assert.equal(completions.at(-1).system, savedPrompts.settings.titlePrompt, "the title prompt is used");
assert.match(completions.at(-1).messages[0].content, /User prompt:\nplease refactor the composer/);
assert.match(completions.at(-1).messages[0].content, /Assistant response \(if available\):/);

// The same turn is considered once, however often the host repeats the event.
await onTurnEnded({ sessionId: "s1", turnId: "t-1", reason: "completed" });
assert.equal(titleWrites.length, 1, "a repeated turn is ignored");

// An aborted or failed turn is not titled.
await onTurnEnded({ sessionId: "s1", turnId: "t-2", reason: "aborted" });
await onTurnEnded({ sessionId: "s1", turnId: "t-3", reason: "error" });
assert.equal(titleWrites.length, 1, "only completed turns are titled");

// A session whose title is no longer a placeholder is skipped by the host.
titleEligible = false;
await onTurnEnded({ sessionId: "s2", turnId: "t-4", reason: "completed" });
assert.equal(titleWrites.length, 1, "an ineligible session gets no title");
titleEligible = true;

// A manual rename that lands while the model is thinking wins the race.
titleWriteAccepted = false;
await onTurnEnded({ sessionId: "s1", turnId: "t-5", reason: "completed" });
assert.equal(titleWrites.length, 2, "the write was attempted");
assert.equal(titleWrites[1].expectedTitle, "New session", "and it still compared against the old title");
titleWriteAccepted = true;

// Switching titles off stops the work entirely.
await freshPlugin.onPanelInvoke("enhancements.saveSettings", { titlesEnabled: false });
const readsBefore = autoTitleReads.length;
await onTurnEnded({ sessionId: "s1", turnId: "t-6", reason: "completed" });
assert.equal(autoTitleReads.length, readsBefore, "a disabled capability does not even ask");
await freshPlugin.onPanelInvoke("enhancements.saveSettings", { titlesEnabled: true });

// Unloading removes the listener: an unloaded plugin must not keep spending.
assert.equal(eventHandlers.has("session:turnEnded"), true, "the listener is live while loaded");

// --- the settings window's channels ------------------------------------

const panelState = await plugin.onPanelInvoke("enhancements.panelState", {});
assert.equal(panelState.settings.promptEnhancementEnabled, true);
assert.equal(panelState.sessionModelKey, "acme/session", "the window is told the conversation's model");
assert.equal(panelState.titlesPerMinute, 3);

const test = await plugin.onPanelInvoke("enhancements.testModel", {});
assert.equal(test.ok, true);
// The enhancement model is unset, so the app default answers 鈥?not the session
// model: only the two prediction-style capabilities prefer the session's.
assert.equal(test.modelKey, "acme/default");

const unknown = await plugin.onPanelInvoke("nope", {});
assert.equal(unknown.ok, false);
assert.equal(unknown.code, "UNSUPPORTED");

// --- the settings window's command -------------------------------------

// Every load registers the command and every unload releases it. This file
// loads the module several times (each load also resets the completion budget
// the suggestion tests spend), so the invariant is asserted as a delta rather
// than as a fixed total.
const commandsBeforeReload = registeredCommands.length;
await plugin.onLoad();
assert.equal(registeredCommands.length - commandsBeforeReload, 1, "a load registers one command");
assert.equal(registeredCommands.at(-1), "enhancements.openSettings");

await plugin.onUnload();
assert.equal(
  registeredCommands.filter((entry) => entry === "-enhancements.openSettings").length,
  1,
  "the first instance releases the command on unload",
);

// The live instance is the fresh one: unloading it must drop its listener.
await freshPlugin.onUnload();
assert.equal(
  registeredCommands.filter((entry) => entry === "-enhancements.openSettings").length,
  2,
  "the second instance releases the command too",
);
assert.equal(
  eventHandlers.has("session:turnEnded"),
  false,
  "an unloaded plugin is not listening for turns",
);
// Unloading is the last guard: the plugin asks the host to drop whatever it
// left in the composer, so a disabled plugin cannot keep a suggestion on screen.
assert.ok(suggestionClears >= 1, "unload clears the plugin's suggestion");
console.log("main.js contract: ok");
