import { useReducer } from "react";
import { applyWorkbenchAction, createInitialState } from "../state/workbench-state.js";

export function useWorkbench() {
  return useReducer(applyWorkbenchAction, undefined, createInitialState);
}
