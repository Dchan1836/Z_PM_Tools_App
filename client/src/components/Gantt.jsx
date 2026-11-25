import { useState } from "react";
import { assignmentClass, fmt, statusClass } from "../format.js";

const VIEW_KEY = "zpm-plan-view";

export function readPlanView() {
  try {
    return localStorage.getItem(VIEW_KEY) === "gantt" ? "gantt" : "table";
  } catch {
    return "table";
  }
}

export function usePlanView() {
  const [view, setView] = useState(readPlanView);
  function choose(next) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* the toggle still works for this visit */
    }
  }
  return [view, choose];
}

export function PlanViewToggle({ view, onChange }) {
  return (
    <div className="view-toggle" role="group" aria-label="Plan view">
      <button type="button" className={view === "table" ? "btn navy" : "btn ghost"} onClick={() => onChange("table")}>Table</button>
      <button type="button" className={view === "gantt" ? "btn navy" : "btn ghost"} onClick={() => onChange("gantt")}>Gantt</button>
    </div>
  );
}

function parseDay(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function dayNumber(date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function addDays(date, count) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

function monthDay(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildScale(min, max) {
  const span = dayNumber(max) - dayNumber(min) + 1;
  const ticks = [];
  if (span <= 45) {
    for (let index = 0; index < span; index += 1) {
      const date = addDays(min, index);
      ticks.push({
        label: index === 0 || date.getDate() === 1 ? monthDay(date) : String(date.getDate()),
        days: 1,
      });
    }
    return { ticks, span, dayWidth: 28 };
  }
  if (span <= 140) {
    let cursor = min;
    while (dayNumber(cursor) <= dayNumber(max)) {
      const days = Math.min(7, dayNumber(max) - dayNumber(cursor) + 1);
      ticks.push({ label: monthDay(cursor), days });
      cursor = addDays(cursor, days);
    }
    return { ticks, span, dayWidth: 14 };
  }
  let cursor = min;
  while (dayNumber(cursor) <= dayNumber(max)) {
    const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const days = Math.min(dayNumber(nextMonth) - dayNumber(cursor), dayNumber(max) - dayNumber(cursor) + 1);
    ticks.push({
      label: cursor.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      days,
    });
    cursor = addDays(cursor, days);
  }
  return { ticks, span, dayWidth: 6 };
}

function barFor(row, origin, span) {
  let start = parseDay(row.start);
  let end = parseDay(row.end);
  if (!start && !end) return null;
  if (!start) start = end;
  if (!end) end = start;
  if (dayNumber(end) < dayNumber(start)) [start, end] = [end, start];
  const left = ((dayNumber(start) - origin) / span) * 100;
  const width = ((dayNumber(end) - dayNumber(start) + 1) / span) * 100;
  return { left, width };
}

export function Gantt({ rows, today, onOpen, selected = [], onToggle }) {
  const dates = rows.flatMap((row) => [parseDay(row.start), parseDay(row.end)]).filter(Boolean);
  if (!rows.length) return <p className="muted">Nothing to chart.</p>;
  if (!dates.length) {
    return <p className="muted">These tasks have no planned dates, so there is no timeline to draw.</p>;
  }
  const min = dates.reduce((best, date) => (dayNumber(date) < dayNumber(best) ? date : best));
  const max = dates.reduce((best, date) => (dayNumber(date) > dayNumber(best) ? date : best));
  const scale = buildScale(min, max);
  const origin = dayNumber(min);
  const todayDate = parseDay(today);
  const todayLeft = todayDate && dayNumber(todayDate) >= origin && dayNumber(todayDate) <= origin + scale.span - 1
    ? ((dayNumber(todayDate) - origin + 0.5) / scale.span) * 100
    : null;
  const track = Math.max(scale.span * scale.dayWidth, 520);

  return (
    <div className="gantt" style={{ "--gantt-track": `${track}px` }}>
      <div className="gantt-layout">
        <div className="gantt-corner">Task</div>
        <div className="gantt-scale">
          {scale.ticks.map((tick, index) => (
            <span key={`${tick.label}-${index}`} style={{ flex: tick.days }}>{tick.label}</span>
          ))}
          {todayLeft != null ? <i className="gantt-today-mark" style={{ left: `${todayLeft}%` }} title="Today" /> : null}
        </div>
        {rows.map((row) => {
          const bar = barFor(row, origin, scale.span);
          const tone = statusClass(row.status);
          return (
            <div className="gantt-row" key={row.id}>
              <div className={`gantt-name ${assignmentClass(row.assignment) || ""}`} style={{ paddingLeft: 10 + Math.min(row.depth || 0, 6) * 16 }}>
                {onToggle ? (
                  <input
                    type="checkbox"
                    checked={selected.includes(row.id)}
                    onChange={() => onToggle(row.id)}
                    aria-label={`Select ${row.name}`}
                  />
                ) : null}
                {onOpen ? (
                  <button type="button" className="linkish" onClick={() => onOpen(row.id)}>{row.name}</button>
                ) : <span>{row.name}</span>}
              </div>
              <div className="gantt-track">
                {todayLeft != null ? <i className="gantt-today" style={{ left: `${todayLeft}%` }} /> : null}
                {bar ? (
                  <button
                    type="button"
                    className={`gantt-bar ${tone}`}
                    style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                    title={`${row.name}: ${fmt(row.start) || "No start"} – ${fmt(row.end) || "No end"}${row.status ? ` · ${row.status}` : ""}`}
                    onClick={() => onOpen?.(row.id)}
                  >
                    <span>{fmt(row.start)} – {fmt(row.end)}</span>
                  </button>
                ) : <span className="gantt-empty">No dates</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
