"use strict";

const { randomUUID } = require("node:crypto");
const { createStore } = require("./store.js");
const { LIMITS, fail, fields, settingsPatch, contentText, scopeOwner, visibleEntries, publicEntry, sameContext, recall } = require("./model.js");

function createMemoryService(api) {
  const store = createStore(() => api.plugin.getDataPath());
  let tail = Promise.resolve();
  let disposed = false;

  function check(signal) {
    if (disposed) fail("UNAVAILABLE", "Memory is unavailable after plugin unload.");
    if (signal?.aborted) fail("CANCELLED", "The memory operation was cancelled.");
  }

  function serial(operation, signal) {
    const result = tail.then(async () => { check(signal); return operation(); });
    tail = result.catch(() => {});
    return result;
  }

  async function context(toolContext) {
    check(toolContext?.signal);
    if (toolContext && (typeof toolContext.sessionId !== "string" || !toolContext.sessionId)) fail("NO_SESSION", "Memory tools require a host-bound session.");
    const active = await api.session.getActive();
    if (toolContext && active?.sessionId !== toolContext.sessionId) fail("SESSION_CHANGED", "The invoking session is no longer selected. Retry in that session.");
    if (!active) return { sessionId: null, projectKey: null, projectLabel: null };
    const path = typeof active.projectPath === "string" && active.projectPath ? active.projectPath : null;
    const workspace = path ? await api.workspace.get() : null;
    const after = await api.session.getActive();
    check(toolContext?.signal);
    if (active.sessionId !== after?.sessionId || active.projectPath !== after?.projectPath) fail(toolContext ? "SESSION_CHANGED" : "CONTEXT_CHANGED", "The selected session changed. Refresh memories before retrying.");
    // workspace.get describes the visible workspace, not necessarily this session.
    const matches = path && (workspace?.path === path || workspace?.roots?.some((root) => root.path === path));
    const projectId = matches && typeof workspace.projectId === "string" && workspace.projectId ? workspace.projectId : null;
    return { sessionId: active.sessionId, projectKey: path ? projectId ? `project:${projectId}` : `path:${path}` : null,
      projectLabel: path ? matches && workspace.name ? workspace.name : path : null };
  }

  function snapshot(data, bound) {
    return { ok: true, settings: { ...data.settings }, context: { ...bound },
      entries: visibleEntries(data.entries, bound).map(publicEntry), limits: { contentChars: LIMITS.contentChars } };
  }

  async function guard(bound, toolContext) {
    check(toolContext?.signal);
    const current = await context(toolContext);
    if (!sameContext(bound, current)) fail("CONTEXT_CHANGED", "The selected session or project changed. Refresh memories before retrying.");
  }

  function requireRevision(args, entry) {
    if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision !== entry.revision) fail("CONFLICT", "This memory changed. Refresh it before editing or deleting.");
  }

  function change(data, args, bound, source, remove) {
    const owner = scopeOwner(args.scope, bound);
    if (args.id !== undefined && (typeof args.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(args.id))) fail("INVALID_INPUT", "Invalid memory ID.");
    if (remove && !args.id) fail("INVALID_INPUT", "A memory ID is required for deletion.");
    if (args.id) {
      const index = data.entries.findIndex((entry) => entry.id === args.id && entry.scope === args.scope && entry.owner === owner);
      if (index < 0) fail("NOT_FOUND", "No memory with that ID exists in this scope.");
      const entry = data.entries[index];
      requireRevision(args, entry);
      if (remove) { data.entries.splice(index, 1); return { id: entry.id, deleted: true }; }
      const content = contentText(args.content);
      if (data.entries.some((other) => other.id !== entry.id && other.scope === args.scope && other.owner === owner && other.content === content)) fail("CONFLICT", "This scope already contains that memory.");
      const updated = { ...entry, content, revision: entry.revision + 1, updatedAt: new Date().toISOString(), source };
      data.entries[index] = updated;
      return publicEntry(updated);
    }
    if (args.expectedRevision !== undefined) fail("INVALID_INPUT", "A revision requires a memory ID.");
    const content = contentText(args.content);
    const owned = data.entries.filter((entry) => entry.scope === args.scope && entry.owner === owner);
    const duplicate = owned.find((entry) => entry.content === content);
    if (duplicate) return publicEntry(duplicate);
    if (data.entries.length >= LIMITS.entries || owned.length >= LIMITS.perOwner) fail("CAPACITY", "This memory store is full. Remove unused records first.");
    const now = new Date().toISOString();
    const entry = { id: randomUUID(), scope: args.scope, owner, content, revision: 1, source, createdAt: now, updatedAt: now };
    data.entries.push(entry);
    return publicEntry(entry);
  }

  async function manual(args, remove) {
    fields(args, remove ? ["context", "scope", "id", "expectedRevision"] : ["context", "scope", "id", "expectedRevision", "content"]);
    const bound = await context();
    if (!sameContext(args.context, bound)) fail("CONTEXT_CHANGED", "The selected session or project changed. Refresh memories before retrying.");
    const data = await store.read();
    change(data, args, bound, "manual", remove);
    await store.write(data, () => guard(bound));
    return snapshot(data, bound);
  }

  return {
    state: () => serial(async () => {
      const bound = await context();
      const data = await store.read();
      await guard(bound);
      return snapshot(data, bound);
    }),
    updateSettings: (partial) => serial(async () => {
      settingsPatch(partial);
      const bound = await context();
      const data = await store.read();
      data.settings = { ...data.settings, ...partial };
      await store.write(data, () => guard(bound));
      return snapshot(data, bound);
    }),
    save: (args) => serial(() => manual(args, false)),
    remove: (args) => serial(() => manual(args, true)),
    execute: (args, ctx) => serial(async () => {
      fields(args, ["action", "scope", "query", "limit", "content", "id", "expectedRevision"]);
      if (!["recall", "save", "delete"].includes(args.action)) fail("INVALID_INPUT", "Unknown memory action.");
      const read = args.action === "recall";
      fields(args, read ? ["action", "scope", "query", "limit"] : args.action === "save" ? ["action", "scope", "content", "id", "expectedRevision"] : ["action", "scope", "id", "expectedRevision"]);
      const bound = await context(ctx ?? {});
      const data = await store.read();
      if (!data.settings.enabled) fail("DISABLED", "Memory is turned off. The user can enable it in Enhancements settings.");
      if (!data.settings[read ? "aiReadEnabled" : "aiWriteEnabled"]) fail("DISABLED", read ? "AI memory recall is turned off." : "AI memory writes are turned off. Use manual memory management instead.");
      if (!read && ctx?.mode && ctx.mode !== "agent") fail("DISABLED", "Memory writes require Agent mode.");
      if (read) {
        const result = recall(data.entries, bound, data.settings, args);
        await guard(bound, ctx);
        return result;
      }
      scopeOwner(args.scope, bound);
      if (!data.settings[`${args.scope}Enabled`]) fail("SCOPE_DISABLED", "This memory level is disabled.");
      const result = change(data, args, bound, "ai", args.action === "delete");
      await store.write(data, () => guard(bound, ctx));
      return { ok: true, memory: result };
    }, ctx?.signal),
    dispose: () => { disposed = true; return tail; },
  };
}

module.exports = { createMemoryService };
