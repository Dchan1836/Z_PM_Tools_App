import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createSeed } from "./seed.js";
import {
  addDays,
  actionItemState,
  can,
  columnFraction,
  daysBetween,
  dashboardBucket,
  durationDays,
  isYes,
  issueState,
  lateStart,
  milestoneColumns,
  publicUser,
  taskStatus,
  taskWindow,
  todayISO,
  trackerPercents,
} from "./logic.js";

import { ensureSchema, hasData, loadDocument, openDatabase, saveDocument } from "./sqlStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
const importPath = path.join(dataDir, "pg-import.json");

let database;
let db = null;

export async function initStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  database = openDatabase();
  await ensureSchema(database);
  if (await hasData(database)) {
    db = await loadDocument(database);
    return;
  }
  const document = fs.existsSync(importPath) ? JSON.parse(fs.readFileSync(importPath, "utf8")) : createSeed();
  await saveDocument(database, document);
  db = document;
}

async function persist(next) {
  db = next;
  await saveDocument(database, db);
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function touch(state) {
  state.project.revisedAt = new Date().toISOString();
}

function reparent(tasks) {
  tasks.forEach((task, index) => {
    if (!task.level || task.level < 0) task.level = 0;
    task.parentId = null;
    if (task.level === 0) return;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (tasks[i].level < task.level) {
        task.parentId = tasks[i].id;
        break;
      }
    }
    if (!task.parentId) task.level = 0;
  });
}

function blockEnd(tasks, index) {
  const level = tasks[index].level || 0;
  let end = index + 1;
  while (end < tasks.length && (tasks[end].level || 0) > level) end += 1;
  return end;
}

function findTask(state, id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) fail("Task not found");
  return task;
}

function cascadeFrom(tasks, originId) {
  const pending = [originId];
  const guard = new Set();
  while (pending.length) {
    const id = pending.shift();
    if (guard.has(id)) continue;
    guard.add(id);
    const origin = tasks.find((item) => item.id === id);
    if (!origin?.plannedEnd) continue;
    for (const task of tasks) {
      if (task.predecessorId !== id || !task.plannedStart) continue;
      const minStart = addDays(origin.plannedEnd, 1);
      if (task.plannedStart < minStart) {
        const span = durationDays(task);
        task.plannedStart = minStart;
        if (task.plannedEnd) task.plannedEnd = addDays(minStart, span);
        pending.push(task.id);
      }
    }
  }
}

function exceedsProject(state, task) {
  return Boolean(task.plannedEnd && state.project.endDate && task.plannedEnd > state.project.endDate);
}

function applyEndChoice(state, task, confirm) {
  if (!exceedsProject(state, task)) return;
  if (confirm === "changeEnd") {
    state.project.endDate = task.plannedEnd;
    return;
  }
  if (confirm === "shrinkTask") {
    task.plannedEnd = state.project.endDate;
    if (task.plannedStart && task.plannedStart > task.plannedEnd) {
      task.plannedStart = state.project.endDate;
    }
    return;
  }
  return {
    warning: "project-end",
    message: `This date goes past the project end (${state.project.endDate}). Change the project end date, or pull the task back inside the project.`,
    projectEnd: state.project.endDate,
    taskEnd: task.plannedEnd,
  };
}

function assertCanEditPlan(user) {
  if (!can(user, "task")) fail("You do not have permission to edit the plan.");
}

function nameOf(users, id) {
  const person = users.find((item) => item.id === id);
  return person ? `${person.firstName} ${person.lastName}` : "";
}

function orgIndex(org) {
  const waves = new Map();
  const visns = new Map();
  const sites = new Map();
  for (const wave of org.waves) {
    waves.set(wave.id, wave);
    for (const visn of wave.visns) {
      visns.set(visn.id, { ...visn, waveId: wave.id, waveName: wave.name });
      for (const site of visn.sites) {
        sites.set(site.id, {
          ...site,
          visnId: visn.id,
          visnName: visn.name,
          waveId: wave.id,
          waveName: wave.name,
        });
      }
    }
  }
  return { waves, visns, sites };
}

function presentTracker(tracker, trackers) {
  const milestones = milestoneColumns(tracker);
  const rows = (tracker.rows || []).map((row) => {
    const rollups = {};
    const child = trackers.find((item) => item.id === row.childTrackerId);
    if (tracker.kind === "parent" && child) {
      for (const column of milestones) {
        const childColumn = column.childColumnId || column.id;
        rollups[column.id] = columnFraction(child, childColumn);
      }
    }
    const tests = (tracker.columns || []).filter((column) => column.dataType === "status" && column.milestone);
    const done = tests.filter((column) => isYes(row.cells?.[column.id])).length;
    return {
      ...row,
      rollups,
      rowPercent: tests.length ? done / tests.length : null,
    };
  });
  let percent = null;
  if (tracker.kind === "parent") {
    const last = milestones[milestones.length - 1];
    if (last && rows.length) {
      const ratio = rows.reduce((sum, row) => sum + (row.rollups[last.id]?.ratio || 0), 0) / rows.length;
      percent = Math.round(ratio * 100);
    }
  } else {
    percent = trackerPercents(tracker, trackers).percent;
  }
  return { ...tracker, rows, percent };
}

export function present(state, user) {
  reparent(state.tasks);
  const presentedTrackers = state.trackers.map((tracker) => presentTracker(tracker, state.trackers));
  const trackerById = new Map(presentedTrackers.map((tracker) => [tracker.id, tracker]));
  const { waves, visns, sites } = orgIndex(state.org);
  const today = todayISO();
  const tasks = state.tasks.map((task) => {
    const site = sites.get(task.siteId);
    const tracker = task.trackerId ? trackerById.get(task.trackerId) : null;
    const percent = tracker && tracker.percent != null ? tracker.percent : task.percentComplete;
    const status = taskStatus(task, today);
    return {
      ...task,
      status,
      window: taskWindow(task, today),
      lateStart: lateStart(task),
      bucket: dashboardBucket(status),
      ownerName: nameOf(state.users, task.ownerId),
      predecessorName: state.tasks.find((item) => item.id === task.predecessorId)?.name || "",
      percent,
      siteName: site?.name || "",
      visnName: site?.visnName || visns.get(task.visnId)?.name || "",
      waveName: site?.waveName || waves.get(task.waveId)?.name || "",
    };
  });

  const meetings = state.meetings.map((meeting) => ({
    ...meeting,
    facilitatorName: nameOf(state.users, meeting.facilitatorId),
    participantNames: [
      ...(meeting.participantIds || []).map((id) => nameOf(state.users, id)).filter(Boolean),
      ...(meeting.guestNames || []).map((name) => `${name} (new, not in the directory)`),
    ],
    agenda: (meeting.agenda || []).map((item) => ({
      ...item,
      ownerName: nameOf(state.users, item.ownerId) || item.ownerName || "",
      actions: (item.actions || []).map((action) => ({
        ...action,
        ownerName: nameOf(state.users, action.ownerId) || action.ownerName || "",
        ...actionItemState(action, today),
      })),
    })),
  }));

  const issues = state.issues.map((issue) => ({
    ...issue,
    ownerName: nameOf(state.users, issue.ownerId),
    taskName: state.tasks.find((item) => item.id === issue.taskId)?.name || "",
    ...issueState(issue, today),
  }));

  return {
    me: publicUser(user),
    users: state.users.map(publicUser),
    org: state.org,
    project: state.project,
    tasks,
    views: state.views.filter((view) => view.userId === user.id),
    prefs: state.prefs[user.id] || { panels: [] },
    meetings,
    decisions: state.decisions,
    folders: [...state.folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    files: state.files,
    trackers: presentedTrackers,
    issues,
    reports: state.reports,
    messages: state.messages.filter((message) => message.toId === user.id || message.fromId === user.id),
    today,
  };
}

function blankTask(partial) {
  return {
    id: uid("t"),
    level: 0,
    pillar: "",
    area: "",
    specialty: "",
    name: "New task",
    ownerId: "",
    waveId: "wA",
    visnId: "v1",
    siteId: "portland",
    plannedStart: todayISO(),
    actualStart: "",
    plannedEnd: addDays(todayISO(), 7),
    actualEnd: "",
    percentComplete: null,
    trackerId: null,
    predecessorId: null,
    assignmentStatus: null,
    negotiable: false,
    proposedStart: "",
    proposedEnd: "",
    proposalComment: "",
    inReport: false,
    comments: [],
    ...partial,
  };
}

export async function dispatch(user, action) {
  const result = apply(structuredClone(db), user, action || {});
  if (result.warning) return result;
  await persist(result.state);
  return {
    state: present(result.state, user),
    deleted: result.deleted,
    kept: result.kept,
    createdId: result.createdId,
  };
}

export async function resetDemo(user) {
  if (!can(user, "organization")) fail("Only a super admin can restore the sample project.");
  await persist(createSeed());
  return { state: present(db, user) };
}

function apply(state, user, action) {
  const type = action.type;
  if (type === "updateTask") return updateTask(state, user, action);
  if (type === "insertTask") return insertTask(state, user, action);
  if (type === "deleteTask") return deleteTask(state, user, action);
  if (type === "indent" || type === "outdent") return indent(state, user, action);
  if (type === "shiftTasks") return shiftTasks(state, user, action);
  if (type === "linkTasks") return linkTasks(state, user, action);
  if (type === "assignTask") return assignTask(state, user, action);
  if (type === "respondAssignment") return respondAssignment(state, user, action);
  if (type === "acceptProposal") return acceptProposal(state, user, action);
  if (type === "addComment") return addComment(state, user, action);
  if (type === "toggleReport") return toggleReport(state, user, action);
  if (type === "addSubtask") return addSubtask(state, user, action);
  if (type === "createWorkflow") return createWorkflow(state, user, action);
  if (type === "saveView") return saveView(state, user, action);
  if (type === "deleteView") return deleteView(state, user, action);
  if (type === "setPrefs") return setPrefs(state, user, action);
  if (type === "saveMeeting") return saveMeeting(state, user, action);
  if (type === "uploadMeeting") return uploadMeeting(state, user, action);
  if (type === "uploadDecision") return uploadDecision(state, user, action);
  if (type === "createFolder") return createFolder(state, user, action);
  if (type === "uploadFile") return uploadFile(state, user, action);
  if (type === "createTracker") return createTracker(state, user, action);
  if (type === "saveTrackerMeta") return saveTrackerMeta(state, user, action);
  if (type === "addTrackerColumn") return addTrackerColumn(state, user, action);
  if (type === "updateTrackerColumn") return updateTrackerColumn(state, user, action);
  if (type === "deleteTrackerColumn") return deleteTrackerColumn(state, user, action);
  if (type === "addTrackerRow") return addTrackerRow(state, user, action);
  if (type === "deleteTrackerRow") return deleteTrackerRow(state, user, action);
  if (type === "updateTrackerCell") return updateTrackerCell(state, user, action);
  if (type === "attachTracker") return attachTracker(state, user, action);
  if (type === "saveIssue") return saveIssue(state, user, action);
  if (type === "addIssueNote") return addIssueNote(state, user, action);
  if (type === "saveReport") return saveReport(state, user, action);
  if (type === "emailReport") return emailReport(state, user, action);
  if (type === "saveUser") return saveUser(state, user, action);
  if (type === "deleteUser") return deleteUser(state, user, action);
  if (type === "saveOrg") return saveOrg(state, user, action);
  if (type === "deleteOrg") return deleteOrg(state, user, action);
  if (type === "saveProject") return saveProject(state, user, action);
  if (type === "purgeRecord") return purgeRecord(state, user, action);
  if (type === "requestUpdate") return requestUpdate(state, user, action);
  fail("Unknown action");
}

function updateTask(state, user, action) {
  const task = findTask(state, action.id);
  const patch = action.patch || {};
  const planFields = ["name", "pillar", "area", "specialty", "waveId", "visnId", "siteId", "plannedStart", "plannedEnd", "ownerId", "predecessorId", "level"];
  const actualFields = ["actualStart", "actualEnd", "percentComplete"];
  const touchesPlan = planFields.some((field) => field in patch);
  const ownWork = task.ownerId === user.id && task.assignmentStatus === "accepted";
  if (touchesPlan) assertCanEditPlan(user);
  else if (!can(user, "task") && !ownWork) fail("You can update actuals only on tasks assigned to you.");
  if (!can(user, "task")) {
    for (const field of planFields) delete patch[field];
  }
  for (const field of [...planFields, ...actualFields]) {
    if (field in patch) task[field] = patch[field];
  }
  if (task.percentComplete === "" || task.percentComplete === undefined) task.percentComplete = null;
  if (typeof task.percentComplete === "string" && task.percentComplete !== "") {
    task.percentComplete = Number(task.percentComplete);
  }
  const warning = applyEndChoice(state, task, action.confirm);
  if (warning) return warning;
  cascadeFrom(state.tasks, task.id);
  reparent(state.tasks);
  touch(state);
  return { state };
}

function insertTask(state, user, action) {
  assertCanEditPlan(user);
  const index = state.tasks.findIndex((item) => item.id === action.anchorId);
  if (index < 0) fail("Select a task first.");
  const anchor = state.tasks[index];
  const created = blankTask({
    level: anchor.level || 0,
    pillar: anchor.pillar,
    area: anchor.area,
    specialty: anchor.specialty,
    waveId: anchor.waveId,
    visnId: anchor.visnId,
    siteId: anchor.siteId,
  });
  const warning = applyEndChoice(state, created, action.confirm);
  if (warning) return warning;
  const at = action.place === "above" ? index : blockEnd(state.tasks, index);
  state.tasks.splice(at, 0, created);
  reparent(state.tasks);
  touch(state);
  return { state, createdId: created.id };
}

function taskTree(tasks, id) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const task of tasks) {
      if (ids.has(task.parentId) && !ids.has(task.id)) {
        ids.add(task.id);
        grew = true;
      }
    }
  }
  return ids;
}

function unlinkTasks(state, removed) {
  for (const task of state.tasks) {
    if (removed.has(task.predecessorId)) task.predecessorId = null;
  }
  for (const meeting of state.meetings) {
    if (removed.has(meeting.taskId)) meeting.taskId = "";
  }
  for (const folder of state.folders) {
    if (removed.has(folder.taskId)) folder.taskId = "";
  }
  for (const tracker of state.trackers) {
    if (removed.has(tracker.taskId)) tracker.taskId = null;
  }
  for (const report of state.reports || []) {
    report.taskIds = (report.taskIds || []).filter((id) => !removed.has(id));
  }
  for (const message of state.messages) {
    if (removed.has(message.taskId)) message.taskId = "";
  }
}

function deleteTask(state, user, action) {
  assertCanEditPlan(user);
  reparent(state.tasks);
  if (!state.tasks.some((task) => task.id === action.id)) fail("Task not found");
  const removed = taskTree(state.tasks, action.id);
  state.tasks = state.tasks.filter((task) => !removed.has(task.id));
  unlinkTasks(state, removed);
  state.issues = state.issues.filter((issue) => !removed.has(issue.taskId));
  reparent(state.tasks);
  touch(state);
  return { state };
}

function indent(state, user, action) {
  assertCanEditPlan(user);
  const index = state.tasks.findIndex((item) => item.id === action.id);
  if (index < 0) fail("Task not found");
  const task = state.tasks[index];
  const delta = action.type === "indent" ? 1 : -1;
  if (delta > 0 && index === 0) fail("The first task cannot be indented.");
  if (delta > 0) {
    const previous = state.tasks[index - 1];
    if ((task.level || 0) > (previous.level || 0)) fail("This task is already a subtask of the row above it.");
  }
  if (delta < 0 && (task.level || 0) === 0) fail("This task is already at the top level.");
  const base = task.level || 0;
  const end = blockEnd(state.tasks, index);
  for (let i = index; i < end; i += 1) {
    state.tasks[i].level = Math.max(0, (state.tasks[i].level || 0) + delta);
  }
  if (delta < 0) {
    // keep the moved block from jumping above a shallower neighbor incorrectly
    state.tasks[index].level = Math.max(0, base + delta);
  }
  reparent(state.tasks);
  touch(state);
  return { state };
}

function shiftTasks(state, user, action) {
  assertCanEditPlan(user);
  const days = Number(action.days);
  if (!Number.isFinite(days) || days === 0) fail("Enter a number of days to move the selected tasks.");
  const ids = new Set(action.ids || []);
  const moved = state.tasks.filter((item) => ids.has(item.id));
  if (!moved.length) fail("Select at least one task.");
  for (const task of moved) {
    if (task.plannedStart) task.plannedStart = addDays(task.plannedStart, days);
    if (task.plannedEnd) task.plannedEnd = addDays(task.plannedEnd, days);
  }
  const offender = moved.find((task) => exceedsProject(state, task));
  if (offender) {
    const warning = applyEndChoice(state, offender, action.confirm);
    if (warning) return warning;
    // changeEnd already extended the project; shrink would only fix one task
    if (action.confirm === "shrinkTask") {
      for (const task of moved) {
        if (exceedsProject(state, task)) applyEndChoice(state, task, "shrinkTask");
      }
    }
  }
  for (const task of moved) cascadeFrom(state.tasks, task.id);
  touch(state);
  return { state };
}

function linkTasks(state, user, action) {
  assertCanEditPlan(user);
  const task = findTask(state, action.id);
  if (!action.predecessorId) {
    task.predecessorId = null;
    touch(state);
    return { state };
  }
  if (action.predecessorId === task.id) fail("A task cannot depend on itself.");
  const seen = new Set([task.id]);
  let cursor = action.predecessorId;
  while (cursor) {
    if (seen.has(cursor)) fail("That link would create a circular dependency.");
    seen.add(cursor);
    cursor = state.tasks.find((item) => item.id === cursor)?.predecessorId;
  }
  task.predecessorId = action.predecessorId;
  cascadeFrom(state.tasks, action.predecessorId);
  const warning = applyEndChoice(state, task, action.confirm);
  if (warning) return warning;
  touch(state);
  return { state };
}

function assignTask(state, user, action) {
  assertCanEditPlan(user);
  const task = findTask(state, action.taskId);
  if (!action.ownerId) fail("Choose a person to assign.");
  if (!state.users.some((item) => item.id === action.ownerId)) fail("That person is not in the directory.");
  const negotiable = Boolean(action.negotiable);
  if (!negotiable && (!action.plannedStart || !action.plannedEnd)) {
    fail("Enter a start and end, or mark the dates as negotiable so the assignee can propose them.");
  }
  task.ownerId = action.ownerId;
  task.negotiable = negotiable;
  task.assignmentStatus = "pending";
  task.proposalComment = "";
  task.proposedStart = "";
  task.proposedEnd = "";
  if (action.plannedStart) task.plannedStart = action.plannedStart;
  if (action.plannedEnd) task.plannedEnd = action.plannedEnd;
  const warning = applyEndChoice(state, task, action.confirm);
  if (warning) return warning;
  state.messages.unshift({
    id: uid("msg"),
    toId: action.ownerId,
    fromId: user.id,
    kind: "assignment",
    subject: `Task assigned: ${task.name}`,
    body: negotiable
      ? "You have a task to accept. Dates are negotiable — propose a timeline if you need one."
      : `Please accept this task for ${task.plannedStart} through ${task.plannedEnd}.`,
    at: new Date().toISOString(),
    taskId: task.id,
  });
  touch(state);
  return { state };
}

function respondAssignment(state, user, action) {
  const task = findTask(state, action.taskId);
  const decision = action.decision;
  if (task.ownerId !== user.id && !can(user, "task")) fail("This assignment is not yours.");
  if (decision === "accept") {
    task.assignmentStatus = "accepted";
    task.proposedStart = "";
    task.proposedEnd = "";
  } else if (decision === "reject") {
    if (!action.comment) fail("A comment is required when you reject a task.");
    task.assignmentStatus = "rejected";
    task.proposalComment = action.comment;
  } else if (decision === "propose") {
    if (!action.proposedStart || !action.proposedEnd) fail("Enter the start and end you can commit to.");
    task.assignmentStatus = "proposed";
    task.proposedStart = action.proposedStart;
    task.proposedEnd = action.proposedEnd;
    task.proposalComment = action.comment || "";
    state.messages.unshift({
      id: uid("msg"),
      toId: state.users.find((item) => item.permission === "organization")?.id || user.id,
      fromId: user.id,
      kind: "proposal",
      subject: `New dates proposed: ${task.name}`,
      body: `${nameOf(state.users, user.id)} proposed ${action.proposedStart} to ${action.proposedEnd}. ${action.comment || ""}`.trim(),
      at: new Date().toISOString(),
      taskId: task.id,
    });
  } else if (decision === "reassign") {
    if (!action.reassignTo) fail("Choose the coworker to take this task.");
    if (!action.comment) fail("Add a comment when you reassign a task.");
    task.ownerId = action.reassignTo;
    task.assignmentStatus = "pending";
    task.proposalComment = action.comment;
    state.messages.unshift({
      id: uid("msg"),
      toId: action.reassignTo,
      fromId: user.id,
      kind: "assignment",
      subject: `Task reassigned to you: ${task.name}`,
      body: action.comment,
      at: new Date().toISOString(),
      taskId: task.id,
    });
  } else if (decision === "comment") {
    if (!action.comment) fail("Enter a comment.");
  } else {
    fail("Unknown response.");
  }
  if (action.comment && decision !== "reassign") {
    task.comments.push({
      id: uid("c"),
      at: todayISO(),
      authorId: user.id,
      text: action.comment,
    });
  }
  touch(state);
  return { state };
}

function acceptProposal(state, user, action) {
  assertCanEditPlan(user);
  const task = findTask(state, action.taskId);
  if (task.assignmentStatus !== "proposed") fail("There is no proposed timeline on this task.");
  if (action.accept === false) {
    task.assignmentStatus = "pending";
    task.proposalComment = action.comment || "Proposed dates were not accepted.";
  } else {
    task.plannedStart = task.proposedStart || task.plannedStart;
    task.plannedEnd = task.proposedEnd || task.plannedEnd;
    task.assignmentStatus = "accepted";
    task.proposedStart = "";
    task.proposedEnd = "";
    const warning = applyEndChoice(state, task, action.confirm);
    if (warning) return warning;
    cascadeFrom(state.tasks, task.id);
  }
  state.messages.unshift({
    id: uid("msg"),
    toId: task.ownerId,
    fromId: user.id,
    kind: "proposal",
    subject: action.accept === false ? `Dates not accepted: ${task.name}` : `Dates accepted: ${task.name}`,
    body: action.accept === false ? task.proposalComment : `The plan now uses ${task.plannedStart} through ${task.plannedEnd}.`,
    at: new Date().toISOString(),
    taskId: task.id,
  });
  touch(state);
  return { state };
}

function addComment(state, user, action) {
  const task = findTask(state, action.taskId);
  if (!action.text) fail("Enter a comment.");
  task.comments.push({ id: uid("c"), at: todayISO(), authorId: user.id, text: action.text });
  touch(state);
  return { state };
}

function toggleReport(state, user, action) {
  const task = findTask(state, action.taskId);
  task.inReport = !task.inReport;
  touch(state);
  return { state };
}

function addSubtask(state, user, action) {
  const parent = findTask(state, action.parentId);
  const owns = parent.ownerId === user.id;
  if (!owns && !can(user, "task")) fail("You can add subtasks only under tasks assigned to you.");
  const index = state.tasks.findIndex((item) => item.id === parent.id);
  const created = blankTask({
    name: action.name || "New subtask",
    level: (parent.level || 0) + 1,
    pillar: parent.pillar,
    area: parent.area,
    specialty: parent.specialty,
    waveId: parent.waveId,
    visnId: parent.visnId,
    siteId: parent.siteId,
    ownerId: action.ownerId || "",
    plannedStart: action.plannedStart || parent.plannedStart,
    plannedEnd: action.plannedEnd || parent.plannedEnd,
    negotiable: Boolean(action.negotiable),
    assignmentStatus: action.ownerId ? "pending" : null,
  });
  const warning = applyEndChoice(state, created, action.confirm);
  if (warning) return warning;
  state.tasks.splice(blockEnd(state.tasks, index), 0, created);
  if (created.ownerId) {
    state.messages.unshift({
      id: uid("msg"),
      toId: created.ownerId,
      fromId: user.id,
      kind: "assignment",
      subject: `Subtask assigned: ${created.name}`,
      body: created.negotiable ? "Dates are negotiable." : "Dates are fixed.",
      at: new Date().toISOString(),
      taskId: created.id,
    });
  }
  reparent(state.tasks);
  touch(state);
  return { state };
}

function placeFor(state, siteId) {
  const fallback = {
    waveId: state.project.waveId || "",
    visnId: state.project.visnId || "",
    siteId: state.project.siteId || "",
  };
  if (!siteId) return fallback;
  for (const wave of state.org.waves) {
    for (const visn of wave.visns) {
      if (visn.sites.some((site) => site.id === siteId)) {
        return { waveId: wave.id, visnId: visn.id, siteId };
      }
    }
  }
  return fallback;
}

function createWorkflow(state, user, action) {
  assertCanEditPlan(user);
  const incoming = action.workflow || {};
  const name = String(incoming.name || "").trim();
  if (!name) fail("A workflow needs a name.");
  const steps = (incoming.steps || [])
    .map((step) => ({
      name: String(step.name || "").trim(),
      ownerId: step.ownerId || "",
      plannedStart: step.plannedStart || "",
      plannedEnd: step.plannedEnd || "",
    }))
    .filter((step) => step.name);
  if (!steps.length) fail("Add at least one task to the workflow.");
  for (const step of steps) {
    if (step.ownerId && !state.users.some((person) => person.id === step.ownerId)) fail("That person is not in the directory.");
  }
  if (incoming.ownerId && !state.users.some((person) => person.id === incoming.ownerId)) {
    fail("That person is not in the directory.");
  }

  const place = placeFor(state, incoming.siteId || state.project.siteId);
  const root = blankTask({
    name,
    level: 0,
    pillar: String(incoming.pillar || "").trim(),
    ownerId: incoming.ownerId || "",
    ...place,
    assignmentStatus: incoming.ownerId ? "pending" : null,
  });
  if (incoming.plannedStart) root.plannedStart = incoming.plannedStart;
  if (incoming.plannedEnd) root.plannedEnd = incoming.plannedEnd;

  const created = [root];
  let previousId = null;
  for (const step of steps) {
    const task = blankTask({
      name: step.name,
      level: 1,
      pillar: root.pillar,
      ownerId: step.ownerId,
      waveId: root.waveId,
      visnId: root.visnId,
      siteId: root.siteId,
      plannedStart: step.plannedStart || root.plannedStart,
      plannedEnd: step.plannedEnd || root.plannedEnd,
      predecessorId: previousId,
      assignmentStatus: step.ownerId ? "pending" : null,
    });
    previousId = task.id;
    created.push(task);
  }

  for (const task of created) {
    const warning = applyEndChoice(state, task, action.confirm);
    if (warning) return warning;
  }

  state.tasks.push(...created);
  for (const task of created) {
    if (!task.ownerId) continue;
    state.messages.unshift({
      id: uid("msg"),
      toId: task.ownerId,
      fromId: user.id,
      kind: "assignment",
      subject: `Task assigned: ${task.name}`,
      body: `Please accept this task for ${task.plannedStart} through ${task.plannedEnd}.`,
      at: new Date().toISOString(),
      taskId: task.id,
    });
  }
  reparent(state.tasks);
  touch(state);
  return { state, createdId: root.id };
}

function saveView(state, user, action) {
  const name = (action.name || "").trim();
  if (!name) fail("Name the view before saving it.");
  const filters = action.filters || {};
  if (action.id) {
    const existing = state.views.find((view) => view.id === action.id && view.userId === user.id);
    if (!existing) fail("View not found");
    existing.name = name;
    existing.filters = filters;
  } else {
    state.views.push({ id: uid("view"), userId: user.id, name, filters });
  }
  touch(state);
  return { state };
}

function deleteView(state, user, action) {
  state.views = state.views.filter((view) => !(view.id === action.id && view.userId === user.id));
  touch(state);
  return { state };
}

function setPrefs(state, user, action) {
  state.prefs[user.id] = { panels: action.panels || [] };
  touch(state);
  return { state };
}

function saveMeeting(state, user, action) {
  const incoming = action.meeting || {};
  if (!incoming.title) fail("A meeting needs a title.");
  const agenda = (incoming.agenda || []).map((item, index) => ({
    id: item.id || uid("ag"),
    topic: item.topic || "",
    ownerId: item.ownerId || "",
    ownerName: item.ownerId ? "" : (item.ownerName || ""),
    time: item.time || "",
    notes: item.notes || "",
    isDecision: Boolean(item.isDecision),
    actions: (item.actions || []).map((entry) => ({
      id: entry.id || uid("ai"),
      action: entry.action || "",
      ownerId: entry.ownerId || "",
      ownerName: entry.ownerId ? "" : (entry.ownerName || ""),
      due: entry.due || "",
      actualEnd: entry.actualEnd || "",
    })),
  }));
  const record = {
    id: incoming.id || uid("mtg"),
    title: incoming.title,
    date: incoming.date || todayISO(),
    time: incoming.time || "",
    facilitatorId: incoming.facilitatorId || user.id,
    participantIds: incoming.participantIds || [],
    guestNames: [...new Set((incoming.guestNames || []).map((name) => String(name || "").trim()).filter(Boolean))],
    taskId: incoming.taskId || "",
    isTemplate: action.saveMode === "template",
    source: "internal",
    fileName: "",
    ownerEmail: user.email,
    agenda,
  };
  const index = state.meetings.findIndex((meeting) => meeting.id === record.id);
  if (index >= 0) state.meetings[index] = record;
  else state.meetings.unshift(record);
  syncDecisions(state, record);
  touch(state);
  return { state };
}

function syncDecisions(state, meeting) {
  state.decisions = state.decisions.filter((item) => item.meetingId !== meeting.id);
  for (const item of meeting.agenda || []) {
    if (!item.isDecision) continue;
    const owner = state.users.find((person) => person.id === item.ownerId);
    state.decisions.push({
      id: uid("dec"),
      title: meeting.title,
      date: meeting.date,
      ownerEmail: owner?.email || meeting.ownerEmail,
      source: "internal",
      fileName: "",
      meetingId: meeting.id,
      agendaId: item.id,
      text: item.notes || item.topic,
    });
  }
}

function uploadMeeting(state, user, action) {
  if (!action.fileName) fail("Choose a file to upload.");
  state.meetings.unshift({
    id: uid("mtg"),
    title: action.fileName,
    date: todayISO(),
    time: "",
    facilitatorId: "",
    participantIds: [],
    taskId: action.taskId || "",
    isTemplate: false,
    source: "upload",
    fileName: action.fileName,
    ownerEmail: user.email,
    agenda: [
      {
        id: uid("ag"),
        topic: "Uploaded notes",
        ownerId: user.id,
        time: "",
        notes: action.notes || "Uploaded from outside Z PM.",
        isDecision: false,
        actions: [],
      },
    ],
  });
  touch(state);
  return { state };
}

function uploadDecision(state, user, action) {
  if (!action.fileName) fail("Choose a file to upload.");
  state.decisions.unshift({
    id: uid("dec"),
    title: action.fileName,
    date: todayISO(),
    ownerEmail: user.email,
    source: "upload",
    fileName: action.fileName,
    meetingId: "",
    agendaId: "",
    text: action.notes || "Decision uploaded from outside Z PM.",
  });
  touch(state);
  return { state };
}

function createFolder(state, user, action) {
  const name = (action.name || "").trim();
  if (!name) fail("Folder name is required.");
  if (state.folders.some((folder) => folder.name.toLowerCase() === name.toLowerCase())) {
    fail("A folder with that name already exists.");
  }
  const today = todayISO();
  state.folders.push({ id: uid("f"), name, created: today, modified: today, taskId: action.taskId || "" });
  touch(state);
  return { state };
}

function uploadFile(state, user, action) {
  const folder = state.folders.find((item) => item.id === action.folderId);
  if (!folder) fail("Pick a folder first.");
  if (!action.fileName) fail("Choose a file.");
  const today = todayISO();
  state.files.push({
    id: uid("file"),
    folderId: folder.id,
    name: action.fileName,
    created: today,
    modified: today,
  });
  folder.modified = today;
  touch(state);
  return { state };
}

function createTracker(state, user, action) {
  if (!can(user, "tracker")) fail("You do not have permission to create a tracker.");
  const name = (action.name || "").trim();
  if (!name) fail("Name the tracker.");
  const columns = (action.columns || []).map((column, index) => ({
    id: uid("col"),
    name: column.name || `Column ${index + 1}`,
    dataType: column.dataType || "text",
    required: Boolean(column.required),
    milestone: Number(column.milestone) || 0,
    order: index + 1,
  }));
  if (!columns.length) fail("Add at least one column.");
  const rowCount = Math.max(1, Number(action.rowCount) || 3);
  const rows = Array.from({ length: rowCount }, () => ({
    id: uid("row"),
    cells: Object.fromEntries(columns.map((column) => [column.id, ""])),
  }));
  state.trackers.push({
    id: uid("tr"),
    name,
    kind: "flat",
    parentId: action.parentId || null,
    taskId: "",
    columns,
    rows,
  });
  touch(state);
  return { state };
}

function trackerOrFail(state, id) {
  const tracker = state.trackers.find((item) => item.id === id);
  if (!tracker) fail("Tracker not found");
  return tracker;
}

function saveTrackerMeta(state, user, action) {
  if (!can(user, "tracker")) fail("You do not have permission to edit trackers.");
  const tracker = trackerOrFail(state, action.id);
  if (action.name) tracker.name = action.name;
  if ("parentId" in action) tracker.parentId = action.parentId || null;
  touch(state);
  return { state };
}

function addTrackerColumn(state, user, action) {
  if (!can(user, "tracker")) fail("You do not have permission to edit trackers.");
  const tracker = trackerOrFail(state, action.trackerId);
  const column = {
    id: uid("col"),
    name: action.column?.name || "New column",
    dataType: action.column?.dataType || "text",
    required: Boolean(action.column?.required),
    milestone: Number(action.column?.milestone) || 0,
    order: tracker.columns.length + 1,
    childColumnId: action.column?.childColumnId || "",
  };
  tracker.columns.push(column);
  for (const row of tracker.rows) row.cells[column.id] = "";
  touch(state);
  return { state };
}

function updateTrackerColumn(state, user, action) {
  if (!can(user, "tracker")) fail("You do not have permission to edit trackers.");
  const tracker = trackerOrFail(state, action.trackerId);
  const column = tracker.columns.find((item) => item.id === action.columnId);
  if (!column) fail("Column not found");
  Object.assign(column, action.patch || {});
  touch(state);
  return { state };
}

function deleteTrackerColumn(state, user, action) {
  if (!can(user, "tracker")) fail("You do not have permission to edit trackers.");
  const tracker = trackerOrFail(state, action.trackerId);
  tracker.columns = tracker.columns.filter((column) => column.id !== action.columnId);
  for (const row of tracker.rows) delete row.cells[action.columnId];
  touch(state);
  return { state };
}

function addTrackerRow(state, user, action) {
  if (!can(user, "tracker")) fail("You do not have permission to edit trackers.");
  const tracker = trackerOrFail(state, action.trackerId);
  tracker.rows.push({
    id: uid("row"),
    cells: Object.fromEntries(tracker.columns.map((column) => [column.id, ""])),
  });
  touch(state);
  return { state };
}

function deleteTrackerRow(state, user, action) {
  if (!can(user, "tracker")) fail("You do not have permission to edit trackers.");
  const tracker = trackerOrFail(state, action.trackerId);
  tracker.rows = tracker.rows.filter((row) => row.id !== action.rowId);
  touch(state);
  return { state };
}

function updateTrackerCell(state, user, action) {
  if (!can(user, "tracker") && !can(user, "task")) {
    const tracker = trackerOrFail(state, action.trackerId);
    const linked = state.tasks.find((task) => task.id === tracker.taskId && task.ownerId === user.id);
    if (!linked) fail("You do not have permission to edit this tracker.");
  }
  const tracker = trackerOrFail(state, action.trackerId);
  const row = tracker.rows.find((item) => item.id === action.rowId);
  if (!row) fail("Row not found");
  const column = tracker.columns.find((item) => item.id === action.columnId);
  if (!column) fail("Column not found");
  row.cells[column.id] = action.value ?? "";
  if (column.id === "configured" || column.name === "Configured") {
    const dateColumn = tracker.columns.find((item) => item.name === "Config Date" || item.id === "configDate");
    if (dateColumn) {
      if (isYes(action.value) && !row.cells[dateColumn.id]) row.cells[dateColumn.id] = todayISO();
      if (!isYes(action.value)) row.cells[dateColumn.id] = "";
    }
  }
  touch(state);
  return { state };
}

function attachTracker(state, user, action) {
  assertCanEditPlan(user);
  const task = findTask(state, action.taskId);
  const tracker = trackerOrFail(state, action.trackerId);
  task.trackerId = tracker.id;
  tracker.taskId = task.id;
  touch(state);
  return { state };
}

function saveIssue(state, user, action) {
  const incoming = action.issue || {};
  if (!incoming.title) fail("A title is required.");
  if (incoming.id) {
    const existing = state.issues.find((issue) => issue.id === incoming.id);
    if (!existing) fail("Issue not found");
    existing.title = incoming.title;
    existing.description = incoming.description || "";
    existing.priority = incoming.priority || "Medium";
    existing.deadline = incoming.deadline || "";
    existing.ownerId = incoming.ownerId || "";
    existing.resolutionDate = incoming.resolutionDate || "";
    existing.status = incoming.status || "Open";
    existing.taskId = incoming.taskId || existing.taskId;
  } else {
    state.issues.unshift({
      id: uid("iss"),
      taskId: incoming.taskId || "",
      title: incoming.title,
      description: incoming.description || "",
      priority: incoming.priority || "Medium",
      deadline: incoming.deadline || "",
      ownerId: incoming.ownerId || user.id,
      resolutionDate: "",
      status: "Open",
      notes: [],
    });
  }
  touch(state);
  return { state };
}

function addIssueNote(state, user, action) {
  const issue = state.issues.find((item) => item.id === action.issueId);
  if (!issue) fail("Issue not found");
  if (!action.text) fail("Write a note.");
  issue.notes.push({ id: uid("n"), date: todayISO(), text: action.text, authorId: user.id });
  touch(state);
  return { state };
}

function saveReport(state, user, action) {
  const name = (action.name || "").trim() || "Untitled report";
  const taskIds = action.taskIds || state.tasks.filter((task) => task.inReport).map((task) => task.id);
  if (action.id) {
    const existing = state.reports.find((report) => report.id === action.id);
    if (!existing) fail("Report not found");
    existing.name = name;
    existing.date = action.date || todayISO();
    existing.taskIds = taskIds;
    existing.customLines = action.customLines || existing.customLines || [];
    existing.saved = true;
  } else {
    state.reports.unshift({
      id: uid("rep"),
      name,
      date: action.date || todayISO(),
      taskIds,
      customLines: action.customLines || [],
      saved: true,
    });
  }
  touch(state);
  return { state };
}

function emailReport(state, user, action) {
  const report = state.reports.find((item) => item.id === action.id);
  if (!report) fail("Save the report before emailing it.");
  const to = (action.to || "").trim();
  if (!to) fail("Enter an email address.");
  state.messages.unshift({
    id: uid("msg"),
    toId: user.id,
    fromId: user.id,
    kind: "report",
    subject: `Report sent: ${report.name}`,
    body: `Emailed "${report.name}" (${report.date}) to ${to}. The same saved report can be sent again later.`,
    at: new Date().toISOString(),
    taskId: "",
  });
  touch(state);
  return { state };
}

function saveUser(state, user, action) {
  if (!can(user, "user")) fail("You do not have permission to edit users.");
  const incoming = action.user || {};
  if (!incoming.firstName || !incoming.lastName || !incoming.email) fail("First name, last name, and email are required.");
  if (incoming.id) {
    const existing = state.users.find((item) => item.id === incoming.id);
    if (!existing) fail("User not found");
    existing.firstName = incoming.firstName;
    existing.lastName = incoming.lastName;
    existing.phone = incoming.phone || "";
    existing.email = incoming.email;
    existing.role = incoming.role || existing.role;
    existing.permission = incoming.permission ?? existing.permission;
    existing.comments = incoming.comments || "";
    if (incoming.password) existing.password = incoming.password;
  } else {
    state.users.push({
      id: uid("u"),
      firstName: incoming.firstName,
      lastName: incoming.lastName,
      phone: incoming.phone || "",
      email: incoming.email,
      role: incoming.role || "Task Owner",
      permission: incoming.permission || "",
      comments: incoming.comments || "",
      password: incoming.password || "demo",
    });
  }
  touch(state);
  return { state };
}

function deleteUser(state, user, action) {
  if (!can(user, "user")) fail("You do not have permission to delete users.");
  if (action.id === user.id) fail("You cannot delete your own account.");
  if (state.tasks.some((task) => task.ownerId === action.id)) {
    fail("Reassign this person's tasks before deleting them.");
  }
  state.users = state.users.filter((item) => item.id !== action.id);
  touch(state);
  return { state };
}

function saveOrg(state, user, action) {
  if (!can(user, "organization")) fail("Only a super admin can edit the organization.");
  const name = (action.name || "").trim();
  if (!name) fail("Name is required.");
  if (action.kind === "wave") {
    if (action.id) {
      const wave = state.org.waves.find((item) => item.id === action.id);
      if (!wave) fail("Wave not found");
      wave.name = name;
    } else {
      state.org.waves.push({ id: uid("w"), name, visns: [] });
    }
  } else if (action.kind === "visn") {
    const wave = state.org.waves.find((item) => item.id === action.parentId);
    if (!wave) fail("Pick a wave for this VISN.");
    if (action.id) {
      const visn = wave.visns.find((item) => item.id === action.id);
      if (!visn) fail("VISN not found");
      visn.name = name;
    } else {
      wave.visns.push({ id: uid("v"), name, sites: [] });
    }
  } else if (action.kind === "site") {
    let host = null;
    for (const wave of state.org.waves) {
      host = wave.visns.find((item) => item.id === action.parentId);
      if (host) break;
    }
    if (!host) fail("Pick a VISN for this site.");
    if (action.id) {
      const site = host.sites.find((item) => item.id === action.id);
      if (!site) fail("Site not found");
      site.name = name;
    } else {
      host.sites.push({ id: uid("s"), name });
    }
  } else {
    fail("Unknown organization level.");
  }
  touch(state);
  return { state };
}

function deleteOrg(state, user, action) {
  if (!can(user, "organization")) fail("Only a super admin can edit the organization.");
  if (action.kind === "site") {
    if (state.tasks.some((task) => task.siteId === action.id)) fail("Tasks still point at this site.");
    for (const wave of state.org.waves) {
      for (const visn of wave.visns) visn.sites = visn.sites.filter((site) => site.id !== action.id);
    }
  } else if (action.kind === "visn") {
    for (const wave of state.org.waves) wave.visns = wave.visns.filter((visn) => visn.id !== action.id);
  } else if (action.kind === "wave") {
    state.org.waves = state.org.waves.filter((wave) => wave.id !== action.id);
  }
  touch(state);
  return { state };
}

function saveProject(state, user, action) {
  if (!can(user, "project")) fail("You do not have permission to edit the project.");
  const incoming = action.project || {};
  if (!incoming.name) fail("Project name is required.");
  state.project = {
    ...state.project,
    name: incoming.name,
    waveId: incoming.waveId || state.project.waveId,
    visnId: incoming.visnId || state.project.visnId,
    siteId: incoming.siteId || state.project.siteId,
    startDate: incoming.startDate || state.project.startDate,
    endDate: incoming.endDate || "",
    siteDetail: incoming.siteDetail || "",
    leadership: incoming.leadership || "",
  };
  touch(state);
  return { state };
}

function recordKey(kind, id) {
  return id ? `${kind}:${id}` : "";
}

function recordTitle(state, kind, id) {
  if (kind === "user") {
    const person = state.users.find((item) => item.id === id);
    return person ? `${person.firstName} ${person.lastName}`.trim() : id;
  }
  if (kind === "task") return state.tasks.find((item) => item.id === id)?.name || id;
  if (kind === "meeting") return state.meetings.find((item) => item.id === id)?.title || id;
  if (kind === "decision") return state.decisions.find((item) => item.id === id)?.title || id;
  if (kind === "issue") return state.issues.find((item) => item.id === id)?.title || id;
  if (kind === "tracker") return state.trackers.find((item) => item.id === id)?.name || id;
  if (kind === "report") return state.reports.find((item) => item.id === id)?.name || id;
  if (kind === "folder") return state.folders.find((item) => item.id === id)?.name || id;
  if (kind === "file") return state.files.find((item) => item.id === id)?.name || id;
  if (kind === "message") return state.messages.find((item) => item.id === id)?.subject || id;
  if (kind === "wave") return state.org.waves.find((item) => item.id === id)?.name || id;
  if (kind === "visn") {
    for (const wave of state.org.waves) {
      const visn = wave.visns.find((item) => item.id === id);
      if (visn) return visn.name;
    }
  }
  if (kind === "site") {
    for (const wave of state.org.waves) {
      for (const visn of wave.visns) {
        const site = visn.sites.find((item) => item.id === id);
        if (site) return site.name;
      }
    }
  }
  return id;
}

function assertRecord(state, kind, id) {
  const known = ["user", "task", "meeting", "decision", "issue", "tracker", "report", "folder", "file", "message", "wave", "visn", "site"];
  if (!known.includes(kind) || !id) fail("Choose a record to delete.");
  if (kind === "user" && !state.users.some((item) => item.id === id)) fail("That person is not in the directory.");
  if (kind === "task" && !state.tasks.some((item) => item.id === id)) fail("That task was not found.");
  if (kind === "meeting" && !state.meetings.some((item) => item.id === id)) fail("That meeting was not found.");
  if (kind === "decision" && !state.decisions.some((item) => item.id === id)) fail("That decision was not found.");
  if (kind === "issue" && !state.issues.some((item) => item.id === id)) fail("That issue was not found.");
  if (kind === "tracker" && !state.trackers.some((item) => item.id === id)) fail("That tracker was not found.");
  if (kind === "report" && !state.reports.some((item) => item.id === id)) fail("That report was not found.");
  if (kind === "folder" && !state.folders.some((item) => item.id === id)) fail("That folder was not found.");
  if (kind === "file" && !state.files.some((item) => item.id === id)) fail("That file was not found.");
  if (kind === "message" && !state.messages.some((item) => item.id === id)) fail("That message was not found.");
  if ((kind === "wave" || kind === "visn" || kind === "site") && recordTitle(state, kind, id) === id && !findOrg(state, kind, id)) {
    fail("That organization record was not found.");
  }
}

function findOrg(state, kind, id) {
  for (const wave of state.org.waves) {
    if (kind === "wave" && wave.id === id) return wave;
    for (const visn of wave.visns) {
      if (kind === "visn" && visn.id === id) return visn;
      if (kind === "site" && visn.sites.some((site) => site.id === id)) return visn.sites.find((site) => site.id === id);
    }
  }
  return null;
}

function orgInUse(state, kind, id) {
  const ids = new Set([id]);
  if (kind === "wave") {
    const wave = state.org.waves.find((item) => item.id === id);
    for (const visn of wave?.visns || []) {
      ids.add(visn.id);
      for (const site of visn.sites) ids.add(site.id);
    }
  } else if (kind === "visn") {
    for (const wave of state.org.waves) {
      const visn = wave.visns.find((item) => item.id === id);
      for (const site of visn?.sites || []) ids.add(site.id);
    }
  }
  const projectUses = ids.has(state.project.waveId) || ids.has(state.project.visnId) || ids.has(state.project.siteId);
  const taskUses = state.tasks.some((task) => ids.has(task.waveId) || ids.has(task.visnId) || ids.has(task.siteId));
  return projectUses || taskUses;
}

function inboundRefs(state) {
  const refs = new Map();
  function add(targetKind, targetId, sourceKind, sourceId) {
    if (!targetId || !sourceId || sourceKind === "user") return;
    const target = recordKey(targetKind, targetId);
    const source = recordKey(sourceKind, sourceId);
    if (target === source) return;
    if (!refs.has(target)) refs.set(target, new Set());
    refs.get(target).add(source);
  }
  for (const task of state.tasks) {
    add("task", task.predecessorId, "task", task.id);
    add("site", task.siteId, "task", task.id);
    add("visn", task.visnId, "task", task.id);
    add("wave", task.waveId, "task", task.id);
    add("tracker", task.trackerId, "task", task.id);
  }
  for (const meeting of state.meetings) add("task", meeting.taskId, "meeting", meeting.id);
  for (const issue of state.issues) add("task", issue.taskId, "issue", issue.id);
  for (const folder of state.folders) add("task", folder.taskId, "folder", folder.id);
  for (const tracker of state.trackers) add("task", tracker.taskId, "tracker", tracker.id);
  for (const report of state.reports) {
    for (const taskId of report.taskIds || []) add("task", taskId, "report", report.id);
  }
  for (const message of state.messages) add("task", message.taskId, "message", message.id);
  add("wave", state.project.waveId, "project", state.project.id || "project");
  add("visn", state.project.visnId, "project", state.project.id || "project");
  add("site", state.project.siteId, "project", state.project.id || "project");
  return refs;
}

function splitKey(key) {
  const splitAt = key.indexOf(":");
  return [key.slice(0, splitAt), key.slice(splitAt + 1)];
}

function containedChildren(state, kind, id) {
  const rows = [];
  if (kind === "task") {
    for (const task of state.tasks) if (task.parentId === id) rows.push(["task", task.id]);
    for (const issue of state.issues) if (issue.taskId === id) rows.push(["issue", issue.id]);
    for (const folder of state.folders) if (folder.taskId === id) rows.push(["folder", folder.id]);
    for (const tracker of state.trackers) if (tracker.taskId === id && !tracker.parentId) rows.push(["tracker", tracker.id]);
  } else if (kind === "meeting") {
    for (const item of state.decisions) if (item.meetingId === id) rows.push(["decision", item.id]);
  } else if (kind === "folder") {
    for (const file of state.files) if (file.folderId === id) rows.push(["file", file.id]);
  } else if (kind === "tracker") {
    for (const tracker of state.trackers) if (tracker.parentId === id) rows.push(["tracker", tracker.id]);
  } else if (kind === "wave") {
    const wave = state.org.waves.find((item) => item.id === id);
    for (const visn of wave?.visns || []) rows.push(["visn", visn.id]);
  } else if (kind === "visn") {
    for (const wave of state.org.waves) {
      const visn = wave.visns.find((item) => item.id === id);
      for (const site of visn?.sites || []) rows.push(["site", site.id]);
    }
  }
  return rows.filter(([childKind]) => childKind !== "user");
}

function collectCascade(state, kind, id) {
  reparent(state.tasks);
  const refs = inboundRefs(state);
  const deleteSet = new Set();
  const parentOf = new Map();
  function walk(childKind, childId, parentKey) {
    const key = recordKey(childKind, childId);
    if (!key || (childKind === "user" && parentKey)) return;
    if (deleteSet.has(key)) return;
    deleteSet.add(key);
    if (parentKey) parentOf.set(key, parentKey);
    for (const [nextKind, nextId] of containedChildren(state, childKind, childId)) walk(nextKind, nextId, key);
  }
  walk(kind, id, null);
  const root = recordKey(kind, id);
  const forced = new Set();
  const rootTask = kind === "task" ? state.tasks.find((task) => task.id === id) : null;
  const workflow = rootTask && !rootTask.parentId && state.tasks.some((task) => task.parentId === id);
  if (workflow) {
    for (const taskId of taskTree(state.tasks, id)) {
      if (taskId !== id) forced.add(recordKey("task", taskId));
    }
  }
  const kept = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of [...deleteSet]) {
      if (key === root || forced.has(key)) continue;
      const outside = [...(refs.get(key) || [])].filter((source) => !deleteSet.has(source));
      if (!outside.length) continue;
      const drop = new Set();
      function mark(node) {
        if (!deleteSet.has(node) || drop.has(node)) return;
        drop.add(node);
        for (const [child, parent] of parentOf) if (parent === node) mark(child);
      }
      mark(key);
      for (const node of drop) deleteSet.delete(node);
      const [keptKind, keptId] = splitKey(key);
      const used = outside.slice(0, 3).map((source) => {
        const [usedKind, usedId] = splitKey(source);
        return `${usedKind} ${recordTitle(state, usedKind, usedId)}`;
      }).join(", ");
      kept.push({
        kind: keptKind,
        id: keptId,
        title: recordTitle(state, keptKind, keptId),
        reason: `Still used by ${used}.`,
      });
      changed = true;
      break;
    }
  }
  return { deleteSet, kept };
}

function applyCascade(state, deleteSet) {
  const gone = (kind, id) => deleteSet.has(recordKey(kind, id));
  state.tasks = state.tasks.filter((task) => !gone("task", task.id));
  for (const task of state.tasks) {
    if (gone("task", task.predecessorId)) task.predecessorId = null;
    if (gone("user", task.ownerId)) task.ownerId = "";
    if (gone("site", task.siteId)) task.siteId = "";
    if (gone("visn", task.visnId)) task.visnId = "";
    if (gone("wave", task.waveId)) task.waveId = "";
    if (gone("tracker", task.trackerId)) task.trackerId = null;
    if (gone("task", task.parentId)) task.level = 0;
  }
  reparent(state.tasks);

  state.meetings = state.meetings.filter((meeting) => !gone("meeting", meeting.id));
  for (const meeting of state.meetings) {
    if (gone("user", meeting.facilitatorId)) meeting.facilitatorId = "";
    if (gone("task", meeting.taskId)) meeting.taskId = "";
    meeting.participantIds = (meeting.participantIds || []).filter((id) => !gone("user", id));
    for (const item of meeting.agenda || []) {
      if (gone("user", item.ownerId)) item.ownerId = "";
      for (const entry of item.actions || []) {
        if (gone("user", entry.ownerId)) entry.ownerId = "";
      }
    }
  }

  state.decisions = state.decisions.filter((item) => !gone("decision", item.id));
  for (const decision of state.decisions) {
    if (gone("meeting", decision.meetingId)) decision.meetingId = "";
  }

  state.issues = state.issues.filter((issue) => !gone("issue", issue.id));
  for (const issue of state.issues) {
    if (gone("task", issue.taskId)) issue.taskId = "";
    if (gone("user", issue.ownerId)) issue.ownerId = "";
    for (const note of issue.notes || []) {
      if (gone("user", note.authorId)) note.authorId = "";
    }
  }

  state.trackers = state.trackers.filter((tracker) => !gone("tracker", tracker.id));
  for (const tracker of state.trackers) {
    if (gone("task", tracker.taskId)) tracker.taskId = null;
    if (gone("tracker", tracker.parentId)) tracker.parentId = null;
    for (const column of tracker.columns || []) {
      if (gone("tracker", column.childTrackerId)) {
        delete column.childTrackerId;
        delete column.childColumnId;
      }
    }
    for (const row of tracker.rows || []) {
      if (gone("tracker", row.childTrackerId)) delete row.childTrackerId;
    }
  }

  state.reports = (state.reports || []).filter((report) => !gone("report", report.id));
  for (const report of state.reports) {
    report.taskIds = (report.taskIds || []).filter((id) => !gone("task", id));
  }

  state.folders = state.folders.filter((folder) => !gone("folder", folder.id));
  for (const folder of state.folders) {
    if (gone("task", folder.taskId)) folder.taskId = "";
  }
  state.files = state.files.filter((file) => !gone("file", file.id) && state.folders.some((folder) => folder.id === file.folderId));

  state.messages = state.messages.filter((message) => !gone("message", message.id));
  for (const message of state.messages) {
    if (gone("user", message.fromId)) message.fromId = "";
    if (gone("user", message.toId)) message.toId = "";
    if (gone("task", message.taskId)) message.taskId = "";
  }
  state.messages = state.messages.filter((message) => message.fromId || message.toId || message.taskId);

  state.users = state.users.filter((person) => !gone("user", person.id));
  state.views = (state.views || []).filter((view) => !gone("user", view.userId));
  for (const view of state.views) {
    const filters = view.filters || {};
    if (filters.owners) filters.owners = filters.owners.filter((id) => !gone("user", id));
    if (filters.waves) filters.waves = filters.waves.filter((id) => !gone("wave", id));
    if (filters.visns) filters.visns = filters.visns.filter((id) => !gone("visn", id));
    if (filters.sites) filters.sites = filters.sites.filter((id) => !gone("site", id));
  }
  for (const person of [...deleteSet].filter((item) => item.startsWith("user:"))) {
    delete state.prefs?.[person.slice(5)];
  }

  state.org.waves = state.org.waves.filter((wave) => !gone("wave", wave.id));
  for (const wave of state.org.waves) {
    wave.visns = wave.visns.filter((visn) => !gone("visn", visn.id));
    for (const visn of wave.visns) visn.sites = visn.sites.filter((site) => !gone("site", site.id));
  }
  if (gone("wave", state.project.waveId)) state.project.waveId = state.org.waves[0]?.id || "";
  if (gone("visn", state.project.visnId)) state.project.visnId = state.org.waves[0]?.visns[0]?.id || "";
  if (gone("site", state.project.siteId)) state.project.siteId = state.org.waves[0]?.visns[0]?.sites[0]?.id || "";
}

function purgeRecord(state, user, action) {
  if (!can(user, "organization")) fail("Only a super admin can delete records from Admin.");
  const kind = action.kind;
  const id = action.id;
  assertRecord(state, kind, id);
  if (kind === "user" && id === user.id) fail("You cannot delete your own account.");
  if ((kind === "wave" || kind === "visn" || kind === "site") && orgInUse(state, kind, id)) {
    fail("That organization record is still used by the project or a task, so it was not deleted.");
  }
  const outcome = cascadeDelete(state, kind, id);
  touch(state);
  return { state, ...outcome };
}

export function cascadeDelete(state, kind, id) {
  const { deleteSet, kept } = collectCascade(state, kind, id);
  const deleted = [...deleteSet].map((item) => {
    const [itemKind, itemId] = splitKey(item);
    return { kind: itemKind, id: itemId, title: recordTitle(state, itemKind, itemId) };
  });
  applyCascade(state, deleteSet);
  return { deleted, kept };
}

function requestUpdate(state, user, action) {
  const task = findTask(state, action.taskId);
  if (!task.ownerId) fail("This task has no owner to contact.");
  const owner = state.users.find((item) => item.id === task.ownerId);
  state.messages.unshift({
    id: uid("msg"),
    toId: task.ownerId,
    fromId: user.id,
    kind: "update",
    subject: `Update requested: ${task.name}`,
    body: action.note || `${nameOf(state.users, user.id)} asked for an update on ${task.name}.`,
    at: new Date().toISOString(),
    taskId: task.id,
  });
  touch(state);
  return { state, ownerEmail: owner?.email || "" };
}

export function getDb() {
  return db;
}

export function userByEmail(email) {
  return db.users.find((item) => item.email.toLowerCase() === String(email || "").toLowerCase());
}

export function userById(id) {
  return db.users.find((item) => item.id === id);
}
