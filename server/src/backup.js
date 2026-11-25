import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const backupDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "backups");

function fail(message) {
  const error = new Error(message);
  error.expose = true;
  error.status = 500;
  return error;
}

function viaDocker() {
  if (process.env.BACKUP_VIA_DOCKER === "0" || process.env.BACKUP_VIA_DOCKER === "false") return false;
  if (process.env.BACKUP_VIA_DOCKER === "1" || process.env.BACKUP_VIA_DOCKER === "true") return true;
  return !fs.existsSync("/.dockerenv");
}

function startDump() {
  if (!viaDocker()) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw fail("DATABASE_URL is missing, so the database backup could not be saved.");
    return spawn("pg_dump", [databaseUrl, "--clean", "--if-exists"], { windowsHide: true, env: process.env });
  }
  return spawn(
    "docker",
    ["exec", "zpm-postgres", "pg_dump", "-U", "zpm", "-d", "zpm", "--clean", "--if-exists"],
    { windowsHide: true },
  );
}

export function saveBackup() {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `zpm-${stamp}.sql`;
  const filePath = path.join(backupDir, filename);
  const output = fs.createWriteStream(filePath);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = startDump();
    } catch (error) {
      output.destroy();
      fs.rmSync(filePath, { force: true });
      reject(error.expose ? error : fail(error.message));
      return;
    }
    let stderr = "";
    child.stdout.pipe(output);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      output.destroy();
      fs.rmSync(filePath, { force: true });
      reject(fail(error.code === "ENOENT"
        ? (viaDocker()
          ? "Docker is not available, so the database backup could not be saved."
          : "pg_dump is not available, so the database backup could not be saved.")
        : error.message));
    });
    const finished = new Promise((done) => output.on("finish", done));
    child.on("close", async (code) => {
      await finished;
      if (code !== 0) {
        fs.rmSync(filePath, { force: true });
        reject(fail(stderr.trim() || "The database backup did not finish."));
        return;
      }
      const bytes = fs.statSync(filePath).size;
      if (!bytes) {
        fs.rmSync(filePath, { force: true });
        reject(fail("The database backup was empty."));
        return;
      }
      resolve({ path: filePath, filename, bytes });
    });
  });
}
