export type DashboardConfig = {
  enabled: boolean;
  refreshMs: number;
};

export interface DashboardControl {
  config(): DashboardConfig;
}

export function createDashboardControl(args: {
  enabled: boolean;
  refreshMs: number;
  isTTY: boolean;
}): DashboardControl {
  const refreshMs = Math.min(1000, Math.max(100, Math.floor(args.refreshMs)));
  const enabled = Boolean(args.enabled) && Boolean(args.isTTY);

  const cfg: DashboardConfig = {
    enabled,
    refreshMs,
  };

  return {
    config: () => cfg,
  };
}
