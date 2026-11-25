import { useEffect, useState } from "react";
import { graph, quietAuthError } from "../api.js";
import { Panel } from "../components/ui.jsx";

const KIND = {
  user: "Person",
  task: "Task",
  meeting: "Meeting",
  issue: "Issue",
  tracker: "Tracker",
  decision: "Decision",
  report: "Report",
  folder: "Folder",
  message: "Message",
};

function scoreLabel(score) {
  return Number(score).toFixed(3);
}

function RankList({ title, hint, rows }) {
  const max = rows.reduce((best, row) => Math.max(best, row.score), 0) || 1;
  return (
    <Panel title={title}>
      <p className="muted">{hint}</p>
      {rows.length ? (
        <ol className="analytics-list">
          {rows.map((row) => (
            <li key={row.id}>
              <div>
                <strong>{row.label}</strong>
                <span className="muted"> {KIND[row.kind] || row.kind}</span>
                <div className="analytics-bar"><span style={{ width: `${Math.max(8, (row.score / max) * 100)}%` }} /></div>
              </div>
              <em>{scoreLabel(row.score)}</em>
            </li>
          ))}
        </ol>
      ) : <p className="muted">No scored records yet.</p>}
    </Panel>
  );
}

export default function GraphAnalytics() {
  const [model, setModel] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    graph({ view: "analytics" })
      .then((payload) => {
        if (live) setModel(payload);
      })
      .catch((reason) => {
        if (live && !quietAuthError(reason)) setError(reason.message || "The graph analytics could not be loaded.");
      });
    return () => {
      live = false;
    };
  }, []);

  const overview = model?.overview;

  return (
    <Panel bare title="Graph analytics">
      <p className="muted">NetworkX measures on the same people, tasks, and meetings used by the relationship diagram.</p>
      {error ? <div className="banner error">{error}</div> : null}
      {!model && !error ? <p>Calculating graph measures…</p> : null}
      {overview ? (
        <>
          <div className="metric-row">
            <article className="metric"><b>{overview.nodes}</b><span>Records</span></article>
            <article className="metric"><b>{overview.edges}</b><span>Links</span></article>
            <article className="metric"><b>{overview.density}</b><span>Density</span></article>
            <article className="metric"><b>{overview.components}</b><span>Components</span></article>
            <article className="metric"><b>{overview.clustering}</b><span>Clustering</span></article>
            <article className="metric"><b>{overview.averageDistance ?? "—"}</b><span>Average distance</span></article>
            <article className="metric"><b>{overview.diameter ?? "—"}</b><span>Diameter</span></article>
            <article className="metric"><b>{overview.dependenciesAcyclic ? "None" : "Yes"}</b><span>Dependency cycle</span></article>
          </div>
          <div className="cards">
            <RankList title="Degree centrality" hint="Records with the most direct links." rows={model.degree || []} />
            <RankList title="Betweenness" hint="Records that sit on the most paths between others." rows={model.betweenness || []} />
            <RankList title="PageRank" hint="Records that other linked records point toward." rows={model.pagerank || []} />
          </div>
          <div className="cards">
            <Panel title="Longest predecessor chain">
              <p className="muted">The longest task sequence NetworkX can walk along predecessor links.</p>
              {model.criticalChain?.length ? (
                <div className="chain">
                  {model.criticalChain.map((node, index) => (
                    <span key={node.id}>{index ? "→ " : ""}{node.label}</span>
                  ))}
                </div>
              ) : <p className="muted">No predecessor chain is longer than one task.</p>}
              {model.dependencyCycle?.length ? (
                <p className="diagram-note warn">A cycle runs through {model.dependencyCycle.map((node) => node.label).join(" → ")}.</p>
              ) : null}
            </Panel>
            <Panel title="Cut points">
              <p className="muted">Removing one of these splits a connected group.</p>
              {model.bridges?.length ? (
                <ul className="analytics-list">
                  {model.bridges.map((node) => (
                    <li key={node.id}>
                      <div><strong>{node.label}</strong><span className="muted"> {KIND[node.kind] || node.kind}</span></div>
                      <em>{node.links} links</em>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">No single record holds a group together.</p>}
            </Panel>
            <Panel title="Unlinked records">
              <p className="muted">{overview.isolates} records have no links. People, tasks, and meetings are listed here.</p>
              {model.isolates?.length ? (
                <ul className="analytics-list">
                  {model.isolates.map((node) => (
                    <li key={node.id}><strong>{node.label}</strong><em>{KIND[node.kind] || node.kind}</em></li>
                  ))}
                </ul>
              ) : <p className="muted">Every person, task, and meeting has a link.</p>}
            </Panel>
          </div>
          <div className="cards">
            {(model.communities || []).map((group) => (
              <Panel key={group.id} title={`Community ${group.id}`}>
                <p className="muted">{group.size} records link more tightly with each other than with the rest of the project.</p>
                <div className="chain">
                  {group.members.map((node) => <span key={node.id}>{node.label}</span>)}
                  {group.more ? <span>+{group.more} more</span> : null}
                </div>
              </Panel>
            ))}
          </div>
        </>
      ) : null}
    </Panel>
  );
}
