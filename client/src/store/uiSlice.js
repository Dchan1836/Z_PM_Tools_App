import { createSlice } from "@reduxjs/toolkit";

const uiSlice = createSlice({
  name: "ui",
  initialState: {
    page: "dashboard",
    focusTaskId: "",
    error: "",
    notice: "",
    pending: null,
    mailOpen: false,
    meetingNotes: null,
    workflowDraft: null,
  },
  reducers: {
    go(state, action) {
      state.page = action.payload.page;
      state.focusTaskId = action.payload.taskId || "";
      state.error = "";
      state.notice = "";
      state.meetingNotes = null;
      state.workflowDraft = null;
    },
    startMeetingFromNotes(state, action) {
      state.page = "meetings";
      state.focusTaskId = "";
      state.error = "";
      state.notice = "";
      state.meetingNotes = { id: action.payload.id, notes: action.payload.notes };
      state.workflowDraft = null;
    },
    clearMeetingNotes(state) {
      state.meetingNotes = null;
    },
    startWorkflowDraft(state, action) {
      state.page = "workflows";
      state.focusTaskId = "";
      state.error = "";
      state.notice = "";
      state.meetingNotes = null;
      state.workflowDraft = { id: action.payload.id, workflow: action.payload.workflow };
    },
    clearWorkflowDraft(state) {
      state.workflowDraft = null;
    },
    setError(state, action) {
      state.error = action.payload || "";
    },
    setNotice(state, action) {
      state.notice = action.payload || "";
    },
    setPending(state, action) {
      state.pending = action.payload;
    },
    setMailOpen(state, action) {
      state.mailOpen = action.payload;
    },
  },
});

export const { go, startMeetingFromNotes, clearMeetingNotes, startWorkflowDraft, clearWorkflowDraft, setError, setNotice, setPending, setMailOpen } = uiSlice.actions;
export default uiSlice.reducer;
