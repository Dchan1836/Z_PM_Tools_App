import pg from "pg";

const { Pool } = pg;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL DEFAULT 0,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  permission TEXT NOT NULL DEFAULT '',
  comments TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS waves (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS visns (
  id TEXT PRIMARY KEY,
  wave_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  visn_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  wave_id TEXT NOT NULL DEFAULT '',
  visn_id TEXT NOT NULL DEFAULT '',
  site_id TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  site_detail TEXT NOT NULL DEFAULT '',
  leadership TEXT NOT NULL DEFAULT '',
  revised_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT,
  pillar TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  specialty TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL DEFAULT '',
  wave_id TEXT NOT NULL DEFAULT '',
  visn_id TEXT NOT NULL DEFAULT '',
  site_id TEXT NOT NULL DEFAULT '',
  planned_start TEXT NOT NULL DEFAULT '',
  actual_start TEXT NOT NULL DEFAULT '',
  planned_end TEXT NOT NULL DEFAULT '',
  actual_end TEXT NOT NULL DEFAULT '',
  percent_complete INTEGER,
  tracker_id TEXT,
  predecessor_id TEXT,
  assignment_status TEXT,
  negotiable BOOLEAN NOT NULL DEFAULT FALSE,
  proposed_start TEXT NOT NULL DEFAULT '',
  proposed_end TEXT NOT NULL DEFAULT '',
  proposal_comment TEXT NOT NULL DEFAULT '',
  in_report BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS views (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS view_filters (
  view_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  position INTEGER NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (view_id, kind, position)
);
CREATE TABLE IF NOT EXISTS pref_panels (
  user_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,
  panel_id TEXT NOT NULL,
  PRIMARY KEY (user_id, position)
);
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  time TEXT NOT NULL DEFAULT '',
  facilitator_id TEXT NOT NULL DEFAULT '',
  task_id TEXT NOT NULL DEFAULT '',
  is_template BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  owner_email TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS meeting_participants (
  meeting_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (meeting_id, position)
);
CREATE TABLE IF NOT EXISTS agenda_items (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL DEFAULT '',
  time TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_decision BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS action_items (
  id TEXT PRIMARY KEY,
  agenda_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  action TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL DEFAULT '',
  due TEXT NOT NULL DEFAULT '',
  actual_end TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  owner_email TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  meeting_id TEXT NOT NULL DEFAULT '',
  agenda_id TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL DEFAULT '',
  modified TEXT NOT NULL DEFAULT '',
  task_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  folder_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL DEFAULT '',
  modified TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS trackers (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '',
  parent_id TEXT,
  task_id TEXT
);
CREATE TABLE IF NOT EXISTS tracker_columns (
  tracker_id TEXT NOT NULL,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  data_type TEXT NOT NULL DEFAULT '',
  required BOOLEAN NOT NULL DEFAULT FALSE,
  milestone INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  child_tracker_id TEXT NOT NULL DEFAULT '',
  child_column_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tracker_id, id)
);
CREATE TABLE IF NOT EXISTS tracker_rows (
  tracker_id TEXT NOT NULL,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  child_tracker_id TEXT,
  PRIMARY KEY (tracker_id, id)
);
CREATE TABLE IF NOT EXISTS tracker_cells (
  tracker_id TEXT NOT NULL,
  row_id TEXT NOT NULL,
  column_id TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tracker_id, row_id, column_id)
);
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  task_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT '',
  deadline TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL DEFAULT '',
  resolution_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS issue_notes (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  date TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  saved BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS report_tasks (
  report_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  PRIMARY KEY (report_id, position)
);
CREATE TABLE IF NOT EXISTS report_lines (
  report_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  line TEXT NOT NULL,
  PRIMARY KEY (report_id, position)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  to_id TEXT NOT NULL DEFAULT '',
  from_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL DEFAULT '',
  task_id TEXT NOT NULL DEFAULT ''
);
`;

const TABLES = [
  "tracker_cells",
  "tracker_rows",
  "tracker_columns",
  "trackers",
  "action_items",
  "agenda_items",
  "meeting_participants",
  "meetings",
  "decisions",
  "issue_notes",
  "issues",
  "report_lines",
  "report_tasks",
  "reports",
  "messages",
  "task_comments",
  "tasks",
  "view_filters",
  "views",
  "pref_panels",
  "files",
  "folders",
  "sites",
  "visns",
  "waves",
  "users",
  "project",
];

function text(value) {
  return value == null ? "" : String(value);
}

function parseNameList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((name) => String(name || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function nullable(value) {
  return value == null || value === "" ? null : value;
}

async function rows(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows;
}

function grouped(list, key) {
  const map = new Map();
  for (const row of list) {
    const id = row[key];
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
}

export function openDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    const error = new Error("Set DATABASE_URL to a Postgres connection string.");
    error.expose = true;
    throw error;
  }
  return new Pool({ connectionString });
}

export async function ensureSchema(pool) {
  await pool.query(SCHEMA);
  await pool.query("ALTER TABLE meetings ADD COLUMN IF NOT EXISTS guest_names TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS owner_name TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE action_items ADD COLUMN IF NOT EXISTS owner_name TEXT NOT NULL DEFAULT ''");
}

export async function hasData(pool) {
  const result = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  return result.rows[0].count > 0;
}

export async function saveDocument(pool, doc) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const table of TABLES) await client.query(`DELETE FROM ${table}`);

    for (let index = 0; index < (doc.users || []).length; index += 1) {
      const user = doc.users[index];
      await client.query(
        `INSERT INTO users (id, position, first_name, last_name, phone, email, role, permission, comments, password)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [user.id, index, text(user.firstName), text(user.lastName), text(user.phone), text(user.email), text(user.role), text(user.permission), text(user.comments), text(user.password)],
      );
    }

    for (let waveIndex = 0; waveIndex < (doc.org?.waves || []).length; waveIndex += 1) {
      const wave = doc.org.waves[waveIndex];
      await client.query("INSERT INTO waves (id, name, position) VALUES ($1,$2,$3)", [wave.id, text(wave.name), waveIndex]);
      for (let visnIndex = 0; visnIndex < (wave.visns || []).length; visnIndex += 1) {
        const visn = wave.visns[visnIndex];
        await client.query("INSERT INTO visns (id, wave_id, name, position) VALUES ($1,$2,$3,$4)", [visn.id, wave.id, text(visn.name), visnIndex]);
        for (let siteIndex = 0; siteIndex < (visn.sites || []).length; siteIndex += 1) {
          const site = visn.sites[siteIndex];
          await client.query("INSERT INTO sites (id, visn_id, name, position) VALUES ($1,$2,$3,$4)", [site.id, visn.id, text(site.name), siteIndex]);
        }
      }
    }

    const project = doc.project || {};
    await client.query(
      `INSERT INTO project (id, name, wave_id, visn_id, site_id, start_date, end_date, site_detail, leadership, revised_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [project.id || "prj-1", text(project.name), text(project.waveId), text(project.visnId), text(project.siteId), text(project.startDate), text(project.endDate), text(project.siteDetail), text(project.leadership), text(project.revisedAt)],
    );

    for (let index = 0; index < (doc.tasks || []).length; index += 1) {
      const task = doc.tasks[index];
      await client.query(
        `INSERT INTO tasks (
          id, position, level, parent_id, pillar, area, specialty, name, owner_id, wave_id, visn_id, site_id,
          planned_start, actual_start, planned_end, actual_end, percent_complete, tracker_id, predecessor_id,
          assignment_status, negotiable, proposed_start, proposed_end, proposal_comment, in_report
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
        )`,
        [
          task.id, index, task.level || 0, nullable(task.parentId), text(task.pillar), text(task.area), text(task.specialty), text(task.name), text(task.ownerId), text(task.waveId), text(task.visnId), text(task.siteId),
          text(task.plannedStart), text(task.actualStart), text(task.plannedEnd), text(task.actualEnd), task.percentComplete == null ? null : task.percentComplete, nullable(task.trackerId), nullable(task.predecessorId),
          task.assignmentStatus == null ? null : task.assignmentStatus, Boolean(task.negotiable), text(task.proposedStart), text(task.proposedEnd), text(task.proposalComment), Boolean(task.inReport),
        ],
      );
      for (let commentIndex = 0; commentIndex < (task.comments || []).length; commentIndex += 1) {
        const comment = task.comments[commentIndex];
        await client.query(
          "INSERT INTO task_comments (id, task_id, position, at, author_id, text) VALUES ($1,$2,$3,$4,$5,$6)",
          [comment.id, task.id, commentIndex, text(comment.at), text(comment.authorId), text(comment.text)],
        );
      }
    }

    for (let index = 0; index < (doc.views || []).length; index += 1) {
      const view = doc.views[index];
      await client.query("INSERT INTO views (id, user_id, name, position) VALUES ($1,$2,$3,$4)", [view.id, text(view.userId), text(view.name), index]);
      const filters = view.filters || {};
      for (const kind of Object.keys(filters)) {
        for (let valueIndex = 0; valueIndex < (filters[kind] || []).length; valueIndex += 1) {
          await client.query("INSERT INTO view_filters (view_id, kind, position, value) VALUES ($1,$2,$3,$4)", [view.id, kind, valueIndex, String(filters[kind][valueIndex])]);
        }
      }
    }

    const prefs = doc.prefs || {};
    for (const userId of Object.keys(prefs)) {
      const panels = prefs[userId]?.panels || [];
      for (let index = 0; index < panels.length; index += 1) {
        await client.query("INSERT INTO pref_panels (user_id, position, kind, panel_id) VALUES ($1,$2,$3,$4)", [userId, index, text(panels[index].kind), text(panels[index].id)]);
      }
    }

    for (let index = 0; index < (doc.meetings || []).length; index += 1) {
      const meeting = doc.meetings[index];
      await client.query(
        `INSERT INTO meetings (id, position, title, date, time, facilitator_id, task_id, is_template, source, file_name, owner_email, guest_names)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [meeting.id, index, text(meeting.title), text(meeting.date), text(meeting.time), text(meeting.facilitatorId), text(meeting.taskId), Boolean(meeting.isTemplate), text(meeting.source), text(meeting.fileName), text(meeting.ownerEmail), JSON.stringify(meeting.guestNames || [])],
      );
      for (let participantIndex = 0; participantIndex < (meeting.participantIds || []).length; participantIndex += 1) {
        await client.query("INSERT INTO meeting_participants (meeting_id, position, user_id) VALUES ($1,$2,$3)", [meeting.id, participantIndex, meeting.participantIds[participantIndex]]);
      }
      for (let itemIndex = 0; itemIndex < (meeting.agenda || []).length; itemIndex += 1) {
        const item = meeting.agenda[itemIndex];
        await client.query(
          `INSERT INTO agenda_items (id, meeting_id, position, topic, owner_id, owner_name, time, notes, is_decision)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [item.id, meeting.id, itemIndex, text(item.topic), text(item.ownerId), text(item.ownerName), text(item.time), text(item.notes), Boolean(item.isDecision)],
        );
        for (let actionIndex = 0; actionIndex < (item.actions || []).length; actionIndex += 1) {
          const entry = item.actions[actionIndex];
          await client.query(
            "INSERT INTO action_items (id, agenda_id, position, action, owner_id, owner_name, due, actual_end) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            [entry.id, item.id, actionIndex, text(entry.action), text(entry.ownerId), text(entry.ownerName), text(entry.due), text(entry.actualEnd)],
          );
        }
      }
    }

    for (let index = 0; index < (doc.decisions || []).length; index += 1) {
      const decision = doc.decisions[index];
      await client.query(
        `INSERT INTO decisions (id, position, title, date, owner_email, source, file_name, meeting_id, agenda_id, text)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [decision.id, index, text(decision.title), text(decision.date), text(decision.ownerEmail), text(decision.source), text(decision.fileName), text(decision.meetingId), text(decision.agendaId), text(decision.text)],
      );
    }

    for (let index = 0; index < (doc.folders || []).length; index += 1) {
      const folder = doc.folders[index];
      await client.query("INSERT INTO folders (id, position, name, created, modified, task_id) VALUES ($1,$2,$3,$4,$5,$6)", [folder.id, index, text(folder.name), text(folder.created), text(folder.modified), text(folder.taskId)]);
    }
    for (let index = 0; index < (doc.files || []).length; index += 1) {
      const file = doc.files[index];
      await client.query("INSERT INTO files (id, position, folder_id, name, created, modified) VALUES ($1,$2,$3,$4,$5,$6)", [file.id, index, text(file.folderId), text(file.name), text(file.created), text(file.modified)]);
    }

    for (let index = 0; index < (doc.trackers || []).length; index += 1) {
      const tracker = doc.trackers[index];
      await client.query("INSERT INTO trackers (id, position, name, kind, parent_id, task_id) VALUES ($1,$2,$3,$4,$5,$6)", [tracker.id, index, text(tracker.name), text(tracker.kind), nullable(tracker.parentId), nullable(tracker.taskId)]);
      for (let columnIndex = 0; columnIndex < (tracker.columns || []).length; columnIndex += 1) {
        const column = tracker.columns[columnIndex];
        await client.query(
          `INSERT INTO tracker_columns (tracker_id, id, position, name, data_type, required, milestone, sort_order, child_tracker_id, child_column_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [tracker.id, column.id, columnIndex, text(column.name), text(column.dataType), Boolean(column.required), column.milestone || 0, column.order || 0, text(column.childTrackerId), text(column.childColumnId)],
        );
      }
      for (let rowIndex = 0; rowIndex < (tracker.rows || []).length; rowIndex += 1) {
        const row = tracker.rows[rowIndex];
        await client.query("INSERT INTO tracker_rows (tracker_id, id, position, child_tracker_id) VALUES ($1,$2,$3,$4)", [tracker.id, row.id, rowIndex, nullable(row.childTrackerId)]);
        const cells = row.cells || {};
        for (const columnId of Object.keys(cells)) {
          await client.query("INSERT INTO tracker_cells (tracker_id, row_id, column_id, value) VALUES ($1,$2,$3,$4)", [tracker.id, row.id, columnId, text(cells[columnId])]);
        }
      }
    }

    for (let index = 0; index < (doc.issues || []).length; index += 1) {
      const issue = doc.issues[index];
      await client.query(
        `INSERT INTO issues (id, position, task_id, title, description, priority, deadline, owner_id, resolution_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [issue.id, index, text(issue.taskId), text(issue.title), text(issue.description), text(issue.priority), text(issue.deadline), text(issue.ownerId), text(issue.resolutionDate), text(issue.status)],
      );
      for (let noteIndex = 0; noteIndex < (issue.notes || []).length; noteIndex += 1) {
        const note = issue.notes[noteIndex];
        await client.query("INSERT INTO issue_notes (id, issue_id, position, date, text, author_id) VALUES ($1,$2,$3,$4,$5,$6)", [note.id, issue.id, noteIndex, text(note.date), text(note.text), text(note.authorId)]);
      }
    }

    for (let index = 0; index < (doc.reports || []).length; index += 1) {
      const report = doc.reports[index];
      await client.query("INSERT INTO reports (id, position, name, date, saved) VALUES ($1,$2,$3,$4,$5)", [report.id, index, text(report.name), text(report.date), Boolean(report.saved)]);
      for (let taskIndex = 0; taskIndex < (report.taskIds || []).length; taskIndex += 1) {
        await client.query("INSERT INTO report_tasks (report_id, position, task_id) VALUES ($1,$2,$3)", [report.id, taskIndex, report.taskIds[taskIndex]]);
      }
      for (let lineIndex = 0; lineIndex < (report.customLines || []).length; lineIndex += 1) {
        await client.query("INSERT INTO report_lines (report_id, position, line) VALUES ($1,$2,$3)", [report.id, lineIndex, String(report.customLines[lineIndex])]);
      }
    }

    for (let index = 0; index < (doc.messages || []).length; index += 1) {
      const message = doc.messages[index];
      await client.query(
        `INSERT INTO messages (id, position, to_id, from_id, kind, subject, body, sent_at, task_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [message.id, index, text(message.toId), text(message.fromId), text(message.kind), text(message.subject), text(message.body), text(message.at), text(message.taskId)],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function loadDocument(pool) {
  if (!(await hasData(pool))) return null;
  const client = await pool.connect();
  try {
    const users = (await rows(client, "SELECT * FROM users ORDER BY position")).map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: row.phone,
      email: row.email,
      role: row.role,
      permission: row.permission,
      comments: row.comments,
      password: row.password,
    }));

    const sitesByVisn = grouped(await rows(client, "SELECT * FROM sites ORDER BY position"), "visn_id");
    const visnsByWave = grouped(await rows(client, "SELECT * FROM visns ORDER BY position"), "wave_id");
    const waves = (await rows(client, "SELECT * FROM waves ORDER BY position")).map((wave) => ({
      id: wave.id,
      name: wave.name,
      visns: (visnsByWave.get(wave.id) || []).map((visn) => ({
        id: visn.id,
        name: visn.name,
        sites: (sitesByVisn.get(visn.id) || []).map((site) => ({ id: site.id, name: site.name })),
      })),
    }));

    const projectRow = (await rows(client, "SELECT * FROM project LIMIT 1"))[0];
    const project = {
      id: projectRow.id,
      name: projectRow.name,
      waveId: projectRow.wave_id,
      visnId: projectRow.visn_id,
      siteId: projectRow.site_id,
      startDate: projectRow.start_date,
      endDate: projectRow.end_date,
      siteDetail: projectRow.site_detail,
      leadership: projectRow.leadership,
      revisedAt: projectRow.revised_at,
    };

    const commentsByTask = grouped(await rows(client, "SELECT * FROM task_comments ORDER BY position"), "task_id");
    const tasks = (await rows(client, "SELECT * FROM tasks ORDER BY position")).map((row) => ({
      level: row.level,
      waveId: row.wave_id,
      visnId: row.visn_id,
      siteId: row.site_id,
      area: row.area,
      specialty: row.specialty,
      actualStart: row.actual_start,
      actualEnd: row.actual_end,
      percentComplete: row.percent_complete,
      trackerId: row.tracker_id,
      predecessorId: row.predecessor_id,
      assignmentStatus: row.assignment_status,
      negotiable: Boolean(row.negotiable),
      proposedStart: row.proposed_start,
      proposedEnd: row.proposed_end,
      proposalComment: row.proposal_comment,
      inReport: Boolean(row.in_report),
      comments: (commentsByTask.get(row.id) || []).map((comment) => ({
        id: comment.id,
        at: comment.at,
        authorId: comment.author_id,
        text: comment.text,
      })),
      id: row.id,
      pillar: row.pillar,
      name: row.name,
      ownerId: row.owner_id,
      plannedStart: row.planned_start,
      plannedEnd: row.planned_end,
      parentId: row.parent_id,
    }));

    const filtersByView = grouped(await rows(client, "SELECT * FROM view_filters ORDER BY position"), "view_id");
    const views = (await rows(client, "SELECT * FROM views ORDER BY position")).map((view) => {
      const buckets = { waves: [], visns: [], sites: [], areas: [], specialties: [], owners: [] };
      for (const filter of filtersByView.get(view.id) || []) {
        if (!buckets[filter.kind]) buckets[filter.kind] = [];
        buckets[filter.kind].push(filter.value);
      }
      return { id: view.id, userId: view.user_id, name: view.name, filters: buckets };
    });

    const prefs = {};
    for (const panel of await rows(client, "SELECT * FROM pref_panels ORDER BY position")) {
      if (!prefs[panel.user_id]) prefs[panel.user_id] = { panels: [] };
      prefs[panel.user_id].panels.push({ kind: panel.kind, id: panel.panel_id });
    }

    const participants = grouped(await rows(client, "SELECT * FROM meeting_participants ORDER BY position"), "meeting_id");
    const actions = grouped(await rows(client, "SELECT * FROM action_items ORDER BY position"), "agenda_id");
    const agenda = grouped(await rows(client, "SELECT * FROM agenda_items ORDER BY position"), "meeting_id");
    const meetings = (await rows(client, "SELECT * FROM meetings ORDER BY position")).map((meeting) => ({
      id: meeting.id,
      title: meeting.title,
      date: meeting.date,
      time: meeting.time,
      facilitatorId: meeting.facilitator_id,
      participantIds: (participants.get(meeting.id) || []).map((person) => person.user_id).filter(Boolean),
      guestNames: parseNameList(meeting.guest_names),
      taskId: meeting.task_id,
      isTemplate: Boolean(meeting.is_template),
      source: meeting.source,
      fileName: meeting.file_name,
      ownerEmail: meeting.owner_email,
      agenda: (agenda.get(meeting.id) || []).map((item) => ({
        id: item.id,
        topic: item.topic,
        ownerId: item.owner_id,
        ownerName: item.owner_name || "",
        time: item.time,
        notes: item.notes,
        isDecision: Boolean(item.is_decision),
        actions: (actions.get(item.id) || []).map((entry) => ({
          id: entry.id,
          action: entry.action,
          ownerId: entry.owner_id,
          ownerName: entry.owner_name || "",
          due: entry.due,
          actualEnd: entry.actual_end,
        })),
      })),
    }));

    const decisions = (await rows(client, "SELECT * FROM decisions ORDER BY position")).map((row) => ({
      id: row.id,
      title: row.title,
      date: row.date,
      ownerEmail: row.owner_email,
      source: row.source,
      fileName: row.file_name,
      meetingId: row.meeting_id,
      agendaId: row.agenda_id,
      text: row.text,
    }));

    const folders = (await rows(client, "SELECT * FROM folders ORDER BY position")).map((row) => ({
      id: row.id,
      name: row.name,
      created: row.created,
      modified: row.modified,
      taskId: row.task_id,
    }));
    const files = (await rows(client, "SELECT * FROM files ORDER BY position")).map((row) => ({
      id: row.id,
      folderId: row.folder_id,
      name: row.name,
      created: row.created,
      modified: row.modified,
    }));

    const columns = grouped(await rows(client, "SELECT * FROM tracker_columns ORDER BY position"), "tracker_id");
    const trackerRows = grouped(await rows(client, "SELECT * FROM tracker_rows ORDER BY position"), "tracker_id");
    const cells = await rows(client, "SELECT * FROM tracker_cells");
    const cellsByRow = new Map();
    for (const cell of cells) {
      const key = `${cell.tracker_id}:${cell.row_id}`;
      if (!cellsByRow.has(key)) cellsByRow.set(key, {});
      cellsByRow.get(key)[cell.column_id] = cell.value;
    }
    const trackers = (await rows(client, "SELECT * FROM trackers ORDER BY position")).map((tracker) => ({
      id: tracker.id,
      name: tracker.name,
      kind: tracker.kind,
      parentId: tracker.parent_id,
      taskId: tracker.task_id,
      columns: (columns.get(tracker.id) || []).map((column) => ({
        id: column.id,
        name: column.name,
        dataType: column.data_type,
        required: Boolean(column.required),
        milestone: column.milestone,
        order: column.sort_order,
        ...(column.child_tracker_id || column.child_column_id
          ? { childTrackerId: column.child_tracker_id, childColumnId: column.child_column_id }
          : {}),
      })),
      rows: (trackerRows.get(tracker.id) || []).map((row) => ({
        id: row.id,
        ...(row.child_tracker_id ? { childTrackerId: row.child_tracker_id } : {}),
        cells: cellsByRow.get(`${tracker.id}:${row.id}`) || {},
      })),
    }));

    const notes = grouped(await rows(client, "SELECT * FROM issue_notes ORDER BY position"), "issue_id");
    const issues = (await rows(client, "SELECT * FROM issues ORDER BY position")).map((issue) => ({
      id: issue.id,
      taskId: issue.task_id,
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      deadline: issue.deadline,
      ownerId: issue.owner_id,
      resolutionDate: issue.resolution_date,
      status: issue.status,
      notes: (notes.get(issue.id) || []).map((note) => ({
        id: note.id,
        date: note.date,
        text: note.text,
        authorId: note.author_id,
      })),
    }));

    const reportTasks = grouped(await rows(client, "SELECT * FROM report_tasks ORDER BY position"), "report_id");
    const reportLines = grouped(await rows(client, "SELECT * FROM report_lines ORDER BY position"), "report_id");
    const reports = (await rows(client, "SELECT * FROM reports ORDER BY position")).map((report) => ({
      id: report.id,
      name: report.name,
      date: report.date,
      taskIds: (reportTasks.get(report.id) || []).map((item) => item.task_id),
      customLines: (reportLines.get(report.id) || []).map((item) => item.line),
      saved: Boolean(report.saved),
    }));

    const messages = (await rows(client, "SELECT * FROM messages ORDER BY position")).map((message) => ({
      id: message.id,
      toId: message.to_id,
      fromId: message.from_id,
      kind: message.kind,
      subject: message.subject,
      body: message.body,
      at: message.sent_at,
      taskId: message.task_id,
    }));

    return { users, org: { waves }, project, tasks, views, prefs, meetings, decisions, folders, files, trackers, issues, reports, messages };
  } finally {
    client.release();
  }
}
