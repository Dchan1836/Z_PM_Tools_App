import { useMemo, useState } from "react";
import { autoLogoutEnabled, downloadWorkbook, quietAuthError, saveBackup, setAutoLogout } from "../api.js";
import { can, PERMISSION_LADDER, sitesOf, visnsOf } from "../format.js";
import { useProject, useRestore, useRun } from "../store/hooks.js";
import { Modal, Panel, Sheet, SortButton, useSort } from "../components/ui.jsx";
import GraphAnalytics from "./GraphAnalytics.jsx";
import GraphMap from "./GraphMap.jsx";

const RECORD_KINDS = [
  ["all", "All records"],
  ["user", "People"],
  ["task", "Tasks"],
  ["meeting", "Meetings"],
  ["decision", "Decisions"],
  ["issue", "Issues"],
  ["tracker", "Trackers"],
  ["report", "Reports"],
  ["folder", "Folders"],
  ["file", "Files"],
  ["message", "Messages"],
  ["wave", "Waves"],
  ["visn", "VISNs"],
  ["site", "Sites"],
];

const LEAD_PERMISSIONS = new Set(["organization", "project", "tracker", "user"]);

function textOf(value) {
  if (value == null || typeof value === "boolean") return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(" ");
  if (typeof value === "object") return Object.values(value).map(textOf).filter(Boolean).join(" ");
  return "";
}

function catalog(state) {
  const rows = [];
  const push = (kind, id, type, title, detail, source) => {
    rows.push({
      kind,
      id,
      type,
      title: title || id,
      detail,
      record: source,
      haystack: `${type} ${title || ""} ${detail} ${textOf(source)}`.toLowerCase(),
    });
  };
  for (const user of state.users) {
    const type = LEAD_PERMISSIONS.has(user.permission) ? "Lead" : "Employee";
    push("user", user.id, type, `${user.firstName} ${user.lastName}`.trim(), [user.role, user.email, user.phone].filter(Boolean).join(" · "), user);
  }
  for (const task of state.tasks) {
    push("task", task.id, task.level > 0 ? "Subtask" : "Task", task.name, [task.pillar, task.ownerName, task.status, task.siteName].filter(Boolean).join(" · "), task);
  }
  for (const meeting of state.meetings) {
    push("meeting", meeting.id, "Meeting", meeting.title, [meeting.date, meeting.facilitatorName].filter(Boolean).join(" · "), meeting);
  }
  for (const decision of state.decisions) {
    push("decision", decision.id, "Decision", decision.title, [decision.date, decision.text].filter(Boolean).join(" · "), decision);
  }
  for (const issue of state.issues) {
    push("issue", issue.id, "Issue", issue.title, [issue.status, issue.taskName, issue.ownerName].filter(Boolean).join(" · "), issue);
  }
  for (const tracker of state.trackers) {
    push("tracker", tracker.id, "Tracker", tracker.name, tracker.kind || "", tracker);
  }
  for (const report of state.reports || []) {
    push("report", report.id, "Report", report.name, report.date || "", report);
  }
  for (const folder of state.folders) push("folder", folder.id, "Folder", folder.name, "", folder);
  for (const file of state.files) push("file", file.id, "File", file.name, "", file);
  for (const message of state.messages) push("message", message.id, "Message", message.subject, message.body || "", message);
  for (const wave of state.org.waves) {
    push("wave", wave.id, "Wave", wave.name, "", wave);
    for (const visn of wave.visns) {
      push("visn", visn.id, "VISN", visn.name, `Wave ${wave.name}`, visn);
      for (const site of visn.sites) push("site", site.id, "Site", site.name, `VISN ${visn.name}`, site);
    }
  }
  return rows;
}

export default function Admin() {
  const state = useProject();
  const run = useRun();
  const onReset = useRestore();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [backupNote, setBackupNote] = useState("");
  const [autoLogout, setAutoLogoutOn] = useState(autoLogoutEnabled);

  async function saveDatabase() {
    setSaving(true);
    setBackupNote("");
    setDownloadError("");
    try {
      const result = await saveBackup();
      const size = result.bytes > 1024 * 1024
        ? `${(result.bytes / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(1, Math.round(result.bytes / 1024))} KB`;
      setBackupNote(`Saved ${result.filename} (${size}) to ${result.path}`);
    } catch (error) {
      if (!quietAuthError(error)) setDownloadError(error.message || "The database backup could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function download() {
    setDownloading(true);
    setDownloadError("");
    try {
      await downloadWorkbook();
    } catch (error) {
      if (!quietAuthError(error)) setDownloadError(error.message || "The workbook could not be downloaded.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="stack">
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <p>Organization sits at the top of the permission ladder. A person who can edit the organization can also edit projects, trackers, tasks, and users.</p>
        </div>
        {can(state.me, "organization") ? (
          <div className="toolbar">
            <button className="btn navy" disabled={saving} onClick={saveDatabase}>{saving ? "Saving backup…" : "Save database backup"}</button>
            <button className="btn navy" disabled={downloading} onClick={download}>{downloading ? "Preparing workbook…" : "Download Excel"}</button>
            <button className="btn ghost" onClick={() => { const next = !autoLogout; setAutoLogout(next); setAutoLogoutOn(next); }}>
              {autoLogout ? "Turn off auto logout" : "Turn on auto logout"}
            </button>
            <button className="btn ghost" onClick={onReset}>Restore sample data</button>
          </div>
        ) : null}
      </div>
      {autoLogout ? null : <p className="muted">Auto logout is off. A dead session stays on this page, and the action reports that you need to sign in again.</p>}
      {downloadError ? <div className="banner error">{downloadError}</div> : null}
      {backupNote ? <div className="banner ok">{backupNote}</div> : null}
      {can(state.me, "organization") ? <RecordFinder state={state} run={run} /> : null}
      <GraphAnalytics />
      <GraphMap />
      {can(state.me, "organization") ? <OrgEditor state={state} run={run} /> : null}
      {can(state.me, "user") ? <UserEditor state={state} run={run} /> : null}
      {can(state.me, "project") ? <ProjectEditor state={state} run={run} /> : null}
    </section>
  );
}

function fieldLabel(key) {
  const words = key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function recordFields(value, label = "") {
  if (Array.isArray(value)) {
    if (!value.length) return [{ label, value: "None" }];
    return value.flatMap((item, index) => recordFields(item, `${label} ${index + 1}`.trim()));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => {
      if (key === "password") return [];
      const next = label ? `${label} · ${fieldLabel(key)}` : fieldLabel(key);
      return recordFields(item, next);
    });
  }
  if (typeof value === "boolean") return [{ label, value: value ? "Yes" : "No" }];
  if (value == null || value === "") return [{ label, value: "—" }];
  return [{ label, value: String(value) }];
}

function RecordFinder({ state, run }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [pending, setPending] = useState(null);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [inspect, setInspect] = useState(null);
  const rows = useMemo(() => catalog(state), [state]);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = rows.filter((row) => {
    if (kind !== "all" && row.kind !== kind) return false;
    return terms.every((term) => row.haystack.includes(term));
  });
  const { sort, toggle, ordered } = useSort("type");
  const shown = ordered(matches, (row, key) => {
    if (key === "type") return row.type;
    if (key === "name") return row.title;
    if (key === "detail") return row.detail;
    return "";
  }).slice(0, 80);

  async function remove() {
    if (!pending) return;
    setBusy(true);
    const result = await run({ type: "purgeRecord", kind: pending.kind, id: pending.id });
    setBusy(false);
    if (!result?.state) return;
    setSummary({
      title: pending.title,
      deleted: result.deleted || [],
      kept: result.kept || [],
    });
    setPending(null);
  }

  return (
    <Panel title="Search data">
      <p className="muted">Search any field and click a record to see everything stored on it. Deleting a record also removes records that nothing else uses. A related record that is still used stays. Employees and leads are never removed by that cascade.</p>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <input className="search" value={query} placeholder="Search name, owner, notes, status…" onChange={(event) => setQuery(event.target.value)} />
        <label className="field">Record type
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            {RECORD_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
      </div>
      <p className="muted">{matches.length} match{matches.length === 1 ? "" : "es"}{matches.length > shown.length ? `, showing ${shown.length}` : ""}</p>
      <div className="sheet-wrap">
        <Sheet>
          <thead>
            <tr>
              <th><SortButton label="Type" column="type" sort={sort} onSort={toggle} /></th>
              <th><SortButton label="Name" column="name" sort={sort} onSort={toggle} /></th>
              <th><SortButton label="Details" column="detail" sort={sort} onSort={toggle} /></th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={`${row.kind}:${row.id}`} className="clickable" onClick={() => setInspect(row)}>
                <td>{row.type}</td>
                <td><button type="button" className="linkish" onClick={() => setInspect(row)}>{row.title}</button></td>
                <td>{row.detail}</td>
                <td className="actions">
                  <button type="button" className="btn small danger" disabled={row.kind === "user" && row.id === state.me?.id} onClick={(event) => { event.stopPropagation(); setPending(row); setSummary(null); }}>Delete</button>
                </td>
              </tr>
            ))}
            {!shown.length ? <tr><td colSpan={4}>No records match that search.</td></tr> : null}
          </tbody>
        </Sheet>
      </div>
      {inspect ? (
        <Modal title={inspect.title} onClose={() => setInspect(null)} wide>
          <p className="muted">{inspect.type}</p>
          <dl className="record-detail">
            {recordFields(inspect.record).map((field, index) => (
              <div key={`${field.label}-${index}`}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        </Modal>
      ) : null}
      {pending ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <strong>Delete {pending.type.toLowerCase()} “{pending.title}”?</strong>
          <p className="muted">
            {pending.kind === "user"
              ? "This removes only this person. Tasks, meetings, and other records stay, and no other employee or lead is removed."
              : "Records that nothing else uses are removed with it. If something else still uses a related record, that record stays. Employees and leads stay either way."}
          </p>
          <div className="toolbar">
            <button className="btn danger" disabled={busy} onClick={remove}>{busy ? "Deleting…" : "Delete"}</button>
            <button className="btn ghost" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
      {summary ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <strong>Deleted {summary.deleted.length} record{summary.deleted.length === 1 ? "" : "s"} for “{summary.title}”.</strong>
          <p>{summary.deleted.map((item) => `${item.kind}: ${item.title}`).join(", ")}</p>
          {summary.kept.length ? (
            <p>Kept {summary.kept.map((item) => `${item.title} (${item.reason})`).join(" ")}</p>
          ) : <p className="muted">Nothing else had to be kept.</p>}
        </div>
      ) : null}
    </Panel>
  );
}

function OrgEditor({ state, run }) {
  const [waveName, setWaveName] = useState("");
  const [visnName, setVisnName] = useState("");
  const [visnWave, setVisnWave] = useState(state.org.waves[0]?.id || "");
  const [siteName, setSiteName] = useState("");
  const [siteVisn, setSiteVisn] = useState(visnsOf(state.org)[0]?.id || "");
  return (
    <Panel title="Project organization">
      <p className="muted">Waves contain VISNs. VISNs contain sites.</p>
      <div className="tree" style={{ marginTop: 8 }}>
        {state.org.waves.map((wave) => (
          <details key={wave.id} open>
            <summary>Wave {wave.name}</summary>
            {wave.visns.map((visn) => (
              <details key={visn.id} open>
                <summary>VISN {visn.name}</summary>
                {visn.sites.map((site) => <div key={site.id} style={{ marginLeft: 16 }}>{site.name}</div>)}
              </details>
            ))}
          </details>
        ))}
      </div>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <label className="field">New wave
          <input value={waveName} onChange={(event) => setWaveName(event.target.value)} />
        </label>
        <button className="btn" onClick={() => run({ type: "saveOrg", kind: "wave", name: waveName })}>Add wave</button>
        <label className="field">New VISN in
          <select value={visnWave} onChange={(event) => setVisnWave(event.target.value)}>
            {state.org.waves.map((wave) => <option key={wave.id} value={wave.id}>Wave {wave.name}</option>)}
          </select>
        </label>
        <label className="field">VISN name<input value={visnName} onChange={(event) => setVisnName(event.target.value)} /></label>
        <button className="btn" onClick={() => run({ type: "saveOrg", kind: "visn", parentId: visnWave, name: visnName })}>Add VISN</button>
        <label className="field">New site in
          <select value={siteVisn} onChange={(event) => setSiteVisn(event.target.value)}>
            {visnsOf(state.org).map((visn) => <option key={visn.id} value={visn.id}>VISN {visn.name}</option>)}
          </select>
        </label>
        <label className="field">Site name<input value={siteName} onChange={(event) => setSiteName(event.target.value)} /></label>
        <button className="btn" onClick={() => run({ type: "saveOrg", kind: "site", parentId: siteVisn, name: siteName })}>Add site</button>
      </div>
    </Panel>
  );
}

function UserEditor({ state, run }) {
  const [draft, setDraft] = useState(null);
  const { sort, toggle, ordered } = useSort("lastName");
  const users = ordered(state.users, (user, key) => {
    if (key === "lastName") return user.lastName;
    if (key === "firstName") return user.firstName;
    if (key === "phone") return user.phone;
    if (key === "email") return user.email;
    if (key === "role") return user.role;
    if (key === "permission") return PERMISSION_LADDER.find((item) => item.id === user.permission)?.label || "None";
    return "";
  });
  return (
    <Panel
      title="Users"
      actions={<button className="btn" onClick={() => setDraft({ firstName: "", lastName: "", phone: "", email: "", role: "Task Owner", permission: "", comments: "" })}>Add user</button>}
    >
      <div className="sheet-wrap" style={{ marginTop: 8 }}>
        <Sheet>
          <thead>
            <tr>
              <th><SortButton label="Last name" column="lastName" sort={sort} onSort={toggle} /></th>
              <th><SortButton label="First name" column="firstName" sort={sort} onSort={toggle} /></th>
              <th><SortButton label="Phone" column="phone" sort={sort} onSort={toggle} /></th>
              <th><SortButton label="Email" column="email" sort={sort} onSort={toggle} /></th>
              <th><SortButton label="Role" column="role" sort={sort} onSort={toggle} /></th>
              <th><SortButton label="Permission" column="permission" sort={sort} onSort={toggle} /></th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.lastName}</td>
                <td>{user.firstName}</td>
                <td>{user.phone}</td>
                <td>{user.email}</td>
                <td>{user.role}</td>
                <td>{PERMISSION_LADDER.find((item) => item.id === user.permission)?.label || "None"}</td>
                <td className="actions">
                  <button className="btn small ghost" onClick={() => setDraft(user)}>Edit</button>
                  <button className="btn small danger" onClick={() => run({ type: "deleteUser", id: user.id })}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </Sheet>
      </div>
      {draft ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="form-grid">
            <label className="field">Last name<input value={draft.lastName} onChange={(event) => setDraft({ ...draft, lastName: event.target.value })} /></label>
            <label className="field">First name<input value={draft.firstName} onChange={(event) => setDraft({ ...draft, firstName: event.target.value })} /></label>
            <label className="field">Phone<input value={draft.phone || ""} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
            <label className="field">Email<input value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>
            <label className="field">Role<input value={draft.role || ""} onChange={(event) => setDraft({ ...draft, role: event.target.value })} /></label>
            <label className="field">Comments<input value={draft.comments || ""} onChange={(event) => setDraft({ ...draft, comments: event.target.value })} /></label>
          </div>
          <div className="ladder">
            {PERMISSION_LADDER.map((item, index) => {
              const rank = PERMISSION_LADDER.findIndex((entry) => entry.id === draft.permission);
              const checked = rank >= 0 && rank <= index;
              return (
                <label key={item.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setDraft({ ...draft, permission: draft.permission === item.id ? "" : item.id })}
                  />
                  {item.label}
                  {checked && draft.permission !== item.id ? <span className="muted">included</span> : null}
                </label>
              );
            })}
          </div>
          <div className="toolbar">
            <button className="btn navy" onClick={async () => { const result = await run({ type: "saveUser", user: draft }); if (result?.state) setDraft(null); }}>Save user</button>
            <button className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function ProjectEditor({ state, run }) {
  const [project, setProject] = useState(state.project);
  const sites = sitesOf(state.org);
  function set(field, value) {
    setProject({ ...project, [field]: value });
  }
  return (
    <Panel title="Project">
      <div className="form-grid">
        <label className="field">Project name<input value={project.name} onChange={(event) => set("name", event.target.value)} /></label>
        <label className="field">Wave
          <select value={project.waveId} onChange={(event) => set("waveId", event.target.value)}>
            {state.org.waves.map((wave) => <option key={wave.id} value={wave.id}>Wave {wave.name}</option>)}
          </select>
        </label>
        <label className="field">VISN
          <select value={project.visnId} onChange={(event) => set("visnId", event.target.value)}>
            {visnsOf(state.org).map((visn) => <option key={visn.id} value={visn.id}>VISN {visn.name}</option>)}
          </select>
        </label>
        <label className="field">Site
          <select value={project.siteId} onChange={(event) => set("siteId", event.target.value)}>
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </label>
        <label className="field">Start date<input type="date" value={project.startDate || ""} onChange={(event) => set("startDate", event.target.value)} /></label>
        <label className="field">End date (optional)<input type="date" value={project.endDate || ""} onChange={(event) => set("endDate", event.target.value)} /></label>
        <label className="field">Site detail<input value={project.siteDetail || ""} onChange={(event) => set("siteDetail", event.target.value)} /></label>
        <label className="field">Leadership<input value={project.leadership || ""} onChange={(event) => set("leadership", event.target.value)} /></label>
      </div>
      <button className="btn navy" style={{ marginTop: 10 }} onClick={() => run({ type: "saveProject", project })}>Save project</button>
    </Panel>
  );
}
