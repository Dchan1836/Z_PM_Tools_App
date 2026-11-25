const ORDER = ["organization", "project", "tracker", "task", "user"];

export function can(user, permission) {
  if (!user?.permission) return false;
  const have = ORDER.indexOf(user.permission);
  const need = ORDER.indexOf(permission);
  if (have < 0 || need < 0) return false;
  return have <= need;
}

export function fmt(value) {
  if (!value) return "";
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtStamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fmt(value);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function statusClass(status) {
  if (status === "Complete") return "st-complete";
  if (status === "Late") return "st-late";
  if (status === "Due Today") return "st-today";
  if (status === "Due in 1 day") return "st-d1";
  if (status === "Due in 2 days" || status === "Due in 3 days") return "st-d2";
  if (status === "Due in 4 days" || status === "Due in 5 days" || status === "Due in 6 days") return "st-d4";
  if (status === "Due in 1 week") return "st-week";
  if (status === "In Progress") return "st-progress";
  if (status === "Unassigned") return "st-unassigned";
  if (status === "Committed") return "st-committed";
  if (String(status || "").includes("Missing")) return "st-missing";
  return "";
}

export function assignmentClass(status) {
  if (status === "accepted") return "as-accepted";
  if (status === "pending") return "as-pending";
  if (status === "proposed") return "as-proposed";
  if (status === "rejected") return "as-rejected";
  return "";
}

export function personName(user) {
  if (!user) return "";
  return `${user.firstName} ${user.lastName}`;
}

export const PERMISSION_LADDER = [
  { id: "organization", label: "Add / Edit project organization" },
  { id: "project", label: "Add / Edit project" },
  { id: "tracker", label: "Add / Edit tracker" },
  { id: "task", label: "Add / Edit / Delete task and task details" },
  { id: "user", label: "Add / Edit / Delete user" },
];

export function sitesOf(org) {
  const list = [];
  for (const wave of org?.waves || []) {
    for (const visn of wave.visns) {
      for (const site of visn.sites) {
        list.push({ ...site, visnId: visn.id, visnName: visn.name, waveId: wave.id, waveName: wave.name });
      }
    }
  }
  return list;
}

export function visnsOf(org) {
  const list = [];
  for (const wave of org?.waves || []) {
    for (const visn of wave.visns) list.push({ ...visn, waveId: wave.id, waveName: wave.name });
  }
  return list;
}
