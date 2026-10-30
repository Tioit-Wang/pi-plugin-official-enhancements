/** Exercise the real memory component in an isolated Electron window with a host-edge fake. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const browserTest = String.raw`
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryPanel } from "./src/view/MemoryPanel.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const state = {
  ok: true,
  settings: { enabled: false, userEnabled: true, projectEnabled: true, sessionEnabled: true, aiReadEnabled: true, aiWriteEnabled: false },
  context: { sessionId: "s1", projectKey: "p1", projectLabel: "Project One" },
  entries: [], limits: { contentChars: 2000 },
};
const calls = [];
const listeners = new Map();
let nextReply = null;
let counter = 0;
const bridge = {
  on(name, handler) { listeners.set(name, handler); return () => listeners.delete(name); },
  async invoke(channel, payload = {}) {
    calls.push({ channel, payload });
    if (channel === "app.getAppearance") return { locale: "zh-CN", base: "light" };
    if (nextReply) { const reply = nextReply; nextReply = null; return reply(channel, payload); }
    if (channel === "memory.settings") Object.assign(state.settings, payload.partial);
    if (channel === "memory.save") {
      if (payload.id) {
        const entry = state.entries.find((entry) => entry.id === payload.id);
        assert(entry.revision === payload.expectedRevision, "Edit must carry revision");
        entry.content = payload.content; entry.revision += 1;
      } else state.entries.push({ id: "m" + ++counter, scope: payload.scope, content: payload.content, source: "manual", revision: 1, createdAt: "2026-10-30T00:00:00Z", updatedAt: "2026-10-30T00:00:00Z" });
    }
    if (channel === "memory.delete") {
      const entry = state.entries.find((entry) => entry.id === payload.id);
      assert(entry.revision === payload.expectedRevision, "Delete must carry revision");
      state.entries = state.entries.filter((entry) => entry.id !== payload.id);
    }
    return clone(state);
  },
};
const container = document.getElementById("root");
let app = createRoot(container);
const buttons = () => [...container.querySelectorAll("button")];
const button = (label) => buttons().find((node) => node.textContent === label);
const input = (label) => [...container.querySelectorAll("label")].find((node) => node.querySelector("span")?.textContent === label)?.querySelector("input,select,textarea");
const click = async (label) => {
  const node = button(label); assert(node && !node.disabled, "Enabled button missing: " + label);
  await act(async () => node.click());
};
const setValue = async (node, value) => {
  assert(node && !node.disabled, "Input is available");
  const prototype = node.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : node.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, value);
  await act(async () => node.dispatchEvent(new Event(node.tagName === "SELECT" ? "change" : "input", { bubbles: true })));
};
const text = () => container.textContent;
const run = async () => {
  await act(async () => app.render(<MemoryPanel bridge={bridge} />));
  assert(text().includes("用户级别") && text().includes("项目级别") && text().includes("会话级别"), "Three localized levels render");
  assert(container.querySelectorAll('[role="switch"]').length === 6, "All six independent switches render");
  assert(text().includes("AI 记忆功能已关闭"), "Off state is explicit");
  assert(button("添加记忆").disabled, "Empty memory cannot be submitted");

  await setValue(input("记忆内容"), "Prefer concise answers <img src=x onerror=alert(1)>");
  await click("添加记忆");
  assert(text().includes("Prefer concise answers"), "Manual save works while AI memory is off");
  assert(!container.querySelector("img"), "Memory text is rendered as text, never HTML");
  assert(input("记忆内容").value === "", "Successful save clears draft");
  await click("编辑");
  assert(document.activeElement === input("记忆内容"), "Edit focuses the text field");
  await setValue(input("记忆内容"), "Prefer concise English answers");
  await click("保存修改");
  assert(state.entries[0].revision === 2, "Edit persisted with optimistic revision");

  await setValue(input("搜索当前级别"), "missing");
  assert(text().includes("没有匹配的记忆"), "Search has a meaningful empty state");
  await setValue(input("搜索当前级别"), "");
  await click("删除");
  assert(!calls.some((call) => call.channel === "memory.delete"), "Delete first asks for confirmation");
  await click("取消");
  assert(!button("确认删除"), "Delete can be cancelled");
  await click("删除");
  await click("确认删除");
  assert(state.entries.length === 0 && text().includes("记忆已删除"), "Confirmed delete updates the list");

  await setValue(input("级别"), "project");
  assert(text().includes("Project One"), "Project ownership is visible");
  await setValue(input("记忆内容"), "Use pnpm in this project");
  await click("添加记忆");
  const projectCall = calls.filter((call) => call.channel === "memory.save").at(-1);
  assert(projectCall.payload.context.projectKey === "p1" && projectCall.payload.scope === "project", "Save uses the rendered project identity");
  await setValue(input("记忆内容"), "An unsaved project draft");
  state.context = { sessionId: "s2", projectKey: "p2", projectLabel: "Project Two" };
  state.entries = [];
  await act(async () => window.dispatchEvent(new Event("focus")));
  assert(input("记忆内容").value === "" && input("级别").value === "user", "Context change clears old scoped draft");
  assert(text().includes("项目或会话已切换"), "Context change is explained");

  await act(async () => container.querySelector('[aria-label="启用记忆"]').click());
  await act(async () => container.querySelector('[aria-label="AI 写入"]').click());
  await act(async () => container.querySelector('[aria-label="项目级别"]').click());
  assert(state.settings.enabled && state.settings.aiWriteEnabled && !state.settings.projectEnabled && state.settings.sessionEnabled, "Switches persist independently");
  nextReply = async () => ({ ok: false, message: "Settings could not be saved." });
  await act(async () => container.querySelector('[aria-label="AI 写入"]').click());
  assert(container.querySelector('[aria-label="AI 写入"]').checked, "Failed settings write keeps the persisted switch value");

  await setValue(input("记忆内容"), "Preserve this failed draft");
  nextReply = async () => ({ ok: false, code: "MEMORY_CONTEXT_CHANGED", message: "The session changed; refresh before saving." });
  await click("添加记忆");
  assert(container.querySelector('[role="alert"]').textContent.includes("refresh"), "Backend errors are visible");
  assert(input("记忆内容").value === "Preserve this failed draft", "Failed save preserves text without automatic retry");
  assert(state.entries.length === 0, "Failed save does not invent a row");
  await click("刷新");
  assert(!container.querySelector('[role="alert"]'), "Successful refresh clears the old error");

  let resolveOld;
  const old = clone(state);
  old.entries = [{ id: "old", scope: "user", content: "STALE RESPONSE", revision: 1, source: "manual" }];
  nextReply = () => new Promise((resolve) => { resolveOld = resolve; });
  await act(async () => window.dispatchEvent(new Event("focus")));
  state.context = { sessionId: null, projectKey: null, projectLabel: null };
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () => resolveOld(old));
  assert(!text().includes("STALE RESPONSE"), "Late reads cannot replace newer state");
  assert(input("级别").querySelector('option[value="project"]').disabled && input("级别").querySelector('option[value="session"]').disabled, "Unavailable scopes cannot be selected");

  state.toolAvailable = false;
  await click("刷新");
  assert(container.querySelector('[aria-label="AI 召回"]').disabled && container.querySelector('[aria-label="AI 写入"]').disabled, "Missing tool grants disable AI switches");
  assert(text().includes("授予 Agent 工具权限") && !input("记忆内容").disabled, "Permission guidance preserves manual management");

  await act(async () => listeners.get("appearance:changed")({ locale: "en", base: "dark" }));
  assert(text().includes("Manage memories") && text().includes("User"), "Locale follows host appearance changes");
  await act(async () => app.unmount());
  assert(!listeners.has("appearance:changed"), "Appearance subscription is disposed");
  const before = calls.filter((call) => call.channel === "memory.state").length;
  app = createRoot(container);
  await act(async () => app.render(<MemoryPanel bridge={bridge} disabled />));
  assert(calls.filter((call) => call.channel === "memory.state").length === before, "Old plugin processes receive no memory calls");
  assert(button("刷新").disabled, "Old plugin controls stay disabled");
  await act(async () => app.unmount());
  window.memoryTestResult = { ok: true };
};
run().catch((error) => { window.memoryTestResult = { ok: false, message: error.stack || String(error) }; });
`;

test("memory settings user path in an isolated renderer", { timeout: 60_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), "pi-memory-ui-"));
  try {
    const compiled = await build({
      stdin: { contents: browserTest, loader: "jsx", resolveDir: root },
      bundle: true, write: false, format: "iife", platform: "browser", target: "chrome120",
      define: { "process.env.NODE_ENV": '"development"' },
    });
    await writeFile(join(scratch, "test.js"), compiled.outputFiles[0].text);
    await writeFile(join(scratch, "index.html"), '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script src="test.js"></script></body></html>');
    await writeFile(join(scratch, "main.cjs"), `
      const { app, BrowserWindow } = require("electron");
      const path = require("node:path");
      app.setPath("userData", path.join(__dirname, "profile"));
      app.whenReady().then(async () => {
        const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
        await win.loadFile(path.join(__dirname, "index.html"));
        const result = await win.webContents.executeJavaScript(
          "new Promise(resolve => { const check = () => window.memoryTestResult ? resolve(window.memoryTestResult) : requestAnimationFrame(check); check(); })"
        );
        console.log("MEMORY_UI_RESULT " + JSON.stringify(result));
        app.exit(result.ok ? 0 : 1);
      }).catch(error => { console.error(error); app.exit(1); });
    `);
    const result = await new Promise((resolve, reject) => {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require("electron"), [join(scratch, "main.cjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { output += chunk; });
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Memory UI test exceeded 55 seconds\n" + output)); }, 55_000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, output: signal ? output + "\nSignal: " + signal : output }); });
    });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /MEMORY_UI_RESULT .*"ok":true/, result.output);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
