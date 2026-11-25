import assert from "node:assert/strict";
import test from "node:test";
import { can, dashboardBucket, issueState, taskStatus, taskWindow } from "../src/logic.js";

const today = "2026-11-25";

function task(partial) {
  return {
    name: "Install printers",
    plannedStart: "2026-11-01",
    actualStart: "2026-11-01",
    plannedEnd: "2026-12-15",
    ownerId: "u-harry",
    ...partial,
  };
}

test("task status follows the schedule rules", () => {
  assert.equal(taskStatus(task({ actualEnd: "2026-11-20" }), today), "Complete");
  assert.equal(taskStatus(task({ plannedEnd: "2026-11-20" }), today), "Late");
  assert.equal(taskStatus(task({ plannedEnd: today }), today), "Due Today");
  assert.equal(taskStatus(task({ plannedEnd: "2026-11-28" }), today), "Due in 3 days");
  assert.equal(taskStatus(task({ ownerId: "" }), today), "Unassigned");
  assert.equal(taskStatus(task({ plannedStart: "2026-12-20", plannedEnd: "2026-12-28" }), today), "Committed");
  assert.equal(taskStatus(task({}), today), "In Progress");
  assert.equal(taskStatus(task({ plannedStart: "" }), today), "Planned Start Date Missing");
});

test("the forward window is counted from the planned start", () => {
  assert.equal(taskWindow(task({ plannedStart: "2026-11-01" }), today), "Before today");
  assert.equal(taskWindow(task({ plannedStart: "2026-12-10" }), today), "Next 30 days");
  assert.equal(taskWindow(task({ plannedStart: "2027-01-05" }), today), "From 30 to 60 days");
  assert.equal(taskWindow(task({ plannedStart: "2027-02-05" }), today), "From 60 to 90 days");
  assert.equal(taskWindow(task({ plannedStart: "2027-03-20" }), today), "Beyond 90 days");
  assert.equal(taskWindow(task({ plannedStart: "" }), today), "");
});

test("dashboard buckets collapse every non-late open status", () => {
  assert.equal(dashboardBucket("Complete"), "Complete");
  assert.equal(dashboardBucket("Late"), "Late");
  assert.equal(dashboardBucket("In Progress"), "In Progress");
  assert.equal(dashboardBucket("Committed"), "In Progress");
  assert.equal(dashboardBucket("Due Today"), "In Progress");
});

test("issue flags use the deadline and the resolution", () => {
  assert.deepEqual(issueState({ deadline: "2026-11-20" }, today), { flag: "Issue", tone: "red" });
  assert.deepEqual(issueState({ deadline: "2026-11-30" }, today), { flag: "Risk", tone: "yellow" });
  assert.deepEqual(issueState({ deadline: "2026-11-20", status: "Resolved" }, today), { flag: "Risk", tone: "green" });
});

test("permission rank lets a lead edit the plan and stops a task owner", () => {
  assert.equal(can({ permission: "organization" }, "task"), true);
  assert.equal(can({ permission: "tracker" }, "task"), true);
  assert.equal(can({ permission: "user" }, "task"), false);
  assert.equal(can({ permission: "" }, "task"), false);
  assert.equal(can(null, "task"), false);
});
