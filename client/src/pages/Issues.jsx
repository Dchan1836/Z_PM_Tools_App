import { useState } from "react";
import { fmt } from "../format.js";
import { PeopleSelect, Sheet, SortButton, useSort } from "../components/ui.jsx";
import { useFocusTaskId, useProject, useRun } from "../store/hooks.js";

const STATUSES = ["Open", "Monitoring", "Mitigating", "Resolved", "Closed"];

export default function Issues() {
  const state = useProject();
  const run = useRun();
  const focusTaskId = useFocusTaskId();
  const rows = state.issues.filter((issue) => !focusTaskId || issue.taskId === focusTaskId);
  const [editing, setEditing] = useState(null);
  const [noteFor, setNoteFor] = useState("");
  const [note, setNote] = useState("");
  const { sort, toggle, ordered } = useSort();
  const tableRows = ordered(rows, (issue, key) => {
    if (key === "title") return issue.title;
    if (key === "priority") return issue.priority;
    if (key === "deadline") return issue.deadline;
    if (key === "owner") return issue.ownerName;
    if (key === "flag") return issue.flag;
    if (key === "resolution") return issue.resolutionDate;
    if (key === "status") return issue.status;
    return "";
  });

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Risks and issues</h1>
          <p>Past the deadline with no resolution date, an item becomes an Issue and turns red. Within a week it turns yellow. Resolved items turn green.</p>
        </div>
        <button className="btn" onClick={() => setEditing({ title: "", description: "", priority: "Medium", deadline: "", ownerId: state.me.id, taskId: focusTaskId || "", status: "Open" })}>Add a risk</button>
      </div>
      {focusTaskId ? <p className="tag">Showing items for this task</p> : null}
      <div className="sheet-wrap" style={{ marginTop: 10 }}>
        <Sheet>
          <thead>
            <tr>
              <th>#</th>
              <th><SortButton label="Title" column="title" sort={sort} onSort={toggle} /></th>
              <th><SortButton label="Priority" column="priority" sort={sort} onSort={toggle} /></th>
              <th><SortButton label="Deadline" column="deadline" sort={sort} onSort={toggle} /></th>
              <th><SortButton label="Owner" column="owner" sort={sort} onSort={toggle} /></th>
              <th><SortButton label="Issue / Risk" column="flag" sort={sort} onSort={toggle} /></th>
              <th><SortButton label="Resolution date" column="resolution" sort={sort} onSort={toggle} /></th>
              <th><SortButton label="Status" column="status" sort={sort} onSort={toggle} /></th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tableRows.map((issue, index) => (
              <tr key={issue.id} className={issue.tone === "red" ? "row-late" : issue.tone === "green" ? "row-green" : issue.tone === "yellow" ? "st-d1" : ""}>
                <td>{index + 1}</td>
                <td>{issue.title}</td>
                <td>{issue.priority}</td>
                <td>{fmt(issue.deadline)}</td>
                <td>{issue.ownerName}</td>
                <td>{issue.flag}</td>
                <td>{fmt(issue.resolutionDate)}</td>
                <td>
                  <select value={issue.status} onChange={(event) => run({ type: "saveIssue", issue: { ...issue, status: event.target.value, resolutionDate: event.target.value === "Resolved" && !issue.resolutionDate ? state.today : issue.resolutionDate } })}>
                    {STATUSES.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </td>
                <td><button className="btn small ghost" onClick={() => setNoteFor(issue.id)}>Notes</button></td>
              </tr>
            ))}
          </tbody>
        </Sheet>
      </div>
      {rows.filter((issue) => issue.id === noteFor).map((issue) => (
        <article key={issue.id} className="card" style={{ marginTop: 12 }}>
          <h3>Notes — {issue.title}</h3>
          {issue.notes.map((entry) => (
            <p key={entry.id}><b>{fmt(entry.date)}</b> — {entry.text}</p>
          ))}
          {issue.notes.length === 0 ? <p className="muted">Each note is kept on its own line with the date filled in.</p> : null}
          <div className="inline" style={{ marginTop: 8 }}>
            <input className="search" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Write a note" />
            <button className="btn" onClick={async () => { const result = await run({ type: "addIssueNote", issueId: issue.id, text: note }); if (result?.state) setNote(""); }}>Save note</button>
          </div>
        </article>
      ))}
      {editing ? (
        <article className="card" style={{ marginTop: 12 }}>
          <h3>Add a risk</h3>
          <div className="form-grid" style={{ marginTop: 8 }}>
            <label className="field">Title<input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label>
            <label className="field">Description<textarea value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label>
            <label className="field">Priority
              <select value={editing.priority} onChange={(event) => setEditing({ ...editing, priority: event.target.value })}>
                <option>Low</option><option>Medium</option><option>High</option>
              </select>
            </label>
            <label className="field">Deadline<input type="date" value={editing.deadline} onChange={(event) => setEditing({ ...editing, deadline: event.target.value })} /></label>
            <label className="field">Owner
              <PeopleSelect users={state.users} value={editing.ownerId} onChange={(value) => setEditing({ ...editing, ownerId: value })} />
            </label>
            <label className="field">Task
              <select value={editing.taskId} onChange={(event) => setEditing({ ...editing, taskId: event.target.value })}>
                <option value="">Not tied to a task</option>
                {state.tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
              </select>
            </label>
          </div>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button className="btn navy" onClick={async () => { const result = await run({ type: "saveIssue", issue: editing }); if (result?.state) setEditing(null); }}>Save risk</button>
            <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </article>
      ) : null}
    </section>
  );
}
