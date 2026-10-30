import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    npmFilesToBuild: [
      "@chainlink/contracts/src/v0.8/vrf/dev/VRFV2PlusWrapper.sol",
      "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol",
      "@chainlink/contracts/src/v0.8/shared/mocks/MockV3Aggregator.sol",
      "@chainlink/contracts/src/v0.8/shared/token/ERC677/LinkToken.sol",
    ],
    compilers: [
      {
        version: "0.8.28",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
      // The official wrapper used by the integration test pins solc 0.8.19.
      {
        version: "0.8.19",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    ],
  },
  networks: {
    localhost: {
      type: "http",
      url: process.env.LOCAL_RPC_URL?.trim() || "http://127.0.0.1:8545",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
  },
});
