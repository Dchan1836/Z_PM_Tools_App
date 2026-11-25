import OpenAI from "openai";

const MODEL = () => process.env.OPENAI_MODEL || "gpt-6-luna";

const meetingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    date: { type: "string", description: "YYYY-MM-DD, or empty when the notes do not give a date" },
    time: { type: "string" },
    facilitatorId: { type: "string" },
    facilitatorName: { type: "string" },
    participants: {
      type: "array",
      description: "Every person who attended, spoke, or received an action. One entry each.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
        },
        required: ["id", "name"],
      },
    },
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          topic: { type: "string" },
          raisedById: { type: "string", description: "Id of the attendee who brought this topic up" },
          raisedByName: { type: "string", description: "Name of the attendee who brought this topic up" },
          time: { type: "string" },
          isDecision: { type: "boolean" },
          remarks: {
            type: "array",
            description: "What each attendee said on this topic. One entry per speaker. Do not merge speakers.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                speakerId: { type: "string" },
                speakerName: { type: "string" },
                said: { type: "string" },
              },
              required: ["speakerId", "speakerName", "said"],
            },
          },
        },
        required: ["topic", "raisedById", "raisedByName", "time", "isDecision", "remarks"],
      },
    },
    actions: {
      type: "array",
      description: "Every follow-up in the notes. One object per follow-up. Never return only the first.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          topic: { type: "string", description: "Topic this follow-up belongs to. Copy that topic title." },
          action: { type: "string" },
          ownerId: { type: "string" },
          ownerName: { type: "string" },
          due: { type: "string" },
          actualEnd: { type: "string" },
        },
        required: ["topic", "action", "ownerId", "ownerName", "due", "actualEnd"],
      },
    },
    taskId: { type: "string" },
    taskName: { type: "string" },
  },
  required: ["title", "date", "time", "facilitatorId", "facilitatorName", "participants", "topics", "actions", "taskId", "taskName"],
};

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function personName(user) {
  return `${user.firstName} ${user.lastName}`.trim();
}

function matchUser(name, users) {
  const needle = String(name || "").trim().toLowerCase();
  if (!needle) return "";
  const labeled = users.map((user) => ({
    id: user.id,
    name: personName(user).toLowerCase(),
    email: String(user.email || "").toLowerCase(),
    first: String(user.firstName || "").toLowerCase(),
    last: String(user.lastName || "").toLowerCase(),
  }));
  const exact = labeled.find((user) => user.name === needle || user.email === needle);
  if (exact) return exact.id;
  const byLast = labeled.filter((user) => user.last === needle || user.first === needle);
  if (byLast.length === 1) return byLast[0].id;
  const partial = labeled.filter((user) => user.name && (needle.includes(user.name) || user.name.includes(needle)));
  if (partial.length === 1) return partial[0].id;
  return "";
}

function knownUser(id, name, users) {
  if (id && users.some((user) => user.id === id)) return id;
  return matchUser(name, users);
}

function displayName(id, name, users) {
  const user = users.find((item) => item.id === id);
  if (user) return personName(user);
  return String(name || "").trim();
}

function knownTask(id, name, tasks) {
  if (id && tasks.some((task) => task.id === id)) return id;
  const needle = String(name || "").trim().toLowerCase();
  if (!needle) return "";
  const hits = tasks.filter((task) => String(task.name || "").trim().toLowerCase() === needle);
  return hits.length === 1 ? hits[0].id : "";
}

function cleanDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "" : text;
}

function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}

function topicKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function addPerson(people, seen, id, name) {
  const cleanId = id || "";
  const cleanName = String(name || "").trim();
  if (!cleanId && !cleanName) return;
  const key = cleanId || cleanName.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  people.push({ id: cleanId, name: cleanName, known: Boolean(cleanId) });
}

function explodeActions(entry) {
  const text = String(entry?.action || "");
  const lines = text.split(/\n+/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter((line) => line.length > 2);
  if (lines.length <= 1) return [entry];
  return lines.map((action) => ({ ...entry, action }));
}

function composeNotes(remarks, actions) {
  const said = remarks.map((line) => `${line.name}: ${line.said}`).join("\n\n");
  const follow = actions.map((action) => {
    const who = action.ownerName || "Unassigned";
    const due = action.due ? ` (due ${action.due})` : "";
    return `- ${who}: ${action.action}${due}`;
  }).join("\n");
  return [said, follow ? `Action items:\n${follow}` : ""].filter(Boolean).join("\n\n").slice(0, 8000);
}

export function normalizeMeetingDraft(raw, { users, tasks }) {
  const warnings = [];
  const remember = (label, name) => {
    const text = String(name || "").trim();
    if (text) warnings.push(`${label}: ${text}`);
  };

  const facilitatorId = knownUser(raw?.facilitatorId, raw?.facilitatorName, users);
  const facilitatorName = displayName(facilitatorId, raw?.facilitatorName, users);

  const topicSource = Array.isArray(raw?.topics) ? raw.topics : (Array.isArray(raw?.agenda) ? raw.agenda : []);
  const topics = topicSource.slice(0, 30).map((item) => {
    const remarks = (Array.isArray(item?.remarks) ? item.remarks : []).slice(0, 30).flatMap((remark) => {
      const said = clip(remark?.said, 2000);
      if (!said) return [];
      const speakerId = knownUser(remark?.speakerId, remark?.speakerName, users);
      const speakerName = displayName(speakerId, remark?.speakerName, users) || "Attendee";
      return [{ id: speakerId, name: speakerName, said }];
    });
    const raisedId = knownUser(item?.raisedById || item?.ownerId, item?.raisedByName || item?.ownerName, users);
    let ownerName = displayName(raisedId, item?.raisedByName || item?.ownerName, users);
    let ownerId = raisedId;
    if (!ownerId && !ownerName && remarks[0]) {
      ownerId = remarks[0].id;
      ownerName = remarks[0].name;
    }
    return {
      topic: clip(item?.topic, 200) || "Untitled topic",
      ownerId,
      ownerName,
      time: clip(item?.time, 40),
      isDecision: Boolean(item?.isDecision),
      remarks,
      actions: [],
    };
  });

  const loose = [
    ...(Array.isArray(raw?.actions) ? raw.actions : []),
    ...topicSource.flatMap((item) => (Array.isArray(item?.actions) ? item.actions.map((entry) => ({ ...entry, topic: entry?.topic || item?.topic })) : [])),
  ];

  for (const packed of loose.flatMap((entry) => explodeActions(entry))) {
    const action = clip(packed?.action, 500);
    if (!action) continue;
    const key = topicKey(packed?.topic);
    let target = topics.find((item) => topicKey(item.topic) === key);
    if (!target && key) {
      target = topics.find((item) => {
        const itemKey = topicKey(item.topic);
        return itemKey.includes(key) || key.includes(itemKey);
      });
    }
    if (!target) {
      target = {
        topic: clip(packed?.topic, 200) || "Follow-ups",
        ownerId: "",
        ownerName: "",
        time: "",
        isDecision: false,
        remarks: [],
        actions: [],
      };
      topics.push(target);
    }
    const ownerId = knownUser(packed?.ownerId, packed?.ownerName, users);
    const ownerName = displayName(ownerId, packed?.ownerName, users);
    const fingerprint = action.toLowerCase();
    if (target.actions.some((entry) => entry.action.toLowerCase() === fingerprint)) continue;
    target.actions.push({
      action,
      ownerId,
      ownerName,
      due: cleanDate(packed?.due),
      actualEnd: cleanDate(packed?.actualEnd),
    });
  }

  const agenda = (topics.length ? topics : [{
    topic: "Meeting notes",
    ownerId: "",
    ownerName: "",
    time: "",
    isDecision: false,
    remarks: [],
    actions: [],
  }]).map((item) => ({
    topic: item.topic,
    ownerId: item.ownerId,
    ownerName: item.ownerName,
    time: item.time,
    notes: composeNotes(item.remarks, item.actions),
    isDecision: item.isDecision,
    actions: item.actions.slice(0, 40).map((entry) => ({
      action: entry.action,
      ownerId: entry.ownerId,
      ownerName: entry.ownerName,
      due: entry.due,
      actualEnd: entry.actualEnd,
    })),
  }));

  const people = [];
  const seen = new Set();
  const listed = Array.isArray(raw?.participants) ? raw.participants : [];
  const legacyNames = Array.isArray(raw?.participantNames) ? raw.participantNames : [];
  const legacyIds = Array.isArray(raw?.participantIds) ? raw.participantIds : [];
  for (let index = 0; index < Math.max(listed.length, legacyNames.length, legacyIds.length); index += 1) {
    const source = listed[index] || {};
    const id = knownUser(source.id || legacyIds[index], source.name || legacyNames[index], users);
    addPerson(people, seen, id, displayName(id, source.name || legacyNames[index], users));
  }
  addPerson(people, seen, facilitatorId, facilitatorName);
  for (const item of topics) {
    addPerson(people, seen, item.ownerId, item.ownerName);
    for (const remark of item.remarks) addPerson(people, seen, remark.id, remark.name);
    for (const action of item.actions) addPerson(people, seen, action.ownerId, action.ownerName);
  }

  const guestNames = people.filter((person) => !person.known).map((person) => person.name);
  if (guestNames.length) remember("New attendees, not in the directory", guestNames.join(", "));

  const taskId = knownTask(raw?.taskId, raw?.taskName, tasks);
  if (!taskId && String(raw?.taskName || "").trim()) remember("No project task was linked", raw.taskName);

  if (!agenda[0].notes && agenda.length === 1 && agenda[0].topic === "Meeting notes") {
    agenda[0].notes = "";
  }

  return {
    meeting: {
      title: clip(raw?.title, 160) || "Meeting notes",
      date: cleanDate(raw?.date),
      time: clip(raw?.time, 80),
      facilitatorId,
      facilitatorName,
      participantIds: people.filter((person) => person.known).map((person) => person.id),
      participants: people,
      guestNames,
      taskId,
      agenda,
    },
    warnings: [...new Set(warnings)],
  };
}

function roster(db) {
  const users = (db.users || []).map((user) => ({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
  }));
  const tasks = (db.tasks || []).map((task) => ({ id: task.id, name: task.name }));
  return { users, tasks };
}

function promptFor(notes, users, tasks) {
  const people = users.map((user) => `${user.id} | ${personName(user)} | ${user.email}`).join("\n");
  const taskLines = tasks.map((task) => `${task.id} | ${task.name}`).join("\n");
  return `Turn these raw meeting notes into one Z PM meeting.

Use the people and tasks below when the notes clearly refer to them. Copy an id exactly.
When a person is not on the list, leave that id empty and put the name from the notes in the name field. Still include that person.

Participants are only the people who attended, spoke, facilitated, or were given an action. Include each of them once.

Split the discussion into topics.
raisedBy is the attendee who brought that topic up. Always set raisedByName. If they are on the people list, set raisedById too.
remarks is what each attendee said on that topic. One remark per speaker. Write the substance of what that person said. Do not merge several people into one remark, and do not leave a speaker out.

actions is every follow-up in the whole meeting, one object per follow-up.
A follow-up is anything someone is asked to do, agrees to do, or is assigned, including lines marked Action, AI, TODO, or "will".
If the notes contain six follow-ups, actions has six objects. Returning only the first follow-up is wrong.
Do not merge several follow-ups into one action string.
Set topic on each action to the topic it belongs to.
Set the action owner to the person who has to do it.

Set isDecision only when the notes record a decision that was made.
Dates must be YYYY-MM-DD. Leave a date empty when the notes do not state one.
Do not invent people, dates, or actions.
Leave the facilitator empty when the notes do not name the person running the meeting.
Keep the title short. Time can be a range such as "1PM to 2 PM", or empty.

People:
${people}

Tasks:
${taskLines}

Notes:
${notes}`;
}

function assumeFacilitator(draft, users, defaultOwnerId) {
  if (!defaultOwnerId) return draft;
  const meeting = draft.meeting;
  if (meeting.facilitatorId || String(meeting.facilitatorName || "").trim()) return draft;
  const person = users.find((user) => user.id === defaultOwnerId);
  if (!person) return draft;
  const name = personName(person);
  meeting.facilitatorId = person.id;
  meeting.facilitatorName = name;
  if (!meeting.participantIds.includes(person.id)) meeting.participantIds.unshift(person.id);
  if (!(meeting.participants || []).some((item) => item.id === person.id)) {
    meeting.participants = [{ id: person.id, name, known: true }, ...(meeting.participants || [])];
  }
  draft.warnings = [...draft.warnings, "You are set as the facilitator because the notes did not name one."];
  return draft;
}

export async function draftMeetingFromNotes(notes, db, client, options = {}) {
  const text = String(notes || "").trim();
  if (!text) throw httpError(400, "Paste meeting notes first.");
  if (text.length > 24000) throw httpError(400, "Those notes are too long. Keep them under 24,000 characters.");
  const apiKey = process.env.OPENAI_API_KEY;
  if (!client && !apiKey) throw httpError(503, "OpenAI is not configured. Add OPENAI_API_KEY to server/.env and restart the API.");

  const { users, tasks } = roster(db);
  const llm = client || new OpenAI({ apiKey });
  let completion;
  try {
    completion = await llm.chat.completions.create({
      model: MODEL(),
      messages: [
        {
          role: "system",
          content: "You extract project meeting records. Include every speaker and every action item. Omitting an action item or a speaker is a mistake. Never invent attendees, decisions, dates, or actions.",
        },
        { role: "user", content: promptFor(text, users, tasks) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "meeting_draft", strict: true, schema: meetingSchema },
      },
    });
  } catch (error) {
    if (error?.status === 401) throw httpError(401, "OpenAI rejected the API key in server/.env.");
    const detail = error?.status === 404
      ? `The model "${MODEL()}" is not available. Set OPENAI_MODEL in server/.env.`
      : "OpenAI could not read those notes. Try again.";
    throw httpError(502, detail);
  }

  const message = completion.choices?.[0]?.message;
  if (message?.refusal) throw httpError(422, "OpenAI declined to turn those notes into a meeting.");
  let parsed;
  try {
    parsed = JSON.parse(message?.content || "");
  } catch {
    throw httpError(502, "OpenAI returned a meeting draft that could not be read.");
  }
  const draft = normalizeMeetingDraft(parsed, { users, tasks });
  if (!draft.meeting.agenda[0].notes && draft.meeting.agenda.length === 1 && draft.meeting.agenda[0].topic === "Meeting notes") {
    draft.meeting.agenda[0].notes = text.slice(0, 8000);
  }
  return assumeFacilitator(draft, users, options.defaultOwnerId);
}
