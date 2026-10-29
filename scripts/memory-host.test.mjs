/** Public plugin entry points with a host-edge fake and real private storage. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const manifest = require("../manifest.json");

test("panel management and the declared agent tool share durable memory through plugin lifecycle", { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-memory-host-"));
  const previousPi = globalThis.pi;
  const tools = new Map();
  const events = new Map();
  const commands = new Map();
  const storedSettings = { predictionsEnabled: false, titlesEnabled: false };
  let completions = 0;
  globalThis.pi = {
    plugin: { getDataPath: async () => directory, getSettings: async () => ({ ...storedSettings }), setSettings: async (partial) => Object.assign(storedSettings, partial) },
    session: { getActive: async () => ({ sessionId: "session-1", projectPath: "/repo" }) },
    workspace: { get: async () => ({ projectId: "project-1", path: "/repo", name: "Repository" }) },
    models: { list: async () => [] },
    commands: { register: async (command) => commands.set(command.id, command), unregister: async (id) => commands.delete(id) },
    events: { on: (name, handler) => events.set(name, handler), off: (name) => events.delete(name) },
    agent: {
      registerTool: async (tool) => tools.set(tool.name, tool),
      unregisterTool: async (name) => tools.delete(name),
      complete: async () => { completions++; throw new Error("No model calls are allowed in this test"); },
    },
  };
  delete require.cache[require.resolve("../main.js")];
  const plugin = require("../main.js");
  t.after(async () => {
    await plugin.onUnload();
    globalThis.pi = previousPi;
    delete require.cache[require.resolve("../main.js")];
    await rm(directory, { recursive: true, force: true });
  });

  await plugin.onLoad();
  const tool = tools.get("memory");
  const { execute, ...descriptor } = tool;
  assert.deepEqual(descriptor, manifest.contributes.agentTools.find((entry) => entry.name === "memory"));
  assert.ok(manifest.permissions.includes("agent.tool.register"));
  assert.deepEqual(descriptor.planSafeActions, ["recall"]);
  const ctx = { sessionId: "session-1", mode: "agent" };
  const initial = await plugin.onPanelInvoke("memory.state");
  assert.equal(initial.ok, true);
  assert.equal(initial.toolAvailable, true);
  assert.equal(initial.settings.enabled, false);

  let state = await plugin.onPanelInvoke("memory.save", { context: initial.context, scope: "project", content: "Use pnpm." });
  assert.equal(state.toolAvailable, true);
  assert.equal(state.entries[0].content, "Use pnpm.");
  await assert.rejects(execute({ action: "recall" }, ctx), { code: "MEMORY_DISABLED" });
  state = await plugin.onPanelInvoke("memory.settings", { partial: { enabled: true, aiWriteEnabled: true } });
  assert.equal(state.toolAvailable, true);
  assert.equal((await execute({ action: "recall", query: "pnpm" }, ctx)).memories[0].content, "Use pnpm.");
  await execute({ action: "save", scope: "user", content: "Prefer short answers." }, ctx);
  state = await plugin.onPanelInvoke("memory.state");
  const added = state.entries.find((entry) => entry.scope === "user");
  assert.equal(added.source, "ai");
  state = await plugin.onPanelInvoke("memory.save", { context: state.context, scope: "user", id: added.id, expectedRevision: added.revision, content: "Explain concisely." });
  assert.equal(state.entries.find((entry) => entry.id === added.id).revision, 2);
  const stale = await plugin.onPanelInvoke("memory.delete", { context: state.context, scope: "user", id: added.id, expectedRevision: 1 });
  assert.equal(stale.code, "MEMORY_CONFLICT");
  const removed = await plugin.onPanelInvoke("memory.delete", { context: state.context, scope: "user", id: added.id, expectedRevision: 2 });
  assert.equal(removed.toolAvailable, true);
  assert.equal(removed.entries.length, 1);

  await plugin.onUnload();
  assert.equal(tools.size, 0);
  assert.equal(events.size, 0);
  assert.equal(commands.size, 0);
  await assert.rejects(async () => execute({ action: "recall" }, ctx), { code: "MEMORY_UNAVAILABLE" });
  assert.equal((await plugin.onPanelInvoke("memory.state")).code, "MEMORY_UNAVAILABLE");

  await plugin.onLoad();
  assert.equal((await tools.get("memory").execute({ action: "recall" }, ctx)).memories[0].content, "Use pnpm.");
  await assert.rejects(async () => execute({ action: "recall" }, ctx), { code: "MEMORY_UNAVAILABLE" });
  assert.equal(completions, 0);
  assert.equal(storedSettings.predictionsEnabled, false);
  assert.equal(storedSettings.enabled, undefined, "Memory does not pollute existing enhancement settings");
  const disk = JSON.parse(await readFile(join(directory, "memory.v1.json"), "utf8"));
  assert.equal(disk.entries.length, 1);
  assert.equal(disk.entries[0].owner, "project:project-1");

  await plugin.onUnload();
  globalThis.pi.agent.registerTool = async () => { throw Object.assign(new Error("Tool permission not granted"), { code: "PERMISSION_DENIED" }); };
  await plugin.onLoad();
  const withoutGrant = await plugin.onPanelInvoke("memory.state");
  assert.equal(withoutGrant.toolAvailable, false);
  const manual = await plugin.onPanelInvoke("memory.save", { context: withoutGrant.context, scope: "user", content: "Manual management without tool access" });
  assert.equal(manual.ok, true);
  assert.equal(manual.toolAvailable, false);
  assert.equal((await plugin.onPanelInvoke("enhancements.panelState")).apiVersion, 3);
});
