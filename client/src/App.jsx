import { useState } from "react";
import { useSelector } from "react-redux";
import { can, fmtStamp, personName } from "./format.js";
import { Banner, Modal } from "./components/ui.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Master from "./pages/Master.jsx";
import Workflows from "./pages/Workflows.jsx";
import MyTasks from "./pages/MyTasks.jsx";
import Meetings from "./pages/Meetings.jsx";
import Documents from "./pages/Documents.jsx";
import Trackers from "./pages/Trackers.jsx";
import Issues from "./pages/Issues.jsx";
import Reports from "./pages/Reports.jsx";
import Admin from "./pages/Admin.jsx";
import RootCause from "./pages/RootCause.jsx";
import Links from "./pages/Links.jsx";
import { useAppDispatch, useProject, useRun, useUi } from "./store/hooks.js";
import { signIn, signOut } from "./store/projectSlice.js";
import { go, setMailOpen, setNotice, setPending } from "./store/uiSlice.js";
import ChatWidget from "./components/ChatWidget.jsx";

const PAGES = [
  ["dashboard", "Dashboard"],
  ["master", "Master Project"],
  ["workflows", "Workflows"],
  ["tasks", "My Tasks"],
  ["meetings", "Meetings"],
  ["documents", "Documents"],
  ["trackers", "Trackers"],
  ["issues", "Issues"],
  ["reports", "Reports"],
  ["root", "Root Cause"],
  ["links", "Links"],
  ["admin", "Admin"],
];

export default function App() {
  const dispatch = useAppDispatch();
  const state = useProject();
  const ui = useUi();
  const run = useRun();
  const status = useSelector((store) => store.project.status);

  async function confirmEnd(choice) {
    const body = { ...ui.pending.body, confirm: choice };
    dispatch(setPending(null));
    const result = await run(body);
    if (result?.state) {
      dispatch(setNotice(choice === "changeEnd" ? "Project end date moved." : "Task dates were pulled inside the project."));
    }
  }

  if (status === "loading") {
    return <p className="page">Loading the project…</p>;
  }

  if (!state) return <Login />;

  const pages = PAGES.filter(([id]) => id !== "admin" || can(state.me, "user") || can(state.me, "organization") || can(state.me, "project") || can(state.me, "tracker") || can(state.me, "task"));

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row">
          <div className="brand">
            <strong>Z PM TOOL</strong>
            <span>30 / 60 / 90 · forward focused</span>
          </div>
          <div className="project-chip">
            <b>{state.project.name}</b>
            Revised {fmtStamp(state.project.revisedAt)}
          </div>
          <div className="spacer" />
          <div className="who">
            <div>{personName(state.me)} · {state.me.role}</div>
            <button className="btn small ghost" onClick={() => dispatch(setMailOpen(true))}>
              Messages ({state.messages.length})
            </button>
            <button className="btn small ghost" onClick={() => dispatch(signOut())}>
              Sign out
            </button>
          </div>
        </div>
        <nav className="nav">
          {pages.map(([id, label]) => (
            <button key={id} className={ui.page === id ? "active" : ""} onClick={() => dispatch(go({ page: id }))}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main className="page">
        <Banner error={ui.error} notice={ui.notice} />
        {ui.page === "dashboard" && <Dashboard />}
        {ui.page === "master" && <Master />}
        {ui.page === "workflows" && <Workflows />}
        {ui.page === "tasks" && <MyTasks />}
        {ui.page === "meetings" && <Meetings />}
        {ui.page === "documents" && <Documents />}
        {ui.page === "trackers" && <Trackers />}
        {ui.page === "issues" && <Issues />}
        {ui.page === "reports" && <Reports />}
        {ui.page === "root" && <RootCause />}
        {ui.page === "links" && <Links />}
        {ui.page === "admin" && <Admin />}
      </main>
      <ChatWidget />
      {ui.pending ? (
        <Modal title="This changes the project end date" onClose={() => dispatch(setPending(null))}>
          <p>{ui.pending.warning.message}</p>
          <div className="toolbar" style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => confirmEnd("changeEnd")}>Change end date</button>
            <button className="btn orange" onClick={() => confirmEnd("shrinkTask")}>Change task dates</button>
            <button className="btn ghost" onClick={() => dispatch(setPending(null))}>Cancel</button>
          </div>
        </Modal>
      ) : null}
      {ui.mailOpen ? (
        <Modal title="Messages" onClose={() => dispatch(setMailOpen(false))}>
          {state.messages.length === 0 ? <p className="muted">No messages yet.</p> : null}
          {state.messages.map((message) => (
            <article key={message.id} className="mail">
              <strong>{message.subject}</strong>
              <div className="muted">{fmtStamp(message.at)}</div>
              <p>{message.body}</p>
            </article>
          ))}
        </Modal>
      ) : null}
    </div>
  );
}

function Login() {
  const dispatch = useAppDispatch();
  const notice = useUi().notice;
  const [email, setEmail] = useState("zulfi@zpm.local");
  const [password, setPassword] = useState("demo");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    const result = await dispatch(signIn({ email, password }));
    if (signIn.rejected.match(result)) setError(result.payload || "Sign in failed.");
  }

  return (
    <div className="login">
      <section className="login-hero">
        <h1>Z PM Tool</h1>
        <p>Project schedule tracking for the next 30, 60, and 90 days. Dashboards, a master plan, negotiated assignments, meetings, trackers, and root-cause views live in one place.</p>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <h2>Sign in</h2>
          <p className="muted">Every account uses the password <b>demo</b>.</p>
          {notice ? <div className="banner warn" style={{ marginTop: 10 }}>{notice}</div> : null}
          {error ? <div className="banner error" style={{ marginTop: 10 }}>{error}</div> : null}
          <div className="stack" style={{ marginTop: 12 }}>
            <label className="field">Email
              <input value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="field">Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <button className="btn navy" type="submit">Enter the project</button>
          </div>
          <div className="accounts">
            <button type="button" onClick={() => { setEmail("zulfi@zpm.local"); setPassword("demo"); }}>
              Zulfi Khan — Super Admin, sees every dashboard
            </button>
            <button type="button" onClick={() => { setEmail("harry.leggs@zpm.local"); setPassword("demo"); }}>
              Harry Leggs — task owner, saved view and a task to accept
            </button>
            <button type="button" onClick={() => { setEmail("ivana.runn@zpm.local"); setPassword("demo"); }}>
              Ivana Runn — proposed a new timeline
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
