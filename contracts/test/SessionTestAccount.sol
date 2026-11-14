// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SessionTestAccount {
    address public immutable owner;
    constructor(address owner_) { owner = owner_; }
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        return ECDSA.recover(digest, signature) == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
    function approveToken(address token, address spender, uint256 amount) external {
        require(msg.sender == owner);
        IERC20(token).approve(spender, amount);
    }
}
