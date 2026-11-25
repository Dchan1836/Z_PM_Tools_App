import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { askProject, quietAuthError } from "../api.js";
import { startMeetingFromNotes, startWorkflowDraft } from "./uiSlice.js";

export const sendChat = createAsyncThunk("chat/send", async (text, { dispatch, getState, rejectWithValue }) => {
  let prior = getState().chat.messages
    .filter((message) => message.role === "user" || message.role === "assistant");
  if (prior.at(-1)?.role === "user" && prior.at(-1).content === text) prior = prior.slice(0, -1);
  prior = prior.slice(-8).map((message) => ({ role: message.role, content: message.content }));
  try {
    const result = await askProject(text, prior);
    if (result.intent === "meeting" && result.notes) {
      dispatch(startMeetingFromNotes({ id: crypto.randomUUID(), notes: result.notes }));
    }
    if (result.intent === "workflow" && result.workflow?.name && result.workflow.steps?.length) {
      dispatch(startWorkflowDraft({ id: crypto.randomUUID(), workflow: result.workflow }));
    }
    return result;
  } catch (error) {
    if (quietAuthError(error)) return rejectWithValue(false);
    return rejectWithValue(error.message || "The assistant could not answer.");
  }
});

const chatSlice = createSlice({
  name: "chat",
  initialState: {
    expanded: false,
    draft: "",
    messages: [],
    status: "idle",
    error: "",
  },
  reducers: {
    setExpanded(state, action) {
      state.expanded = action.payload;
    },
    setDraft(state, action) {
      state.draft = action.payload;
    },
    clearChat(state) {
      state.messages = [];
      state.draft = "";
      state.error = "";
      state.status = "idle";
      state.expanded = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(sendChat.pending, (state, action) => {
        state.status = "sending";
        state.error = "";
        state.expanded = true;
        state.messages.push({ id: action.meta.requestId, role: "user", content: action.meta.arg, sources: [] });
      })
      .addCase(sendChat.fulfilled, (state, action) => {
        state.status = "idle";
        if (action.payload.intent === "meeting" || action.payload.intent === "workflow") state.expanded = false;
        state.messages.push({
          id: `${action.meta.requestId}-answer`,
          role: "assistant",
          content: action.payload.answer,
          sources: action.payload.sources || [],
        });
      })
      .addCase(sendChat.rejected, (state, action) => {
        state.status = "idle";
        if (action.payload === false) return;
        state.error = action.payload || "The assistant could not answer.";
      });
  },
});

export const { setExpanded, setDraft, clearChat } = chatSlice.actions;
export default chatSlice.reducer;
