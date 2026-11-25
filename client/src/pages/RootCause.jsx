import { useMemo, useState } from "react";
import { fmt } from "../format.js";
import { Sheet } from "../components/ui.jsx";
import { useFocusTaskId, useProject, useRun } from "../store/hooks.js";

export default function RootCause() {
  const state = useProject();
  const run = useRun();
  const focusTaskId = useFocusTaskId();
  const levelOne = state.tasks.filter((task) => !task.level);
  const [selectedId, setSelectedId] = useState(focusTaskId || levelOne.find((task) => task.status === "Late")?.id || levelOne[0]?.id || "");
  const selected = state.tasks.find((task) => task.id === selectedId);
  const chain = useMemo(() => selected ? causeChain(state.tasks, selected) : [], [state.tasks, selected]);
  const [note, setNote] = useState("Can you send an update on what is blocking this task?");
  const [sent, setSent] = useState("");

  const span = chain.reduce((range, task) => {
    for (const value of [task.plannedStart, task.plannedEnd, task.actualStart, task.actualEnd]) {
      if (value && (!range.min || value < range.min)) range.min = value;
      if (value && (!range.max || value > range.max)) range.max = value;
    }
    return range;
  }, { min: "", max: "" });

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Late tasks — root cause</h1>
          <p>Level 1 tasks are listed below. Open a late one to see the task on the chain that is driving the delay, then ask the owner for an update.</p>
        </div>
      </div>
      <div className="sheet-wrap">
        <Sheet>
          <thead>
            <tr><th className="task">Task</th><th>Owner</th><th>Planned end</th><th>Status</th><th>Late start</th></tr>
          </thead>
          <tbody>
            {levelOne.map((task) => (
              <tr key={task.id} className={task.status === "Late" ? "row-late" : task.status === "Complete" ? "row-green" : ""} onClick={() => setSelectedId(task.id)} style={{ cursor: "pointer", outline: task.id === selectedId ? "2px solid #305496" : undefined }}>
                <td>{task.name}</td>
                <td>
                  {task.ownerName ? (
                    <button className="linkish" onClick={(event) => { event.stopPropagation(); setSelectedId(task.id); }}>{task.ownerName}</button>
                  ) : "—"}
                </td>
                <td>{fmt(task.plannedEnd)}</td>
                <td>{task.status}</td>
                <td>{task.lateStart}</td>
              </tr>
            ))}
          </tbody>
        </Sheet>
      </div>
      {selected ? (
        <div className="split" style={{ marginTop: 16 }}>
          <div>
            <h2 style={{ color: "#305496", marginBottom: 8 }}>What is delaying {selected.name}</h2>
            <div className="gantt">
              {chain.map((task) => {
                const left = percentBetween(span.min, span.max, task.plannedStart);
                const right = percentBetween(span.min, span.max, task.plannedEnd || task.plannedStart);
                const width = Math.max(right - left, 2);
                const delaying = task.id === driverId(chain);
                return (
                  <div key={task.id} className="gantt-row">
                    <div className="gantt-label" style={{ paddingLeft: 8 + (task.level || 0) * 14, fontWeight: delaying ? 800 : 500, color: delaying ? "#9c0006" : "inherit" }}>
                      {task.name}
                      <div className="muted">{task.status}{task.ownerName ? ` · ${task.ownerName}` : ""}</div>
                    </div>
                    <div className="gantt-track">
                      <div className={`bar ${delaying ? "delay" : task.level ? "ok" : "summary"}`} style={{ left: `${left}%`, width: `${width}%` }} title={`${fmt(task.plannedStart)} – ${fmt(task.plannedEnd)}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <article className="card">
            <h3>Ask {selected.ownerName || "the owner"} for an update</h3>
            <p className="muted">{state.users.find((user) => user.id === selected.ownerId)?.email}</p>
            <label className="field" style={{ marginTop: 8 }}>Message
              <textarea value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <button className="btn" style={{ marginTop: 8 }} disabled={!selected.ownerId} onClick={async () => {
              const result = await run({ type: "requestUpdate", taskId: selected.id, note });
              if (result?.state) setSent(`Update requested from ${selected.ownerName}.`);
            }}>Send update request</button>
            {sent ? <p className="banner ok" style={{ marginTop: 8 }}>{sent}</p> : null}
            {state.users.find((user) => user.id === selected.ownerId)?.email ? (
              <p style={{ marginTop: 8 }}>
                <a href={`mailto:${state.users.find((user) => user.id === selected.ownerId).email}?subject=${encodeURIComponent(`Update requested: ${selected.name}`)}&body=${encodeURIComponent(note)}`}>Open in email</a>
              </p>
            ) : null}
          </article>
        </div>
      ) : null}
    </section>
  );
}

function causeChain(tasks, task) {
  const children = [];
  const walk = (id) => {
    tasks.filter((item) => item.parentId === id).forEach((child) => {
      children.push(child);
      walk(child.id);
    });
  };
  walk(task.id);
  const group = [task, ...children];
  if (group.length > 1) return group;
  const chain = [task];
  let cursor = task;
  const guard = new Set([task.id]);
  while (cursor.predecessorId && !guard.has(cursor.predecessorId)) {
    const previous = tasks.find((item) => item.id === cursor.predecessorId);
    if (!previous) break;
    chain.unshift(previous);
    guard.add(previous.id);
    cursor = previous;
  }
  return chain;
}

function driverId(chain) {
  const late = chain.filter((task) => task.status === "Late" || task.status === "Actual Start Date Missing");
  const pool = late.length ? late : chain.filter((task) => task.status !== "Complete");
  const ranked = [...pool].sort((a, b) => (b.level || 0) - (a.level || 0) || String(a.plannedEnd).localeCompare(String(b.plannedEnd)));
  return ranked[0]?.id;
}

function percentBetween(min, max, value) {
  if (!min || !max || !value || min === max) return 0;
  const start = new Date(min).getTime();
  const end = new Date(max).getTime();
  const point = new Date(value).getTime();
  return Math.min(100, Math.max(0, ((point - start) / (end - start)) * 100));
}
