import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

test("NetworkX analytics score a small project graph", () => {
  const result = spawnSync(python, ["test/graph_analytics_check.py"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.overview.nodes, 6);
  assert.equal(payload.overview.dependenciesAcyclic, true);
  assert.deepEqual(payload.criticalChain.map((node) => node.label), ["Survey", "Install", "Train"]);
  assert.ok(payload.degree.some((node) => node.label === "Ada"));
  assert.ok(payload.betweenness.some((node) => node.score > 0));
  assert.ok(payload.pagerank.length > 0);
  assert.ok(payload.communities.length > 0);
  assert.equal(payload.dependencyCycle.length, 0);
});
