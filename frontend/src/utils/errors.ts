import { isError } from "ethers";

export function readableError(error: unknown): string {
  if (isError(error, "ACTION_REJECTED")) return "Operazione rifiutata nel wallet.";
  if (error instanceof Error) return error.message;
  return "Operazione non riuscita.";
}
