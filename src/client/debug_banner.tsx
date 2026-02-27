export type DebugGateInfo = {
  enabled: boolean;
  reason: string;
  build: string;
};

type DebugBannerProps = {
  debugGate: DebugGateInfo | null;
};

export const DebugBanner = ({ debugGate }: DebugBannerProps) => {
  if (!debugGate?.enabled) {
    return null;
  }

  return (
    <div className="w-full rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
      Dev tools: ON | build: {debugGate.build} | gate: {debugGate.reason}
    </div>
  );
};
