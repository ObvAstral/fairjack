export const grantTypes = {
  SessionGrant: [
    { name: "player", type: "address" }, { name: "sessionKey", type: "address" },
    { name: "nonce", type: "uint256" }, { name: "validUntil", type: "uint256" },
    { name: "maxBet", type: "uint256" }, { name: "budget", type: "uint256" },
    { name: "deploymentId", type: "bytes32" },
  ],
};
export const actionTypes = {
  SessionAction: [
    { name: "sessionId", type: "bytes32" }, { name: "nonce", type: "uint256" },
    { name: "kind", type: "uint8" }, { name: "argument", type: "uint256" },
    { name: "validUntil", type: "uint256" },
  ],
};
export type SessionGrant = {
  player: string; sessionKey: string; nonce: string; validUntil: string;
  maxBet: string; budget: string; deploymentId: string;
};
export type SessionAction = {
  sessionId: string; nonce: string; kind: number; argument: string; validUntil: string;
};
export type Operation = {
  id: string; status: "queued" | "submitted" | "confirmed" | "failed";
  txHash?: string; error?: string; sessionId?: string; gameId?: string;
};
export function sessionDomain(chainId: bigint | string, pool: string) {
  return { name: "FairJackPool", version: "2", chainId, verifyingContract: pool };
}
