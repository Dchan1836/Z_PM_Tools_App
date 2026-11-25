import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import * as api from "../api.js";
import { go, setError, setNotice, setPending } from "./uiSlice.js";
import { clearChat } from "./chatSlice.js";

export const signIn = createAsyncThunk("project/signIn", async ({ email, password }, { dispatch, rejectWithValue }) => {
  try {
    const result = await api.login(email, password);
    api.setToken(result.token);
    dispatch(go({ page: "dashboard", taskId: "" }));
    return result.state;
  } catch (error) {
    return rejectWithValue(error.message);
  }
});

export const bootstrap = createAsyncThunk("project/bootstrap", async () => {
  const token = api.getToken();
  const epoch = api.sessionEpoch();
  if (!token) return { ignored: true };
  try {
    const data = await api.loadState();
    if (api.sessionEpoch() !== epoch) return { ignored: true };
    return { data };
  } catch (error) {
    if (error.stale || api.sessionEpoch() !== epoch) return { ignored: true };
    api.setToken("");
    return { data: null };
  }
});

export const runAction = createAsyncThunk("project/run", async (body, { dispatch, rejectWithValue }) => {
  dispatch(setError(""));
  try {
    const result = await api.action(body);
    if (result.warning) dispatch(setPending({ body, warning: result }));
    return result;
  } catch (error) {
    if (!api.quietAuthError(error)) dispatch(setError(error.message));
    return rejectWithValue(error.message);
  }
});

export const absorbResult = createAsyncThunk("project/absorb", async (result, { dispatch }) => {
  if (result?.warning) dispatch(setPending({ body: {}, warning: result }));
  return result || null;
});

export const restoreSample = createAsyncThunk("project/restore", async (_, { dispatch }) => {
  const result = await api.resetDemo();
  dispatch(setNotice("Sample project restored."));
  return result.state;
});

export function signOut({ expired = false } = {}) {
  return (dispatch) => {
    api.setToken("");
    dispatch(projectSlice.actions.clearProject());
    dispatch(clearChat());
    dispatch(setPending(null));
    dispatch(go({ page: "dashboard", taskId: "" }));
    if (expired) dispatch(setNotice("Your session ended. Sign in again."));
  };
}

const projectSlice = createSlice({
  name: "project",
  initialState: {
    data: null,
    status: api.getToken() ? "loading" : "signedOut",
  },
  reducers: {
    clearProject(state) {
      state.data = null;
      state.status = "signedOut";
    },
  },
  extraReducers(builder) {
    builder
      .addCase(signIn.fulfilled, (state, action) => {
        state.data = action.payload;
        state.status = "ready";
      })
      .addCase(bootstrap.fulfilled, (state, action) => {
        if (action.payload?.ignored) return;
        state.data = action.payload?.data ?? null;
        state.status = state.data ? "ready" : "signedOut";
      })
      .addCase(bootstrap.rejected, (state) => {
        state.data = null;
        state.status = "signedOut";
      })
      .addCase(runAction.fulfilled, (state, action) => {
        if (action.payload?.state) state.data = action.payload.state;
      })
      .addCase(absorbResult.fulfilled, (state, action) => {
        if (action.payload?.state) state.data = action.payload.state;
      })
      .addCase(restoreSample.fulfilled, (state, action) => {
        state.data = action.payload;
        state.status = "ready";
      })
      .addCase(restoreSample.rejected, (state) => {
        state.status = state.data ? "ready" : "signedOut";
      });
  },
});

export default projectSlice.reducer;
