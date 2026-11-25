import { configureStore } from "@reduxjs/toolkit";
import { onSessionExpired } from "../api.js";
import projectReducer, { signOut } from "./projectSlice.js";
import uiReducer from "./uiSlice.js";
import chatReducer from "./chatSlice.js";

export const store = configureStore({
  reducer: {
    project: projectReducer,
    ui: uiReducer,
    chat: chatReducer,
  },
});

onSessionExpired(() => {
  store.dispatch(signOut({ expired: true }));
});
