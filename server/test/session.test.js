import assert from "node:assert/strict";
import { after, test } from "node:test";

const memory = new Map();
globalThis.sessionStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};

const previousFetch = globalThis.fetch;
const api = await import("../../client/src/api.js");

after(() => {
  globalThis.fetch = previousFetch;
});

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("an expired session signs the user out once", async () => {
  api.setToken("dead-token");
  let expired = 0;
  const stop = api.onSessionExpired(() => {
    expired += 1;
  });
  globalThis.fetch = async () => jsonResponse(401, { error: "Sign in again." });
  const error = await api.action({ type: "saveTask" }).catch((reason) => reason);
  assert.equal(error.status, 401);
  assert.equal(error.stale, undefined);
  assert.equal(api.getToken(), "");
  assert.equal(expired, 1);
  stop();
});

test("a late sign-in failure does not wipe the new session", async () => {
  api.setToken("old-token");
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let expired = 0;
  const stop = api.onSessionExpired(() => {
    expired += 1;
  });
  globalThis.fetch = async () => {
    await gate;
    return jsonResponse(401, { error: "Sign in again." });
  };
  const pending = api.action({ type: "saveTask" });
  api.setToken("new-token");
  release();
  const error = await pending.catch((reason) => reason);
  assert.equal(error.stale, true);
  assert.equal(api.getToken(), "new-token");
  assert.equal(expired, 0);
  stop();
});

test("turning off auto logout keeps the page signed in", async () => {
  const memory = new Map();
  globalThis.localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  };
  api.setAutoLogout(false);
  api.setToken("kept-token");
  let expired = 0;
  const stop = api.onSessionExpired(() => {
    expired += 1;
  });
  globalThis.fetch = async () => jsonResponse(401, { error: "Sign in again." });
  const error = await api.action({ type: "saveTask" }).catch((reason) => reason);
  assert.equal(error.kept, true);
  assert.equal(api.getToken(), "kept-token");
  assert.equal(expired, 0);
  api.setAutoLogout(true);
  stop();
  delete globalThis.localStorage;
});

test("a wrong password does not count as a session timeout", async () => {
  api.setToken("still-good");
  let expired = 0;
  const stop = api.onSessionExpired(() => {
    expired += 1;
  });
  globalThis.fetch = async () => jsonResponse(401, { error: "Email or password does not match a Z PM account." });
  const error = await api.login("steve@zpm.local", "nope").catch((reason) => reason);
  assert.equal(error.status, 401);
  assert.equal(api.getToken(), "still-good");
  assert.equal(expired, 0);
  stop();
});
