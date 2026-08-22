// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FairJackPool} from "../FairJackPool.sol";

/// @dev Test-only harness used before gameplay exists to exercise pool profit
///      and locked-liquidity accounting in isolation.
contract PoolAccountingHarness is FairJackPool {
    constructor(address tokenAddress) FairJackPool(tokenAddress) {}

    function recordPoolProfit(uint256 amount) external {
        poolBalance += amount;
    }

    function setLockedLiquidityForTest(uint256 amount) external {
        lockedLiquidity = amount;
    }
}
