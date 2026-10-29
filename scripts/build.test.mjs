/** The committed HTML must preserve the bundled JavaScript literally. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
test("the built settings HTML contains executable JavaScript without replacement-token corruption", { timeout: 60_000 }, async () => {
  await promisify(execFile)(process.execPath, [join(root, "build.mjs")], { cwd: root, timeout: 50_000 });
  const html = await readFile(join(root, "views/index.html"), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Script(scripts[0][1]));
  assert.ok(!html.includes("<!--VIEW_SCRIPT-->"));
  assert.ok(!html.includes("<!--VIEW_STYLE-->"));
});
