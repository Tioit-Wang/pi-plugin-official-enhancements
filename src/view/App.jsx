/**
 * Official Enhancements - the plugin's settings window.
 *
 * This page is a detached panel (`ui.panel`), not a work-panel view: the plugin
 * has exactly one configuration surface and it must be openable on its own,
 * from the command palette or the plugin row, without occupying the sidebar the
 * user reads the conversation in.
 *
 * It writes through the plugin process (`onPanelInvoke`) so a single sanitizer
 * decides what is a valid setting, and it renders the value that came back
 * rather than assuming its own input was accepted.
 */

import React from "react";
import { createRoot } from "react-dom/client";

import { watchAppearance } from "./appearance.js";

const { useCallback, useEffect, useState } = React;
const h = React.createElement;

const bridge = window.pluginBridge;

/* ------------------------------------------------------------------ *
 * Bridge helpers
 * ------------------------------------------------------------------ */

async function invoke(channel, payload) {
  try {
    const answer = await bridge.invoke(channel, payload ?? {});
    if (answer && answer.ok === false) {
      return {
        ok: false,
        error: answer.message ?? answer.code ?? "The plugin refused this request.",
      };
    }
    return { ok: true, data: answer };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/* ------------------------------------------------------------------ *
 * Building blocks
 * ------------------------------------------------------------------ */

/**
 * A capability block: its title, what it does, the on/off button, and the
 * controls that only matter while it is on.
 */
function Capability({ title, description, on, busy, onToggle, children }) {
  return h(
    "section",
    { className: "rounded-xl border border-line bg-surface p-4" },
    h(
      "div",
      { className: "flex items-start justify-between gap-3" },
      h(
        "div",
        { className: "min-w-0" },
        h("h2", { className: "text-sm font-semibold text-ink" }, title),
        h("p", { className: "mt-0.5 text-xs text-ink-muted" }, description),
      ),
      h(
        "button",
        {
          type: "button",
          role: "switch",
          "aria-checked": on ? "true" : "false",
          "aria-label": `${title}: ${on ? "on" : "off"}`,
          disabled: busy,
          onClick: onToggle,
          className: `shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
            on
              ? "bg-accent text-accent-ink"
              : "border border-line bg-transparent text-ink-muted hover:bg-surface-sunken"
          } ${busy ? "opacity-50" : ""}`,
        },
        on ? "On" : "Off",
      ),
    ),
    on ? h("div", { className: "mt-3 space-y-3" }, children) : null,
  );
}

function Field({ label, hint, children }) {
  return h(
    "label",
    { className: "block" },
    h("span", { className: "mb-1 block text-xs font-medium text-ink-muted" }, label),
    children,
    hint ? h("span", { className: "mt-1 block text-[11px] text-ink-faint" }, hint) : null,
  );
}

const INPUT_CLASS =
  "w-full rounded-lg border border-line bg-surface-sunken px-2.5 py-1.5 text-xs text-ink outline-none transition focus:border-ink-faint disabled:opacity-50";
const BUTTON_SECONDARY =
  "rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface-sunken disabled:opacity-40";

/** The three editable instructions, in the order the page shows them. */
const PROMPT_KEYS = ["predictionPrompt", "enhancementPrompt", "titlePrompt"];
/**
 * The `state()` shape this page understands.
 *
 * The page is served from disk, so it is always the newest build; the plugin
 * process behind it is not necessarily. Comparing this number against
 * `state.apiVersion` is how a stale process becomes visible instead of showing
 * up as a switch that flips back on its own.
 */
const EXPECTED_API = 2;

/** The draft shape the editors bind to, taken from a settings record. */
function promptDraft(settings) {
  const draft = {};
  for (const key of PROMPT_KEYS) draft[key] = settings?.[key] ?? "";
  return draft;
}

/**
 * One editable instruction.
 *
 * A document, not a switch: it gets a monospace box, a character budget taken
 * from the plugin, and a note on where the text is sent, because the difference
 * between "system instruction" and "the data" is what makes an edit predictable.
 */
function PromptEditor({ value, onChange, maxChars, hint, disabled }) {
  const length = Array.from(value ?? "").length;
  return h(
    "div",
    null,
    h(
      "div",
      { className: "mb-1 flex items-baseline justify-between gap-2" },
      h("span", { className: "text-xs font-medium text-ink-muted" }, "Instruction prompt"),
      h(
        "span",
        { className: `text-[10px] ${length > maxChars ? "text-danger" : "text-ink-faint"}` },
        `${length} / ${maxChars}`,
      ),
    ),
    h("textarea", {
      className: `${INPUT_CLASS} h-24 resize-y font-mono text-[11px] leading-relaxed`,
      value: value ?? "",
      spellCheck: false,
      disabled,
      maxLength: maxChars,
      onChange: (event) => onChange(event.target.value),
    }),
    h("span", { className: "mt-1 block text-[11px] text-ink-faint" }, hint),
  );
}

function Status({ status }) {
  if (!status) return null;
  const tone =
    status.tone === "error" ? "text-danger" : status.tone === "ok" ? "text-ok" : "text-ink-muted";
  return h("p", { className: `text-[11px] ${tone}`, "aria-live": "polite" }, status.text);
}

/**
 * A model dropdown plus its thinking level.
 *
 * `inheritLabel` names what "no explicit choice" means for this capability,
 * because the two capabilities inherit from different places. While no model is
 * pinned the thinking list is the plugin's full level list: the choice is
 * validated against whichever model ends up answering, so it must be pickable
 * before one is.
 */
function ModelPicker({
  models,
  allLevels,
  value,
  thinkingLevel,
  onChange,
  disabled,
  inheritLabel,
  hint,
}) {
  const selected = models.find((model) => model.key === value) ?? null;
  const levels = selected ? selected.thinkingLevels ?? [] : allLevels ?? [];
  const reasoning = selected ? selected.supportsReasoning === true : true;

  return h(
    "div",
    { className: "space-y-3" },
    h(
      "div",
      { className: "grid gap-3 sm:grid-cols-2" },
      h(
        Field,
        { label: "Model", hint: models.length ? undefined : "No model is enabled yet; add one in Settings." },
        h(
          "select",
          {
            className: INPUT_CLASS,
            value,
            disabled: disabled || models.length === 0,
            onChange: (event) => onChange({ modelKey: event.target.value, thinkingLevel: "" }),
          },
          h("option", { value: "" }, inheritLabel),
          models.map((model) =>
            h(
              "option",
              { key: model.key, value: model.key },
              model.providerName ? `${model.label} (${model.providerName})` : model.label,
            ),
          ),
        ),
      ),
      h(
        Field,
        {
          label: "Thinking level",
          hint: reasoning ? undefined : "The selected model does not support reasoning.",
        },
        h(
          "select",
          {
            className: INPUT_CLASS,
            value: thinkingLevel,
            disabled: disabled || levels.length === 0,
            onChange: (event) => onChange({ modelKey: value, thinkingLevel: event.target.value }),
          },
          h("option", { value: "" }, "Model default"),
          levels.map((level) => h("option", { key: level, value: level }, level)),
        ),
      ),
    ),
    hint ? h("p", { className: "text-[11px] text-ink-faint" }, hint) : null,
  );
}

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

function App() {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [pending, setPending] = useState("");
  const [status, setStatus] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    const answer = await invoke("enhancements.panelState");
    if (!answer.ok) {
      setLoadError(answer.error);
      return;
    }
    setState(answer.data);
    setLoadError(null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const settings = state?.settings ?? null;
  const models = state?.models ?? [];
  const limits = state?.limits ?? { fileChangesMaxFiles: { min: 1, max: 50 } };
  const sessionModelKey = state?.sessionModelKey ?? "";
  const sessionModel = models.find((model) => model.key === sessionModelKey) ?? null;
  // Every level the plugin accepts while no model is pinned. The host's own
  // catalog per model narrows it once a model is chosen.
  const allLevels = Array.isArray(state?.thinkingLevels) ? state.thinkingLevels : [];
  const titleLimits = state?.titleMaxCharsLimit ?? { min: 16, max: 80 };

  // The page is read from disk on every open, so it is always the newest
  // build; the plugin process behind it may not be. An older process answers
  // without `apiVersion` and discards setting keys it does not know, which is
  // what makes a switch flip back. Name that, instead of leaving the user to
  // guess that saving is broken.
  const apiVersion = typeof state?.apiVersion === "number" ? state.apiVersion : 0;
  const stale = apiVersion < EXPECTED_API;

  const save = useCallback(
    async (partial, message = "Saved.") => {
      if (!settings) return;
      const keys = Object.keys(partial);
      setPending(keys.join(","));
      setState((current) => (current ? { ...current, settings: { ...current.settings, ...partial } } : current));
      const answer = await invoke("enhancements.saveSettings", partial);
      setPending("");
      if (!answer.ok) {
        setStatus({ tone: "error", text: answer.error });
        // The write was refused: re-read so the page never shows a lie.
        await load();
        return;
      }
      const saved = answer.data?.settings ?? null;
      const dropped = saved ? keys.filter((key) => !(key in saved)) : keys;
      if (dropped.length > 0) {
        // The process that answered does not know these keys, so it is older
        // than this page and discarded them. Report which ones rather than let
        // the control snap back with no explanation.
        setStatus({
          tone: "error",
          text: `The running plugin discarded ${dropped.join(", ")}. Reload the plugin folder so this version takes effect.`,
        });
        await load();
        return;
      }
      setState((current) => (current ? { ...current, settings: saved } : current));
      setStatus({ tone: "ok", text: message });
    },
    [settings, load],
  );

  // --- prompts: edited locally, written only by the header's Save ---------
  //
  // The three instructions are the one piece of settings that is *written* as a
  // document rather than toggled, so they are draft state: typing must not
  // reach the plugin on every keystroke, and the header's Save is the single
  // point where all three are committed together.
  const [prompts, setPrompts] = useState(null);
  const [promptStatus, setPromptStatus] = useState(null);
  const [savingPrompts, setSavingPrompts] = useState(false);

  // Adopt the stored prompts once the page has data, and again after a save.
  // Later reads never overwrite an edit that has not been saved.
  useEffect(() => {
    if (settings && prompts === null) setPrompts(promptDraft(settings));
  }, [settings, prompts]);

  const promptDefaults = state?.promptDefaults ?? null;
  const promptMaxChars = state?.promptMaxChars ?? 8000;
  const dirtyKeys = prompts && settings
    ? PROMPT_KEYS.filter((key) => prompts[key] !== settings[key])
    : [];

  const savePrompts = useCallback(async () => {
    if (!prompts || dirtyKeys.length === 0) return;
    const payload = {};
    for (const key of dirtyKeys) payload[key] = prompts[key];
    setSavingPrompts(true);
    const answer = await invoke("enhancements.saveSettings", payload);
    setSavingPrompts(false);
    if (!answer.ok) {
      setPromptStatus({ tone: "error", text: answer.error });
      return;
    }
    const saved = answer.data?.settings ?? null;
    const dropped = saved ? dirtyKeys.filter((key) => !(key in saved)) : dirtyKeys;
    if (dropped.length > 0) {
      setPromptStatus({
        tone: "error",
        text: `The running plugin discarded ${dropped.join(", ")}. Reload the plugin folder so this version takes effect.`,
      });
      return;
    }
    setState((current) => (current ? { ...current, settings: saved } : current));
    // Show what was actually stored: an empty edit comes back as the default.
    setPrompts(promptDraft(saved));
    setPromptStatus({
      tone: "ok",
      text: `Saved ${dirtyKeys.length === 1 ? "1 prompt" : `${dirtyKeys.length} prompts`}.`,
    });
  }, [prompts, dirtyKeys]);

  const resetPrompts = useCallback(() => {
    if (!promptDefaults) return;
    setPrompts({ ...promptDefaults });
    setPromptStatus({ tone: "muted", text: "Defaults loaded. Click Save to apply." });
  }, [promptDefaults]);

  const testModel = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    const answer = await invoke("enhancements.testModel", {
      modelKey: settings?.enhancementModelKey ?? "",
    });
    setTesting(false);
    setTestResult(
      answer.ok
        ? {
            tone: "ok",
            text: `Reached ${answer.data.modelKey} in ${answer.data.durationMs} ms; it answered "${answer.data.text || "(empty)"}".`,
          }
        : { tone: "error", text: answer.error },
    );
  }, [settings]);

  if (loadError) {
    return h(
      "div",
      { className: "flex flex-col gap-3 p-4" },
      h(
        "p",
        {
          className: "rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger",
        },
        `The plugin could not be reached: ${loadError}`,
      ),
      h(
        "button",
        { type: "button", className: `self-start ${BUTTON_SECONDARY}`, onClick: () => void load() },
        "Retry",
      ),
    );
  }

  if (!settings) {
    return h("div", { className: "p-4 text-xs text-ink-muted" }, "Loading...");
  }

  // A stale process discards every write again, so leave the page read-only.
  const busy = pending !== "" || stale;
  const sessionLabel = sessionModel
    ? sessionModel.label
    : sessionModelKey || "the app default model";

  const staleBanner = stale
    ? h(
        "div",
        {
          role: "alert",
          className:
            "rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] leading-relaxed text-danger",
        },
        h("p", { className: "font-semibold" }, "The running plugin is older than this window."),
        h(
          "p",
          { className: "mt-1" },
          "Reload the plugin folder (Plugins, then Official Enhancements, then Reload) so this version's " +
            "permissions and settings take effect. Until then a switch flips back and the instruction prompts " +
            "stay empty, because the old process discards the keys it does not know.",
        ),
      )
    : null;

  return h(
    "div",
    { className: "flex flex-col gap-3" },
    staleBanner,
    h(Status, { status }),
    h(
      "header",
      { className: "flex items-start justify-between gap-3" },
      h(
        "div",
        { className: "min-w-0" },
        h("h1", { className: "text-base font-semibold text-ink" }, "Official Enhancements"),
        h(
          "p",
          { className: "mt-0.5 text-xs text-ink-muted" },
          "Four capabilities. Switches apply at once; the three instruction prompts are saved together from here.",
        ),
        promptStatus ? h(Status, { status: promptStatus }) : null,
      ),
      h(
        "div",
        { className: "flex shrink-0 items-center gap-2" },
        dirtyKeys.length > 0
          ? h("span", { className: "text-[10px] text-ink-faint" }, "Unsaved")
          : null,
        h(
          "button",
          {
            type: "button",
            className: BUTTON_SECONDARY,
            disabled: !promptDefaults || savingPrompts || stale,
            title: "Load the built-in prompts into the editors",
            onClick: resetPrompts,
          },
          "Defaults",
        ),
        h(
          "button",
          {
            type: "button",
            className:
              "rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition hover:opacity-85 disabled:opacity-40",
            disabled: dirtyKeys.length === 0 || savingPrompts || stale,
            title: "Save all three instruction prompts",
            onClick: () => void savePrompts(),
          },
          savingPrompts ? "Saving..." : "Save",
        ),
      ),
    ),

    h(
      Capability,
      {
        title: "Next-message suggestion",
        description:
          "When the assistant finishes a turn, propose the message you are most likely to send next. Tab accepts it in the composer; Esc drops it.",
        on: settings.predictionsEnabled,
        busy,
        onToggle: () =>
          void save(
            { predictionsEnabled: !settings.predictionsEnabled },
            settings.predictionsEnabled ? "Suggestion off." : "Suggestion on.",
          ),
      },
      h(ModelPicker, {
        models,
        allLevels,
        value: settings.predictionModelKey,
        thinkingLevel: settings.predictionThinkingLevel,
        disabled: busy,
        inheritLabel: `Session model (${sessionLabel})`,
        hint: `Suggestions use this conversation's model by default. If the model picked here is unavailable, the session model answers instead. At most ${state.suggestionsPerMinute ?? 3} suggestions a minute.`,
      }),
      state.suggestionSupported === false
        ? h(
            "p",
            {
              className:
                "rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger",
            },
            "This build of PI-Desktop has no composer suggestion channel yet, so a suggestion would be generated and then dropped. Everything else on this page still works.",
          )
        : null,
      state.suggestionFailure
        ? h(
            "p",
            {
              className:
                "rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger",
            },
            `The host refused the last suggestion (${state.suggestionFailure}). If it names a permission, reload the plugin folder so this version's grant can be confirmed.`,
          )
        : null,
      h(PromptEditor, {
        value: prompts?.predictionPrompt ?? "",
        onChange: (next) =>
          setPrompts((current) => ({ ...(current ?? {}), predictionPrompt: next })),
        maxChars: promptMaxChars,
        disabled: savingPrompts,
        hint: "Sent as the system instruction. The tail of the conversation is sent as the message.",
      }),
    ),

    h(
      Capability,
      {
        title: "Prompt enhancement",
        description: "Adds an Enhance prompt action that rewrites the draft before sending.",
        on: settings.promptEnhancementEnabled,
        busy,
        onToggle: () =>
          void save(
            { promptEnhancementEnabled: !settings.promptEnhancementEnabled },
            settings.promptEnhancementEnabled ? "Enhancement off." : "Enhancement on.",
          ),
      },
      h(ModelPicker, {
        models,
        allLevels,
        value: settings.enhancementModelKey,
        thinkingLevel: settings.enhancementThinkingLevel,
        disabled: busy,
        inheritLabel: "App default model",
      }),
      h(
        "div",
        { className: "flex flex-wrap items-center gap-2" },
        h(
          "button",
          { type: "button", className: BUTTON_SECONDARY, disabled: testing, onClick: () => void testModel() },
          testing ? "Testing..." : "Test model",
        ),
        sessionModel?.supportsReasoning && !settings.enhancementModelKey
          ? h("span", { className: "text-[11px] text-ink-faint" }, "The default model supports reasoning.")
          : null,
      ),
      h(PromptEditor, {
        value: prompts?.enhancementPrompt ?? "",
        onChange: (next) =>
          setPrompts((current) => ({ ...(current ?? {}), enhancementPrompt: next })),
        maxChars: promptMaxChars,
        disabled: savingPrompts,
        hint: "Sent as the system instruction. The draft is sent as the message.",
      }),
      h(Status, { status: testResult }),
    ),

    h(
      Capability,
      {
        title: "Session titles",
        description: "Names a session from its first exchange, replacing the placeholder title.",
        on: settings.titlesEnabled,
        busy,
        onToggle: () =>
          void save(
            { titlesEnabled: !settings.titlesEnabled },
            settings.titlesEnabled ? "Titles off." : "Titles on.",
          ),
      },
      h(ModelPicker, {
        models,
        allLevels,
        value: settings.titleModelKey,
        thinkingLevel: settings.titleThinkingLevel,
        disabled: busy,
        inheritLabel: `Session model (${sessionLabel})`,
        hint: `The host offers a title after each completed turn while the stored title is still its placeholder, so a manual rename always wins. At most ${state.titlesPerMinute ?? 3} titles a minute.`,
      }),
      h(
        Field,
        {
          label: "Title length",
          hint: `Between ${titleLimits.min} and ${titleLimits.max} characters; the host refuses more.`,
        },
        h("input", {
          type: "number",
          className: INPUT_CLASS,
          min: titleLimits.min,
          max: titleLimits.max,
          value: settings.titleMaxChars,
          disabled: busy,
          onChange: (event) =>
            void save({ titleMaxChars: Number(event.target.value) }, "Title length saved."),
        }),
      ),
      h(PromptEditor, {
        value: prompts?.titlePrompt ?? "",
        onChange: (next) => setPrompts((current) => ({ ...(current ?? {}), titlePrompt: next })),
        maxChars: promptMaxChars,
        disabled: savingPrompts,
        hint: "Sent as the system instruction. The first user message and the first reply are sent as the message.",
      }),
    ),

    h(
      Capability,
      {
        title: "Changed-files card",
        description: "Lists the files a reply changed, under the last reply of the conversation.",
        on: settings.fileChangesEnabled,
        busy,
        onToggle: () =>
          void save(
            { fileChangesEnabled: !settings.fileChangesEnabled },
            settings.fileChangesEnabled ? "Card off." : "Card on.",
          ),
      },
      h(
        Field,
        {
          label: "Files shown",
          hint: `Between ${limits.fileChangesMaxFiles.min} and ${limits.fileChangesMaxFiles.max}.`,
        },
        h("input", {
          type: "number",
          className: INPUT_CLASS,
          min: limits.fileChangesMaxFiles.min,
          max: limits.fileChangesMaxFiles.max,
          value: settings.fileChangesMaxFiles,
          disabled: busy,
          onChange: (event) =>
            void save({ fileChangesMaxFiles: Number(event.target.value) }, "Limit saved."),
        }),
      ),
    ),

    h(
      "p",
      { className: "pb-1 text-[11px] leading-relaxed text-ink-faint" },
      "Only the draft is sent to a model; the transcript never leaves the machine. " +
        "Permissions: renderer extension, panel, composer transform, model list, model completion, session read.",
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Mount
 * ------------------------------------------------------------------ */

watchAppearance(bridge);

createRoot(document.getElementById("root")).render(h(App));
