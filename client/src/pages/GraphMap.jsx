import { useEffect, useMemo, useState } from "react";
import { graph, quietAuthError } from "../api.js";
import { Panel } from "../components/ui.jsx";

const CARD_W = 172;
const CARD_H = 58;
const GAP_Y = 8;
const COL_GAP = 36;
const PAD_X = 18;
const PAD_Y = 14;
const HEADER = 26;

const NODE_TOGGLES = [
  ["lead", "Leads"],
  ["employee", "Employees"],
  ["meeting", "Meetings"],
  ["workflow", "Workflows"],
  ["task", "Tasks"],
  ["subtask", "Subtasks"],
];

const EDGE_TOGGLES = [
  ["supervises", "Has employees"],
  ["owns", "Has tasks"],
  ["has_meeting", "Has meetings"],
  ["about", "Meeting tasks"],
  ["step", "Workflow steps"],
  ["precedes", "Task order"],
  ["subtask", "Subtasks"],
];

const FILLS = {
  lead: "#f6d6d2",
  employee: "#d9efe4",
  meeting: "#f8ecd4",
  workflow: "#d9e6f5",
  task: "#ffffff",
  subtask: "#fff6ea",
};

function layoutCards(model, hiddenKinds) {
  const placed = new Map();
  const columns = [];
  let x = PAD_X;
  (model?.columns || []).forEach((column) => {
    const members = (model.nodes || [])
      .filter((node) => node.column === column.id && !hiddenKinds[node.kind])
      .sort((a, b) => a.order - b.order);
    if (!members.length) return;
    members.forEach((node, index) => {
      placed.set(node.id, {
        ...node,
        x,
        y: PAD_Y + HEADER + index * (CARD_H + GAP_Y),
      });
    });
    columns.push({ ...column, x, count: members.length });
    x += CARD_W + COL_GAP;
  });
  const height = Math.max(
    420,
    PAD_Y + HEADER + Math.max(0, ...columns.map((column) => column.count)) * (CARD_H + GAP_Y) + 24,
  );
  return { placed, columns, width: Math.max(x + PAD_X - COL_GAP, 640), height };
}

function curve(from, to) {
  const y1 = from.y + CARD_H / 2;
  const y2 = to.y + CARD_H / 2;
  if (from.x === to.x) {
    const x = from.x + CARD_W + 16;
    return `M ${from.x + CARD_W} ${y1} C ${x} ${y1}, ${x} ${y2}, ${to.x + CARD_W} ${y2}`;
  }
  const forward = to.x > from.x;
  const x1 = forward ? from.x + CARD_W : from.x;
  const x2 = forward ? to.x : to.x + CARD_W;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

export default function GraphMap() {
  const [model, setModel] = useState(null);
  const [error, setError] = useState("");
  const [hiddenKinds, setHiddenKinds] = useState({});
  const [hiddenEdges, setHiddenEdges] = useState({});
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    graph({ view: "diagram" })
      .then(setModel)
      .catch((err) => {
        if (!quietAuthError(err)) setError(err.message);
      });
  }, []);

  const board = useMemo(() => layoutCards(model, hiddenKinds), [model, hiddenKinds]);
  const selected = board.placed.get(selectedId) || (model?.nodes || []).find((node) => node.id === selectedId);

  const visibleEdges = useMemo(() => {
    return (model?.edges || []).filter((edge) => (
      !hiddenEdges[edge.relation]
      && board.placed.has(edge.source)
      && board.placed.has(edge.target)
    ));
  }, [model, hiddenEdges, board]);

  const neighborIds = useMemo(() => {
    const ids = new Set();
    if (!selectedId) return ids;
    visibleEdges.forEach((edge) => {
      if (edge.source === selectedId) ids.add(edge.target);
      if (edge.target === selectedId) ids.add(edge.source);
    });
    return ids;
  }, [visibleEdges, selectedId]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return (model?.nodes || [])
      .filter((node) => node.label.toLowerCase().includes(needle) && !hiddenKinds[node.kind])
      .slice(0, 6);
  }, [model, query, hiddenKinds]);

  function focusNode(id) {
    setSelectedId(id);
    setQuery("");
    requestAnimationFrame(() => {
      document.getElementById(`diagram-${id}`)?.scrollIntoView({ block: "nearest", inline: "center" });
    });
  }

  const stats = model?.stats;

  return (
    <Panel className="diagram" title="Relationship diagram">
      <p className="muted">Leads have employees. Employees have tasks, and those tasks can have subtasks that must be finished first. Leads and employees have meetings, meetings have tasks, and a workflow is the series of tasks that completes it.</p>
      {error ? <div className="banner error">{error}</div> : null}
      {!model && !error ? <p>Drawing the diagram…</p> : null}
      {stats ? (
        <>
          <div className="diagram-stats">
            <span><b>{stats.nodes}</b> nodes</span>
            <span><b>{stats.edges}</b> edges</span>
            <span>{stats.dag ? "Subtasks and task order form a DAG" : "Task dependencies contain a cycle"}</span>
            <span><b>{stats.workflows}</b> workflows</span>
            <span>Density <b>{stats.density}</b></span>
          </div>
          <p className={`diagram-note${stats.dag ? "" : " warn"}`}>{stats.message}</p>
          <div className="diagram-toggles">
            {NODE_TOGGLES.map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                className={hiddenKinds[kind] ? "" : "on"}
                onClick={() => setHiddenKinds((current) => ({ ...current, [kind]: !current[kind] }))}
              >{label}</button>
            ))}
            {EDGE_TOGGLES.map(([relation, label]) => {
              const sample = (model.edges || []).find((edge) => edge.relation === relation);
              return (
                <button
                  key={relation}
                  type="button"
                  className={hiddenEdges[relation] ? "" : "on"}
                  onClick={() => setHiddenEdges((current) => ({ ...current, [relation]: !current[relation] }))}
                >
                  <svg width="22" height="8" aria-hidden="true">
                    <line
                      x1="1" y1="4" x2="21" y2="4"
                      stroke={sample?.color || "#5c6b80"}
                      strokeWidth="1.6"
                      strokeDasharray={sample?.style === "dash" ? "3 2" : undefined}
                    />
                  </svg>
                  {label}
                </button>
              );
            })}
          </div>
          <label className="field diagram-find">Find a record
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or title" />
          </label>
          {matches.length ? (
            <div className="graph-matches">
              {matches.map((node) => (
                <button key={node.id} type="button" onClick={() => focusNode(node.id)}>{node.label}</button>
              ))}
            </div>
          ) : null}
          <div className="diagram-scroll">
            <div className="diagram-board" style={{ width: board.width, height: board.height }} onClick={() => setSelectedId("")}>
              <svg width={board.width} height={board.height} className="diagram-edges">
                <defs>
                  {[...new Set(visibleEdges.map((edge) => edge.color))].map((color) => (
                    <marker key={color} id={`arrow-${color.slice(1)}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                      <path d="M 0 0 L 10 5 L 0 10 Z" fill={color} />
                    </marker>
                  ))}
                </defs>
                {visibleEdges.map((edge, index) => {
                  const from = board.placed.get(edge.source);
                  const to = board.placed.get(edge.target);
                  const active = !selectedId || edge.source === selectedId || edge.target === selectedId;
                  return (
                    <path
                      key={`${edge.source}-${edge.target}-${edge.relation}-${index}`}
                      d={curve(from, to)}
                      fill="none"
                      stroke={edge.color}
                      strokeWidth={active && selectedId ? 2 : 1.3}
                      strokeDasharray={edge.style === "dash" ? "4 3" : undefined}
                      markerEnd={`url(#arrow-${edge.color.slice(1)})`}
                      opacity={active ? 0.95 : 0.08}
                    />
                  );
                })}
              </svg>
              {board.columns.map((column) => (
                <div key={column.id} className="diagram-colhead" style={{ left: column.x, top: PAD_Y }}>{column.label}</div>
              ))}
              {[...board.placed.values()].map((node) => {
                const dim = selectedId && node.id !== selectedId && !neighborIds.has(node.id);
                return (
                  <button
                    key={node.id}
                    id={`diagram-${node.id}`}
                    type="button"
                    className={`diagram-card${node.id === selectedId ? " selected" : ""}`}
                    style={{
                      left: node.x,
                      top: node.y,
                      width: CARD_W,
                      height: CARD_H,
                      background: FILLS[node.tone] || "#fff",
                      opacity: dim ? 0.38 : 1,
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId(node.id);
                    }}
                  >
                    <strong>{node.label}</strong>
                    {node.sub ? <span>{node.sub}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
          {selected ? (
            <div className="diagram-focus">
              <p><b>{selected.label}</b> <span className="muted">{selected.sub}</span></p>
              <div className="graph-matches">
                {visibleEdges
                  .filter((edge) => edge.source === selected.id || edge.target === selected.id)
                  .map((edge) => {
                    const otherId = edge.source === selected.id ? edge.target : edge.source;
                    const other = board.placed.get(otherId);
                    if (!other) return null;
                    return (
                      <button key={`${edge.relation}-${other.id}`} type="button" onClick={() => focusNode(other.id)}>
                        {edge.label}: {other.label}
                      </button>
                    );
                  })}
              </div>
            </div>
          ) : <p className="muted">Click a card to see its links. Drag the diagram if a column runs past the edge.</p>}
        </>
      ) : null}
    </Panel>
  );
}
