import { formatUnits } from "ethers";

export function formatToken(value: bigint, decimals = 18, maximumFractionDigits = 4) {
  const formatted = formatUnits(value, decimals);
  const [whole, fraction = ""] = formatted.split(".");
  const trimmed = fraction.slice(0, maximumFractionDigits).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function shortAddress(address: string | null | undefined) {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatDuration(seconds: number) {
  const absolute = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function formatTimestamp(timestamp: bigint) {
  if (timestamp === 0n) return "—";
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(Number(timestamp) * 1000));
}

const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const suits = ["♠", "♥", "♦", "♣"];

export function cardLabel(card: bigint) {
  const value = Number(card);
  return {
    label: ranks[value % 13],
    suit: suits[Math.floor(value / 13)],
    red: Math.floor(value / 13) === 1 || Math.floor(value / 13) === 2,
  };
}
