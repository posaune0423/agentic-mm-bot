export type DashboardConfig = {
  enabled: boolean;
  refreshMs: number;
  noColor: boolean;
};

export interface DashboardControl {
  config(): DashboardConfig;
}

export function createDashboardControl(args: {
  enabled: boolean;
  refreshMs: number;
  noColor: boolean;
  isTTY: boolean;
}): DashboardControl {
  const refreshMs = Math.min(1000, Math.max(100, Math.floor(args.refreshMs)));
  const enabled = Boolean(args.enabled) && Boolean(args.isTTY);

  const cfg: DashboardConfig = {
    enabled,
    refreshMs,
    noColor: Boolean(args.noColor),
  };

  return {
    config: () => cfg,
  };
}
