import assert from "node:assert/strict";
import test from "node:test";
import { cascadeDelete } from "../src/store.js";
import { createSeed } from "../src/seed.js";

function names(state) {
  return state.tasks.map((task) => task.name);
}

test("deleting a workflow removes every task under it and unlinks the meeting", () => {
  const state = structuredClone(createSeed());
  const beforeUsers = state.users.length;
  const result = cascadeDelete(state, "task", "t6");

  assert.equal(names(state).includes("South Portland - Cabling prep"), false);
  assert.equal(names(state).includes("Set up Temp Spaces"), false);
  assert.equal(names(state).includes("Call Landlord"), false);
  assert.equal(names(state).includes("Set up meeting with Landlord"), false);
  assert.equal(names(state).includes("Sign agreement"), false);
  assert.equal(names(state).includes("Get approval from VA"), false);
  assert.equal(names(state).includes("South Portland - VA Network setup"), false);
  assert.equal(names(state).includes("Printer Deployment"), true);
  assert.equal(state.users.length, beforeUsers);
  assert.equal(state.meetings.find((meeting) => meeting.id === "mtg-landlord").taskId, "");
  assert.equal(result.kept.length, 0);
  assert.ok(result.deleted.some((item) => item.id === "t8"));
});

test("deleting one step keeps a child that a meeting still references", () => {
  const state = structuredClone(createSeed());
  const result = cascadeDelete(state, "task", "t7");

  assert.equal(names(state).includes("Set up Temp Spaces"), false);
  assert.equal(names(state).includes("Set up meeting with Landlord"), false);
  assert.equal(names(state).includes("Sign agreement"), false);
  assert.equal(names(state).includes("Get approval from VA"), false);
  assert.equal(names(state).includes("Call Landlord"), true);
  assert.equal(names(state).includes("South Portland - Cabling prep"), true);
  assert.equal(state.meetings.find((meeting) => meeting.id === "mtg-landlord").taskId, "t8");
  assert.ok(result.kept.some((item) => item.id === "t8"));
});

test("deleting one person leaves the rest of the directory in place", () => {
  const state = structuredClone(createSeed());
  const before = state.users.length;
  cascadeDelete(state, "user", "u-harry");

  assert.equal(state.users.some((user) => user.id === "u-harry"), false);
  assert.equal(state.users.length, before - 1);
  assert.equal(state.users.some((user) => user.id === "u-sally"), true);
  assert.equal(state.tasks.find((task) => task.id === "t2").ownerId, "");
});
