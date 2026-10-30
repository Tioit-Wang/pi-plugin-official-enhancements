"use strict";

const fs = require("node:fs/promises");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const { DEFAULTS, LIMITS, fail, validateDocument } = require("./model.js");

/**
 * Version 1 shipped a session level; version 2 dropped it; version 3 added
 * pending user-level proposals. Each step only reshapes what the previous one
 * wrote, so an old file reaches the current shape without losing the entries
 * that still have a home. The steps are applied in order rather than as a
 * switch, because a v1 file must pass through v2 to gain the temporal fields.
 */
function migrateFrom1(raw) {
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.entries)) {
    fail("STORAGE_INVALID", "Memory storage is invalid or uses an unsupported version. It was not overwritten.");
  }
  const { sessionEnabled, ...settings } = raw.settings ?? {};
  const entries = raw.entries
    .filter((entry) => entry.scope === "user" || entry.scope === "project")
    .map((entry) => ({
      ...entry,
      title: typeof entry.title === "string" ? entry.title : "",
      validUntil: null,
      supersededBy: null,
    }));
  return { schemaVersion: 2, settings, entries };
}

/** Version 2 files predate proposals, so they simply start with none. */
function migrateFrom2(raw) {
  if (!raw || !Array.isArray(raw.entries)) {
    fail("STORAGE_INVALID", "Memory storage is invalid or uses an unsupported version. It was not overwritten.");
  }
  return { schemaVersion: 3, settings: { ...DEFAULTS, ...raw.settings }, entries: raw.entries, proposals: [] };
}

/** Bring any older on-disk version to the current one, one step at a time. */
function upgrade(raw) {
  let next = raw;
  if (next && next.schemaVersion === 1) next = migrateFrom1(next);
  if (next && next.schemaVersion === 2) next = migrateFrom2(next);
  return next;
}

// The service serializes operations. Only rename publishes a new snapshot.
function createStore(getDataPath) {
  let cached = null;
  let directory = null;

  async function location() {
    directory ??= await getDataPath();
    if (typeof directory !== "string" || !directory) fail("UNAVAILABLE", "The host did not provide a private data directory.");
    return join(directory, "memory.v1.json");
  }

  async function read() {
    if (cached) return structuredClone(cached);
    const path = await location();
    try {
      // Read through one handle, and never allocate an unbounded corrupt file.
      const handle = await fs.open(path, "r");
      try {
        const stat = await handle.stat();
        if (stat.size > LIMITS.fileBytes) fail("STORAGE_INVALID", "Memory storage exceeds its size limit. It was not overwritten.");
        const bytes = Buffer.alloc(Math.min(stat.size + 1, LIMITS.fileBytes + 1));
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (bytesRead !== stat.size) fail("STORAGE_INVALID", "Memory storage changed while being read. Retry after reloading the plugin.");
        cached = validateDocument(upgrade(JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"))));
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error.code === "ENOENT") cached = { schemaVersion: 3, settings: { ...DEFAULTS }, entries: [], proposals: [] };
      else if (error instanceof SyntaxError) fail("STORAGE_INVALID", "Memory storage contains invalid JSON. It was not overwritten.");
      else if (error.code?.startsWith("MEMORY_")) throw error;
      else fail("STORAGE_IO", "Memory storage could not be read. Check the plugin data directory permissions.");
    }
    return structuredClone(cached);
  }

  async function write(next, guard) {
    validateDocument(next);
    const text = JSON.stringify(next, null, 2) + "\n";
    if (Buffer.byteLength(text) > LIMITS.fileBytes) fail("CAPACITY", "Memory storage is full. Remove unused records first.");
    const path = await location();
    const temp = `${path}.${randomUUID()}.tmp`;
    let created = false;
    try {
      await guard();
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const handle = await fs.open(temp, "wx", 0o600);
      created = true;
      try {
        await handle.writeFile(text, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await guard();
      await fs.rename(temp, path);
      created = false;
      cached = structuredClone(next);
    } catch (error) {
      if (error.code?.startsWith("MEMORY_")) throw error;
      fail("STORAGE_IO", "Memory could not be saved. The previous snapshot was retained.");
    } finally {
      if (created) {
        try { await fs.unlink(temp); }
        catch (error) { if (error.code !== "ENOENT") console.error("[official-enhancements] memory temporary-file cleanup failed"); }
      }
    }
  }

  return { read, write };
}

module.exports = { createStore };
