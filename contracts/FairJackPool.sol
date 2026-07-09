// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FairJackPool {
    IERC20 public token;

    uint256 public poolBalance;
    uint256 public lockedLiquidity;
    uint256 public totalShares;

    mapping(address => uint256) public sharesOf;

    enum GameState {
        WaitingForValidatorCommit,
        WaitingForPlayerReveal,
        WaitingForValidatorReveal,
        PlayerTurn,
        Finished,
        Cancelled
    }

    struct ValidatorInfo {
        bool registered;
        uint256 collateral;
        uint256 activeGames;
        uint256 slashCount;
    }

    struct Game {
        address player;
        uint256 bet;
        uint256 maxPayout;
        GameState state;

        bytes32 playerCommit;

        address validator;
        bytes32 validatorCommit;
        bytes32 playerSecret;
        bytes32 validatorSecret;

        uint256 commitDeadline;
        uint256 revealDeadline;
        uint256 actionDeadline;

        uint8[] playerCards;
        uint8[] dealerCards;

        bytes32 finalSeed;
        uint256 nonce;
    }

    mapping(address => ValidatorInfo) public validators;
    address[] public validatorList;

    mapping(uint256 => Game) internal games;
    uint256 public nextGameId;

    constructor(address tokenAddress) {
        require(tokenAddress != address(0), "Invalid token address");
        token = IERC20(tokenAddress);
    }

    function depositToHousePool(uint256 amount) external {
        // TODO: implementare Giorno 2
    }

    function withdrawFromHousePool(uint256 shares) external {
        // TODO: implementare Giorno 2
    }

    function getAvailableLiquidity() public view returns (uint256) {
        return poolBalance - lockedLiquidity;
    }

    function getSharePrice() public view returns (uint256) {
        if (totalShares == 0) {
            return 1e18;
        }

        return (poolBalance * 1e18) / totalShares;
    }
}
