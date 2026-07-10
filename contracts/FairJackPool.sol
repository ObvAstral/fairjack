// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice House pool for FairJack games using a conventional ERC-20 wager token.
/// @dev Fee-on-transfer and rebasing tokens are not supported because the pool
///      accounting assumes that transferred amounts match the requested amounts.
contract FairJackPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error InvalidTokenAddress();
    error ZeroAmount();
    error ZeroShares();
    error ZeroSharesMinted();
    error ZeroWithdrawalAmount();
    error InsolventPool();
    error InsufficientShares(uint256 available, uint256 requested);
    error InsufficientAvailableLiquidity(uint256 available, uint256 requested);
    error UnsupportedTokenTransfer(uint256 expected, uint256 received);

    event PoolDeposit(address indexed user, uint256 amount, uint256 sharesMinted);
    event PoolWithdraw(address indexed user, uint256 amount, uint256 sharesBurned);

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
        if (tokenAddress == address(0)) revert InvalidTokenAddress();
        token = IERC20(tokenAddress);
    }

    /// @notice Deposits wager tokens into the house pool and mints accounting shares.
    /// @param amount Amount of tokens to deposit, expressed in token base units.
    function depositToHousePool(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 sharesMinted;
        if (totalShares == 0) {
            sharesMinted = amount;
        } else {
            if (poolBalance == 0) revert InsolventPool();
            sharesMinted = Math.mulDiv(amount, totalShares, poolBalance);
        }
        if (sharesMinted == 0) revert ZeroSharesMinted();

        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert UnsupportedTokenTransfer(amount, received);

        poolBalance += amount;
        totalShares += sharesMinted;
        sharesOf[msg.sender] += sharesMinted;

        emit PoolDeposit(msg.sender, amount, sharesMinted);
    }

    /// @notice Burns pool shares and returns the corresponding available liquidity.
    /// @param shares Number of accounting shares to burn.
    function withdrawFromHousePool(uint256 shares) external nonReentrant {
        if (shares == 0) revert ZeroShares();

        uint256 userShares = sharesOf[msg.sender];
        if (userShares < shares) revert InsufficientShares(userShares, shares);

        uint256 amount = Math.mulDiv(shares, poolBalance, totalShares);
        if (amount == 0) revert ZeroWithdrawalAmount();

        uint256 availableLiquidity = getAvailableLiquidity();
        if (availableLiquidity < amount) {
            revert InsufficientAvailableLiquidity(availableLiquidity, amount);
        }

        sharesOf[msg.sender] = userShares - shares;
        totalShares -= shares;
        poolBalance -= amount;

        uint256 balanceBefore = token.balanceOf(msg.sender);
        token.safeTransfer(msg.sender, amount);
        uint256 received = token.balanceOf(msg.sender) - balanceBefore;
        if (received != amount) revert UnsupportedTokenTransfer(amount, received);

        emit PoolWithdraw(msg.sender, amount, shares);
    }

    /// @notice Returns pool funds that are not reserved for active games.
    function getAvailableLiquidity() public view returns (uint256) {
        return poolBalance - lockedLiquidity;
    }

    /// @notice Returns the value of one whole share, scaled by 1e18.
    /// @dev Returns 1e18 before the first deposit and after all shares are burned.
    function getSharePrice() public view returns (uint256) {
        if (totalShares == 0) {
            return 1e18;
        }

        return (poolBalance * 1e18) / totalShares;
    }
}
