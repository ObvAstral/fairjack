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

export function createFinalSeed(
  gameId: BigNumberish,
  playerSecret: string,
  validatorSecrets: readonly [string, string, string],
  contractAddress: string,
): string {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["uint256", "bytes32", "bytes32", "bytes32", "bytes32", "address"],
      [
        gameId,
        playerSecret,
        validatorSecrets[0],
        validatorSecrets[1],
        validatorSecrets[2],
        getAddress(contractAddress),
      ],
    ),
  );
}
