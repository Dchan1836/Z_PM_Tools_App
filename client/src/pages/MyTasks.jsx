import { useState } from "react";
import { assignmentClass, fmt, statusClass } from "../format.js";
import { PeopleSelect, Sheet } from "../components/ui.jsx";
import { useGo, useProject, useRun } from "../store/hooks.js";

export default function MyTasks() {
  const state = useProject();
  const run = useRun();
  const go = useGo();
  const mine = state.tasks.filter((task) => task.ownerId === state.me.id && task.assignmentStatus !== "pending" && task.assignmentStatus !== "proposed");
  const incoming = state.tasks.filter((task) => task.ownerId === state.me.id && (task.assignmentStatus === "pending" || task.assignmentStatus === "proposed"));
  const proposals = state.tasks.filter((task) => task.assignmentStatus === "proposed" && canManage(state));

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>My Tasks — {state.me.firstName} {state.me.lastName}</h1>
          <p>Work assigned to you, plus anything still waiting on an accept, reject, or a new date.</p>
        </div>
      </div>
      <h2 style={{ color: "#305496", marginBottom: 8 }}>On my list</h2>
      <TaskRows tasks={mine} go={go} />
      <h2 style={{ color: "#305496", margin: "18px 0 8px" }}>Waiting for my response</h2>
      <p className="muted" style={{ marginBottom: 8 }}>Accept it, reject it with a comment, propose a new date, reassign it, or add a comment.</p>
      {incoming.length === 0 ? <p className="muted">Nothing waiting.</p> : incoming.map((task) => (
        <ResponseCard key={task.id} task={task} users={state.users} run={run} />
      ))}
      {proposals.length ? (
        <>
          <h2 style={{ color: "#305496", margin: "18px 0 8px" }}>Dates proposed to me</h2>
          {proposals.map((task) => (
            <article key={task.id} className="card" style={{ marginBottom: 8 }}>
              <strong>{task.name}</strong>
              <p>{task.ownerName} proposed {fmt(task.proposedStart)} – {fmt(task.proposedEnd)}. {task.proposalComment}</p>
              <div className="toolbar" style={{ marginTop: 8 }}>
                <button className="btn" onClick={() => run({ type: "acceptProposal", taskId: task.id, accept: true })}>Accept changes</button>
                <button className="btn ghost" onClick={() => run({ type: "acceptProposal", taskId: task.id, accept: false })}>Decline</button>
              </div>
            </article>
          ))}
        </>
      ) : null}
      <SubtaskBox state={state} run={run} />
    </section>
  );
}

function canManage(state) {
  return ["organization", "project", "tracker", "task"].includes(state.me.permission);
}

function TaskRows({ tasks, go }) {
  return (
    <div className="sheet-wrap">
      <Sheet>
        <thead>
          <tr>
            <th className="task">Task starts</th>
            <th className="task">Pillar / Area</th>
            <th className="task">Task</th>
            <th>Planned end</th>
            <th>Status</th>
            <th>%</th>
            <th>Links</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className={`${statusClass(task.status)} ${assignmentClass(task.assignmentStatus)}`}>
              <td>{task.window}</td>
              <td>{task.pillar}</td>
              <td>{task.name}</td>
              <td>{fmt(task.plannedEnd)}</td>
              <td>{task.status}</td>
              <td>{task.percent == null ? "" : `${Math.round(task.percent)}%`}</td>
              <td className="actions">
                <button className="btn small" onClick={() => go("meetings", task.id)}>Meetings</button>
                <button className="btn small orange" onClick={() => go("documents", task.id)}>Documents</button>
                <button className="btn small yellow" onClick={() => go("trackers", task.id)}>Tracker</button>
                <button className="btn small green" onClick={() => go("issues", task.id)}>Issues/Risks</button>
              </td>
            </tr>
          ))}
          {tasks.length === 0 ? <tr><td colSpan={7}>No tasks on your list yet.</td></tr> : null}
        </tbody>
      </Sheet>
    </div>
  );
}

function ResponseCard({ task, users, run }) {
  const [open, setOpen] = useState("");
  const [comment, setComment] = useState("");
  const [proposedStart, setProposedStart] = useState(task.plannedStart || "");
  const [proposedEnd, setProposedEnd] = useState(task.plannedEnd || "");
  const [reassignTo, setReassignTo] = useState("");

  async function send(decision) {
    await run({ type: "respondAssignment", taskId: task.id, decision, comment, proposedStart, proposedEnd, reassignTo });
  }

  return (
    <article className={`card ${assignmentClass(task.assignmentStatus)}`} style={{ marginBottom: 8 }}>
      <strong>{task.name}</strong>
      <p className="muted">{task.pillar} · {fmt(task.plannedStart)} – {fmt(task.plannedEnd)} · {task.negotiable ? "Dates are negotiable" : "Dates are fixed"}</p>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <button className="btn" onClick={() => send("accept")}>Accept</button>
        <button className="btn ghost" onClick={() => setOpen(open === "reject" ? "" : "reject")}>Reject</button>
        <button className="btn orange" onClick={() => setOpen(open === "propose" ? "" : "propose")}>Propose new date</button>
        <button className="btn ghost" onClick={() => setOpen(open === "reassign" ? "" : "reassign")}>Reassign</button>
        <button className="btn ghost" onClick={() => setOpen(open === "comment" ? "" : "comment")}>Add comment</button>
      </div>
      {open ? (
        <div className="stack" style={{ marginTop: 10 }}>
          {open === "propose" ? (
            <div className="form-grid">
              <label className="field">Start<input type="date" value={proposedStart} onChange={(event) => setProposedStart(event.target.value)} /></label>
              <label className="field">End<input type="date" value={proposedEnd} onChange={(event) => setProposedEnd(event.target.value)} /></label>
            </div>
          ) : null}
          {open === "reassign" ? (
            <label className="field">Coworker
              <PeopleSelect users={users.filter((user) => user.id !== task.ownerId)} value={reassignTo} onChange={setReassignTo} allowEmpty={false} />
            </label>
          ) : null}
          <label className="field">{open === "reject" || open === "reassign" ? "Comment (required)" : "Comment"}
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} />
          </label>
          <button className="btn navy" onClick={() => send(open)}>{open === "propose" ? "Send proposed dates" : "Send"}</button>
        </div>
      ) : null}
    </article>
  );
}

function SubtaskBox({ state, run }) {
  const parents = state.tasks.filter((task) => task.ownerId === state.me.id);
  const [parentId, setParentId] = useState(parents[0]?.id || "");
  const [name, setName] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [negotiable, setNegotiable] = useState(true);
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  if (!parents.length) return null;
  return (
    <article className="card" style={{ marginTop: 18 }}>
      <h3>Create a subtask</h3>
      <p className="muted">Hand a piece of your task to someone else, with a negotiable or a fixed date.</p>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <label className="field">Under
          <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
            {parents.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
          </select>
        </label>
        <label className="field">Subtask<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field">Assign to
          <PeopleSelect users={state.users} value={ownerId} onChange={setOwnerId} />
        </label>
        <label className="field">Start<input type="date" value={plannedStart} onChange={(event) => setPlannedStart(event.target.value)} /></label>
        <label className="field">End<input type="date" value={plannedEnd} onChange={(event) => setPlannedEnd(event.target.value)} /></label>
      </div>
      <label className="checkline" style={{ margin: "8px 0" }}>
        <input type="checkbox" checked={negotiable} onChange={(event) => setNegotiable(event.target.checked)} /> Negotiable dates
      </label>
      <button className="btn" onClick={() => run({ type: "addSubtask", parentId, name, ownerId, negotiable, plannedStart, plannedEnd })}>Add subtask</button>
    </article>
  );
}
