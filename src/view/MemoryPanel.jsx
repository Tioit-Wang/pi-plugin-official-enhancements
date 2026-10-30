import React from "react";
import { memoryCopy } from "./memory-copy.js";

const { useCallback, useEffect, useRef, useState } = React;
const SCOPES = ["user", "project", "session"];
const EMPTY_DRAFT = { id: null, content: "", revision: null };

function contextKey(context) {
  return JSON.stringify([context?.sessionId ?? null, context?.projectKey ?? null]);
}

function Toggle({ label, hint, checked, disabled, onChange }) {
  return (
    <label className="memory-toggle">
      <span><span className="memory-label">{label}</span>{hint && <span className="memory-hint">{hint}</span>}</span>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={onChange} />
    </label>
  );
}

/** A separate settings surface for memory; it never reads conversation content. */
export function MemoryPanel({ bridge, disabled = false }) {
  const [snapshot, setSnapshot] = useState(null);
  const [locale, setLocale] = useState("en");
  const [scope, setScope] = useState("user");
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const live = useRef(false);
  const sequence = useRef(0);
  const latest = useRef(null);
  const writing = useRef(false);
  const refreshPending = useRef(false);
  const editor = useRef(null);
  const copy = memoryCopy(locale);
  const copyRef = useRef(copy);
  copyRef.current = copy;

  const accept = useCallback((next) => {
    const changed = latest.current && contextKey(latest.current.context) !== contextKey(next.context);
    latest.current = next;
    setSnapshot(next);
    if (changed) {
      setScope("user");
      setDraft(EMPTY_DRAFT);
      setDeleting(null);
      setQuery("");
      setNotice({ kind: "status", text: copyRef.current.contextChanged });
    }
    return changed;
  }, []);

  const load = useCallback(async () => {
    if (disabled || !live.current) return;
    if (writing.current) { refreshPending.current = true; return; }
    const request = ++sequence.current;
    setLoading(true);
    try {
      const next = await bridge.invoke("memory.state", {});
      if (!live.current || request !== sequence.current) return;
      if (!next || next.ok === false) throw new Error(next?.message || copyRef.current.error);
      setNotice(null);
      accept(next);
    } catch (error) {
      if (live.current && request === sequence.current) {
        setNotice({ kind: "alert", text: error?.message || copyRef.current.error });
      }
    } finally {
      if (live.current && request === sequence.current) setLoading(false);
    }
  }, [bridge, disabled, accept]);

  useEffect(() => {
    live.current = true;
    const onFocus = () => void load();
    let localeEventSeen = false;
    const onAppearance = (appearance) => {
      localeEventSeen = true;
      if (live.current) setLocale(appearance?.locale || "en");
    };
    const unsubscribe = bridge?.on?.("appearance:changed", onAppearance);
    bridge.invoke("app.getAppearance", {}).then((appearance) => {
      if (!localeEventSeen && live.current) setLocale(appearance?.locale || "en");
    }).catch(() => { /* Keep the English fallback when appearance is unavailable. */ });
    window.addEventListener("focus", onFocus);
    void load();
    return () => {
      live.current = false;
      sequence.current += 1;
      window.removeEventListener("focus", onFocus);
      if (typeof unsubscribe === "function") unsubscribe();
      else bridge?.off?.("appearance:changed", onAppearance);
    };
  }, [bridge, load]);

  const mutate = useCallback(async (channel, payload, success, clearDraft = false) => {
    if (disabled || writing.current || !live.current) return;
    writing.current = true;
    const request = ++sequence.current;
    setSaving(true);
    setNotice(null);
    try {
      const next = await bridge.invoke(channel, payload);
      if (!live.current || request !== sequence.current) return;
      if (!next || next.ok === false) throw new Error(next?.message || copyRef.current.error);
      const changed = accept(next);
      if (clearDraft) { setDraft(EMPTY_DRAFT); setDeleting(null); }
      if (!changed) setNotice({ kind: "status", text: success });
    } catch (error) {
      if (live.current && request === sequence.current) {
        setNotice({ kind: "alert", text: error?.message || copyRef.current.error });
      }
    } finally {
      writing.current = false;
      if (live.current && request === sequence.current) {
        setSaving(false);
        if (refreshPending.current) { refreshPending.current = false; void load(); }
      }
    }
  }, [bridge, disabled, accept, load]);

  const busy = disabled || loading || saving;
  const settings = snapshot?.settings;
  const available = { user: true, project: Boolean(snapshot?.context?.projectKey), session: Boolean(snapshot?.context?.sessionId) };
  const maxChars = snapshot?.limits?.contentChars ?? 2000;
  const valid = draft.content.trim().length > 0 && draft.content.length <= maxChars;
  const scoped = (snapshot?.entries ?? []).filter((entry) => entry.scope === scope);
  const filtered = scoped.filter((entry) => entry.content.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const setOption = (key) => void mutate("memory.settings", { partial: { [key]: !settings[key] } }, copy.settingsSaved);
  const saveDraft = (event) => {
    event.preventDefault();
    if (!valid || !available[scope]) return;
    void mutate("memory.save", {
      context: snapshot.context, scope, content: draft.content,
      ...(draft.id ? { id: draft.id, expectedRevision: draft.revision } : {}),
    }, copy.saved, true);
  };

  return (
    <section className="memory-panel" aria-labelledby="memory-heading" lang={locale}>
      <div className="memory-heading">
        <div><h2 id="memory-heading">{copy.title}</h2><p className="memory-hint">{copy.description}</p></div>
        <button type="button" disabled={busy} onClick={() => void load()}>{copy.refresh}</button>
      </div>
      {disabled ? <p role="status">{copy.unavailable}</p> : null}
      {loading && <p role="status">{copy.loading}</p>}
      {notice && <p className={`memory-notice memory-${notice.kind}`} role={notice.kind}>{notice.text}</p>}
      {settings && <>
        {snapshot.toolAvailable === false && <p className="memory-notice" role="status">{copy.toolsUnavailable}</p>}
        <Toggle label={copy.enabled} checked={settings.enabled} disabled={busy} onChange={() => setOption("enabled")} />
        {!settings.enabled && <p className="memory-hint">{copy.disabledHint}</p>}
        <fieldset disabled={busy} className="memory-options">
          <legend>{copy.scopeHeading}</legend>
          {SCOPES.map((level) => <Toggle key={level} label={copy[level]} hint={copy[`${level}Hint`]} checked={settings[`${level}Enabled`]} onChange={() => setOption(`${level}Enabled`)} />)}
        </fieldset>
        <div className="memory-ai-options">
          <Toggle label={copy.aiReadEnabled} hint={copy.aiReadHint} checked={settings.aiReadEnabled} disabled={busy || snapshot.toolAvailable === false} onChange={() => setOption("aiReadEnabled")} />
          <Toggle label={copy.aiWriteEnabled} hint={copy.aiWriteHint} checked={settings.aiWriteEnabled} disabled={busy || snapshot.toolAvailable === false} onChange={() => setOption("aiWriteEnabled")} />
        </div>
        <p className="memory-hint">{copy.privacy}</p>
        <div className="memory-heading"><h3>{copy.manage}</h3><span className="memory-hint">{copy.count(scoped.length)}</span></div>
        <label className="memory-field"><span>{copy.scope}</span>
          <select value={scope} disabled={busy} onChange={(event) => { setScope(event.target.value); setDraft(EMPTY_DRAFT); setDeleting(null); setQuery(""); }}>
            {SCOPES.map((level) => <option key={level} value={level} disabled={!available[level]}>{copy[level]}{available[level] ? "" : ` · ${copy[level === "project" ? "noProject" : "noSession"]}`}</option>)}
          </select>
        </label>
        {scope === "project" && <p className="memory-context">{copy.currentProject}: {snapshot.context.projectLabel || snapshot.context.projectKey}</p>}
        {scope === "session" && <p className="memory-context">{copy.currentSession}: {snapshot.context.sessionId}</p>}
        <form onSubmit={saveDraft}>
          <label className="memory-field"><span>{copy.content}</span>
            <textarea ref={editor} rows={3} value={draft.content} maxLength={maxChars} disabled={busy || !available[scope]} aria-describedby="memory-limit"
              onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} />
          </label>
          <div className="memory-actions">
            <span id="memory-limit" className="memory-hint">{draft.content.length} / {maxChars}</span>
            <button className="memory-primary" type="submit" disabled={busy || !valid || !available[scope]}>{saving ? copy.saving : draft.id ? copy.update : copy.add}</button>
            {draft.id && <button type="button" disabled={busy} onClick={() => setDraft(EMPTY_DRAFT)}>{copy.cancel}</button>}
          </div>
        </form>
        <label className="memory-field"><span>{copy.search}</span><input type="search" value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} /></label>
        {filtered.length === 0 && <p className="memory-hint">{scoped.length ? copy.noResults : copy.empty}</p>}
        <ul className="memory-list">
          {filtered.map((entry) => <li key={entry.id} className="memory-entry">
            <p className="memory-content">{entry.content}</p>
            <div className="memory-actions">
              <span className="memory-hint">{entry.source === "ai" ? copy.ai : copy.manual} · {copy.revision(entry.revision)}</span>
              <button type="button" disabled={busy} onClick={() => { setDraft({ id: entry.id, content: entry.content, revision: entry.revision }); setDeleting(null); editor.current?.focus(); }}>{copy.edit}</button>
              <button type="button" disabled={busy} onClick={() => setDeleting(entry.id)}>{copy.remove}</button>
            </div>
            {deleting === entry.id && <div className="memory-delete" role="group" aria-label={copy.confirmDelete}>
              <p>{copy.confirmDelete}</p>
              <div className="memory-actions">
                <button className="memory-danger" type="button" disabled={busy} onClick={() => void mutate("memory.delete", { context: snapshot.context, scope, id: entry.id, expectedRevision: entry.revision }, copy.deleted, true)}>{copy.confirm}</button>
                <button type="button" disabled={busy} onClick={() => setDeleting(null)}>{copy.cancel}</button>
              </div>
            </div>}
          </li>)}
        </ul>
      </>}
    </section>
  );
}
