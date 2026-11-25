import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fmt } from "../format.js";
import { PeopleSelect, Sheet } from "../components/ui.jsx";
import { draftMeeting, quietAuthError, upload } from "../api.js";
import { useAbsorb, useFocusTaskId, useProject, useRun } from "../store/hooks.js";
import { clearMeetingNotes } from "../store/uiSlice.js";

const emptyMeeting = (taskId) => ({
  title: "",
  date: "",
  time: "",
  facilitatorId: "",
  participantIds: [],
  taskId: taskId || "",
  agenda: [
    { topic: "", ownerId: "", time: "", notes: "", isDecision: false, actions: [] },
  ],
});

export default function Meetings() {
  const state = useProject();
  const run = useRun();
  const absorb = useAbsorb();
  const focusTaskId = useFocusTaskId();
  const [mode, setMode] = useState("archive");
  const [draft, setDraft] = useState(null);
  const [openId, setOpenId] = useState("");
  const [sort, setSort] = useState({ key: "date", dir: 1 });
  const [query, setQuery] = useState("");
  const [decisionSort, setDecisionSort] = useState({ key: "date", dir: 1 });
  const [noteText, setNoteText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [draftNotice, setDraftNotice] = useState("");
  const meetingNotes = useSelector((store) => store.ui.meetingNotes);
  const dispatch = useDispatch();
  const seenNotes = useRef("");

  const templates = state.meetings.filter((meeting) => meeting.isTemplate);

  async function fillFromNotes(text, { defaultOwner = false } = {}) {
    const source = String(text ?? noteText).trim();
    if (!source) return;
    setNoteText(source);
    setDraftError("");
    setDrafting(true);
    setMode("notes");
    try {
      const result = await draftMeeting(source, { defaultOwner });
      const meeting = result.meeting;
      setDraft({
        title: meeting.title,
        date: meeting.date,
        time: meeting.time,
        facilitatorId: meeting.facilitatorId,
        facilitatorName: meeting.facilitatorName || "",
        participantIds: meeting.participantIds,
        participants: meeting.participants || [],
        guestNames: meeting.guestNames || [],
        taskId: meeting.taskId || focusTaskId || "",
        agenda: meeting.agenda.map((item) => ({
          topic: item.topic,
          ownerId: item.ownerId,
          ownerName: item.ownerName || "",
          time: item.time,
          notes: item.notes,
          isDecision: item.isDecision,
          actions: (item.actions || []).map((entry) => ({
            action: entry.action,
            ownerId: entry.ownerId,
            ownerName: entry.ownerName || "",
            due: entry.due,
            actualEnd: entry.actualEnd,
          })),
        })),
      });
      const extra = (result.warnings || []).join(" ");
      setDraftNotice(extra ? `Review this draft, then save it. ${extra}` : "Review this draft, then save it.");
      setMode("edit");
    } catch (error) {
      if (quietAuthError(error)) return;
      setDraftError(error.message);
      setMode("notes");
    } finally {
      setDrafting(false);
    }
  }

  useEffect(() => {
    if (!meetingNotes || seenNotes.current === meetingNotes.id) return;
    seenNotes.current = meetingNotes.id;
    const text = meetingNotes.notes;
    dispatch(clearMeetingNotes());
    fillFromNotes(text, { defaultOwner: true });
  }, [meetingNotes]);

  function closeCreate() {
    setDraft(null);
    setDraftNotice("");
    setDraftError("");
    setMode("archive");
  }

  function startBlank() {
    setDraftNotice("");
    setDraft(emptyMeeting(focusTaskId));
    setMode("edit");
  }

  function createFromNotes() {
    fillFromNotes(noteText);
  }

  function startFrom(template) {
    setDraftNotice("");
    setDraft({
      ...template,
      id: undefined,
      isTemplate: false,
      taskId: focusTaskId || template.taskId,
      agenda: template.agenda.map((item) => ({ ...item, id: undefined, notes: "", actions: [], isDecision: false })),
    });
    setMode("edit");
  }

  const notes = useMemo(() => filterSort(state.meetings, query, sort), [state.meetings, query, sort]);
  const decisions = useMemo(() => filterSort(state.decisions, query, decisionSort), [state.decisions, query, decisionSort]);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Meetings</h1>
          <p>Build a recurring agenda, paste notes to draft a meeting, or capture notes for a one-time meeting. Archived notes and key decisions stay searchable.</p>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={() => setMode("new")}>Start new meeting</button>
          <button className="btn navy" onClick={() => { setDraftError(""); setMode("notes"); }}>Create from notes</button>
          <button className="btn ghost" onClick={() => setMode("archive")}>Archived meetings</button>
        </div>
      </div>
      {focusTaskId ? <p className="tag">Filtered from a task</p> : null}

      {mode === "new" ? (
        <div className="split">
          <article className="card">
            <h3>Create recurring meeting agenda</h3>
            <p className="muted">Start a blank agenda. Saving as a template keeps it for the next meeting.</p>
            <button className="btn" style={{ marginTop: 8 }} onClick={startBlank}>New agenda</button>
          </article>
          <article className="card">
            <h3>Select meeting agenda</h3>
            <p className="muted">Pick a template that was saved earlier.</p>
            <div className="stack" style={{ marginTop: 8 }}>
              {templates.map((template) => (
                <button key={template.id} className="btn ghost" onClick={() => startFrom(template)}>{template.title}</button>
              ))}
              {templates.length === 0 ? <p className="muted">No templates yet.</p> : null}
            </div>
          </article>
          <div className="toolbar" style={{ gridColumn: "1 / -1" }}>
            <button className="btn ghost" onClick={closeCreate}>Cancel</button>
          </div>
        </div>
      ) : null}

      {mode === "notes" ? (
        <article className="card">
          <h3>Create a meeting from notes</h3>
          <p className="muted">Paste raw notes. Z PM records what each person said, every action item, and who brought up each topic.</p>
          {draftError ? <div className="banner error" style={{ marginTop: 10 }}>{draftError}</div> : null}
          <label className="field" style={{ marginTop: 10 }}>Meeting notes
            <textarea className="notes-input" value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Paste the notes from the meeting" />
          </label>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button className="btn navy" disabled={drafting || !noteText.trim()} onClick={createFromNotes}>
              {drafting ? "Reading the notes…" : "Create meeting"}
            </button>
            <button className="btn ghost" disabled={drafting} onClick={closeCreate}>Cancel</button>
          </div>
        </article>
      ) : null}

      {mode === "edit" && draft ? (
        <MeetingEditor draft={draft} setDraft={setDraft} state={state} run={run} notice={draftNotice} onDone={closeCreate} />
      ) : null}

      {mode === "archive" ? (
        <div className="split">
          <ArchiveColumn
            title="Meeting notes"
            rows={notes.filter((meeting) => !focusTaskId || meeting.taskId === focusTaskId)}
            sort={sort}
            setSort={setSort}
            query={query}
            setQuery={setQuery}
            onUpload={async (file) => absorb(await upload("meeting", { notes: "" }, file))}
            run={run}
            renderRow={(meeting) => (
              <tr key={meeting.id} onClick={() => setOpenId(openId === meeting.id ? "" : meeting.id)} style={{ cursor: "pointer" }}>
                <td>{fmt(meeting.date)}{meeting.source === "upload" ? " · uploaded" : ""}</td>
                <td>{meeting.source === "upload" ? meeting.fileName : meeting.title}</td>
                <td>{meeting.source === "upload" ? meeting.ownerEmail : meeting.facilitatorName || meeting.ownerEmail}</td>
              </tr>
            )}
            detail={state.meetings.find((meeting) => meeting.id === openId)}
          />
          <div>
            <div className="toolbar" style={{ marginBottom: 8 }}>
              <h2 style={{ color: "#305496" }}>Key decisions</h2>
            </div>
            <UploadButton label="Upload key decisions" onFile={async (file) => absorb(await upload("decision", {}, file))} />
            <div className="sheet-wrap">
              <Sheet>
                <thead>
                  <tr>
                    {["date", "title", "ownerEmail"].map((key) => (
                      <th key={key}><button className="linkish" style={{ color: "white" }} onClick={() => setDecisionSort({ key, dir: decisionSort.key === key ? -decisionSort.dir : 1 })}>{key === "ownerEmail" ? "Owner" : key}</button></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((decision) => (
                    <tr key={decision.id}>
                      <td>{fmt(decision.date)}</td>
                      <td>{decision.source === "upload" ? decision.fileName : decision.title}</td>
                      <td>{decision.ownerEmail}</td>
                    </tr>
                  ))}
                </tbody>
              </Sheet>
            </div>
            {decisions.map((decision) => (
              <article key={decision.id} className="meeting decision" style={{ marginTop: 8 }}>
                <strong>{decision.title}</strong>
                <p>{decision.text}</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function filterSort(rows, query, sort) {
  const q = query.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (!q) return true;
    return JSON.stringify(row).toLowerCase().includes(q);
  });
  return [...filtered].sort((a, b) => String(a[sort.key] || "").localeCompare(String(b[sort.key] || "")) * sort.dir);
}

function ArchiveColumn({ title, rows, sort, setSort, query, setQuery, onUpload, detail, renderRow }) {
  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <h2 style={{ color: "#305496" }}>{title}</h2>
        <input className="search" placeholder="Filter" value={query} onChange={(event) => setQuery(event.target.value)} />
        <label className="btn ghost small">
          Upload meeting notes
          <input hidden type="file" onChange={(event) => event.target.files?.[0] && onUpload(event.target.files[0])} />
        </label>
      </div>
      <div className="sheet-wrap">
        <Sheet>
          <thead>
            <tr>
              {[["date", "Date"], ["title", "Title"], ["owner", "Owner"]].map(([key, label]) => (
                <th key={key}><button className="linkish" style={{ color: "white" }} onClick={() => setSort({ key: key === "owner" ? "facilitatorName" : key, dir: sort.key === key ? -sort.dir : 1 })}>{label}</button></th>
              ))}
            </tr>
          </thead>
          <tbody>{rows.map((meeting) => renderRow(meeting))}</tbody>
        </Sheet>
      </div>
      {detail ? <MeetingRead meeting={detail} /> : null}
    </div>
  );
}

function MeetingRead({ meeting }) {
  return (
    <article className="meeting" style={{ marginTop: 12 }}>
      <h3>{meeting.title}</h3>
      <p>{fmt(meeting.date)} · {meeting.time}</p>
      <p>Facilitator: {meeting.facilitatorName || "—"}</p>
      <p>Participants: {meeting.participantNames?.join(", ")}</p>
      {meeting.agenda.map((item) => (
        <div key={item.id} className={item.isDecision ? "meeting decision" : "notes-box"} style={{ marginTop: 8 }}>
          <strong>Topic: {item.topic}</strong>
          <div>Owner: {item.ownerName}</div>
          <div>Notes: {item.notes || "—"}</div>
          {item.actions?.length ? (
            <Sheet style={{ marginTop: 8, background: "white" }}>
              <thead>
                <tr><th>#</th><th>Action</th><th>Owner</th><th>Due</th><th>Completed</th><th>Status</th></tr>
              </thead>
              <tbody>
                {item.actions.map((action, index) => (
                  <tr key={action.id} className={action.tone === "red" ? "row-late" : action.tone === "green" ? "row-green" : ""}>
                    <td>{index + 1}</td>
                    <td>{action.action}</td>
                    <td>{action.ownerName}</td>
                    <td>{fmt(action.due)}</td>
                    <td>{fmt(action.actualEnd)}</td>
                    <td>{action.status}</td>
                  </tr>
                ))}
              </tbody>
            </Sheet>
          ) : null}
        </div>
      ))}
    </article>
  );
}

function UploadButton({ label, onFile }) {
  return (
    <label className="btn ghost small">
      {label}
      <input hidden type="file" onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])} />
    </label>
  );
}

function personCalled(users, id) {
  const user = users.find((item) => item.id === id);
  return user ? `${user.firstName} ${user.lastName}` : "";
}

function ownerLabel(users, participants, ownerId, ownerName) {
  if (ownerId) {
    const listed = (participants || []).find((person) => person.id === ownerId);
    return listed?.name || personCalled(users, ownerId) || ownerName || "—";
  }
  return ownerName || "—";
}

function ParticipantOwnerSelect({ participants, ownerId, ownerName, onChange }) {
  const options = [...(participants || [])];
  const listed = options.some((person) => (ownerId && person.id === ownerId) || (!ownerId && ownerName && person.name === ownerName));
  if (!listed && (ownerId || ownerName)) {
    options.unshift({ id: ownerId || "", name: ownerName || personCalled([], ownerId), known: Boolean(ownerId) });
  }
  const value = ownerId ? `id:${ownerId}` : ownerName ? `name:${ownerName}` : "";
  return (
    <select value={value} onChange={(event) => {
      const raw = event.target.value;
      if (raw.startsWith("id:")) {
        const id = raw.slice(3);
        const person = options.find((item) => item.id === id);
        onChange({ ownerId: id, ownerName: person?.name || "" });
      } else if (raw.startsWith("name:")) {
        onChange({ ownerId: "", ownerName: raw.slice(5) });
      } else {
        onChange({ ownerId: "", ownerName: "" });
      }
    }}>
      <option value="">Unassigned</option>
      {options.map((person) => (
        <option key={person.id || person.name} value={person.id ? `id:${person.id}` : `name:${person.name}`}>
          {person.name} — {person.known ? "in the directory" : "new, not in the directory"}
        </option>
      ))}
    </select>
  );
}

function MeetingEditor({ draft, setDraft, state, run, notice, onDone }) {
  const agenda = draft.agenda;
  const fromNotes = Array.isArray(draft.participants);

  function patchAgenda(index, patch) {
    const next = agenda.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item);
    setDraft({ ...draft, agenda: next });
  }

  function patchAction(topicIndex, actionIndex, patch) {
    const item = agenda[topicIndex];
    const actions = (item.actions || []).map((entry, index) => index === actionIndex ? { ...entry, ...patch } : entry);
    patchAgenda(topicIndex, { actions });
  }

  function addAction(index) {
    const item = agenda[index];
    patchAgenda(index, {
      actions: [...(item.actions || []), { action: "", ownerId: "", ownerName: "", due: "", actualEnd: "" }],
    });
  }

  async function save(saveMode) {
    const result = await run({ type: "saveMeeting", saveMode, meeting: draft });
    if (result?.state) onDone();
  }

  return (
    <div className="stack">
      {notice ? <div className="banner warn">{notice}</div> : null}
      <div className="form-grid">
        <label className="field">Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className="field">Meeting date<input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
        <label className="field">Meeting time<input value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} placeholder="1PM to 2 PM" /></label>
        <label className="field">Facilitator
          <PeopleSelect users={state.users} value={draft.facilitatorId} onChange={(value) => setDraft({ ...draft, facilitatorId: value, facilitatorName: personCalled(state.users, value) })} />
          {draft.facilitatorName && !draft.facilitatorId ? <span className="muted">Named in the notes: {draft.facilitatorName} — new, not in the directory</span> : null}
        </label>
        <label className="field">Linked task
          <select value={draft.taskId || ""} onChange={(event) => setDraft({ ...draft, taskId: event.target.value })}>
            <option value="">No linked task</option>
            {state.tasks.map((task) => <option key={task.id} value={task.id}>{"\u00A0".repeat(task.level * 2)}{task.name}</option>)}
          </select>
        </label>
      </div>
      <label className="field">Participants
        {fromNotes ? (
          <div className="person-list">
            {draft.participants.length ? draft.participants.map((person) => (
              <div key={person.id || person.name} className="person-row">
                <span>{person.name}</span>
                <span className={person.known ? "tag" : "tag new"}>{person.known ? "In the directory" : "New, not in the directory"}</span>
              </div>
            )) : <p className="muted" style={{ margin: 8 }}>No attendees were named in the notes.</p>}
          </div>
        ) : (
          <select multiple value={draft.participantIds} onChange={(event) => setDraft({ ...draft, participantIds: [...event.target.selectedOptions].map((option) => option.value) })} style={{ minHeight: 80 }}>
            {state.users.map((user) => <option key={user.id} value={user.id}>{user.firstName} {user.lastName}</option>)}
          </select>
        )}
      </label>
      <div className="sheet-wrap">
        <Sheet>
          <thead><tr><th>#</th><th>Topic</th><th>Topic owner</th><th>Time</th></tr></thead>
          <tbody>
            {agenda.map((item, index) => (
              <tr key={index}>
                <td>{index + 1}</td>
                <td><input value={item.topic} onChange={(event) => patchAgenda(index, { topic: event.target.value })} /></td>
                <td>
                  {fromNotes ? (
                    <ParticipantOwnerSelect participants={draft.participants} ownerId={item.ownerId} ownerName={item.ownerName} onChange={(owner) => patchAgenda(index, owner)} />
                  ) : (
                    <PeopleSelect users={state.users} value={item.ownerId} onChange={(value) => patchAgenda(index, { ownerId: value, ownerName: personCalled(state.users, value) })} />
                  )}
                </td>
                <td><input value={item.time} onChange={(event) => patchAgenda(index, { time: event.target.value })} placeholder="20 Min" /></td>
              </tr>
            ))}
          </tbody>
        </Sheet>
      </div>
      <button className="btn ghost" onClick={() => setDraft({ ...draft, agenda: [...agenda, { topic: "", ownerId: "", ownerName: "", time: "", notes: "", isDecision: false, actions: [] }] })}>Add agenda line</button>
      {agenda.map((item, topicIndex) => (
        <article key={topicIndex} className={item.isDecision ? "meeting decision" : "meeting"}>
          <h3>Topic: {item.topic || "Untitled"}</h3>
          <p>Owner: {ownerLabel(state.users, draft.participants, item.ownerId, item.ownerName)}</p>
          <label className="field">Notes
            <textarea value={item.notes} onChange={(event) => patchAgenda(topicIndex, { notes: event.target.value })} />
          </label>
          <label className="checkline">
            <input type="checkbox" checked={item.isDecision} onChange={(event) => patchAgenda(topicIndex, { isDecision: event.target.checked })} />
            Mark as decision
          </label>
          <h3 style={{ marginTop: 10 }}>Action items</h3>
          {(item.actions || []).length === 0 ? <p className="muted">No action items on this topic.</p> : null}
          {(item.actions || []).map((action, index) => (
            <div key={index} className="form-grid" style={{ marginTop: 6 }}>
              <label className="field">Action<input value={action.action} onChange={(event) => patchAction(topicIndex, index, { action: event.target.value })} /></label>
              <label className="field">Owner
                {fromNotes ? (
                  <ParticipantOwnerSelect participants={draft.participants} ownerId={action.ownerId} ownerName={action.ownerName} onChange={(owner) => patchAction(topicIndex, index, owner)} />
                ) : (
                  <PeopleSelect users={state.users} value={action.ownerId} onChange={(value) => patchAction(topicIndex, index, { ownerId: value, ownerName: personCalled(state.users, value) })} />
                )}
              </label>
              <label className="field">Due<input type="date" value={action.due} onChange={(event) => patchAction(topicIndex, index, { due: event.target.value })} /></label>
              <label className="field">Actual completion<input type="date" value={action.actualEnd} onChange={(event) => patchAction(topicIndex, index, { actualEnd: event.target.value })} /></label>
            </div>
          ))}
          <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => addAction(topicIndex)}>Add action item</button>
        </article>
      ))}
      <div className="toolbar">
        <button className="btn navy" onClick={() => save("template")}>Save template and meeting notes</button>
        <button className="btn" onClick={() => save("notes")}>Save meeting notes only</button>
        <button className="btn ghost" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
