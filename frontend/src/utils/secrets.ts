import { hexlify, isHexString, randomBytes } from "ethers";

export function createSecret() {
  return hexlify(randomBytes(32));
}

export function isValidSecret(secret: string) {
  return isHexString(secret, 32);
}

function storageKey(chainId: bigint, poolAddress: string, gameId: bigint, account: string) {
  return `fairjack:secret:${chainId}:${poolAddress.toLowerCase()}:${gameId}:${account.toLowerCase()}`;
}

export function loadSecret(chainId: bigint, poolAddress: string, gameId: bigint, account: string) {
  return window.localStorage.getItem(storageKey(chainId, poolAddress, gameId, account)) || "";
}

export function saveSecret(chainId: bigint, poolAddress: string, gameId: bigint, account: string, secret: string) {
  window.localStorage.setItem(storageKey(chainId, poolAddress, gameId, account), secret);
}
