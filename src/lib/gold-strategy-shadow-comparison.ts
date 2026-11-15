import { selectShadowCandidate, type FibCandle, type ShadowCandidate } from "./fibonacci-shadow.ts";
import { goldSmcShadowAnalysis, type GoldSmcShadowAnalysis } from "./gold-smc-shadow.ts";

export interface ComparableShadowSignal extends ShadowCandidate {
  entry?: number;
  sl?: number;
  tp?: number;
}

export interface VerifiedShadowCandidates {
  verified: true;
  gold?: ComparableShadowSignal | null;
  smc?: ComparableShadowSignal | null;
}

export interface GoldStrategyShadowComparison {
  shadowOnly: true;
  ordersSent: false;
  paperMotorNotified: false;
  time: number;
  historicalSignal: ComparableShadowSignal | null;
  proposedSignal: ComparableShadowSignal | null;
  directionAgreement: boolean | null;
  timeAgreement: boolean | null;
  priceDifferences: { entry: number | null; sl: number | null; tp: number | null };
  analysis: GoldSmcShadowAnalysis | null;
  limitation: string;
}

function difference(left?: number, right?: number): number | null {
  return Number.isFinite(left) && Number.isFinite(right) ? right! - left! : null;
}

export function compareGoldStrategyShadowAt(
  candles: FibCandle[],
  decisionAt: number,
  historicalSignal: ComparableShadowSignal | null,
  newSignals?: VerifiedShadowCandidates,
): GoldStrategyShadowComparison | null {
  if (!Number.isFinite(decisionAt)) return null;
  const analysis = goldSmcShadowAnalysis(candles, decisionAt);
  const selected = selectShadowCandidate(
    newSignals?.gold ?? null,
    newSignals?.smc ?? null,
    analysis?.fibonacciSignal ?? null,
  );
  const proposedSignal = selected?.source === "GOLD"
    ? newSignals?.gold ?? null
    : selected?.source === "SMC"
      ? newSignals?.smc ?? null
      : analysis?.fibonacciSignal ?? null;
  return {
    shadowOnly: true,
    ordersSent: false,
    paperMotorNotified: false,
    time: decisionAt,
    historicalSignal,
    proposedSignal,
    directionAgreement: historicalSignal && proposedSignal
      ? historicalSignal.direction === proposedSignal.direction
      : null,
    timeAgreement: historicalSignal && proposedSignal
      ? historicalSignal.time === proposedSignal.time
      : null,
    priceDifferences: {
      entry: difference(historicalSignal?.entry, proposedSignal?.entry),
      sl: difference(historicalSignal?.sl, proposedSignal?.sl),
      tp: difference(historicalSignal?.tp, proposedSignal?.tp),
    },
    analysis,
    limitation: "Le signal historique doit être fourni par un adaptateur vérifié ; aucun moteur GOLD/SMC ancien n’a été retrouvé en TypeScript. Le candidat proposé est Fibonacci seul : aucun signal SMC de trading n’est inventé.",
  };
}
