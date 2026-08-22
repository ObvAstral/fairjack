// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FairJackPool} from "../FairJackPool.sol";

contract BlackjackScoringHarness is FairJackPool {
    constructor(address tokenAddress) FairJackPool(tokenAddress) {}

    function scoreHandForTest(uint8[] calldata cards)
        external
        pure
        returns (uint256)
    {
        return _calculateHandScore(cards);
    }
}
