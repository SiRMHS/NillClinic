import { create } from "zustand";
import type { TimeRange } from "@jordan/shared";

interface DashboardState {
  timeRange: TimeRange;
  setTimeRange: (range: TimeRange) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  timeRange: "31d",
  setTimeRange: (timeRange) => set({ timeRange }),
}));
