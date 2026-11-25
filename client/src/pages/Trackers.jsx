import { useMemo, useState } from "react";
import { can } from "../format.js";
import { Modal, Sheet, SortButton, useSort } from "../components/ui.jsx";
import { useFocusTaskId, useProject, useRun } from "../store/hooks.js";

const TYPES = ["text", "date", "status", "number"];

export default function Trackers() {
  const state = useProject();
  const run = useRun();
  const focusTaskId = useFocusTaskId();
  const linked = focusTaskId ? state.trackers.filter((tracker) => tracker.taskId === focusTaskId || state.tasks.find((task) => task.id === focusTaskId)?.trackerId === tracker.id) : state.trackers;
  const [openId, setOpenId] = useState(linked[0]?.id || state.trackers[0]?.id || "");
  const [creating, setCreating] = useState(false);
  const tracker = state.trackers.find((item) => item.id === openId) || linked[0];
  const editable = can(state.me, "tracker");

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Trackers</h1>
          <p>Milestone columns roll up. A parent tracker shows each child’s fraction, and that percent lands on the master task it is attached to.</p>
        </div>
        {editable ? <button className="btn" onClick={() => setCreating(true)}>Create tracker</button> : null}
      </div>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        {(focusTaskId ? linked : state.trackers).map((item) => (
          <button key={item.id} className={item.id === tracker?.id ? "btn navy" : "btn ghost"} onClick={() => setOpenId(item.id)}>
            {item.name}{item.percent != null ? ` · ${item.percent}%` : ""}
          </button>
        ))}
      </div>
      {tracker ? <TrackerGrid tracker={tracker} state={state} run={run} editable={editable} /> : <p className="muted">No tracker is attached to this task yet.</p>}
      {editable && tracker ? (
        <AttachBar key={tracker.id} state={state} tracker={tracker} run={run} />
      ) : null}
      {creating ? <CreateTracker onClose={() => setCreating(false)} run={run} /> : null}
    </section>
  );
}

function TrackerGrid({ tracker, run, editable }) {
  const milestones = tracker.columns.filter((column) => column.milestone);
  const { sort, toggle, ordered } = useSort();
  const rows = ordered(tracker.rows, (row, key) => {
    if (key === "rowPercent") return row.rowPercent;
    const column = tracker.columns.find((item) => item.id === key);
    if (!column) return "";
    if (column.dataType === "rollup") return row.rollups?.[column.id]?.text || "";
    return row.cells?.[column.id] || "";
  });
  return (
    <div className="card">
      <div className="inline" style={{ justifyContent: "space-between" }}>
        <h3>{tracker.name}</h3>
        {tracker.percent != null ? <span className="tag">{tracker.percent}% on the driving milestone</span> : null}
      </div>
      <div className="sheet-wrap" style={{ marginTop: 10 }}>
        <Sheet>
          <thead>
            <tr>
              {tracker.columns.map((column) => (
                <th key={column.id}>
                  <SortButton
                    label={`${column.name}${column.milestone ? ` · M${column.milestone}` : ""}${column.required ? " *" : ""}`}
                    column={column.id}
                    sort={sort}
                    onSort={toggle}
                  />
                </th>
              ))}
              <th><SortButton label="Row %" column="rowPercent" sort={sort} onSort={toggle} /></th>
              {editable ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {tracker.columns.map((column) => (
                  <td key={column.id}>
                    {column.dataType === "rollup" ? (
                      <b>{row.rollups?.[column.id]?.text || "—"}</b>
                    ) : column.dataType === "status" && editable ? (
                      <select value={row.cells?.[column.id] || ""} onChange={(event) => run({ type: "updateTrackerCell", trackerId: tracker.id, rowId: row.id, columnId: column.id, value: event.target.value })}>
                        <option value="" />
                        <option>Yes</option>
                        <option>No</option>
                        <option>Complete</option>
                      </select>
                    ) : editable ? (
                      <input defaultValue={row.cells?.[column.id] || ""} key={`${row.id}-${column.id}-${row.cells?.[column.id] || ""}`} onBlur={(event) => {
                        if (event.target.value !== (row.cells?.[column.id] || "")) {
                          run({ type: "updateTrackerCell", trackerId: tracker.id, rowId: row.id, columnId: column.id, value: event.target.value });
                        }
                      }} />
                    ) : (row.cells?.[column.id] || "")}
                  </td>
                ))}
                <td>{row.rowPercent == null ? "" : `${Math.round(row.rowPercent * 100)}%`}</td>
                {editable ? <td><button className="btn small danger" onClick={() => run({ type: "deleteTrackerRow", trackerId: tracker.id, rowId: row.id })}>Delete</button></td> : null}
              </tr>
            ))}
            {milestones.length && tracker.kind !== "parent" ? (
              <tr>
                {tracker.columns.map((column) => (
                  <td key={column.id}>
                    {column.milestone ? <b>{fraction(tracker, column.id)}</b> : ""}
                  </td>
                ))}
                <td colSpan={editable ? 2 : 1} />
              </tr>
            ) : null}
          </tbody>
        </Sheet>
      </div>
      {editable ? (
        <div className="toolbar" style={{ marginTop: 10 }}>
          <button className="btn ghost" onClick={() => run({ type: "addTrackerRow", trackerId: tracker.id })}>Add row</button>
          <ColumnEditor tracker={tracker} run={run} />
        </div>
      ) : null}
    </div>
  );
}

function fraction(tracker, columnId) {
  const rows = tracker.rows || [];
  const done = rows.filter((row) => ["yes", "complete"].includes(String(row.cells?.[columnId] || "").toLowerCase())).length;
  return `${done}/${rows.length}`;
}

function ColumnEditor({ tracker, run }) {
  const [open, setOpen] = useState(false);
  const [column, setColumn] = useState({ name: "", dataType: "text", required: true, milestone: 0 });
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>Add column</button>;
  return (
    <div className="form-grid" style={{ width: "100%" }}>
      <label className="field">Column name<input value={column.name} onChange={(event) => setColumn({ ...column, name: event.target.value })} /></label>
      <label className="field">Data type
        <select value={column.dataType} onChange={(event) => setColumn({ ...column, dataType: event.target.value })}>
          {TYPES.map((type) => <option key={type}>{type}</option>)}
        </select>
      </label>
      <label className="field">Milestone
        <select value={column.milestone} onChange={(event) => setColumn({ ...column, milestone: Number(event.target.value) })}>
          <option value={0}>Not a milestone</option>
          <option value={1}>Milestone 1</option>
          <option value={2}>Milestone 2</option>
          <option value={3}>Milestone 3</option>
        </select>
      </label>
      <label className="checkline"><input type="checkbox" checked={column.required} onChange={(event) => setColumn({ ...column, required: event.target.checked })} /> Required</label>
      <button className="btn navy" onClick={() => { run({ type: "addTrackerColumn", trackerId: tracker.id, column }); setOpen(false); }}>Save column</button>
    </div>
  );
}

function AttachBar({ state, tracker, run }) {
  const [taskId, setTaskId] = useState(tracker.taskId || "");
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3>Insert into the master plan</h3>
      <p className="muted">Pick a task. The driving milestone’s percent complete becomes that task’s percent complete.</p>
      <div className="inline" style={{ marginTop: 8 }}>
        <select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
          <option value="">Select a task</option>
          {state.tasks.filter((task) => task.level === 0).map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
        </select>
        <button className="btn yellow" disabled={!taskId} onClick={() => run({ type: "attachTracker", taskId, trackerId: tracker.id })}>Insert tracker</button>
      </div>
    </div>
  );
}

function CreateTracker({ onClose, run }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [count, setCount] = useState(4);
  const [rowCount, setRowCount] = useState(3);
  const [index, setIndex] = useState(0);
  const [columns, setColumns] = useState([]);
  const current = columns[index] || { name: "", dataType: "text", required: true, milestone: 0 };

  function saveColumn(nextIndex) {
    const copy = [...columns];
    copy[index] = current;
    setColumns(copy);
    setIndex(nextIndex);
  }

  const ready = useMemo(() => columns.filter((column) => column?.name).length, [columns]);

  return (
    <Modal title="Create tracker" onClose={onClose}>
      {step === 1 ? (
        <div className="stack">
          <label className="field">Tracker name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="field">How many columns?
            <input type="number" min="1" max="12" value={count} onChange={(event) => setCount(Number(event.target.value))} />
          </label>
          <label className="field">How many rows to start?
            <input type="number" min="1" max="50" value={rowCount} onChange={(event) => setRowCount(Number(event.target.value))} />
          </label>
          <button className="btn" onClick={() => { setColumns(Array.from({ length: count }, () => ({ name: "", dataType: "text", required: true, milestone: 0 }))); setStep(2); }}>Add columns</button>
        </div>
      ) : (
        <div className="stack">
          <p className="muted">Column {index + 1} of {count}. Configure one column at a time. You can edit or delete columns after the tracker exists.</p>
          <div className="form-grid">
            <label className="field">Column name<input value={current.name} onChange={(event) => setColumns(columns.map((column, columnIndex) => columnIndex === index ? { ...current, name: event.target.value } : column))} /></label>
            <label className="field">Data type
              <select value={current.dataType} onChange={(event) => setColumns(columns.map((column, columnIndex) => columnIndex === index ? { ...current, dataType: event.target.value } : column))}>
                {TYPES.map((type) => <option key={type}>{type}</option>)}
              </select>
            </label>
            <label className="field">Milestone
              <select value={current.milestone} onChange={(event) => setColumns(columns.map((column, columnIndex) => columnIndex === index ? { ...current, milestone: Number(event.target.value) } : column))}>
                <option value={0}>No</option>
                <option value={1}>Milestone 1</option>
                <option value={2}>Milestone 2</option>
                <option value={3}>Milestone 3</option>
              </select>
            </label>
            <label className="checkline">
              <input type="checkbox" checked={current.required} onChange={(event) => setColumns(columns.map((column, columnIndex) => columnIndex === index ? { ...current, required: event.target.checked } : column))} />
              Required
            </label>
          </div>
          <div className="toolbar">
            <button className="btn ghost" disabled={index === 0} onClick={() => saveColumn(index - 1)}>Previous</button>
            {index < count - 1 ? <button className="btn" onClick={() => saveColumn(index + 1)}>Next column</button> : null}
            <button className="btn navy" disabled={ready < 1 && !current.name} onClick={async () => {
              const finalColumns = columns.map((column, columnIndex) => columnIndex === index ? current : column).filter((column) => column?.name);
              const result = await run({ type: "createTracker", name, columns: finalColumns, rowCount });
              if (result?.state) onClose();
            }}>Create tracker</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
