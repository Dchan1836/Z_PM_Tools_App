/** Date and status rules taken from the Master Project formulas. */

export const PERMISSIONS = ["organization", "project", "tracker", "task", "user"];

export function todayISO(now = new Date()) {
  const z = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${z(now.getMonth() + 1)}-${z(now.getDate())}`;
}

export function parseISO(value) {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function fmtDate(value) {
  const date = parseISO(value);
  if (!date) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function daysBetween(from, to) {
  const a = parseISO(from);
  const b = parseISO(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function addDays(value, days) {
  const date = parseISO(value);
  if (!date) return "";
  date.setDate(date.getDate() + days);
  return todayISO(date);
}

export function durationDays(task) {
  if (!task.plannedStart || !task.plannedEnd) return 0;
  return Math.max(0, daysBetween(task.plannedStart, task.plannedEnd));
}

/**
 * Mirrors the Master Project status formula, then fills the labels the
 * storyboard types onto future work: Unassigned, Committed, In Progress.
 */
export function taskStatus(task, today = todayISO()) {
  if (!task.name || !String(task.name).trim()) return "";
  if (!task.plannedStart) return "Planned Start Date Missing";
  if (!task.plannedEnd) return "Planned End Date Missing";
  if (task.plannedStart < today && !task.actualStart) return "Actual Start Date Missing";
  if (!task.actualEnd) {
    const diff = daysBetween(today, task.plannedEnd);
    if (diff === 7) return "Due in 1 week";
    if (diff === 6) return "Due in 6 days";
    if (diff === 5) return "Due in 5 days";
    if (diff === 4) return "Due in 4 days";
    if (diff === 3) return "Due in 3 days";
    if (diff === 2) return "Due in 2 days";
    if (diff === 1) return "Due in 1 day";
    if (diff === 0) return "Due Today";
    if (diff < 0) return "Late";
  }
  if (task.actualEnd) return "Complete";
  if (!task.ownerId) return "Unassigned";
  if (task.plannedStart <= today) return "In Progress";
  return "Committed";
}

/** 30/60/90 bucket from the planned start, blank when the planned end is blank. */
export function taskWindow(task, today = todayISO()) {
  if (!task.plannedEnd || !task.plannedStart) return "";
  if (task.plannedStart < today) return "Before today";
  const diff = daysBetween(today, task.plannedStart);
  if (diff <= 30) return "Next 30 days";
  if (diff <= 60) return "From 30 to 60 days";
  if (diff <= 90) return "From 60 to 90 days";
  return "Beyond 90 days";
}

export function lateStart(task) {
  if (task.actualStart && task.plannedStart && task.actualStart > task.plannedStart) {
    return "Late Start";
  }
  return "";
}

export function dashboardBucket(status) {
  if (status === "Complete") return "Complete";
  if (status === "Late") return "Late";
  return "In Progress";
}

export function actionItemState(item, today = todayISO()) {
  if (item.actualEnd) return { status: "Complete", tone: "green" };
  if (item.due && item.due < today) return { status: "Late", tone: "red" };
  return { status: item.status && item.status !== "Late" && item.status !== "Complete" ? item.status : "Open", tone: "open" };
}

/**
 * Deadline passed with no resolution date => Issue (red).
 * Within 7 days => Risk (yellow). Resolved => green.
 */
export function issueState(issue, today = todayISO()) {
  const resolved = Boolean(issue.resolutionDate) || issue.status === "Resolved" || issue.status === "Closed";
  if (resolved) return { flag: "Risk", tone: "green" };
  if (issue.deadline && issue.deadline < today) return { flag: "Issue", tone: "red" };
  if (issue.deadline) {
    const diff = daysBetween(today, issue.deadline);
    if (diff >= 0 && diff <= 7) return { flag: "Risk", tone: "yellow" };
  }
  return { flag: "Risk", tone: "open" };
}

export function permissionRank(permission) {
  const index = PERMISSIONS.indexOf(permission);
  return index === -1 ? 99 : index;
}

export function can(user, permission) {
  if (!user) return false;
  return permissionRank(user.permission) <= permissionRank(permission);
}

export function isYes(value) {
  const v = String(value || "").trim().toLowerCase();
  return v === "yes" || v === "complete" || v === "true" || v === "done";
}

export function milestoneColumns(tracker) {
  return (tracker.columns || [])
    .filter((column) => column.milestone)
    .sort((a, b) => a.milestone - b.milestone || a.order - b.order);
}

/** Fraction of rows complete for one milestone column, e.g. 2/5. */
export function columnFraction(tracker, columnId) {
  const rows = tracker.rows || [];
  if (!rows.length) return { done: 0, total: 0, text: "0/0", ratio: 0 };
  const done = rows.filter((row) => isYes(row.cells?.[columnId])).length;
  return {
    done,
    total: rows.length,
    text: `${done}/${rows.length}`,
    ratio: done / rows.length,
  };
}

export function trackerPercents(tracker, allTrackers = []) {
  const milestones = milestoneColumns(tracker);
  const byColumn = {};
  for (const column of milestones) {
    if (column.dataType === "rollup") {
      const child = allTrackers.find((item) => item.id === column.childTrackerId);
      byColumn[column.id] = child
        ? columnFraction(child, column.childColumnId)
        : { done: 0, total: 0, text: "—", ratio: 0 };
    } else {
      byColumn[column.id] = columnFraction(tracker, column.id);
    }
  }
  const driving = milestones[milestones.length - 1];
  const percent = driving ? Math.round((byColumn[driving.id]?.ratio || 0) * 100) : null;
  return { byColumn, percent, driving };
}

export function publicUser(user) {
  if (!user) return null;
  const { password, ...rest } = user;
  return rest;
}
