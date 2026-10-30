// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {MockERC20} from "../MockERC20.sol";

/// @dev Simulates a temporarily failing payout to exercise callback isolation.
contract SettlementTestToken is MockERC20 {
    error TransfersBlocked();
    bool public transfersBlocked;
    function setTransfersBlocked(bool blocked) external {
        transfersBlocked = blocked;
    }
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override {
        if (transfersBlocked && from != address(0)) revert TransfersBlocked();
        super._update(from, to, value);
    }
}
