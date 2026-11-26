import assert from "node:assert/strict";
import test from "node:test";
import { answerProjectQuestion, clearRetrievalCache } from "../src/rag.js";
import { createSeed } from "../src/seed.js";
import { createMockLlm } from "./mockLlm.js";

function project() {
  return structuredClone(createSeed());
}

function steve(db) {
  return db.users.find((user) => user.id === "u-steve");
}

test.beforeEach(() => {
  clearRetrievalCache();
});

test("a project question is answered from retrieved records", async () => {
  const db = project();
  const llm = createMockLlm();
  const result = await answerProjectQuestion({
    question: "Who owns the task Supervisor Interviews?",
    db,
    user: steve(db),
    client: llm,
  });

  assert.equal(result.intent, "question");
  assert.match(result.answer, /Supervisor Interviews is owned by Bill Ding/);
  assert.ok(result.sources.some((source) => source.title === "Supervisor Interviews" && source.kind === "task"));
  assert.ok(llm.calls.some((call) => call.api === "embeddings"));
  assert.ok(llm.calls.some((call) => call.api === "chat.completions" && call.schema === "chat_intent"));
  assert.ok(llm.calls.some((call) => call.api === "chat.completions" && call.schema === ""));
  assert.equal(JSON.stringify(llm.calls).includes("openai.com"), false);
});

test("a workflow request opens a review draft with directory ids", async () => {
  const db = project();
  const llm = createMockLlm();
  const result = await answerProjectQuestion({
    question: "Create a workflow named Badge pickup at Portland in Training. Tasks: Print badges owned by Harry Leggs, then Hand out badges owned by Sally Nguyen. Dates 2026-12-01 to 2026-12-15.",
    db,
    user: steve(db),
    client: llm,
  });

  assert.equal(result.intent, "workflow");
  assert.equal(result.workflow.name, "Badge pickup");
  assert.equal(result.workflow.siteId, "portland");
  assert.equal(result.workflow.pillar, "Training");
  assert.equal(result.workflow.plannedStart, "2026-12-01");
  assert.equal(result.workflow.plannedEnd, "2026-12-15");
  assert.equal(result.workflow.ownerId, "u-steve");
  assert.deepEqual(result.workflow.steps.map((step) => step.name), ["Print badges", "Hand out badges"]);
  assert.deepEqual(result.workflow.steps.map((step) => step.ownerId), ["u-harry", "u-sally"]);
  assert.match(result.answer, /You are set as the owner/);
  assert.equal(llm.calls.some((call) => call.api === "embeddings"), false);
});

test("a workflow task with no owner is assigned to the person who asked", async () => {
  const db = project();
  const result = await answerProjectQuestion({
    question: "Create a workflow named Badge pickup at Portland in Training. Tasks: Print badges, then Hand out badges owned by Sally Nguyen. Dates 2026-12-01 to 2026-12-15.",
    db,
    user: steve(db),
    client: createMockLlm(),
  });

  assert.equal(result.workflow.ownerId, "u-steve");
  assert.deepEqual(result.workflow.steps.map((step) => [step.name, step.ownerId]), [
    ["Print badges", "u-steve"],
    ["Hand out badges", "u-sally"],
  ]);
  assert.match(result.answer, /assigned to you/);
});

test("an unknown workflow owner is left blank and named in the reply", async () => {
  const db = project();
  const result = await answerProjectQuestion({
    question: "Create a workflow named Room check at Atlantis in Training. Tasks: Walk the rooms owned by Nobody Special. Dates 2026-12-01 to 2026-12-02.",
    db,
    user: steve(db),
    client: createMockLlm(),
  });

  assert.equal(result.intent, "workflow");
  assert.equal(result.workflow.ownerId, "u-steve");
  assert.equal(result.workflow.steps[0].ownerId, "");
  assert.equal(result.workflow.siteId, "");
  assert.match(result.answer, /Nobody Special/);
  assert.match(result.answer, /Atlantis/);
});

test("someone who cannot edit the plan does not get a workflow draft", async () => {
  const db = project();
  const harry = db.users.find((user) => user.id === "u-harry");
  const result = await answerProjectQuestion({
    question: "Create a workflow named Badge pickup at Portland in Training. Tasks: Print badges owned by Harry Leggs. Dates 2026-12-01 to 2026-12-02.",
    db,
    user: harry,
    client: createMockLlm(),
  });

  assert.equal(result.intent, "question");
  assert.match(result.answer, /permission to edit the plan/);
  assert.equal(result.workflow, undefined);
});

test("meeting notes in the chat are returned for the create form", async () => {
  const db = project();
  const llm = createMockLlm();
  const result = await answerProjectQuestion({
    question: "Create a meeting from these notes:\nDate: 2026-12-02\nHarry Leggs said the printers slipped.",
    db,
    user: steve(db),
    client: llm,
  });

  assert.equal(result.intent, "meeting");
  assert.match(result.notes, /Harry Leggs said the printers slipped/);
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0].schema, "chat_intent");
});

test("an empty question does not call the model", async () => {
  const db = project();
  const llm = createMockLlm();
  await assert.rejects(
    answerProjectQuestion({ question: "  ", db, user: steve(db), client: llm }),
    /Ask a question/,
  );
  assert.equal(llm.calls.length, 0);
});

test("chat is refused when no model client and no API key are available", async () => {
  const db = project();
  await assert.rejects(
    answerProjectQuestion({ question: "Who owns Printer Deployment?", db, user: steve(db) }),
    /OPENAI_API_KEY/,
  );
});

test("a model failure stays on the mock client", async () => {
  const db = project();
  const denied = createMockLlm({
    complete: async () => {
      const error = new Error("bad key");
      error.status = 401;
      throw error;
    },
  });
  await assert.rejects(
    answerProjectQuestion({ question: "Who owns the task Supervisor Interviews?", db, user: steve(db), client: denied }),
    /rejected the API key/,
  );

  const missing = createMockLlm({
    complete: async () => {
      const error = new Error("missing model");
      error.status = 404;
      throw error;
    },
  });
  await assert.rejects(
    answerProjectQuestion({ question: "Who owns the task Supervisor Interviews?", db, user: steve(db), client: missing }),
    /not available/,
  );
});
