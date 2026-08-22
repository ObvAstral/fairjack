import {
  AbiCoder,
  getAddress,
  hexlify,
  keccak256,
  randomBytes,
  type BigNumberish,
} from "ethers";

export function createSecret(): string {
  return hexlify(randomBytes(32));
}

export function createCommit(
  secret: string,
  gameId: BigNumberish,
  participant: string,
  contractAddress: string,
): string {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "address", "address"],
      [
        secret,
        gameId,
        getAddress(participant),
        getAddress(contractAddress),
      ],
    ),
  );
}
