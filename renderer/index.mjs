// src/renderer/index.js
import React from "react";
var { useCallback, useEffect, useState } = React;
var h = React.createElement;
var host = null;
async function call(method, args) {
  try {
    return await host.dispatch("plugin.call", { method, args: args ?? {} });
  } catch (error) {
    return { ok: false, error: String(error?.code ?? "PLUGIN_CALL_FAILED") };
  }
}
function useEnhancementsState() {
  const [state, setState] = useState(null);
  const reload = useCallback(async () => {
    const answer = await call("enhancements.state");
    if (answer && answer.settings) setState(answer);
    return answer;
  }, []);
  useEffect(() => {
    let live = true;
    void call("enhancements.state").then((answer) => {
      if (live && answer?.settings) setState(answer);
    });
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => {
      live = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);
  return state;
}
var STATUS_LABEL = { added: "A", modified: "M", deleted: "D" };
var STATUS_TITLE = { added: "Added", modified: "Modified", deleted: "Deleted" };
function ChangedFilesCard({ message, messageId, sessionId }) {
  const state = useEnhancementsState();
  const [result, setResult] = useState(null);
  const enabled = state?.settings?.fileChangesEnabled === true;
  const content = message?.content ?? "";
  useEffect(() => {
    if (!enabled || !sessionId) {
      setResult(null);
      return void 0;
    }
    let live = true;
    void call("enhancements.fileChanges", { sessionId, messageId, content }).then((answer) => {
      if (live && answer && !answer.error) setResult(answer);
    });
    return () => {
      live = false;
    };
  }, [enabled, sessionId, messageId, content]);
  const files = Array.isArray(result?.files) ? result.files : [];
  if (!enabled || result?.isLastReply !== true || files.length === 0) return null;
  const total = result.total ?? files.length;
  return h(
    "section",
    { className: "pi-oe-files", "data-pi-oe": "file-changes" },
    h(
      "header",
      { className: "pi-oe-files-head" },
      h("span", { className: "pi-oe-files-title" }, "Changed files"),
      h("span", { className: "pi-oe-count" }, String(total))
    ),
    h(
      "ul",
      { className: "pi-oe-list" },
      files.map(
        (file) => h(
          "li",
          { key: file.path, className: "pi-oe-file" },
          h(
            "span",
            {
              className: `pi-oe-status pi-oe-status-${file.status}`,
              title: STATUS_TITLE[file.status] ?? "Modified"
            },
            STATUS_LABEL[file.status] ?? "M"
          ),
          h("span", { className: "pi-oe-path", title: file.path }, file.path),
          h("span", { className: "pi-oe-tool" }, String(file.toolName ?? ""))
        )
      )
    ),
    total > files.length ? h("p", { className: "pi-oe-more" }, `+${total - files.length} more`) : null
  );
}
var CSS = `
.pi-oe-files {
  border: 1px solid var(--ds-border-default, rgba(255, 255, 255, 0.12));
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 12px;
}
.pi-oe-files-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.pi-oe-files-title { font-weight: 600; }
.pi-oe-count {
  border-radius: 999px;
  background: var(--ds-bg-muted, rgba(255, 255, 255, 0.08));
  padding: 0 6px;
  font-size: 11px;
  opacity: 0.8;
}
.pi-oe-list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.pi-oe-file { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pi-oe-status {
  flex: none;
  width: 14px;
  text-align: center;
  font-size: 10px;
  font-weight: 700;
}
.pi-oe-status-added { color: var(--ds-color-success, #3fb950); }
.pi-oe-status-modified { color: var(--ds-color-warning, #d29922); }
.pi-oe-status-deleted { color: var(--ds-color-danger, #f85149); }
.pi-oe-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--ds-font-mono, ui-monospace, monospace);
}
.pi-oe-tool { flex: none; font-size: 10px; opacity: 0.45; }
.pi-oe-more { margin: 6px 0 0; font-size: 11px; opacity: 0.6; }
`;
function onLoad(pi) {
  host = pi;
  pi.ui.injectStyle(CSS);
  pi.slots.register({ slot: "entryExtra", component: ChangedFilesCard });
}
function onUnload() {
  host = null;
}
export {
  onLoad,
  onUnload
};
