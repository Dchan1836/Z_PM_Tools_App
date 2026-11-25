import assert from "node:assert/strict";
import test from "node:test";
import { draftMeetingFromNotes, normalizeMeetingDraft } from "../src/meetingDraft.js";
import { createMockLlm } from "./mockLlm.js";
import { createSeed } from "../src/seed.js";

const users = [
  { id: "u-harry", firstName: "Harry", lastName: "Leggs", email: "harry.leggs@zpm.local" },
  { id: "u-sally", firstName: "Sally", lastName: "Nguyen", email: "sally.nguyen@zpm.local" },
];

const notes = [
  "Printer standup",
  "Date: 2026-12-02",
  "Time: 1PM to 2 PM",
  "Facilitator: John Smith",
  "Topic: Label printers",
  "Raised by: Harry Leggs",
  "Harry Leggs: The shipment slipped two weeks.",
  "Jane Doe: We should tell the floor.",
  "Riley Guest: I can hold the boxes.",
  "Action: Harry Leggs will email the vendor by 2026-12-05",
  "Action: Sally Nguyen will update the tracker by 2026-12-06",
].join("\n");

test("a meeting draft keeps every action and matches directory names", () => {
  const draft = normalizeMeetingDraft({
    title: "Printer standup",
    date: "2026-12-02",
    time: "1PM to 2 PM",
    facilitatorName: "Harry Leggs",
    participants: [{ id: "", name: "Riley Guest" }],
    topics: [{
      topic: "Label printers",
      raisedByName: "Harry Leggs",
      raisedById: "",
      time: "",
      isDecision: false,
      remarks: [
        { speakerName: "Harry Leggs", speakerId: "", said: "The shipment slipped two weeks." },
        { speakerName: "Sally Nguyen", speakerId: "", said: "I will update the tracker." },
      ],
    }],
    actions: [
      { topic: "Label printers", action: "Email the vendor", ownerName: "Harry Leggs", due: "2026-12-05", actualEnd: "" },
      { topic: "Label printers", action: "Update the tracker", ownerName: "Sally Nguyen", due: "2026-12-06", actualEnd: "" },
    ],
  }, { users, tasks: [] });

  const topic = draft.meeting.agenda[0];
  assert.equal(topic.actions.length, 2);
  assert.equal(topic.actions[0].ownerId, "u-harry");
  assert.equal(topic.actions[1].ownerId, "u-sally");
  assert.equal(topic.ownerId, "u-harry");
  assert.match(topic.notes, /Harry Leggs: The shipment slipped/);
  assert.match(topic.notes, /Sally Nguyen: I will update the tracker/);
  assert.deepEqual(draft.meeting.guestNames, ["Riley Guest"]);
  assert.match(draft.warnings.join(" "), /Riley Guest/);
});

test("drafting notes uses the mock model and files both follow-ups", async () => {
  const llm = createMockLlm();
  const draft = await draftMeetingFromNotes(notes, createSeed(), llm);

  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0].api, "chat.completions");
  assert.equal(llm.calls[0].schema, "meeting_draft");
  assert.equal(draft.meeting.title, "Printer standup");
  assert.equal(draft.meeting.date, "2026-12-02");
  assert.equal(draft.meeting.facilitatorId, "u-john");
  const actions = draft.meeting.agenda[0].actions;
  assert.deepEqual(actions.map((item) => item.action), ["email the vendor", "update the tracker"]);
  assert.deepEqual(actions.map((item) => item.ownerId), ["u-harry", "u-sally"]);
  assert.equal(draft.meeting.agenda[0].remarks ? draft.meeting.agenda[0].remarks.length : undefined, undefined);
  assert.match(draft.meeting.agenda[0].notes, /Jane Doe: We should tell the floor/);
  assert.ok(draft.meeting.guestNames.includes("Riley Guest"));
  assert.ok(draft.meeting.participantIds.includes("u-jane"));
});

test("blank notes and a refused draft never need a live model", async () => {
  const llm = createMockLlm();
  await assert.rejects(draftMeetingFromNotes("   ", createSeed(), llm), /Paste meeting notes first/);
  assert.equal(llm.calls.length, 0);

  const refused = createMockLlm({
    complete: async () => ({ choices: [{ message: { refusal: "no", content: null } }] }),
  });
  await assert.rejects(draftMeetingFromNotes(notes, createSeed(), refused), /declined to turn those notes/);

  const broken = createMockLlm({
    complete: async () => ({ choices: [{ message: { content: "not json" } }] }),
  });
  await assert.rejects(draftMeetingFromNotes(notes, createSeed(), broken), /could not be read/);
});

test("notes are refused when no model client and no API key are available", async () => {
  await assert.rejects(draftMeetingFromNotes(notes, createSeed()), /OPENAI_API_KEY/);
});

test("chat notes with no facilitator use the person who sent the message", async () => {
  const llm = createMockLlm();
  const draft = await draftMeetingFromNotes([
    "Printer standup",
    "Date: 2026-12-02",
    "Topic: Label printers",
    "Raised by: Harry Leggs",
    "Harry Leggs: The shipment slipped.",
    "Action: Sally Nguyen will update the tracker by 2026-12-06",
  ].join("\n"), createSeed(), llm, { defaultOwnerId: "u-zulfi" });

  assert.equal(draft.meeting.facilitatorId, "u-zulfi");
  assert.equal(draft.meeting.facilitatorName, "Zulfi Khan");
  assert.ok(draft.meeting.participantIds.includes("u-zulfi"));
  assert.equal(draft.meeting.agenda[0].ownerId, "u-harry");
  assert.equal(draft.meeting.agenda[0].actions[0].ownerId, "u-sally");
  assert.match(draft.warnings.join(" "), /set as the facilitator/);
});

test("a named facilitator stays in place when the chat supplies a default", async () => {
  const draft = await draftMeetingFromNotes(notes, createSeed(), createMockLlm(), { defaultOwnerId: "u-zulfi" });
  assert.equal(draft.meeting.facilitatorId, "u-john");
  assert.equal(draft.warnings.some((warning) => /facilitator/.test(warning)), false);
});
