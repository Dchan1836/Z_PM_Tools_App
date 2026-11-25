const KEY = "zpm-token";
const AUTO_LOGOUT = "zpm-auto-logout";

let epoch = 0;
const expiredListeners = new Set();

function preferenceStore() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function autoLogoutEnabled() {
  const store = preferenceStore();
  if (!store) return true;
  return store.getItem(AUTO_LOGOUT) !== "off";
}

export function setAutoLogout(enabled) {
  const store = preferenceStore();
  if (!store) return;
  if (enabled) store.removeItem(AUTO_LOGOUT);
  else store.setItem(AUTO_LOGOUT, "off");
}

export function quietAuthError(error) {
  return Boolean(error?.stale || (error?.status === 401 && !error?.kept));
}

export function getToken() {
  return sessionStorage.getItem(KEY) || "";
}

export function sessionEpoch() {
  return epoch;
}

export function setToken(token) {
  const next = token || "";
  if (next === getToken()) return;
  epoch += 1;
  if (next) sessionStorage.setItem(KEY, next);
  else sessionStorage.removeItem(KEY);
}

export function onSessionExpired(listener) {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

function expireSession() {
  if (!autoLogoutEnabled()) return false;
  setToken("");
  expiredListeners.forEach((listener) => listener());
  return true;
}

function noteAuthFailure(error, sentToken, sentEpoch) {
  if (!sentToken || sentToken !== getToken() || sentEpoch !== epoch) {
    error.stale = true;
    return;
  }
  if (!expireSession()) error.kept = true;
}

async function request(path, options = {}) {
  const { auth = true, body, headers: extraHeaders, ...rest } = options;
  const headers = { ...(extraHeaders || {}) };
  const sentToken = auth ? getToken() : "";
  const sentEpoch = epoch;
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;
  let payload = body;
  if (payload && !(payload instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(payload);
  }
  const response = await fetch(path, { ...rest, headers, body: payload });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Request failed");
    error.status = response.status;
    if (response.status === 401 && auth) noteAuthFailure(error, sentToken, sentEpoch);
    throw error;
  }
  return data;
}

export function login(email, password) {
  return request("/api/login", { method: "POST", body: { email, password }, auth: false });
}

export function loadState() {
  return request("/api/state");
}

export function action(body) {
  return request("/api/action", { method: "POST", body });
}

export function resetDemo() {
  return request("/api/reset", { method: "POST", body: {} });
}

export function graph(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  const query = search.toString();
  return request(query ? `/api/graph?${query}` : "/api/graph");
}

export function askProject(message, history) {
  return request("/api/ai/chat", { method: "POST", body: { message, history } });
}

export function draftMeeting(notes, { defaultOwner = false } = {}) {
  return request("/api/ai/meeting", { method: "POST", body: { notes, defaultOwner } });
}

export function saveBackup() {
  return request("/api/backup", { method: "POST", body: {} });
}

export async function downloadWorkbook() {
  const sentToken = getToken();
  const sentEpoch = epoch;
  const headers = {};
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;
  const response = await fetch("/api/export", { headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || "The workbook could not be downloaded.");
    error.status = response.status;
    if (response.status === 401) noteAuthFailure(error, sentToken, sentEpoch);
    throw error;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const match = /filename="?([^"]+)"?/i.exec(response.headers.get("Content-Disposition") || "");
  link.href = url;
  link.download = match?.[1] || "Z-PM-Tool.xlsx";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function upload(type, fields, file) {
  const body = new FormData();
  body.set("type", type);
  Object.entries(fields).forEach(([key, value]) => body.set(key, value ?? ""));
  if (file) body.set("file", file);
  return request("/api/upload", { method: "POST", body });
}
