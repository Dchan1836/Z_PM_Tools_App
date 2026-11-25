import { useDispatch, useSelector } from "react-redux";
import { absorbResult, restoreSample, runAction } from "./projectSlice.js";
import { go } from "./uiSlice.js";

export function useAppDispatch() {
  return useDispatch();
}

export function useProject() {
  return useSelector((state) => state.project.data);
}

export function useUi() {
  return useSelector((state) => state.ui);
}

export function useRun() {
  const dispatch = useAppDispatch();
  return (body) => dispatch(runAction(body)).unwrap().catch(() => null);
}

export function useAbsorb() {
  const dispatch = useAppDispatch();
  return (result) => dispatch(absorbResult(result)).unwrap();
}

export function useGo() {
  const dispatch = useAppDispatch();
  return (page, taskId = "") => dispatch(go({ page, taskId }));
}

export function useFocusTaskId() {
  return useSelector((state) => state.ui.focusTaskId);
}

export function useRestore() {
  const dispatch = useAppDispatch();
  return () => dispatch(restoreSample());
}
