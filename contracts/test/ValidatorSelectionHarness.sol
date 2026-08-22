// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FairJackPool} from "../FairJackPool.sol";

/// @dev Test-only access to validator selection and reservation before game
///      creation is introduced in the next implementation phase.
contract ValidatorSelectionHarness is FairJackPool {
    constructor(address tokenAddress) FairJackPool(tokenAddress) {}

    function selectValidatorsForTest(address player, uint256 selectionSalt)
        external
        view
        returns (address[3] memory)
    {
        return _selectValidators(player, selectionSalt);
    }

    function reserveValidatorForTest(address validator) external {
        _reserveValidator(validator);
    }
}
