import { useMemo, useState } from "react";
import { assignmentClass, can, fmt, statusClass } from "../format.js";
import { Modal, PeopleSelect, Sheet, SortButton, useSort } from "../components/ui.jsx";
import { Gantt, PlanViewToggle, usePlanView } from "../components/Gantt.jsx";
import { useFocusTaskId, useGo, useProject, useRun } from "../store/hooks.js";

export default function Master() {
  const state = useProject();
  const run = useRun();
  const go = useGo();
  const focusTaskId = useFocusTaskId();
  const editable = can(state.me, "task");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState([]);
  const [viewOpen, setViewOpen] = useState(false);
  const [activeView, setActiveView] = useState(null);
  const [assignTask, setAssignTask] = useState(null);
  const [detail, setDetail] = useState(focusTaskId ? state.tasks.find((task) => task.id === focusTaskId) : null);
  const [shiftDays, setShiftDays] = useState(5);
  const [planView, setPlanView] = usePlanView();
  const { sort, toggle: sortBy, ordered } = useSort();

  const tasks = useMemo(() => {
    return state.tasks.filter((task) => {
      if (activeView && !matchView(task, activeView.filters)) return false;
      if (!query.trim()) return true;
      const hay = `${task.name} ${task.pillar} ${task.ownerName} ${task.status} ${task.siteName}`.toLowerCase();
      return hay.includes(query.trim().toLowerCase());
    });
  }, [state.tasks, query, activeView]);
  const tableTasks = ordered(tasks, taskColumn);

  function toggle(id) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function saveCell(task, patch) {
    await run({ type: "updateTask", id: task.id, patch });
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Master Project</h1>
          <p>Project schedule tracking — 30/60/90 — forward focused. Revised {fmt(state.project.revisedAt)}.</p>
        </div>
        <div className="toolbar">
          <PlanViewToggle view={planView} onChange={setPlanView} />
          <button className="btn" onClick={() => setViewOpen(true)}>View</button>
          {activeView ? <span className="tag">{activeView.name}</span> : null}
          {activeView ? <button className="btn ghost small" onClick={() => setActiveView(null)}>Clear view</button> : null}
          <input className="search" placeholder="Search filter" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>
      <div className="legend">
        <span><i className="st-complete" /> Complete</span>
        <span><i className="st-late" /> Late</span>
        <span><i className="st-today" /> Due today</span>
        <span><i className="st-d1" /> Due in 1 day</span>
        <span><i className="st-week" /> Due in 1 week</span>
        <span><i className="st-missing" /> Missing date</span>
        <span><i className="as-accepted" /> Accepted</span>
        <span><i className="as-pending" /> Waiting on assignee</span>
        <span><i className="as-proposed" /> New dates proposed</span>
      </div>
      {editable ? (
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <button className="btn ghost" disabled={!detail} onClick={() => run({ type: "insertTask", anchorId: detail.id, place: "above" })}>Insert above</button>
          <button className="btn ghost" disabled={!detail} onClick={() => run({ type: "insertTask", anchorId: detail.id, place: "below" })}>Insert below</button>
          <button className="btn ghost" disabled={!detail} onClick={() => run({ type: "indent", id: detail.id })}>Indent</button>
          <button className="btn ghost" disabled={!detail} onClick={() => run({ type: "outdent", id: detail.id })}>Outdent</button>
          <button className="btn ghost" disabled={!detail} onClick={() => run({ type: "deleteTask", id: detail.id })}>Delete</button>
          <label className="inline">Move selected
            <input style={{ width: 70 }} type="number" value={shiftDays} onChange={(event) => setShiftDays(event.target.value)} />
            days
          </label>
          <button className="btn navy" disabled={!selected.length} onClick={() => run({ type: "shiftTasks", ids: selected, days: Number(shiftDays) })}>Apply</button>
          <span className="muted">{selected.length} selected</span>
        </div>
      ) : null}
      <div className="sheet-wrap">
        {planView === "gantt" ? (
          <Gantt
            rows={tasks.map((task) => ({
              id: task.id,
              name: task.name,
              depth: task.level || 0,
              start: task.plannedStart,
              end: task.plannedEnd,
              status: task.status,
              assignment: task.assignmentStatus,
            }))}
            today={state.today}
            selected={selected}
            onToggle={(id) => { toggle(id); setDetail(state.tasks.find((task) => task.id === id) || null); }}
            onOpen={(id) => setDetail(state.tasks.find((task) => task.id === id) || null)}
          />
        ) : (
        <Sheet>
          <thead>
            <tr>
              <th className="task" rowSpan={2} />
              <th className="task" rowSpan={2}><SortButton label="Task starts" column="window" sort={sort} onSort={sortBy} /></th>
              <th className="task" rowSpan={2}><SortButton label="Pillar / Area" column="pillar" sort={sort} onSort={sortBy} /></th>
              <th className="task" rowSpan={2}><SortButton label="Task" column="name" sort={sort} onSort={sortBy} /></th>
              <th className="task" rowSpan={2}><SortButton label="Task owner" column="owner" sort={sort} onSort={sortBy} /></th>
              <th colSpan={2}><SortButton label="Start date" column="start" sort={sort} onSort={sortBy} /></th>
              <th colSpan={2}><SortButton label="End date" column="end" sort={sort} onSort={sortBy} /></th>
              <th rowSpan={2}><SortButton label="Status" column="status" sort={sort} onSort={sortBy} /></th>
              <th rowSpan={2}><SortButton label="Percent complete" column="percent" sort={sort} onSort={sortBy} /></th>
              <th rowSpan={2}><SortButton label="Late start" column="lateStart" sort={sort} onSort={sortBy} /></th>
              <th rowSpan={2}><SortButton label="Actions" column="actions" sort={sort} onSort={sortBy} /></th>
            </tr>
            <tr>
              <th><SortButton label="Planned" column="plannedStart" sort={sort} onSort={sortBy} /></th>
              <th><SortButton label="Actual" column="actualStart" sort={sort} onSort={sortBy} /></th>
              <th><SortButton label="Planned" column="plannedEnd" sort={sort} onSort={sortBy} /></th>
              <th><SortButton label="Actual completion" column="actualEnd" sort={sort} onSort={sortBy} /></th>
            </tr>
          </thead>
          <tbody>
            {tableTasks.map((task) => {
              const tone = `${statusClass(task.status)} ${assignmentClass(task.assignmentStatus)}`;
              const mine = task.ownerId === state.me.id && task.assignmentStatus === "accepted";
              const canPlan = editable;
              const canActual = editable || mine;
              return (
                <tr key={task.id} className={tone} style={detail?.id === task.id ? { outline: "2px solid #305496" } : undefined}>
                  <td>
                    <input type="checkbox" checked={selected.includes(task.id)} onChange={() => { toggle(task.id); setDetail(task); }} />
                  </td>
                  <td>{task.window}</td>
                  <td>
                    {canPlan ? (
                      <input className="pillar" defaultValue={task.pillar} key={`${task.id}-pillar-${task.pillar}`} onBlur={(event) => event.target.value !== task.pillar && saveCell(task, { pillar: event.target.value })} />
                    ) : task.pillar}
                  </td>
                  <td className={`task-name indent-${Math.min(task.level || 0, 3)}`}>
                    <button className="linkish" onClick={() => setDetail(task)}>{task.name}</button>
                    {task.predecessorName ? <div className="muted">after {task.predecessorName}</div> : null}
                  </td>
                  <td>{task.ownerName || "—"}</td>
                  <td>{canPlan ? <input type="date" defaultValue={task.plannedStart} key={task.plannedStart} onBlur={(event) => event.target.value !== task.plannedStart && saveCell(task, { plannedStart: event.target.value })} /> : fmt(task.plannedStart)}</td>
                  <td>{canActual ? <input type="date" defaultValue={task.actualStart} key={`a${task.actualStart}`} onBlur={(event) => event.target.value !== (task.actualStart || "") && saveCell(task, { actualStart: event.target.value })} /> : fmt(task.actualStart)}</td>
                  <td>{canPlan ? <input type="date" defaultValue={task.plannedEnd} key={task.plannedEnd} onBlur={(event) => event.target.value !== task.plannedEnd && saveCell(task, { plannedEnd: event.target.value })} /> : fmt(task.plannedEnd)}</td>
                  <td>{canActual ? <input type="date" defaultValue={task.actualEnd} key={`e${task.actualEnd}`} onBlur={(event) => event.target.value !== (task.actualEnd || "") && saveCell(task, { actualEnd: event.target.value })} /> : fmt(task.actualEnd)}</td>
                  <td>{task.status}</td>
                  <td>{task.percent == null ? "" : `${Math.round(task.percent)}%`}</td>
                  <td>{task.lateStart}</td>
                  <td className="actions">
                    {canPlan ? <button className="btn small" onClick={() => setAssignTask(task)}>Assign</button> : null}
                    <button className="btn small" onClick={() => go("meetings", task.id)}>Meetings</button>
                    <button className="btn small orange" onClick={() => go("documents", task.id)}>Documents</button>
                    <button className="btn small deep" onClick={() => run({ type: "toggleReport", taskId: task.id })}>{task.inReport ? "In report" : "Add to report"}</button>
                    <button className="btn small yellow" onClick={() => go("trackers", task.id)}>Tracker</button>
                    <button className="btn small green" onClick={() => go("issues", task.id)}>Issues/Risks</button>
                    <button className="btn small ghost" onClick={() => go("root", task.id)}>Root cause</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Sheet>
        )}
      </div>
      {viewOpen ? (
        <ViewEditor
          state={state}
          current={activeView}
          onClose={() => setViewOpen(false)}
          onApply={(view) => { setActiveView(view); setViewOpen(false); }}
          run={run}
        />
      ) : null}
      {assignTask ? (
        <AssignDialog task={assignTask} users={state.users} onClose={() => setAssignTask(null)} run={run} />
      ) : null}
      {detail ? (
        <TaskDetail
          task={state.tasks.find((item) => item.id === detail.id) || detail}
          state={state}
          editable={editable}
          onClose={() => setDetail(null)}
          run={run}
        />
      ) : null}
    </section>
  );
}

function taskColumn(task, key) {
  if (key === "window") return task.window;
  if (key === "pillar") return task.pillar;
  if (key === "name") return task.name;
  if (key === "owner") return task.ownerName;
  if (key === "start" || key === "plannedStart") return task.plannedStart;
  if (key === "actualStart") return task.actualStart;
  if (key === "end" || key === "plannedEnd") return task.plannedEnd;
  if (key === "actualEnd") return task.actualEnd;
  if (key === "status") return task.status;
  if (key === "percent") return task.percent;
  if (key === "lateStart") return task.lateStart;
  if (key === "actions") return task.inReport ? "In report" : "";
  return "";
}

function matchView(task, filters) {
  const hit = (list, value) => !list?.length || list.includes(value);
  return hit(filters.waves, task.waveId)
    && hit(filters.visns, task.visnId)
    && hit(filters.sites, task.siteId)
    && hit(filters.areas, task.area)
    && hit(filters.specialties, task.specialty)
    && hit(filters.owners, task.ownerId);
}

function ViewEditor({ state, current, onClose, onApply, run }) {
  const [name, setName] = useState(current?.name || "");
  const [filters, setFilters] = useState(current?.filters || { waves: [], visns: [], sites: [], areas: [], specialties: [], owners: [] });
  const areas = [...new Set(state.tasks.map((task) => task.area).filter(Boolean))].sort();
  const specialties = [...new Set(state.tasks.map((task) => task.specialty).filter(Boolean))].sort();

  function toggle(key, id) {
    const list = new Set(filters[key] || []);
    if (list.has(id)) list.delete(id);
    else list.add(id);
    setFilters({ ...filters, [key]: [...list] });
  }

  async function save(apply) {
    const result = await run({ type: "saveView", id: current?.id, name: name || "Saved view", filters });
    if (!result?.state) return;
    const saved = result.state.views.find((view) => view.name === (name || "Saved view"));
    if (apply && saved) onApply(saved);
    else onClose();
  }

  return (
    <Modal title="View" onClose={onClose} wide>
      <p className="muted">Wave includes multiple VISNs. A VISN includes multiple sites. You can also slice by area, specialty, or owner — printers across every VISN, or scanners at two sites.</p>
      <label className="field" style={{ margin: "10px 0" }}>View name
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Portland technical" />
      </label>
      <div className="tree">
        {state.org.waves.map((wave) => (
          <details key={wave.id} open>
            <summary>
              <label><input type="checkbox" checked={filters.waves.includes(wave.id)} onChange={() => toggle("waves", wave.id)} /> Wave {wave.name}</label>
            </summary>
            {wave.visns.map((visn) => (
              <details key={visn.id} open>
                <summary>
                  <label><input type="checkbox" checked={filters.visns.includes(visn.id)} onChange={() => toggle("visns", visn.id)} /> VISN {visn.name}</label>
                </summary>
                {visn.sites.map((site) => (
                  <label key={site.id} style={{ marginLeft: 18 }}>
                    <input type="checkbox" checked={filters.sites.includes(site.id)} onChange={() => toggle("sites", site.id)} /> {site.name}
                  </label>
                ))}
              </details>
            ))}
          </details>
        ))}
        <details open>
          <summary>Area</summary>
          {areas.map((area) => (
            <label key={area}><input type="checkbox" checked={filters.areas.includes(area)} onChange={() => toggle("areas", area)} /> {area}</label>
          ))}
        </details>
        <details>
          <summary>Specialty</summary>
          {specialties.map((specialty) => (
            <label key={specialty}><input type="checkbox" checked={filters.specialties.includes(specialty)} onChange={() => toggle("specialties", specialty)} /> {specialty}</label>
          ))}
        </details>
        <details>
          <summary>Task owner</summary>
          {state.users.map((user) => (
            <label key={user.id}>
              <input type="checkbox" checked={filters.owners.includes(user.id)} onChange={() => toggle("owners", user.id)} />
              {user.firstName} {user.lastName}
            </label>
          ))}
        </details>
      </div>
      {state.views.length ? (
        <div className="toolbar" style={{ marginTop: 10 }}>
          <span className="muted">Saved</span>
          {state.views.map((view) => (
            <button key={view.id} className="btn ghost small" onClick={() => onApply(view)}>{view.name}</button>
          ))}
        </div>
      ) : null}
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="btn navy" onClick={() => save(true)}>Save view</button>
        <button className="btn" onClick={() => onApply({ name: name || "Unsaved view", filters })}>Apply without saving</button>
        {current?.id ? <button className="btn danger" onClick={async () => { await run({ type: "deleteView", id: current.id }); onClose(); }}>Delete</button> : null}
      </div>
    </Modal>
  );
}

function AssignDialog({ task, users, onClose, run }) {
  const [ownerId, setOwnerId] = useState(task.ownerId || "");
  const [negotiable, setNegotiable] = useState(task.negotiable);
  const [plannedStart, setPlannedStart] = useState(task.plannedStart || "");
  const [plannedEnd, setPlannedEnd] = useState(task.plannedEnd || "");

  async function submit() {
    const result = await run({
      type: "assignTask",
      taskId: task.id,
      ownerId,
      negotiable,
      plannedStart,
      plannedEnd,
    });
    if (result?.state || result?.warning) onClose();
  }

  return (
    <Modal title={`Assign — ${task.name}`} onClose={onClose}>
      <p className="muted">Leave the dates blank and mark them negotiable when the assignee should say how long the work will take. Otherwise the dates are fixed and they can only accept them.</p>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="field">Assign to
          <PeopleSelect users={users} value={ownerId} onChange={setOwnerId} allowEmpty={false} />
        </label>
        <label className="field">Planned start
          <input type="date" value={plannedStart} onChange={(event) => setPlannedStart(event.target.value)} />
        </label>
        <label className="field">Planned end
          <input type="date" value={plannedEnd} onChange={(event) => setPlannedEnd(event.target.value)} />
        </label>
      </div>
      <label className="checkline" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={negotiable} onChange={(event) => setNegotiable(event.target.checked)} />
        Dates are negotiable
      </label>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="btn navy" onClick={submit}>Assign task</button>
      </div>
    </Modal>
  );
}

function TaskDetail({ task, state, editable, onClose, run }) {
  const [text, setText] = useState("");
  const [predecessorId, setPredecessorId] = useState(task.predecessorId || "");
  return (
    <Modal title={task.name} onClose={onClose}>
      <p className="muted">{task.pillar} · {task.siteName} · {task.status}{task.assignmentStatus ? ` · ${task.assignmentStatus}` : ""}</p>
      {task.assignmentStatus === "proposed" ? (
        <div className="banner warn">
          Proposed {fmt(task.proposedStart)} – {fmt(task.proposedEnd)}. {task.proposalComment}
          {editable ? (
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => run({ type: "acceptProposal", taskId: task.id, accept: true })}>Accept new dates</button>
              <button className="btn ghost" onClick={() => run({ type: "acceptProposal", taskId: task.id, accept: false })}>Keep original dates</button>
            </div>
          ) : null}
        </div>
      ) : null}
      {editable ? (
        <label className="field">Link to the task that must finish first
          <select value={predecessorId} onChange={(event) => setPredecessorId(event.target.value)}>
            <option value="">No link</option>
            {state.tasks.filter((item) => item.id !== task.id).map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
      ) : null}
      {editable ? (
        <button className="btn" style={{ marginTop: 8 }} onClick={() => run({ type: "linkTasks", id: task.id, predecessorId })}>Save link</button>
      ) : null}
      <h3 style={{ margin: "14px 0 6px" }}>Comments</h3>
      {task.comments?.length ? task.comments.map((comment) => (
        <p key={comment.id}><b>{fmt(comment.at)}</b> — {comment.text}</p>
      )) : <p className="muted">No comments yet.</p>}
      <div className="inline" style={{ marginTop: 8 }}>
        <input className="search" value={text} onChange={(event) => setText(event.target.value)} placeholder="Add a comment" />
        <button className="btn" onClick={async () => { const result = await run({ type: "addComment", taskId: task.id, text }); if (result?.state) setText(""); }}>Add</button>
      </div>
    </Modal>
  );
}
