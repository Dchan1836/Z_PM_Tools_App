import { useState } from "react";
import { fmt } from "../format.js";
import { Sheet, SortButton, useSort } from "../components/ui.jsx";
import { upload } from "../api.js";
import { useAbsorb, useFocusTaskId, useProject, useRun } from "../store/hooks.js";

export default function Documents() {
  const state = useProject();
  const run = useRun();
  const focusTaskId = useFocusTaskId();
  const absorb = useAbsorb();
  const [folderId, setFolderId] = useState("");
  const [name, setName] = useState("");
  const { sort, toggle, ordered } = useSort("name");
  const folders = [...state.folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const visible = focusTaskId ? folders.filter((folder) => folder.taskId === focusTaskId || folder.taskId === "") : folders;
  const open = folders.find((folder) => folder.id === folderId);
  const files = ordered(
    state.files.filter((file) => file.folderId === folderId),
    (file, key) => {
      if (key === "name") return file.name;
      if (key === "created") return file.created;
      if (key === "modified") return file.modified;
      return "";
    },
  );

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Documents</h1>
          <p>Folders stay in alphabetical order. Open one to see its files.</p>
        </div>
        <div className="toolbar">
          <input className="search" placeholder="New folder name" value={name} onChange={(event) => setName(event.target.value)} />
          <button className="btn" onClick={async () => { const result = await run({ type: "createFolder", name, taskId: focusTaskId || "" }); if (result?.state) setName(""); }}>Create folder</button>
        </div>
      </div>
      {focusTaskId ? <p className="tag">Opened from a task — task folder is highlighted</p> : null}
      <div className="split" style={{ marginTop: 12 }}>
        <div>
          {visible.map((folder) => (
            <button key={folder.id} className="folder" onClick={() => setFolderId(folder.id)} style={folder.taskId && folder.taskId === focusTaskId ? { borderLeftColor: "#00b0f0" } : undefined}>
              <span>
                <strong>{folder.name}</strong>
                <div className="muted">Created {fmt(folder.created)} · Modified {fmt(folder.modified)}</div>
              </span>
              <span className="tag">{state.files.filter((file) => file.folderId === folder.id).length} files</span>
            </button>
          ))}
        </div>
        <div className="card">
          {open ? (
            <>
              <h3>{open.name}</h3>
              <label className="btn" style={{ margin: "8px 0", display: "inline-block" }}>
                Upload
                <input hidden type="file" onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const result = await upload("file", { folderId: open.id }, file);
                  absorb?.(result);
                }} />
              </label>
              <Sheet>
                <thead>
                  <tr>
                    <th><SortButton label="File name" column="name" sort={sort} onSort={toggle} /></th>
                    <th><SortButton label="Date created" column="created" sort={sort} onSort={toggle} /></th>
                    <th><SortButton label="Date modified" column="modified" sort={sort} onSort={toggle} /></th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((file) => (
                    <tr key={file.id}>
                      <td>{file.name}</td>
                      <td>{fmt(file.created)}</td>
                      <td>{fmt(file.modified)}</td>
                    </tr>
                  ))}
                  {files.length === 0 ? <tr><td colSpan={3}>This folder is empty.</td></tr> : null}
                </tbody>
              </Sheet>
            </>
          ) : <p className="muted">Choose a folder.</p>}
        </div>
      </div>
    </section>
  );
}
