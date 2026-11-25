import { Fragment, useMemo, useState } from "react";
import { fmt, statusClass, assignmentClass } from "../format.js";
import { Modal, Sheet, SortButton, useSort } from "../components/ui.jsx";
import { sitesOf, visnsOf } from "../format.js";
import { useGo, useProject, useRun } from "../store/hooks.js";

const BUCKETS = [
  ["Late", "Late", "#e05a6a"],
  ["Complete", "Complete", "#3d9a5b"],
  ["In Progress", "In Progress", "#4aa3df"],
];

const WINDOWS = [
  ["Before today", "Started", "#9c0006"],
  ["Next 30 days", "Next 30 days", "#c65911"],
  ["From 30 to 60 days", "30–60 days", "#e0a100"],
  ["From 60 to 90 days", "60–90 days", "#5b9bd5"],
  ["Beyond 90 days", "After 90 days", "#305496"],
  ["No dates", "No dates", "#b0b8c4"],
];

const ASSIGNMENTS = [
  ["accepted", "Accepted", "#00b0f0"],
  ["pending", "Pending", "#ffc000"],
  ["proposed", "Proposed", "#ed7d31"],
  ["rejected", "Rejected", "#c00000"],
  ["unassigned", "Unassigned", "#b0b8c4"],
];

export default function Dashboard() {
  const state = useProject();
  const run = useRun();
  const go = useGo();
  const sites = sitesOf(state.org);
  const visns = visnsOf(state.org);
  const pillars = [...new Set(state.tasks.map((task) => task.pillar).filter(Boolean))].sort();
  const [filters, setFilters] = useState({ wave: "", visn: "", site: "", pillar: "" });
  const [drill, setDrill] = useState(null);
  const [picker, setPicker] = useState(false);
  const [expanded, setExpanded] = useState("");

  const filtered = useMemo(
    () => state.tasks.filter((task) => matchScope(task, filters)),
    [state.tasks, filters]
  );
  const tops = useMemo(() => filtered.filter((task) => task.level === 0), [filtered]);
  const scoped = filters.wave || filters.visn || filters.site || filters.pillar;
  const taskIds = useMemo(() => new Set(filtered.map((task) => task.id)), [filtered]);
  const openIssues = state.issues.filter((issue) => {
    const closed = issue.status === "Resolved" || issue.status === "Closed" || issue.tone === "green";
    if (closed) return false;
    if (!issue.taskId) return !scoped;
    return taskIds.has(issue.taskId);
  });
  const meetingsAhead = state.meetings.filter((meeting) => {
    if (!meeting.date || meeting.date < state.today || meeting.isTemplate) return false;
    if (!meeting.taskId) return !scoped;
    return taskIds.has(meeting.taskId);
  });
  const workflows = tops.filter((task) => state.tasks.some((child) => child.parentId === task.id));
  const scored = tops.filter((task) => task.percent != null && task.percent !== "");
  const average = scored.length ? Math.round(scored.reduce((sum, task) => sum + Number(task.percent), 0) / scored.length) : null;
  const horizon = plusDays(state.today, 30);
  const dueSoon = tops.filter((task) => task.bucket !== "Complete" && task.plannedEnd && task.plannedEnd >= state.today && task.plannedEnd <= horizon);

  const panels = state.prefs.panels?.length
    ? state.prefs.panels.map((panel) => ({
        key: `${panel.kind}:${panel.id}`,
        title: panelTitle(panel, state),
        tasks: filtered.filter((task) => matchPanel(task, panel)),
      }))
    : [
        { key: "visn", title: filters.visn ? `VISN ${visns.find((item) => item.id === filters.visn)?.name}` : "VISN", tasks: filtered },
        { key: "wave", title: filters.wave ? `Wave ${state.org.waves.find((item) => item.id === filters.wave)?.name}` : "Wave", tasks: filtered },
        { key: "site", title: filters.site ? `Site ${sites.find((item) => item.id === filters.site)?.name}` : "Site", tasks: filtered },
        { key: "pillar", title: filters.pillar ? `Pillar: ${filters.pillar}` : "Pillar", tasks: filtered },
      ];

  const drilled = drill ? sliceTasks(drill.key === "project" ? filtered : panels.find((panel) => panel.key === drill.key)?.tasks || [], drill.field, drill.value) : [];
  const { sort, toggle, ordered } = useSort();
  const drilledRows = ordered(drilled, taskColumn);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Project Dashboard</h1>
          <p>Status, schedule, and assignments are shown as charts. Open a slice to see the tasks behind it.</p>
        </div>
        <button className="btn yellow" onClick={() => setPicker(true)}>My Dashboards</button>
      </div>
      <div className="filters">
        <label>VISN
          <select value={filters.visn} onChange={(event) => setFilters({ ...filters, visn: event.target.value })}>
            <option value="">Select VISN</option>
            {visns.map((visn) => <option key={visn.id} value={visn.id}>VISN {visn.name}</option>)}
          </select>
        </label>
        <label>Wave
          <select value={filters.wave} onChange={(event) => setFilters({ ...filters, wave: event.target.value })}>
            <option value="">Select Wave</option>
            {state.org.waves.map((wave) => <option key={wave.id} value={wave.id}>Wave {wave.name}</option>)}
          </select>
        </label>
        <label>Site
          <select value={filters.site} onChange={(event) => setFilters({ ...filters, site: event.target.value })}>
            <option value="">Select Site</option>
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </label>
        <label>Pillar
          <select value={filters.pillar} onChange={(event) => setFilters({ ...filters, pillar: event.target.value })}>
            <option value="">Select pillar</option>
            {pillars.map((pillar) => <option key={pillar}>{pillar}</option>)}
          </select>
        </label>
      </div>
      <div className="metric-row">
        <article className="metric"><b>{tops.length}</b><span>Top-level tasks</span></article>
        <article className="metric"><b>{workflows.length}</b><span>Workflows</span></article>
        <article className="metric"><b>{average == null ? "—" : `${average}%`}</b><span>Average complete</span></article>
        <article className="metric"><b>{dueSoon.length}</b><span>Due in 30 days</span></article>
        <article className="metric"><b>{openIssues.length}</b><span>Open issues</span></article>
        <article className="metric"><b>{meetingsAhead.length}</b><span>Meetings ahead</span></article>
      </div>
      <div className="cards">
        <PiePanel
          title="Task status"
          hint="Late, complete, and still in progress"
          slices={countSlices(tops, (task) => task.bucket, BUCKETS)}
          active={drill?.key === "project" && drill.field === "bucket" ? drill.value : ""}
          onPick={(slice) => setDrill({ key: "project", field: "bucket", value: slice.id, title: "Project", label: slice.label })}
        />
        <PiePanel
          title="Forward window"
          hint="When top-level work is planned to start"
          slices={countSlices(tops, (task) => task.window || "No dates", WINDOWS)}
          active={drill?.key === "project" && drill.field === "window" ? drill.value : ""}
          onPick={(slice) => setDrill({ key: "project", field: "window", value: slice.id, title: "Project", label: slice.label })}
        />
        <PiePanel
          title="Assignments"
          hint="Whether owners have accepted the work"
          slices={countSlices(tops, (task) => task.assignmentStatus || "unassigned", ASSIGNMENTS)}
          active={drill?.key === "project" && drill.field === "assignment" ? drill.value : ""}
          onPick={(slice) => setDrill({ key: "project", field: "assignment", value: slice.id, title: "Project", label: slice.label })}
        />
      </div>
      <div className="cards">
        {panels.map((panel) => (
          <PiePanel
            key={panel.key}
            title={panel.title}
            hint="Top-level tasks in this dashboard"
            slices={countSlices(panel.tasks.filter((task) => task.level === 0), (task) => task.bucket, BUCKETS)}
            active={drill?.key === panel.key && drill.field === "bucket" ? drill.value : ""}
            onPick={(slice) => setDrill({ key: panel.key, field: "bucket", value: slice.id, title: panel.title, label: slice.label })}
          />
        ))}
      </div>
      {drill ? (
        <>
          <div className="page-head">
            <h2 style={{ color: "#305496" }}>{drill.title} — {drill.label}</h2>
            <button className="btn ghost" onClick={() => setDrill(null)}>Clear</button>
          </div>
          <div className="sheet-wrap">
            <Sheet>
              <thead>
                <tr>
                  <th className="task"><SortButton label="Window" column="window" sort={sort} onSort={toggle} /></th>
                  <th className="task"><SortButton label="Pillar / Area" column="pillar" sort={sort} onSort={toggle} /></th>
                  <th className="task"><SortButton label="Task" column="name" sort={sort} onSort={toggle} /></th>
                  <th className="task"><SortButton label="Owner" column="owner" sort={sort} onSort={toggle} /></th>
                  <th><SortButton label="Planned start" column="plannedStart" sort={sort} onSort={toggle} /></th>
                  <th><SortButton label="Planned end" column="plannedEnd" sort={sort} onSort={toggle} /></th>
                  <th><SortButton label="Status" column="status" sort={sort} onSort={toggle} /></th>
                  <th><SortButton label="%" column="percent" sort={sort} onSort={toggle} /></th>
                  <th><SortButton label="Links" column="links" sort={sort} onSort={toggle} /></th>
                </tr>
              </thead>
              <tbody>
                {drilledRows.map((task) => {
                  const children = state.tasks.filter((item) => item.parentId === task.id);
                  const open = expanded === task.id;
                  return (
                    <Fragment key={task.id}>
                      <tr className={`${statusClass(task.status)} ${assignmentClass(task.assignmentStatus)}`}>
                        <td>{task.window}</td>
                        <td>{task.pillar}</td>
                        <td className="task-name">
                          {children.length ? (
                            <button className="linkish" onClick={() => setExpanded(open ? "" : task.id)}>{open ? "▾" : "▸"} {task.name}</button>
                          ) : task.name}
                        </td>
                        <td>{task.ownerName}</td>
                        <td>{fmt(task.plannedStart)}</td>
                        <td>{fmt(task.plannedEnd)}</td>
                        <td>{task.status}</td>
                        <td>{task.percent == null ? "" : `${task.percent}%`}</td>
                        <td className="actions">
                          <button className="btn small" onClick={() => go("meetings", task.id)}>Meetings</button>
                          <button className="btn small orange" onClick={() => go("documents", task.id)}>Documents</button>
                          {task.trackerId ? <button className="btn small yellow" onClick={() => go("trackers", task.id)}>Tracker</button> : null}
                          <button className="btn small green" onClick={() => go("issues", task.id)}>Issues/Risks</button>
                          <button className="btn small ghost" onClick={() => go("root", task.id)}>Root Cause</button>
                        </td>
                      </tr>
                      {open ? children.map((child) => (
                        <tr key={child.id} className={statusClass(child.status)}>
                          <td colSpan={2} />
                          <td className={`indent-${Math.min(child.level, 3)}`}>{child.name}</td>
                          <td>{child.ownerName}</td>
                          <td>{fmt(child.plannedEnd)}</td>
                          <td colSpan={2}>{child.status}</td>
                          <td colSpan={2}>{child.comments?.[0]?.text || ""}</td>
                        </tr>
                      )) : null}
                    </Fragment>
                  );
                })}
                {drilled.length === 0 ? <tr><td colSpan={9}>Nothing in this bucket.</td></tr> : null}
              </tbody>
            </Sheet>
          </div>
        </>
      ) : null}
      {picker ? (
        <DashboardPicker
          state={state}
          onClose={() => setPicker(false)}
          onSave={async (panels) => {
            const result = await run({ type: "setPrefs", panels });
            if (result?.state) setPicker(false);
          }}
        />
      ) : null}
    </section>
  );
}

function DashboardPicker({ state, onClose, onSave }) {
  const sites = sitesOf(state.org);
  const pillars = [...new Set(state.tasks.map((task) => task.pillar).filter(Boolean))].sort();
  const initial = new Set((state.prefs.panels || []).map((panel) => `${panel.kind}:${panel.id}`));
  const [selected, setSelected] = useState(initial);

  function toggle(key) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  }

  function save() {
    const panels = [...selected].map((key) => {
      const [kind, ...rest] = key.split(":");
      return { kind, id: rest.join(":") };
    });
    onSave(panels);
  }

  return (
    <Modal title="My Dashboards" onClose={onClose}>
      <p className="muted">Pick the slices you want on your home screen. Leave this empty to see VISN, Wave, Site, and Pillar for the whole project.</p>
      <div className="split" style={{ marginTop: 12 }}>
        <div className="tree">
          <strong>Sites</strong>
          {sites.map((site) => (
            <label key={site.id}>
              <input type="checkbox" checked={selected.has(`site:${site.id}`)} onChange={() => toggle(`site:${site.id}`)} />
              {site.name} · VISN {site.visnName}
            </label>
          ))}
        </div>
        <div className="tree">
          <strong>Pillars</strong>
          {pillars.map((pillar) => (
            <label key={pillar}>
              <input type="checkbox" checked={selected.has(`pillar:${pillar}`)} onChange={() => toggle(`pillar:${pillar}`)} />
              {pillar}
            </label>
          ))}
        </div>
      </div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="btn navy" onClick={save}>Save my dashboards</button>
        <button className="btn ghost" onClick={() => onSave([])}>Use the default view</button>
      </div>
    </Modal>
  );
}

function PiePanel({ title, hint, slices, active, onPick }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  return (
    <article className="card">
      <h3>{title}</h3>
      <p className="muted">{hint}</p>
      <div className="pie-body">
        <Donut slices={slices} total={total} active={active} onPick={onPick} />
        <div className="pie-legend">
          {slices.map((slice) => (
            <button key={slice.id} className={active === slice.id ? "active" : ""} onClick={() => onPick(slice)}>
              <span className="pie-swatch" style={{ background: slice.color }} />
              <span className="pie-label">{slice.label}</span>
              <em>{slice.value} · {total ? Math.round((slice.value / total) * 100) : 0}%</em>
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

function Donut({ slices, total, active, onPick }) {
  const radius = 52;
  const center = 70;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const drawn = slices.filter((slice) => slice.value > 0);
  return (
    <svg className="pie-chart" viewBox="0 0 140 140" role="img" aria-label={`${total} tasks`}>
      <circle cx={center} cy={center} r={radius} fill="none" stroke="#e6edf5" strokeWidth="18" />
      {drawn.length === 1 ? (
        <circle className="slice" cx={center} cy={center} r={radius} fill="none" stroke={drawn[0].color} strokeWidth={active === drawn[0].id ? 24 : 18} onClick={() => onPick(drawn[0])} />
      ) : drawn.map((slice) => {
        const length = total ? (slice.value / total) * circumference : 0;
        const dash = `${length} ${circumference - length}`;
        const circle = (
          <circle
            key={slice.id}
            className="slice"
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={slice.color}
            strokeWidth={active === slice.id ? 24 : 18}
            strokeDasharray={dash}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${center} ${center})`}
            onClick={() => onPick(slice)}
          />
        );
        offset += length;
        return circle;
      })}
      <text x={center} y={center} textAnchor="middle" dominantBaseline="central" fontSize="22" fontWeight="700" fill="#305496">{total}</text>
    </svg>
  );
}

function countSlices(tasks, valueOf, catalog) {
  return catalog.map(([id, label, color]) => ({
    id,
    label,
    color,
    value: tasks.filter((task) => valueOf(task) === id).length,
  }));
}

function taskColumn(task, key) {
  if (key === "window") return task.window;
  if (key === "pillar") return task.pillar;
  if (key === "name") return task.name;
  if (key === "owner") return task.ownerName;
  if (key === "plannedStart") return task.plannedStart;
  if (key === "plannedEnd") return task.plannedEnd;
  if (key === "status") return task.status;
  if (key === "percent") return task.percent;
  if (key === "links") return task.trackerId ? "Tracker" : "";
  return "";
}

function sliceTasks(tasks, field, value) {
  const tops = tasks.filter((task) => task.level === 0);
  if (field === "bucket") return tops.filter((task) => task.bucket === value);
  if (field === "window") return tops.filter((task) => (task.window || "No dates") === value);
  if (field === "assignment") return tops.filter((task) => (task.assignmentStatus || "unassigned") === value);
  return tops;
}

function plusDays(iso, days) {
  const [year, month, day] = String(iso || "").slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "";
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${nextMonth}-${nextDay}`;
}

function matchScope(task, filters) {
  if (filters.wave && task.waveId !== filters.wave) return false;
  if (filters.visn && task.visnId !== filters.visn) return false;
  if (filters.site && task.siteId !== filters.site) return false;
  if (filters.pillar && task.pillar !== filters.pillar) return false;
  return true;
}

function matchPanel(task, panel) {
  if (panel.kind === "site") return task.siteId === panel.id;
  if (panel.kind === "visn") return task.visnId === panel.id;
  if (panel.kind === "wave") return task.waveId === panel.id;
  if (panel.kind === "pillar") return task.pillar === panel.id;
  return true;
}

function panelTitle(panel, state) {
  if (panel.kind === "site") return `Site: ${sitesOf(state.org).find((site) => site.id === panel.id)?.name || panel.id}`;
  if (panel.kind === "visn") return `VISN ${visnsOf(state.org).find((visn) => visn.id === panel.id)?.name || panel.id}`;
  if (panel.kind === "wave") return `Wave ${state.org.waves.find((wave) => wave.id === panel.id)?.name || panel.id}`;
  return `Pillar: ${panel.id}`;
}
