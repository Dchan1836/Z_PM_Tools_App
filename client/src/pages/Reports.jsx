import { useState } from "react";
import { fmt, statusClass } from "../format.js";
import { Sheet } from "../components/ui.jsx";
import { useProject, useRun } from "../store/hooks.js";

export default function Reports() {
  const state = useProject();
  const run = useRun();
  const flagged = state.tasks.filter((task) => task.inReport);
  const [name, setName] = useState("Weekly status");
  const [date, setDate] = useState(state.today);
  const [activeId, setActiveId] = useState(state.reports[0]?.id || "");
  const [customTitle, setCustomTitle] = useState("");
  const [line, setLine] = useState("");
  const [lines, setLines] = useState([]);
  const [email, setEmail] = useState("");
  const active = state.reports.find((report) => report.id === activeId);
  const shown = active ? state.tasks.filter((task) => active.taskIds.includes(task.id)) : flagged;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p>Tasks marked Add to report on the master plan collect here. Save a report and you can send the same one again later.</p>
        </div>
      </div>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <button className={activeId ? "btn ghost" : "btn navy"} onClick={() => setActiveId("")}>Unsaved basket ({flagged.length})</button>
        {state.reports.map((report) => (
          <button key={report.id} className={activeId === report.id ? "btn navy" : "btn ghost"} onClick={() => setActiveId(report.id)}>{report.name}</button>
        ))}
      </div>
      <div className="sheet-wrap">
        <Sheet>
          <thead>
            <tr>
              <th className="task">Window</th><th className="task">Pillar</th><th className="task">Task</th><th className="task">Owner</th>
              <th>Start</th><th>End</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((task) => (
              <tr key={task.id} className={statusClass(task.status)}>
                <td>{task.window}</td>
                <td>{task.pillar}</td>
                <td>{task.name}</td>
                <td>{task.ownerName}</td>
                <td>{fmt(task.plannedStart)}</td>
                <td>{fmt(task.plannedEnd)}</td>
                <td>{task.status}</td>
              </tr>
            ))}
          </tbody>
        </Sheet>
      </div>
      {active?.customLines?.length ? (
        <ul>{active.customLines.map((entry, index) => <li key={index}>{entry}</li>)}</ul>
      ) : null}
      <div className="split" style={{ marginTop: 16 }}>
        <article className="card">
          <h3>Save this report</h3>
          <div className="form-grid" style={{ marginTop: 8 }}>
            <label className="field">Report name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="field">Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          </div>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button className="btn navy" onClick={() => run({ type: "saveReport", id: activeId || undefined, name, date, taskIds: shown.map((task) => task.id), customLines: active?.customLines || [] })}>Save report</button>
          </div>
          <label className="field" style={{ marginTop: 10 }}>Email to
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@va.gov" />
          </label>
          <button className="btn" disabled={!active} onClick={() => run({ type: "emailReport", id: active.id, to: email })}>Email report</button>
        </article>
        <article className="card">
          <h3>Create a custom report</h3>
          <p className="muted">Write the lines yourself when the basket is not the report you need.</p>
          <label className="field" style={{ marginTop: 8 }}>Report title<input value={customTitle} onChange={(event) => setCustomTitle(event.target.value)} /></label>
          <div className="inline">
            <input className="search" value={line} onChange={(event) => setLine(event.target.value)} placeholder="Add a line item" />
            <button className="btn ghost" onClick={() => { if (line.trim()) { setLines([...lines, line.trim()]); setLine(""); } }}>Add line</button>
          </div>
          <ul>{lines.map((entry, index) => <li key={index}>{entry}</li>)}</ul>
          <button className="btn navy" onClick={async () => {
            const result = await run({ type: "saveReport", name: customTitle || "Custom report", date, taskIds: [], customLines: lines });
            if (result?.state) { setLines([]); setCustomTitle(""); }
          }}>Save custom report</button>
        </article>
      </div>
    </section>
  );
}
