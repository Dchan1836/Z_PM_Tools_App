import { useEffect, useMemo, useRef, useState } from "react";
import { can, fmt, sitesOf, statusClass } from "../format.js";
import { PeopleSelect, Sheet } from "../components/ui.jsx";
import { Gantt, PlanViewToggle, usePlanView } from "../components/Gantt.jsx";
import { useAppDispatch, useProject, useRun, useUi } from "../store/hooks.js";
import { clearWorkflowDraft } from "../store/uiSlice.js";

let stepSerial = 0;

function blankStep(plannedStart = "", plannedEnd = "") {
  stepSerial += 1;
  return { key: stepSerial, name: "", ownerId: "", plannedStart, plannedEnd };
}

function childrenOf(tasks, id) {
  return tasks.filter((task) => task.parentId === id);
}

function series(steps) {
  const ids = new Set(steps.map((step) => step.id));
  const incoming = new Map(steps.map((step) => [step.id, 0]));
  const outgoing = new Map(steps.map((step) => [step.id, []]));
  for (const step of steps) {
    if (step.predecessorId && ids.has(step.predecessorId)) {
      incoming.set(step.id, incoming.get(step.id) + 1);
      outgoing.get(step.predecessorId).push(step.id);
    }
  }
  const position = new Map(steps.map((step, index) => [step.id, index]));
  const ready = steps.filter((step) => incoming.get(step.id) === 0).map((step) => step.id);
  const byPlan = (left, right) => position.get(left) - position.get(right);
  ready.sort(byPlan);
  const ordered = [];
  while (ready.length) {
    const id = ready.shift();
    ordered.push(id);
    for (const follower of outgoing.get(id) || []) {
      incoming.set(follower, incoming.get(follower) - 1);
      if (incoming.get(follower) === 0) ready.push(follower);
    }
    ready.sort(byPlan);
  }
  if (ordered.length !== steps.length) return steps;
  const byId = new Map(steps.map((step) => [step.id, step]));
  return ordered.map((id) => byId.get(id));
}

function workflowIdOf(tasks, taskId) {
  let current = tasks.find((task) => task.id === taskId);
  const guard = new Set();
  while (current?.parentId && !guard.has(current.id)) {
    guard.add(current.id);
    current = tasks.find((task) => task.id === current.parentId);
  }
  if (!current || !childrenOf(tasks, current.id).length) return "";
  return current.id;
}

function rowsFor(tasks, workflow) {
  const steps = series(childrenOf(tasks, workflow.id));
  const rows = [];
  steps.forEach((step, index) => {
    rows.push({ task: step, label: String(index + 1), depth: 0 });
    const nested = [];
    const walk = (parentId, depth) => {
      for (const child of series(childrenOf(tasks, parentId))) {
        nested.push({ task: child, label: "Subtask", depth });
        walk(child.id, depth + 1);
      }
    };
    walk(step.id, 1);
    rows.push(...nested);
  });
  return rows;
}

export default function Workflows() {
  const state = useProject();
  const ui = useUi();
  const run = useRun();
  const dispatch = useAppDispatch();
  const tasks = state.tasks;
  const [creating, setCreating] = useState(false);
  const [seed, setSeed] = useState(null);
  const [planView, setPlanView] = usePlanView();
  const seenDraft = useRef("");
  const workflows = useMemo(
    () => tasks.filter((task) => !task.parentId && childrenOf(tasks, task.id).length > 0),
    [tasks],
  );
  const [selectedId, setSelectedId] = useState("");
  const focusedId = workflowIdOf(tasks, ui.focusTaskId);

  useEffect(() => {
    if (focusedId) setSelectedId(focusedId);
  }, [focusedId]);

  useEffect(() => {
    const request = ui.workflowDraft;
    if (!request || seenDraft.current === request.id) return;
    seenDraft.current = request.id;
    dispatch(clearWorkflowDraft());
    if (!can(state.me, "task")) return;
    setSeed({ id: request.id, ...request.workflow });
    setCreating(true);
  }, [ui.workflowDraft, dispatch, state.me]);

  const selected = workflows.find((workflow) => workflow.id === selectedId) || workflows[0];
  const rows = selected ? rowsFor(tasks, selected) : [];
  const steps = rows.filter((row) => row.depth === 0);
  const complete = steps.filter((row) => row.task.status === "Complete").length;
  const memberIds = new Set(selected ? [selected.id, ...rows.map((row) => row.task.id)] : []);
  const meetings = selected ? state.meetings.filter((meeting) => memberIds.has(meeting.taskId)) : [];

  return (
    <section className="stack">
      <div className="page-head">
        <div>
          <h1>Workflows</h1>
          <p>A workflow is the series of tasks that has to be finished to complete it. Subtasks are the work a task depends on, and they have to be finished first.</p>
        </div>
        {can(state.me, "task") && !creating ? (
          <div className="toolbar">
            <PlanViewToggle view={planView} onChange={setPlanView} />
            <button className="btn navy" onClick={() => { setSeed(null); setCreating(true); }}>Create workflow</button>
          </div>
        ) : <PlanViewToggle view={planView} onChange={setPlanView} />}
      </div>
      {creating ? (
        <WorkflowEditor
          key={seed?.id || "blank"}
          state={state}
          run={run}
          initial={seed}
          onCancel={() => { setSeed(null); setCreating(false); }}
          onSaved={(id) => {
            setSeed(null);
            setSelectedId(id);
            setCreating(false);
          }}
        />
      ) : workflows.length === 0 ? (
        <p className="muted">No workflows yet. A workflow appears when a top-level task has tasks under it.</p>
      ) : (
        <>
          <div className="toolbar">
            {workflows.map((workflow) => {
              const count = childrenOf(tasks, workflow.id).length;
              return (
                <button
                  key={workflow.id}
                  className={workflow.id === selected?.id ? "btn navy" : "btn ghost"}
                  onClick={() => setSelectedId(workflow.id)}
                >
                  {workflow.name} ({count})
                </button>
              );
            })}
          </div>
          {selected ? (
            <>
              <div className="cards">
                <article className="card">
                  <h3>{selected.name}</h3>
                  <p>{[selected.pillar, selected.ownerName || "Unassigned", selected.siteName].filter(Boolean).join(" · ")}</p>
                  <p className="muted">{complete} of {steps.length} tasks complete</p>
                </article>
                <article className="card">
                  <h3>Schedule</h3>
                  <p>{fmt(selected.plannedStart) || "No start"} – {fmt(selected.plannedEnd) || "No end"}</p>
                  <p>{selected.status}</p>
                </article>
              </div>
              <div className="sheet-wrap">
                {planView === "gantt" ? (
                  <Gantt
                    rows={rows.map((row) => ({
                      id: row.task.id,
                      name: row.task.name,
                      depth: row.depth,
                      start: row.task.plannedStart,
                      end: row.task.plannedEnd,
                      status: row.task.status,
                      assignment: row.task.assignmentStatus,
                    }))}
                    today={state.today}
                  />
                ) : (
                <Sheet>
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th className="task">Task</th>
                      <th>Owner</th>
                      <th>Planned start</th>
                      <th>Planned end</th>
                      <th>Status</th>
                      <th>Depends on</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.task.id} className={statusClass(row.task.status)}>
                        <td>{row.label}</td>
                        <td className={row.depth ? `task indent-${Math.min(row.depth, 3)}` : "task"}>{row.task.name}</td>
                        <td>{row.task.ownerName}</td>
                        <td>{fmt(row.task.plannedStart)}</td>
                        <td>{fmt(row.task.plannedEnd)}</td>
                        <td>{row.task.status}</td>
                        <td>{row.task.predecessorName}</td>
                      </tr>
                    ))}
                  </tbody>
                </Sheet>
                )}
              </div>
              {meetings.length ? (
                <article className="card">
                  <h3>Meetings</h3>
                  <ul>
                    {meetings.map((meeting) => (
                      <li key={meeting.id}>{meeting.title} · {fmt(meeting.date)} · {meeting.facilitatorName || "No facilitator"}</li>
                    ))}
                  </ul>
                </article>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

function WorkflowEditor({ state, run, onCancel, onSaved, initial }) {
  const sites = sitesOf(state.org);
  const pillars = [...new Set(state.tasks.map((task) => task.pillar).filter(Boolean))].sort();
  const [draft, setDraft] = useState(() => draftFrom(state, sites, initial));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function patchStep(key, patch) {
    setDraft({
      ...draft,
      steps: draft.steps.map((step) => step.key === key ? { ...step, ...patch } : step),
    });
  }

  function moveStep(index, direction) {
    const next = draft.steps.slice();
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row);
    setDraft({ ...draft, steps: next });
  }

  async function save() {
    const named = draft.steps.filter((step) => step.name.trim());
    if (!draft.name.trim()) {
      setError("A workflow needs a name.");
      return;
    }
    if (!named.length) {
      setError("Add at least one task to the workflow.");
      return;
    }
    setError("");
    setSaving(true);
    const result = await run({
      type: "createWorkflow",
      workflow: {
        name: draft.name.trim(),
        ownerId: draft.ownerId,
        pillar: draft.pillar.trim(),
        siteId: draft.siteId,
        plannedStart: draft.plannedStart,
        plannedEnd: draft.plannedEnd,
        steps: named.map((step) => ({
          name: step.name.trim(),
          ownerId: step.ownerId,
          plannedStart: step.plannedStart,
          plannedEnd: step.plannedEnd,
        })),
      },
    });
    setSaving(false);
    if (result?.state) onSaved(result.createdId);
  }

  return (
    <div className="stack">
      <h2 style={{ color: "#305496" }}>Create workflow</h2>
      {initial ? <div className="banner warn">Review this workflow from the chat, then save it.</div> : null}
      {error ? <div className="banner error">{error}</div> : null}
      <div className="form-grid">
        <label className="field">Workflow name
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label className="field">Owner
          <PeopleSelect users={state.users} value={draft.ownerId} onChange={(ownerId) => setDraft({ ...draft, ownerId })} />
        </label>
        <label className="field">Pillar
          <input list="workflow-pillars" value={draft.pillar} onChange={(event) => setDraft({ ...draft, pillar: event.target.value })} />
          <datalist id="workflow-pillars">
            {pillars.map((pillar) => <option key={pillar} value={pillar} />)}
          </datalist>
        </label>
        <label className="field">Site
          <select value={draft.siteId} onChange={(event) => setDraft({ ...draft, siteId: event.target.value })}>
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </label>
        <label className="field">Planned start
          <input type="date" value={draft.plannedStart} onChange={(event) => setDraft({ ...draft, plannedStart: event.target.value })} />
        </label>
        <label className="field">Planned end
          <input type="date" value={draft.plannedEnd} onChange={(event) => setDraft({ ...draft, plannedEnd: event.target.value })} />
        </label>
      </div>
      <p className="muted">Tasks run in this order. Each task depends on the one above it.</p>
      <div className="sheet-wrap">
        <Sheet>
          <thead>
            <tr>
              <th>#</th>
              <th className="task">Task</th>
              <th>Owner</th>
              <th>Planned start</th>
              <th>Planned end</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {draft.steps.map((step, index) => (
              <tr key={step.key}>
                <td>{index + 1}</td>
                <td><input style={{ width: 280 }} value={step.name} onChange={(event) => patchStep(step.key, { name: event.target.value })} /></td>
                <td><PeopleSelect users={state.users} value={step.ownerId} onChange={(ownerId) => patchStep(step.key, { ownerId })} /></td>
                <td><input type="date" value={step.plannedStart} onChange={(event) => patchStep(step.key, { plannedStart: event.target.value })} /></td>
                <td><input type="date" value={step.plannedEnd} onChange={(event) => patchStep(step.key, { plannedEnd: event.target.value })} /></td>
                <td className="actions">
                  <button className="btn small ghost" disabled={index === 0} onClick={() => moveStep(index, -1)}>Up</button>
                  <button className="btn small ghost" disabled={index === draft.steps.length - 1} onClick={() => moveStep(index, 1)}>Down</button>
                  <button className="btn small ghost" onClick={() => {
                    const steps = draft.steps.filter((item) => item.key !== step.key);
                    setDraft({ ...draft, steps: steps.length ? steps : [blankStep(draft.plannedStart, draft.plannedEnd)] });
                  }}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </Sheet>
      </div>
      <div className="toolbar">
        <button className="btn ghost" onClick={() => setDraft({ ...draft, steps: [...draft.steps, blankStep(draft.plannedStart, draft.plannedEnd)] })}>Add task</button>
        <button className="btn navy" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save workflow"}</button>
        <button className="btn ghost" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function draftFrom(state, sites, initial) {
  const start = initial?.plannedStart || state.today;
  const end = initial?.plannedEnd || (state.project.endDate && start < state.project.endDate ? shiftDate(start, 14) : start);
  const named = (initial?.steps || []).filter((step) => String(step.name || "").trim());
  return {
    name: initial?.name || "",
    ownerId: initial?.ownerId || "",
    pillar: initial?.pillar || "",
    siteId: initial?.siteId || state.project.siteId || sites[0]?.id || "",
    plannedStart: start,
    plannedEnd: end,
    steps: named.length
      ? named.map((step) => {
        stepSerial += 1;
        return {
          key: stepSerial,
          name: step.name,
          ownerId: step.ownerId || "",
          plannedStart: step.plannedStart || start,
          plannedEnd: step.plannedEnd || end,
        };
      })
      : [blankStep(start, shiftDate(start, 7) || end)],
  };
}

function shiftDate(iso, days) {
  const [year, month, day] = String(iso || "").slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "";
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${nextMonth}-${nextDay}`;
}
