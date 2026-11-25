import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const python = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const script = path.join(root, "graph", "links.py");
const NODE = /^(user|task|meeting|issue|tracker|decision|report|folder|message):[A-Za-z0-9_-]+$/;

export function graphQuery(command, ids = []) {
  for (const id of ids) {
    if (!NODE.test(id)) {
      const error = new Error("That record is not a link the graph understands.");
      error.status = 400;
      throw error;
    }
  }
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, command, ...ids], { cwd: root, env: process.env });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", () => {
      const error = new Error("NetworkX is not available. Install the graph tools in server/.venv.");
      error.status = 500;
      reject(error);
    });
    child.on("close", (code) => {
      let payload = {};
      try {
        payload = JSON.parse(out || "{}");
      } catch {
        const error = new Error(err.trim() || "The link graph failed.");
        error.status = 500;
        reject(error);
        return;
      }
      if (code !== 0 || payload.error) {
        const error = new Error(payload.error || "The link graph failed.");
        error.status = 400;
        reject(error);
        return;
      }
      resolve(payload);
    });
  });
}
