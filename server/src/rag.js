import crypto from "crypto";
import OpenAI from "openai";
import { can, todayISO } from "./logic.js";
import { present } from "./store.js";

const EMBED_MODEL = () => process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
const CHAT_MODEL = () => process.env.OPENAI_MODEL || "gpt-6-luna";
const cache = new Map();

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function line(label, value) {
  const text = String(value ?? "").trim();
  return text ? `${label}: ${text}` : "";
}

function documentsFrom(state) {
  const docs = [];
  docs.push({
    id: "project",
    kind: "project",
    title: state.project?.name || "Project",
    text: [
      line("Project", state.project?.name),
      line("Start", state.project?.startDate),
      line("End", state.project?.endDate),
      line("Site", state.project?.siteDetail),
      line("Leadership", state.project?.leadership),
      line("Today", state.today),
    ].filter(Boolean).join("\n"),
  });
  for (const user of state.users || []) {
    const name = `${user.firstName || ""} ${user.lastName || ""}`.trim();
    docs.push({
      id: `user:${user.id}`,
      kind: "person",
      title: name,
      text: [line("Person", name), line("Role", user.role), line("Permission", user.permission), line("Email", user.email), line("Comments", user.comments)].filter(Boolean).join("\n"),
    });
  }
  for (const task of state.tasks || []) {
    const comments = (task.comments || []).map((comment) => comment.text).filter(Boolean).join(" ");
    docs.push({
      id: `task:${task.id}`,
      kind: "task",
      title: task.name,
      text: [
        line("Task", task.name),
        line("Owner", task.ownerName || "unassigned"),
        line("Status", task.status),
        line("Window", task.window),
        line("Pillar", task.pillar),
        line("Area", task.area),
        line("Site", task.siteName),
        line("Planned start", task.plannedStart),
        line("Planned end", task.plannedEnd),
        line("Actual start", task.actualStart),
        line("Actual end", task.actualEnd),
        line("Predecessor", task.predecessorName),
        line("Assignment", task.assignmentStatus),
        line("Percent complete", task.percent == null ? "" : String(task.percent)),
        line("Comments", comments),
      ].filter(Boolean).join("\n"),
    });
  }
  for (const meeting of state.meetings || []) {
    const agenda = (meeting.agenda || []).map((item) => {
      const actions = (item.actions || []).map((action) => `${action.action} (${action.ownerName || "unassigned"}, due ${action.due || "unspecified"})`).join("; ");
      return [item.topic, item.notes, item.isDecision ? "This topic is a decision." : "", actions].filter(Boolean).join(" ");
    }).join("\n");
    docs.push({
      id: `meeting:${meeting.id}`,
      kind: "meeting",
      title: meeting.title,
      text: [
        line("Meeting", meeting.title),
        line("Date", meeting.date),
        line("Time", meeting.time),
        line("Facilitator", meeting.facilitatorName),
        line("Participants", (meeting.participantNames || []).join(", ")),
        line("Linked task", state.tasks.find((task) => task.id === meeting.taskId)?.name || ""),
        line("Notes", meeting.notes),
        agenda ? `Agenda:\n${agenda}` : "",
      ].filter(Boolean).join("\n"),
    });
  }
  for (const decision of state.decisions || []) {
    docs.push({
      id: `decision:${decision.id}`,
      kind: "decision",
      title: decision.title,
      text: [line("Decision", decision.title), line("Date", decision.date), line("Owner", decision.ownerEmail), line("Text", decision.text)].filter(Boolean).join("\n"),
    });
  }
  for (const issue of state.issues || []) {
    const notes = (issue.notes || []).map((note) => note.text).filter(Boolean).join(" ");
    docs.push({
      id: `issue:${issue.id}`,
      kind: "issue",
      title: issue.title,
      text: [line("Issue", issue.title), line("Task", issue.taskName), line("Owner", issue.ownerName), line("Status", issue.status), line("Description", issue.description), line("Notes", notes)].filter(Boolean).join("\n"),
    });
  }
  return docs.filter((doc) => doc.text);
}

function tokens(text) {
  return String(text).toLowerCase().match(/[a-z0-9]{2,}/g) || [];
}

function keywordRanks(docs, query) {
  const queryTokens = tokens(query);
  const frequencies = docs.map((doc) => {
    const counts = new Map();
    const words = tokens(`${doc.title}\n${doc.text}`);
    for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
    return { counts, length: words.length };
  });
  const documentFrequency = new Map();
  for (const frequency of frequencies) {
    for (const word of frequency.counts.keys()) documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1);
  }
  const average = frequencies.reduce((sum, item) => sum + item.length, 0) / Math.max(docs.length, 1);
  const total = docs.length;
  return frequencies.map((frequency, index) => {
    let score = 0;
    for (const word of queryTokens) {
      const found = frequency.counts.get(word) || 0;
      if (!found) continue;
      const docsWithWord = documentFrequency.get(word) || 0;
      const idf = Math.log(1 + (total - docsWithWord + 0.5) / (docsWithWord + 0.5));
      score += idf * (found * 2.2) / (found + 1.2 * (1 - 0.75 + 0.75 * frequency.length / average));
    }
    return { index, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
}

function cosine(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  const denom = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denom ? dot / denom : 0;
}

function fuse(lists) {
  const scores = new Map();
  for (const list of lists) {
    list.forEach((index, rank) => {
      scores.set(index, (scores.get(index) || 0) + 1 / (60 + rank + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([index]) => index);
}

async function vectorsFor(client, docs) {
  const missing = [];
  for (const doc of docs) {
    const hash = crypto.createHash("sha1").update(doc.text).digest("hex");
    const cached = cache.get(doc.id);
    if (!cached || cached.hash !== hash) missing.push({ doc, hash });
  }
  for (let start = 0; start < missing.length; start += 64) {
    const batch = missing.slice(start, start + 64);
    const response = await client.embeddings.create({
      model: EMBED_MODEL(),
      input: batch.map((item) => item.doc.text.slice(0, 8000)),
    });
    response.data.forEach((item, index) => {
      const entry = batch[index];
      cache.set(entry.doc.id, { hash: entry.hash, vector: item.embedding });
    });
  }
  return docs.map((doc) => cache.get(doc.id).vector);
}

const workflowStepSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    owner: { type: "string" },
    plannedStart: { type: "string" },
    plannedEnd: { type: "string" },
  },
  required: ["name", "owner", "plannedStart", "plannedEnd"],
};

const intentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: ["question", "meeting", "workflow"] },
    notes: { type: "string", description: "The meeting notes to file. Empty unless intent is meeting." },
    workflow: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        owner: { type: "string" },
        pillar: { type: "string" },
        site: { type: "string" },
        plannedStart: { type: "string" },
        plannedEnd: { type: "string" },
        steps: { type: "array", items: workflowStepSchema },
      },
      required: ["name", "owner", "pillar", "site", "plannedStart", "plannedEnd", "steps"],
    },
  },
  required: ["intent", "notes", "workflow"],
};

function emptyWorkflow() {
  return { name: "", owner: "", pillar: "", site: "", plannedStart: "", plannedEnd: "", steps: [] };
}

function isoDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function personId(users, name, actor) {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return "";
  if (actor?.id && ["me", "myself", "i"].includes(wanted)) return actor.id;
  const named = users.map((user) => ({
    id: user.id,
    full: `${user.firstName || ""} ${user.lastName || ""}`.trim().toLowerCase(),
    first: String(user.firstName || "").trim().toLowerCase(),
    last: String(user.lastName || "").trim().toLowerCase(),
  }));
  const exact = named.filter((person) => person.full === wanted);
  if (exact.length === 1) return exact[0].id;
  const partial = named.filter((person) => person.first === wanted || person.last === wanted);
  return partial.length === 1 ? partial[0].id : "";
}

function siteId(org, name) {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return "";
  const matches = [];
  for (const wave of org?.waves || []) {
    for (const visn of wave.visns || []) {
      for (const site of visn.sites || []) {
        if (String(site.name || "").trim().toLowerCase() === wanted) matches.push(site.id);
      }
    }
  }
  return matches.length === 1 ? matches[0] : "";
}

function resolveWorkflow(db, raw, actor) {
  const users = db.users || [];
  const source = raw || emptyWorkflow();
  const missed = [];
  const namedOwner = String(source.owner || "").trim();
  let ownerId = personId(users, source.owner, actor);
  if (namedOwner && !ownerId) missed.push(namedOwner);
  if (!namedOwner && actor?.id) ownerId = actor.id;
  const steps = (Array.isArray(source.steps) ? source.steps : []).slice(0, 30).map((step) => {
    const namedStepOwner = String(step.owner || "").trim();
    let owner = personId(users, step.owner, actor);
    if (namedStepOwner && !owner) missed.push(namedStepOwner);
    if (!namedStepOwner && actor?.id) owner = actor.id;
    return {
      name: String(step.name || "").trim(),
      ownerId: owner,
      plannedStart: isoDate(step.plannedStart),
      plannedEnd: isoDate(step.plannedEnd),
    };
  }).filter((step) => step.name);
  const namedSite = String(source.site || "").trim();
  const matchedSite = siteId(db.org, namedSite);
  if (namedSite && !matchedSite) missed.push(namedSite);
  return {
    workflow: {
      name: String(source.name || "").trim(),
      ownerId,
      pillar: String(source.pillar || "").trim(),
      siteId: matchedSite,
      plannedStart: isoDate(source.plannedStart),
      plannedEnd: isoDate(source.plannedEnd),
      steps,
    },
    missed,
  };
}

function directoryLines(db, user) {
  const people = (db.users || []).map((person) => `${person.firstName || ""} ${person.lastName || ""}`.trim()).filter(Boolean);
  const sites = [];
  for (const wave of db.org?.waves || []) {
    for (const visn of wave.visns || []) {
      for (const site of visn.sites || []) sites.push(site.name);
    }
  }
  const sender = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
  return `Today is ${todayISO()}. The person sending this message is ${sender || "unknown"}. People: ${people.join(", ") || "none"}. Sites: ${sites.join(", ") || "none"}.`;
}

async function readIntent(client, text, priorUser, db, user) {
  const completion = await client.chat.completions.create({
    model: CHAT_MODEL(),
    messages: [
      {
        role: "system",
        content: `You decide what the user wants in a project tool. Choose workflow when they want a new workflow created: a named series of tasks to add to the plan. Choose meeting only when they want a new meeting created from notes they provided. That includes asking to create a meeting from notes, and a message that is itself meeting notes: a date, attendees, what people said, or follow-ups, rather than a question. Choose question when they are asking about data already in the project, including questions about workflows, meetings, tasks, or people. When intent is meeting, put only the notes in notes and leave out the instruction. If this message asks to create a meeting from notes in the previous message, copy those notes. When intent is not meeting, notes is empty. When intent is workflow, fill workflow from what they asked: the name, the tasks in the order given, and any owner, pillar, site, or dates they named. Dates are YYYY-MM-DD or empty. Owner must be a person from the directory, or empty when they did not name an owner. Leave each step owner empty when that task names no owner. Site must be a site from the list or empty. Do not invent tasks, people, or dates, and do not fill the sender in as an owner. When intent is not workflow, workflow name, owner, pillar, site, and dates are empty and steps is an empty array. ${directoryLines(db, user)}`,
      },
      {
        role: "user",
        content: priorUser ? `Previous message:\n${priorUser}\n\nCurrent message:\n${text}` : text,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "chat_intent", strict: true, schema: intentSchema },
    },
  });
  const parsed = JSON.parse(completion.choices?.[0]?.message?.content || "");
  const intent = parsed.intent === "meeting" || parsed.intent === "workflow" ? parsed.intent : "question";
  return {
    intent,
    notes: intent === "meeting" ? String(parsed.notes || "").trim() : "",
    workflow: intent === "workflow" ? (parsed.workflow || emptyWorkflow()) : emptyWorkflow(),
  };
}

export function clearRetrievalCache() {
  cache.clear();
}

export async function answerProjectQuestion({ question, history, db, user, client }) {
  const text = String(question || "").trim();
  if (!text) throw httpError(400, "Ask a question about the project.");
  if (text.length > 24000) throw httpError(400, "Keep that message under 24,000 characters.");
  const apiKey = process.env.OPENAI_API_KEY;
  if (!client && !apiKey) throw httpError(503, "OpenAI is not configured. Add OPENAI_API_KEY to server/.env and restart the API.");

  const prior = (Array.isArray(history) ? history : [])
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && String(item.content || "").trim())
    .slice(-8)
    .map((item) => ({ role: item.role, content: String(item.content).slice(0, 4000) }));
  const priorUser = [...prior].reverse().find((item) => item.role === "user")?.content || "";
  const llm = client || new OpenAI({ apiKey });

  let intent;
  try {
    intent = await readIntent(llm, text, priorUser, db, user);
  } catch (error) {
    if (error?.status === 401) throw httpError(401, "OpenAI rejected the API key in server/.env.");
    const detail = error?.status === 404
      ? `The model "${CHAT_MODEL()}" is not available. Set OPENAI_MODEL in server/.env.`
      : "OpenAI could not read that message. Try again.";
    throw httpError(502, detail);
  }
  if (intent.intent === "workflow") {
    if (!can(user, "task")) {
      return {
        intent: "question",
        answer: "You can ask about workflows. Creating one needs permission to edit the plan.",
        sources: [],
      };
    }
    const { workflow, missed } = resolveWorkflow(db, intent.workflow, user);
    if (!workflow.name || !workflow.steps.length) {
      return {
        intent: "question",
        answer: "Name the workflow and list the tasks in order. I will open it for you to review and save.",
        sources: [],
      };
    }
    const namedOwner = String(intent.workflow?.owner || "").trim();
    const unnamedSteps = (intent.workflow?.steps || []).filter((step) => String(step?.name || "").trim() && !String(step?.owner || "").trim()).length;
    const assumed = [
      namedOwner ? "" : " You are set as the owner.",
      unnamedSteps ? " Tasks that did not name an owner are assigned to you." : "",
    ].join("");
    const gap = missed.length ? ` I could not match ${missed.join(", ")} to the project, so those fields are blank.` : "";
    return {
      intent: "workflow",
      answer: `Opening ${workflow.name} so you can review the tasks, then save it.${assumed}${gap}`,
      workflow,
      sources: [],
    };
  }
  if (intent.intent === "meeting" && intent.notes) {
    return {
      intent: "meeting",
      notes: intent.notes.slice(0, 24000),
      answer: "Opening Create from notes and filling the meeting from those notes.",
      sources: [],
    };
  }
  if (intent.intent === "meeting") {
    return {
      intent: "question",
      answer: "Paste the meeting notes in the chat and I will create the meeting from them.",
      sources: [],
    };
  }

  const docs = documentsFrom(present(db, user));
  if (!docs.length) throw httpError(400, "There is no project data to search yet.");
  let embedded;
  let chosen = [];
  try {
    embedded = await vectorsFor(llm, docs);
    const questionVector = (await llm.embeddings.create({ model: EMBED_MODEL(), input: text })).data[0].embedding;
    const semantic = embedded
      .map((vector, index) => ({ index, score: cosine(questionVector, vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((item) => item.index);
    const lexical = keywordRanks(docs, text).slice(0, 8).map((item) => item.index);
    chosen = fuse([semantic, lexical]).slice(0, 6).map((index) => docs[index]);
  } catch (error) {
    if (error?.status === 401) throw httpError(401, "OpenAI rejected the API key in server/.env.");
    throw httpError(502, "The project search could not reach OpenAI. Try again.");
  }
  if (!chosen.length) chosen = docs.slice(0, 4);

  const passages = chosen.map((doc, index) => `[${index + 1}] ${doc.title} (${doc.kind})\n${doc.text}`).join("\n\n");

  let completion;
  try {
    completion = await llm.chat.completions.create({
      model: CHAT_MODEL(),
      messages: [
        {
          role: "system",
          content: `You answer questions about one project schedule. Use only the retrieved records. If they do not contain the answer, say you cannot find it in the project data. Name the task, meeting, or person you used. Do not invent dates, owners, or decisions.\n\nRetrieved records:\n${passages}`,
        },
        ...prior,
        { role: "user", content: text },
      ],
    });
  } catch (error) {
    if (error?.status === 401) throw httpError(401, "OpenAI rejected the API key in server/.env.");
    const detail = error?.status === 404
      ? `The model "${CHAT_MODEL()}" is not available. Set OPENAI_MODEL in server/.env.`
      : "OpenAI could not answer that question. Try again.";
    throw httpError(502, detail);
  }

  const answer = completion.choices?.[0]?.message?.content?.trim();
  if (!answer) throw httpError(502, "OpenAI returned an empty answer.");
  return {
    intent: "question",
    answer,
    sources: chosen.map((doc) => ({ id: doc.id, kind: doc.kind, title: doc.title })),
  };
}
