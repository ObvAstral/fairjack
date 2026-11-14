import { createContext, useContext } from "react";
import type { Operation } from "../../../shared/sessions";

export type GameSessionContext = {
  walletMode: boolean; setWalletMode: (value: boolean) => void;
  active: boolean; busy: boolean; revoking: boolean; pending: boolean; status: string | null; error: string | null;
  remaining: bigint; maxBet: bigint; expiresAt: number; secondsLeft: number;
  dealer: boolean; available: boolean; unavailable: string | null;
  open: (budget: string, maxBet: string) => Promise<void>;
  revoke: () => Promise<void>; resume: () => Promise<void>;
  send: (kind: number, argument: bigint) => Promise<Operation>;
};
export const GameSessionContext = createContext<GameSessionContext | null>(null);
export function useGameSession() {
  const context = useContext(GameSessionContext);
  if (!context) throw new Error("GameSessionProvider mancante.");
  return context;
}
