import type { PaperAccount } from "./model";

export function allocatePaperPosition(account: PaperAccount, equityEUR: number, entryUSD: number, distanceUSD: number, riskPercent: number) {
  const riskBudgetEUR = equityEUR * Math.min(riskPercent, 1) / 100;
  const riskPerOunceUSD = distanceUSD + account.slippage + 2 * account.commission;
  const riskPerLotEUR = riskPerOunceUSD * account.contractSize / account.usdPerEur;
  const marginPerLotEUR = entryUSD * account.contractSize / (account.usdPerEur * account.leverage);
  const entryFeePerLotEUR = account.commission * account.contractSize / account.usdPerEur;
  const minimumLots = Math.ceil(account.minLot / account.lotStep) * account.lotStep;
  if (![riskBudgetEUR, riskPerLotEUR, marginPerLotEUR].every(Number.isFinite) || riskBudgetEUR <= 0 || riskPerLotEUR <= 0 || marginPerLotEUR <= 0) return { error: "Risk Manager : budget, prix ou distance de stop invalide." } as const;
  if (minimumLots * riskPerLotEUR > riskBudgetEUR) return { error: `Trade refusé : la taille minimale (${minimumLots.toLocaleString("fr-FR")} lot, ${(minimumLots * account.contractSize).toLocaleString("fr-FR")} oz) risquerait ${(minimumLots * riskPerLotEUR).toFixed(2)} €, au-delà du budget de ${riskBudgetEUR.toFixed(2)} €. Aucune taille inférieure fictive n’est utilisée.` } as const;
  if (minimumLots * (marginPerLotEUR + entryFeePerLotEUR) > equityEUR) return { error: `Trade refusé : marge et commission minimales ${(minimumLots * (marginPerLotEUR + entryFeePerLotEUR)).toFixed(2)} € supérieures au capital disponible ${equityEUR.toFixed(2)} € (levier simulé ${account.leverage}:1).` } as const;
  const ceiling = Math.min(riskBudgetEUR / riskPerLotEUR, equityEUR / (marginPerLotEUR + entryFeePerLotEUR));
  const lots = Number((Math.floor(ceiling / account.lotStep) * account.lotStep).toFixed(12));
  const quantity = lots * account.contractSize;
  const riskMoney = lots * riskPerLotEUR;
  const marginEUR = lots * marginPerLotEUR;
  if (lots < minimumLots || riskMoney > riskBudgetEUR || marginEUR + lots * entryFeePerLotEUR > equityEUR) return { error: "Trade refusé : aucun volume valide au pas de lot ne respecte simultanément le risque et la marge disponibles." } as const;
  return { lots, quantity, riskMoney, riskBudgetEUR, marginEUR, error: null } as const;
}
