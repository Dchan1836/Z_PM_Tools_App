import { useEffect, useState } from "react";
import { graph, quietAuthError } from "../api.js";

const KINDS = [
  ["user", "People"],
  ["task", "Tasks"],
  ["meeting", "Meetings"],
];

export default function Links() {
  const [summary, setSummary] = useState(null);
  const [kind, setKind] = useState("user");
  const [selected, setSelected] = useState("");
  const [other, setOther] = useState("");
  const [focus, setFocus] = useState(null);
  const [path, setPath] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    graph().then((result) => {
      setSummary(result);
      const first = result.catalog.user[0]?.id || "";
      setSelected(first);
    }).catch((err) => {
      if (!quietAuthError(err)) setError(err.message);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setError("");
    graph({ focus: selected }).then(setFocus).catch((err) => {
      if (!quietAuthError(err)) setError(err.message);
    });
  }, [selected]);

  async function findPath() {
    setError("");
    setPath(null);
    try {
      setPath(await graph({ from: selected, to: other }));
    } catch (err) {
      if (!quietAuthError(err)) setError(err.message);
    }
  }

  const options = summary?.catalog?.[kind] || [];
  const everyone = [
    ...(summary?.catalog?.user || []),
    ...(summary?.catalog?.task || []),
    ...(summary?.catalog?.meeting || []),
  ];
  const fromOptions = everyone.some((item) => item.id === selected) || !focus?.focus ? everyone : [focus.focus, ...everyone];
  const otherOptions = fromOptions.filter((item) => item.id !== selected);

  return (
    <section className="stack">
      <div className="page-head">
        <div>
          <h1>Links</h1>
          <p>NetworkX connects people, tasks, meetings, and the issues, trackers, decisions, reports, folders, and messages that belong to them.</p>
        </div>
      </div>
      {error ? <div className="banner error">{error}</div> : null}
      {loading ? <p>Building the graph…</p> : null}
      {summary ? (
        <div className="cards">
          {Object.entries(summary.counts).map(([name, count]) => (
            <article key={name} className="card">
              <h3>{name}</h3>
              <p>{count}</p>
            </article>
          ))}
          <article className="card">
            <h3>links</h3>
            <p>{summary.edgeCount}</p>
          </article>
        </div>
      ) : null}

      <div className="split">
        <article className="card">
          <h3>Open a record</h3>
          <div className="toolbar" style={{ marginTop: 8 }}>
            {KINDS.map(([id, label]) => (
              <button key={id} className={kind === id ? "btn navy" : "btn ghost"} onClick={() => setKind(id)}>{label}</button>
            ))}
          </div>
          <label className="field" style={{ marginTop: 10 }}>Record
            <select value={options.some((item) => item.id === selected) ? selected : ""} onChange={(event) => setSelected(event.target.value)}>
              <option value="">Select</option>
              {options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          {summary?.hubs?.length ? (
            <div className="stack" style={{ marginTop: 12 }}>
              <p className="muted">Most connected</p>
              {summary.hubs.map((hub) => (
                <button key={hub.id} className="btn ghost" onClick={() => { setKind(hub.kind); setSelected(hub.id); }}>
                  {hub.label} · {hub.links} links
                </button>
              ))}
            </div>
          ) : null}
        </article>

        <article className="card">
          <h3>{focus?.focus?.label || "Links"}</h3>
          {focus?.groups?.length === 0 ? <p className="muted">Nothing is linked to this record yet.</p> : null}
          {(focus?.groups || []).map((group) => (
            <div key={group.relation} style={{ marginTop: 12 }}>
              <span className="tag">{group.label}</span>
              <div className="stack" style={{ marginTop: 6 }}>
                {group.nodes.map((node) => (
                  <button key={`${group.relation}-${node.id}`} className="btn ghost" onClick={() => { setKind(node.kind); setSelected(node.id); }}>
                    {node.kind}: {node.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </article>
      </div>

      <article className="card">
        <h3>How two records connect</h3>
        <p className="muted">NetworkX finds the shortest path through the graph.</p>
        <div className="toolbar" style={{ marginTop: 8 }}>
          <label className="field">From
            <select value={selected} onChange={(event) => setSelected(event.target.value)}>
              {fromOptions.map((item) => <option key={item.id} value={item.id}>{item.kind}: {item.label}</option>)}
            </select>
          </label>
          <label className="field">To
            <select value={other} onChange={(event) => setOther(event.target.value)}>
              <option value="">Select</option>
              {otherOptions.map((item) => <option key={item.id} value={item.id}>{item.kind}: {item.label}</option>)}
            </select>
          </label>
          <button className="btn navy" disabled={!selected || !other} onClick={findPath}>Find path</button>
        </div>
        {path?.connected === false ? <p style={{ marginTop: 10 }}>Those records are not connected.</p> : null}
        {path?.steps?.length ? (
          <div className="stack" style={{ marginTop: 12 }}>
            {path.steps.map((step, index) => (
              <p key={`${step.from.id}-${step.to.id}-${index}`}>
                <b>{step.from.label}</b> — {step.relations.map((item) => item.label).join(", ")} — <b>{step.to.label}</b>
              </p>
            ))}
          </div>
        ) : null}
      </article>
    </section>
  );
}
