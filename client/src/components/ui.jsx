import { Children, cloneElement, useEffect, useRef, useState } from "react";

export function Sheet({ children, className = "", style }) {
  const tableRef = useRef(null);
  const widthsRef = useRef(null);
  const dragRef = useRef(null);
  const [widths, setWidths] = useState(null);

  function commit(next) {
    widthsRef.current = next;
    setWidths(next);
  }

  function stopDrag() {
    const drag = dragRef.current;
    if (!drag) return;
    window.removeEventListener("pointermove", drag.move);
    window.removeEventListener("pointerup", drag.stop);
    dragRef.current = null;
  }

  useEffect(() => stopDrag, []);

  function onResizeStart(colIndex, event) {
    const table = tableRef.current;
    if (!table) return;
    stopDrag();
    const count = columnCount(table);
    const base = widthsRef.current?.length === count ? widthsRef.current : measureColumns(table);
    const startX = event.clientX;
    const startW = base[colIndex] || 80;
    function move(moveEvent) {
      const next = base.slice();
      next[colIndex] = Math.max(56, Math.round(startW + moveEvent.clientX - startX));
      commit(next);
    }
    function stop() {
      stopDrag();
    }
    dragRef.current = { move, stop };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    commit(base);
  }

  const content = Children.map(children, (child) => {
    if (!child || child.type !== "thead") return child;
    return cloneElement(child, { children: resizeHeaders(child.props.children, onResizeStart) });
  });
  const total = widths ? widths.reduce((sum, width) => sum + width, 0) : 0;

  return (
    <table
      ref={tableRef}
      className={`sheet${widths ? " sized" : ""}${className ? ` ${className}` : ""}`}
      style={widths ? { ...style, width: total } : style}
    >
      {widths ? (
        <colgroup>
          {widths.map((width, index) => <col key={index} style={{ width }} />)}
        </colgroup>
      ) : null}
      {content}
    </table>
  );
}

function resizeHeaders(theadChildren, onResizeStart) {
  const rows = Children.toArray(theadChildren);
  const occupied = [];
  return rows.map((row, rowIndex) => {
    const cells = Children.toArray(row.props?.children);
    let column = 0;
    occupied[rowIndex] = occupied[rowIndex] || [];
    const nextCells = cells.map((cell) => {
      if (!cell || cell.type !== "th") return cell;
      while (occupied[rowIndex][column]) column += 1;
      const colspan = Number(cell.props.colSpan || 1);
      const rowspan = Number(cell.props.rowSpan || 1);
      const colEnd = column + colspan - 1;
      for (let rr = 0; rr < rowspan; rr += 1) {
        occupied[rowIndex + rr] = occupied[rowIndex + rr] || [];
        for (let cc = 0; cc < colspan; cc += 1) occupied[rowIndex + rr][column + cc] = true;
      }
      column += colspan;
      return cloneElement(cell, {
        children: (
          <>
            {cell.props.children}
            <button
              type="button"
              className="col-resize"
              data-col={colEnd}
              aria-label="Resize column"
              title="Drag to resize"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onResizeStart(colEnd, event);
              }}
            />
          </>
        ),
      });
    });
    return cloneElement(row, { children: nextCells });
  });
}

function columnCount(table) {
  let count = 0;
  const occupied = [];
  [...table.tHead.rows].forEach((row, rowIndex) => {
    let column = 0;
    occupied[rowIndex] = occupied[rowIndex] || [];
    [...row.cells].forEach((cell) => {
      while (occupied[rowIndex][column]) column += 1;
      const colspan = cell.colSpan || 1;
      const rowspan = cell.rowSpan || 1;
      for (let rr = 0; rr < rowspan; rr += 1) {
        occupied[rowIndex + rr] = occupied[rowIndex + rr] || [];
        for (let cc = 0; cc < colspan; cc += 1) occupied[rowIndex + rr][column + cc] = true;
      }
      count = Math.max(count, column + colspan);
      column += colspan;
    });
  });
  return count;
}

function measureColumns(table) {
  const count = columnCount(table);
  const widths = Array(count).fill(0);
  const occupied = [];
  [...table.tHead.rows].forEach((row, rowIndex) => {
    let column = 0;
    occupied[rowIndex] = occupied[rowIndex] || [];
    [...row.cells].forEach((cell) => {
      while (occupied[rowIndex][column]) column += 1;
      const colspan = cell.colSpan || 1;
      const rowspan = cell.rowSpan || 1;
      if (colspan === 1) widths[column] = cell.getBoundingClientRect().width;
      for (let rr = 0; rr < rowspan; rr += 1) {
        occupied[rowIndex + rr] = occupied[rowIndex + rr] || [];
        for (let cc = 0; cc < colspan; cc += 1) occupied[rowIndex + rr][column + cc] = true;
      }
      column += colspan;
    });
  });
  const body = table.tBodies[0];
  if (body) {
    for (const row of body.rows) {
      let column = 0;
      for (const cell of row.cells) {
        const colspan = cell.colSpan || 1;
        if (colspan === 1 && !widths[column]) widths[column] = cell.getBoundingClientRect().width;
        column += colspan;
      }
    }
  }
  return widths.map((width) => Math.max(56, Math.round(width || 80)));
}

export function Panel({ title, children, actions, className = "", bare = false }) {
  const [open, setOpen] = useState(true);
  const Tag = bare ? "section" : "article";
  return (
    <Tag className={`${bare ? "panel-bare" : "card"} panel ${open ? "open" : "shut"} ${className}`.trim()}>
      <div className="panel-head">
        <button type="button" className="panel-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <span className="panel-mark" aria-hidden="true">{open ? "▾" : "▸"}</span>
          {title}
        </button>
        {open && actions ? <div className="panel-actions">{actions}</div> : null}
      </div>
      <div className="panel-body" hidden={!open}>{children}</div>
    </Tag>
  );
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" style={wide ? { width: "min(1100px, 100%)" } : undefined} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Banner({ error, notice }) {
  return (
    <>
      {error ? <div className="banner error">{error}</div> : null}
      {notice ? <div className="banner ok">{notice}</div> : null}
    </>
  );
}

export function PeopleSelect({ users, value, onChange, allowEmpty = true }) {
  return (
    <select value={value || ""} onChange={(event) => onChange(event.target.value)}>
      {allowEmpty ? <option value="">Unassigned</option> : null}
      {users.map((user) => (
        <option key={user.id} value={user.id}>
          {user.firstName} {user.lastName}
        </option>
      ))}
    </select>
  );
}
