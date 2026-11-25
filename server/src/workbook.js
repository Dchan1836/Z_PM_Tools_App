import ExcelJS from "exceljs";
import { present } from "./store.js";

const NAVY = "FF1F4E79";
const NAVY_SOFT = "FF305496";
const PAPER = "FFF4F7FB";
const INK = "FF1D2433";
const WHITE = "FFFFFFFF";
const LINE = { style: "thin", color: { argb: "FFD5DEEA" } };
const LEAD_PERMISSIONS = new Set(["organization", "project", "tracker", "user"]);
const PERMISSION_LABELS = {
  organization: "Add / Edit project organization",
  project: "Add / Edit project",
  tracker: "Add / Edit tracker",
  task: "Add / Edit / Delete task and task details",
  user: "Add / Edit / Delete user",
};

const STATUS_COLORS = {
  complete: ["FFC6EFCE", "FF006100"],
  late: ["FFFFC7CE", "FF9C0006"],
  today: ["FFF8CBAD", "FF833C0C"],
  soon: ["FFFFE699", "FF7A5B00"],
  progress: ["FFDDEBF7", "FF1F4E79"],
  missing: ["FFF8D0D8", "FF9C0006"],
  open: ["FFFFF2CC", "FF7A5B00"],
};

function personName(users, id) {
  const person = users.find((item) => item.id === id);
  return person ? `${person.firstName} ${person.lastName}`.trim() : "";
}

function dateValue(value) {
  const text = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const [year, month, day] = text.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function statusTone(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return "";
  if (text.includes("complete") || text === "resolved" || text === "closed" || text === "yes") return "complete";
  if (text.includes("late")) return "late";
  if (text.includes("today")) return "today";
  if (text.startsWith("due in")) return "soon";
  if (text.includes("missing")) return "missing";
  if (text === "open" || text === "mitigating" || text === "monitoring") return "open";
  if (text.includes("progress") || text === "committed" || text === "unassigned" || text === "risk") return "progress";
  return "";
}

function sheetTitle(name, used) {
  const cleaned = String(name || "Sheet").replace(/[\\/*?:[\]]/g, " ").replace(/\s+/g, " ").trim() || "Sheet";
  const clipped = cleaned.length <= 31 ? cleaned : cleaned.slice(0, 31).replace(/\s+\S*$/, "");
  let base = clipped.length >= 8 ? clipped : cleaned.slice(0, 31);
  let candidate = base;
  let count = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` ${count}`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    count += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function paintSheet(sheet, columns) {
  sheet.properties.defaultRowHeight = 18;
  sheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 1,
    horizontalCentered: true,
  };
  sheet.headerFooter.oddHeader = `&L${sheet.name}&R Z PM Tool`;
  sheet.headerFooter.oddFooter = "&LConfidential project data&RPage &P of &N";
  sheet.pageSetup.printTitlesRow = "1:1";

  const width = columns.length;
  const height = Math.max(sheet.rowCount, 1);
  const header = sheet.getRow(1);
  header.height = 24;
  for (let column = 1; column <= width; column += 1) {
    const cell = header.getCell(column);
    cell.font = { name: "Calibri", bold: true, color: { argb: WHITE }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.border = { top: LINE, left: LINE, bottom: LINE, right: LINE };
  }
  if (height > 1) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: height, column: width } };
  }

  for (let rowIndex = 2; rowIndex <= height; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    row.height = 20;
    for (let column = 1; column <= width; column += 1) {
      const cell = row.getCell(column);
      const spec = columns[column - 1];
      cell.font = { name: "Calibri", size: 11, color: { argb: INK } };
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = { top: LINE, left: LINE, bottom: LINE, right: LINE };
      if (rowIndex % 2 === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PAPER } };
      }
      if (spec?.date && cell.value instanceof Date) cell.numFmt = "yyyy-mm-dd";
      if (spec?.percent && typeof cell.value === "number") cell.numFmt = "0";
      const tone = spec?.status ? statusTone(cell.value) : "";
      if (tone && STATUS_COLORS[tone]) {
        const [fill, font] = STATUS_COLORS[tone];
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: font } };
      }
    }
  }

  columns.forEach((column, index) => {
    let longest = column.header.length;
    sheet.eachRow((row, rowIndex) => {
      if (rowIndex === 1) return;
      const value = row.getCell(index + 1).value;
      const text = value instanceof Date ? "yyyy-mm-dd" : String(value ?? "");
      longest = Math.max(longest, Math.min(text.length, 48));
    });
    sheet.getColumn(index + 1).width = column.width || Math.min(46, Math.max(14, longest + 3));
  });
}

function addTable(workbook, used, catalog, name, description, columns, records) {
  const title = sheetTitle(name, used);
  const sheet = workbook.addWorksheet(title, { properties: { tabColor: { argb: NAVY_SOFT } } });
  sheet.columns = columns.map((column) => ({ header: column.header, key: column.key }));
  records.forEach((record) => sheet.addRow(record));
  paintSheet(sheet, columns);
  catalog.push({ name: title, description, rows: records.length });
  return sheet;
}

function joinNames(list) {
  return (list || []).filter(Boolean).join(", ");
}

function commentText(comments) {
  return (comments || []).map((comment) => comment.text).filter(Boolean).join("\n");
}

export async function buildWorkbook(db, user) {
  const state = structuredClone(db);
  const view = present(state, user);
  const users = view.users;
  const taskName = new Map(view.tasks.map((task) => [task.id, task.name]));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Z PM Tool";
  workbook.created = new Date();
  workbook.title = view.project.name || "Z PM Tool";
  const used = new Set();
  const catalog = [];
  const contents = workbook.addWorksheet(sheetTitle("Contents", used), {
    properties: { tabColor: { argb: "FF0B3A75" } },
    views: [{ showGridLines: false }],
  });

  const waveName = new Map((view.org.waves || []).map((wave) => [wave.id, wave.name]));
  const visnName = new Map();
  const siteName = new Map();
  for (const wave of view.org.waves || []) {
    for (const visn of wave.visns || []) {
      visnName.set(visn.id, visn.name);
      for (const site of visn.sites || []) siteName.set(site.id, site.name);
    }
  }

  addTable(workbook, used, catalog, "People", "Leads and employees in the directory", [
    { header: "Type", key: "type", width: 14 },
    { header: "Last name", key: "lastName", width: 18 },
    { header: "First name", key: "firstName", width: 18 },
    { header: "Role", key: "role", width: 22 },
    { header: "Permission", key: "permission", width: 42 },
    { header: "Email", key: "email", width: 32 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Comments", key: "comments", width: 36 },
  ], users.map((person) => ({
    type: LEAD_PERMISSIONS.has(person.permission) ? "Lead" : "Employee",
    lastName: person.lastName,
    firstName: person.firstName,
    role: person.role,
    permission: PERMISSION_LABELS[person.permission] || "None",
    email: person.email,
    phone: person.phone,
    comments: person.comments,
  })));

  const orgRows = [];
  for (const wave of view.org.waves || []) {
    for (const visn of wave.visns || []) {
      for (const site of visn.sites || []) {
        orgRows.push({ wave: wave.name, visn: visn.name, site: site.name });
      }
      if (!visn.sites?.length) orgRows.push({ wave: wave.name, visn: visn.name, site: "" });
    }
  }
  addTable(workbook, used, catalog, "Organization", "Waves, VISNs, and sites", [
    { header: "Wave", key: "wave", width: 18 },
    { header: "VISN", key: "visn", width: 18 },
    { header: "Site", key: "site", width: 28 },
  ], orgRows);

  addTable(workbook, used, catalog, "Tasks", "The master plan, including status and dates", [
    { header: "Window", key: "window", width: 22 },
    { header: "Pillar", key: "pillar", width: 36 },
    { header: "Area", key: "area", width: 22 },
    { header: "Specialty", key: "specialty", width: 20 },
    { header: "Level", key: "level", width: 12 },
    { header: "Task", key: "name", width: 42 },
    { header: "Owner", key: "owner", width: 22 },
    { header: "Wave", key: "wave", width: 14 },
    { header: "VISN", key: "visn", width: 14 },
    { header: "Site", key: "site", width: 20 },
    { header: "Planned start", key: "plannedStart", date: true },
    { header: "Actual start", key: "actualStart", date: true },
    { header: "Planned end", key: "plannedEnd", date: true },
    { header: "Actual end", key: "actualEnd", date: true },
    { header: "Status", key: "status", status: true, width: 28 },
    { header: "Percent", key: "percent", percent: true, width: 12 },
    { header: "Predecessor", key: "predecessor", width: 32 },
    { header: "Late start", key: "lateStart", status: true, width: 16 },
    { header: "In report", key: "inReport", width: 12 },
    { header: "Comments", key: "comments", width: 42 },
  ], view.tasks.map((task) => ({
    window: task.window,
    pillar: task.pillar,
    area: task.area,
    specialty: task.specialty,
    level: task.level || 0,
    name: task.name,
    owner: task.ownerName,
    wave: task.waveName,
    visn: task.visnName,
    site: task.siteName,
    plannedStart: dateValue(task.plannedStart),
    actualStart: dateValue(task.actualStart),
    plannedEnd: dateValue(task.plannedEnd),
    actualEnd: dateValue(task.actualEnd),
    status: task.status,
    percent: task.percent == null ? "" : Number(task.percent),
    predecessor: task.predecessorName,
    lateStart: task.lateStart,
    inReport: task.inReport ? "Yes" : "",
    comments: commentText(task.comments),
  })));

  addTable(workbook, used, catalog, "Meetings", "Meetings, facilitators, and participants", [
    { header: "Date", key: "date", date: true },
    { header: "Time", key: "time", width: 18 },
    { header: "Title", key: "title", width: 40 },
    { header: "Facilitator", key: "facilitator", width: 22 },
    { header: "Participants", key: "participants", width: 46 },
    { header: "Task", key: "task", width: 32 },
    { header: "Template", key: "template", width: 12 },
  ], view.meetings.map((meeting) => ({
    date: dateValue(meeting.date),
    time: meeting.time,
    title: meeting.title,
    facilitator: meeting.facilitatorName,
    participants: joinNames(meeting.participantNames),
    task: taskName.get(meeting.taskId) || "",
    template: meeting.isTemplate ? "Yes" : "",
  })));

  const agenda = [];
  const actions = [];
  for (const meeting of view.meetings) {
    for (const item of meeting.agenda || []) {
      agenda.push({
        meeting: meeting.title,
        date: dateValue(meeting.date),
        topic: item.topic,
        owner: item.ownerName,
        time: item.time,
        decision: item.isDecision ? "Decision" : "",
        notes: item.notes,
      });
      for (const action of item.actions || []) {
        actions.push({
          meeting: meeting.title,
          topic: item.topic,
          action: action.action,
          owner: action.ownerName,
          due: dateValue(action.due),
          completed: dateValue(action.actualEnd),
          status: action.status,
        });
      }
    }
  }
  addTable(workbook, used, catalog, "Agenda", "Topics and notes from each meeting", [
    { header: "Meeting", key: "meeting", width: 36 },
    { header: "Date", key: "date", date: true },
    { header: "Topic", key: "topic", width: 32 },
    { header: "Owner", key: "owner", width: 22 },
    { header: "Time", key: "time", width: 14 },
    { header: "Decision", key: "decision", status: true, width: 14 },
    { header: "Notes", key: "notes", width: 54 },
  ], agenda);
  addTable(workbook, used, catalog, "Action items", "Follow-ups recorded in meetings", [
    { header: "Meeting", key: "meeting", width: 36 },
    { header: "Topic", key: "topic", width: 32 },
    { header: "Action", key: "action", width: 46 },
    { header: "Owner", key: "owner", width: 22 },
    { header: "Due", key: "due", date: true },
    { header: "Completed", key: "completed", date: true },
    { header: "Status", key: "status", status: true, width: 16 },
  ], actions);

  addTable(workbook, used, catalog, "Decisions", "Key decisions", [
    { header: "Date", key: "date", date: true },
    { header: "Title", key: "title", width: 36 },
    { header: "Owner", key: "owner", width: 28 },
    { header: "Source", key: "source", width: 16 },
    { header: "Meeting", key: "meeting", width: 36 },
    { header: "Decision", key: "text", width: 54 },
  ], view.decisions.map((decision) => ({
    date: dateValue(decision.date),
    title: decision.title,
    owner: decision.ownerEmail,
    source: decision.source,
    meeting: view.meetings.find((meeting) => meeting.id === decision.meetingId)?.title || "",
    text: decision.text,
  })));

  addTable(workbook, used, catalog, "Issues", "Risks and issues", [
    { header: "Title", key: "title", width: 36 },
    { header: "Task", key: "task", width: 32 },
    { header: "Type", key: "type", status: true, width: 12 },
    { header: "Priority", key: "priority", width: 12 },
    { header: "Deadline", key: "deadline", date: true },
    { header: "Owner", key: "owner", width: 22 },
    { header: "Status", key: "status", status: true, width: 16 },
    { header: "Resolution date", key: "resolution", date: true },
    { header: "Description", key: "description", width: 46 },
  ], view.issues.map((issue) => ({
    title: issue.title,
    task: issue.taskName,
    type: issue.flag,
    priority: issue.priority,
    deadline: dateValue(issue.deadline),
    owner: issue.ownerName,
    status: issue.status,
    resolution: dateValue(issue.resolutionDate),
    description: issue.description,
  })));

  const notes = [];
  for (const issue of view.issues) {
    for (const note of issue.notes || []) {
      notes.push({
        issue: issue.title,
        date: dateValue(note.date),
        author: personName(users, note.authorId),
        text: note.text,
      });
    }
  }
  addTable(workbook, used, catalog, "Issue notes", "Notes written on risks and issues", [
    { header: "Issue", key: "issue", width: 36 },
    { header: "Date", key: "date", date: true },
    { header: "Author", key: "author", width: 22 },
    { header: "Note", key: "text", width: 54 },
  ], notes);

  addTable(workbook, used, catalog, "Trackers", "Tracker list and the task each one drives", [
    { header: "Tracker", key: "name", width: 36 },
    { header: "Kind", key: "kind", width: 14 },
    { header: "Parent", key: "parent", width: 32 },
    { header: "Task", key: "task", width: 32 },
    { header: "Percent", key: "percent", percent: true, width: 12 },
    { header: "Columns", key: "columns", width: 46 },
  ], view.trackers.map((tracker) => ({
    name: tracker.name,
    kind: tracker.kind,
    parent: view.trackers.find((item) => item.id === tracker.parentId)?.name || "",
    task: taskName.get(tracker.taskId) || "",
    percent: tracker.percent == null ? "" : Number(tracker.percent),
    columns: (tracker.columns || []).map((column) => column.name).join(", "),
  })));

  for (const tracker of view.trackers) {
    const columns = [
      ...(tracker.columns || []).map((column) => ({ header: column.name, key: column.id, width: 22 })),
      { header: "Row %", key: "rowPercent", percent: true, width: 12 },
    ];
    const records = (tracker.rows || []).map((row) => {
      const record = {};
      for (const column of tracker.columns || []) {
        const rollup = row.rollups?.[column.id];
        record[column.id] = rollup?.text || row.cells?.[column.id] || "";
      }
      record.rowPercent = row.rowPercent == null ? "" : Math.round(row.rowPercent * 100);
      return record;
    });
    addTable(workbook, used, catalog, tracker.name, `Rows for ${tracker.name}`, columns, records);
  }

  addTable(workbook, used, catalog, "Reports", "Saved reports and the tasks they include", [
    { header: "Report", key: "name", width: 36 },
    { header: "Date", key: "date", date: true },
    { header: "Saved", key: "saved", width: 12 },
    { header: "Tasks", key: "tasks", width: 54 },
  ], (view.reports || []).map((report) => ({
    name: report.name,
    date: dateValue(report.date),
    saved: report.saved ? "Yes" : "",
    tasks: (report.taskIds || []).map((id) => taskName.get(id) || id).join(", "),
  })));

  const folderName = new Map(view.folders.map((folder) => [folder.id, folder.name]));
  addTable(workbook, used, catalog, "Folders", "Document folders", [
    { header: "Folder", key: "name", width: 32 },
    { header: "Created", key: "created", date: true },
    { header: "Modified", key: "modified", date: true },
    { header: "Task", key: "task", width: 32 },
  ], view.folders.map((folder) => ({
    name: folder.name,
    created: dateValue(folder.created),
    modified: dateValue(folder.modified),
    task: taskName.get(folder.taskId) || "",
  })));
  addTable(workbook, used, catalog, "Files", "Files stored in folders", [
    { header: "Folder", key: "folder", width: 28 },
    { header: "File", key: "name", width: 36 },
    { header: "Created", key: "created", date: true },
    { header: "Modified", key: "modified", date: true },
  ], view.files.map((file) => ({
    folder: folderName.get(file.folderId) || "",
    name: file.name,
    created: dateValue(file.created),
    modified: dateValue(file.modified),
  })));

  addTable(workbook, used, catalog, "Messages", "Messages between people", [
    { header: "Sent", key: "sent", width: 22 },
    { header: "From", key: "from", width: 22 },
    { header: "To", key: "to", width: 22 },
    { header: "Kind", key: "kind", width: 14 },
    { header: "Subject", key: "subject", width: 36 },
    { header: "Task", key: "task", width: 32 },
    { header: "Message", key: "body", width: 54 },
  ], (state.messages || []).map((message) => ({
    sent: message.at ? String(message.at).replace("T", " ").slice(0, 16) : "",
    from: personName(users, message.fromId),
    to: personName(users, message.toId),
    kind: message.kind,
    subject: message.subject,
    task: taskName.get(message.taskId) || "",
    body: message.body,
  })));

  contents.mergeCells("A1:C1");
  contents.getCell("A1").value = "Z PM Tool";
  contents.getCell("A1").font = { name: "Calibri", size: 24, bold: true, color: { argb: WHITE } };
  contents.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  contents.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
  contents.getRow(1).height = 36;
  contents.mergeCells("A2:C2");
  contents.getCell("A2").value = view.project.name || "Project";
  contents.getCell("A2").font = { name: "Calibri", size: 16, bold: true, color: { argb: NAVY } };
  contents.getRow(2).height = 24;
  contents.mergeCells("A3:C3");
  contents.getCell("A3").value = `Exported ${new Date().toLocaleString()} by ${personName(users, user.id)}`;
  contents.getCell("A3").font = { name: "Calibri", size: 11, color: { argb: "FF5C677A" } };

  const details = [
    ["Wave", waveName.get(view.project.waveId) || ""],
    ["VISN", visnName.get(view.project.visnId) || ""],
    ["Site", siteName.get(view.project.siteId) || ""],
    ["Start", view.project.startDate || ""],
    ["End", view.project.endDate || ""],
    ["Leadership", view.project.leadership || ""],
    ["Site detail", view.project.siteDetail || ""],
  ];
  details.forEach(([label, value], index) => {
    const row = contents.getRow(5 + index);
    row.getCell(1).value = label;
    row.getCell(1).font = { name: "Calibri", bold: true, color: { argb: NAVY } };
    row.getCell(2).value = value;
    row.getCell(2).font = { name: "Calibri", color: { argb: INK } };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PAPER } };
  });

  const tableStart = 14;
  ["Sheet", "What it contains", "Rows"].forEach((header, index) => {
    const cell = contents.getRow(tableStart).getCell(index + 1);
    cell.value = header;
    cell.font = { name: "Calibri", bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { vertical: "middle" };
  });
  contents.getRow(tableStart).height = 22;
  catalog.forEach((entry, index) => {
    const row = contents.getRow(tableStart + 1 + index);
    row.getCell(1).value = entry.name;
    row.getCell(2).value = entry.description;
    row.getCell(3).value = entry.rows;
    row.getCell(3).alignment = { horizontal: "right" };
    [1, 2, 3].forEach((column) => {
      const cell = row.getCell(column);
      cell.font = { name: "Calibri", size: 11, color: { argb: INK } };
      cell.border = { top: LINE, left: LINE, bottom: LINE, right: LINE };
      if (index % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PAPER } };
    });
  });
  contents.getColumn(1).width = 36;
  contents.getColumn(2).width = 62;
  contents.getColumn(3).width = 12;
  contents.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 1 };

  return workbook.xlsx.writeBuffer();
}
