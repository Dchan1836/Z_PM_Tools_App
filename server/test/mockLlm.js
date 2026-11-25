/**
 * In-process stand-in for the OpenAI client.
 * embeddings.create and chat.completions.create never leave the machine.
 * Pass { complete } to script one reply. Otherwise the mock reads the
 * request the app already built and returns a schema-shaped answer.
 */

const DIMENSIONS = 48;

function tokens(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9]{2,}/g) || [];
}

function embed(text) {
  const vector = Array(DIMENSIONS).fill(0);
  for (const token of tokens(text)) {
    let hash = 0;
    for (let index = 0; index < token.length; index += 1) hash = (hash * 33 + token.charCodeAt(index)) >>> 0;
    vector[hash % DIMENSIONS] += 1;
  }
  return vector;
}

function message(content, extra = {}) {
  return { choices: [{ message: { content, ...extra } }] };
}

function userText(request) {
  const content = [...(request.messages || [])].reverse().find((item) => item.role === "user")?.content || "";
  const marker = "Current message:\n";
  const at = content.lastIndexOf(marker);
  return (at >= 0 ? content.slice(at + marker.length) : content).trim();
}

function emptyWorkflow() {
  return { name: "", owner: "", pillar: "", site: "", plannedStart: "", plannedEnd: "", steps: [] };
}

function workflowFrom(text) {
  const named = text.match(/\bnamed\s+(.+?)\s+at\s+/i);
  const place = text.match(/\bat\s+([A-Za-z]+)\s+in\s+([A-Za-z]+)/i);
  const dates = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/g) || [];
  const taskBlock = (text.split(/\btasks:\s*/i)[1] || "").split(/\bdates\b/i)[0];
  const steps = taskBlock.split(/\bthen\b/i).map((chunk) => {
    const text = chunk.replace(/^[^A-Za-z0-9]+/, "").trim();
    if (!text) return null;
    const owned = text.match(/^(.*?)\s+owned by\s+([A-Za-z][A-Za-z .'-]*?)(?:[.,]|$)/i);
    if (!owned) {
      return { name: text.replace(/[.,]\s*$/, "").trim(), owner: "", plannedStart: "", plannedEnd: "" };
    }
    return {
      name: owned[1].trim(),
      owner: owned[2].trim(),
      plannedStart: "",
      plannedEnd: "",
    };
  }).filter((step) => step?.name);
  return {
    intent: "workflow",
    notes: "",
    workflow: {
      name: named ? named[1].trim() : "",
      owner: "",
      pillar: place ? place[2].trim() : "",
      site: place ? place[1].trim() : "",
      plannedStart: dates[0] || "",
      plannedEnd: dates[1] || "",
      steps,
    },
  };
}

function intentFrom(text) {
  if (/\bworkflow\b/i.test(text) && /\btasks?:/i.test(text)) return workflowFrom(text);
  const notesLead = text.match(/^create a meeting from these notes:\s*([\s\S]*)$/i);
  if (notesLead || /\b(attendees:|action:|topic:)\b/i.test(text)) {
    return {
      intent: "meeting",
      notes: (notesLead ? notesLead[1] : text).trim(),
      workflow: emptyWorkflow(),
    };
  }
  return { intent: "question", notes: "", workflow: emptyWorkflow() };
}

function peopleInPrompt(prompt) {
  const block = prompt.split("People:\n")[1]?.split("\n\nTasks:")[0] || "";
  return block.split("\n").map((line) => {
    const [id, name] = line.split("|").map((part) => part.trim());
    return id && name ? { id, name } : null;
  }).filter(Boolean);
}

function idFor(people, name) {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return "";
  return people.find((person) => person.name.toLowerCase() === wanted)?.id || "";
}

function meetingFrom(prompt) {
  const people = peopleInPrompt(prompt);
  const notes = prompt.split("Notes:\n").pop() || "";
  const lines = notes.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const field = (label) => {
    const line = lines.find((item) => item.toLowerCase().startsWith(`${label.toLowerCase()}:`));
    return line ? line.slice(label.length + 1).trim() : "";
  };
  const topics = [];
  const actions = [];
  let current = null;
  for (const line of lines.slice(1)) {
    if (/^topic:/i.test(line)) {
      current = {
        topic: line.slice(6).trim(),
        raisedById: "",
        raisedByName: "",
        time: "",
        isDecision: false,
        remarks: [],
      };
      topics.push(current);
      continue;
    }
    if (/^raised by:/i.test(line) && current) {
      current.raisedByName = line.slice(10).trim();
      current.raisedById = idFor(people, current.raisedByName);
      continue;
    }
    const action = line.match(/^action:\s*(.+?)\s+will\s+(.+?)(?:\s+by\s+(20\d{2}-\d{2}-\d{2}))?\.?$/i);
    if (action) {
      const ownerName = action[1].trim();
      actions.push({
        topic: current?.topic || "",
        action: action[2].trim(),
        ownerId: idFor(people, ownerName),
        ownerName,
        due: action[3] || "",
        actualEnd: "",
      });
      continue;
    }
    const said = line.match(/^([^:]{2,80}):\s*(.+)$/);
    if (said && current && !/^(date|time|facilitator)$/i.test(said[1].trim())) {
      const speakerName = said[1].trim();
      current.remarks.push({
        speakerId: idFor(people, speakerName),
        speakerName,
        said: said[2].trim(),
      });
    }
  }
  const facilitatorName = field("Facilitator");
  const names = [];
  const addName = (name) => {
    const clean = String(name || "").trim();
    if (!clean || names.some((item) => item.toLowerCase() === clean.toLowerCase())) return;
    names.push(clean);
  };
  addName(facilitatorName);
  for (const topic of topics) {
    addName(topic.raisedByName);
    for (const remark of topic.remarks) addName(remark.speakerName);
  }
  for (const action of actions) addName(action.ownerName);
  return {
    title: lines[0] || "Meeting",
    date: field("Date"),
    time: field("Time"),
    facilitatorId: idFor(people, facilitatorName),
    facilitatorName,
    participants: names.map((name) => ({ id: idFor(people, name), name })),
    topics,
    actions,
    taskId: "",
    taskName: "",
  };
}

function passages(system) {
  const records = [];
  const pattern = /\[(\d+)\] ([^\n]+) \(([^)\n]+)\)\n([\s\S]*?)(?=\n\n\[\d+\] |\s*$)/g;
  for (const match of String(system || "").matchAll(pattern)) {
    records.push({ title: match[2].trim(), kind: match[3].trim(), text: match[4] });
  }
  return records;
}

function overlap(left, right) {
  const words = new Set(tokens(right));
  return tokens(left).reduce((sum, token) => sum + (words.has(token) ? 1 : 0), 0);
}

function answerFrom(request) {
  const question = userText(request);
  const system = (request.messages || []).find((item) => item.role === "system")?.content || "";
  const records = passages(system);
  const best = records.slice().sort((left, right) => overlap(question, `${right.title}\n${right.text}`) - overlap(question, `${left.title}\n${left.text}`))[0];
  if (!best) return "I cannot find it in the project data.";
  const owner = best.text.match(/^Owner: (.+)$/m)?.[1]?.trim();
  if (/\bwho owns\b/i.test(question) && owner) return `${best.title} is owned by ${owner}.`;
  const status = best.text.match(/^Status: (.+)$/m)?.[1]?.trim();
  if (status) return `${best.title} is ${status}.`;
  return `From ${best.title}.`;
}

function localCompletion(request) {
  const schema = request.response_format?.json_schema?.name;
  if (schema === "chat_intent") return message(JSON.stringify(intentFrom(userText(request))));
  if (schema === "meeting_draft") return message(JSON.stringify(meetingFrom(userText(request))));
  return message(answerFrom(request));
}

export function createMockLlm({ complete } = {}) {
  const calls = [];
  return {
    calls,
    embeddings: {
      async create(body) {
        calls.push({ api: "embeddings", model: body?.model });
        const input = Array.isArray(body?.input) ? body.input : [body?.input];
        return { data: input.map((text, index) => ({ index, embedding: embed(text) })) };
      },
    },
    chat: {
      completions: {
        async create(body) {
          calls.push({ api: "chat.completions", model: body?.model, schema: body?.response_format?.json_schema?.name || "" });
          if (complete) return complete(body);
          return localCompletion(body);
        },
      },
    },
  };
}
