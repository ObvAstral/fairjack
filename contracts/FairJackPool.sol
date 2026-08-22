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
    error AlreadyRegisteredValidator();
    error NotRegisteredValidator();
    error InsufficientValidatorCollateral(uint256 minimum, uint256 provided);
    error ValidatorHasActiveGames(uint256 activeGames);
    error InsufficientWithdrawableCollateral(uint256 available, uint256 requested);
    error InsufficientEligibleValidators(uint256 required, uint256 available);
    error ValidatorCapacityReached(address validator);

    event PoolDeposit(address indexed user, uint256 amount, uint256 sharesMinted);
    event PoolWithdraw(address indexed user, uint256 amount, uint256 sharesBurned);
    event ValidatorRegistered(address indexed validator, uint256 collateral);
    event ValidatorUnregistered(address indexed validator, uint256 collateralReturned);
    event ValidatorCollateralAdded(address indexed validator, uint256 amount);
    event ValidatorCollateralWithdrawn(address indexed validator, uint256 amount);

    IERC20 public token;

    uint256 public constant COMMITTEE_SIZE = 3;
    uint256 public constant MIN_VALIDATOR_COLLATERAL = 100 ether;
    uint256 public constant VALIDATOR_COLLATERAL_PER_GAME = 100 ether;
    uint256 public constant MAX_VALIDATOR_ACTIVE_GAMES = 10;

    uint256 public poolBalance;
    uint256 public lockedLiquidity;
    uint256 public totalShares;

    mapping(address => uint256) public sharesOf;

    enum GameState {
        Created,
        WaitingForCommits,
        WaitingForReveals,
        PlayerTurn,
        DealerTurn,
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
        bytes32 playerSecret;
        bool playerCommitted;
        bool playerRevealed;

        address[3] selectedValidators;
        bytes32[3] validatorCommits;
        bytes32[3] validatorSecrets;
        bool[3] validatorCommitted;
        bool[3] validatorRevealed;
        uint8 commitCount;
        uint8 revealCount;

        uint8[] playerCards;
        uint8[] dealerCards;

        bytes32 finalSeed;
        uint256 cardNonce;
        bool[52] drawnCards;

        uint256 commitDeadline;
        uint256 revealDeadline;
        uint256 actionDeadline;
    }

    mapping(address => ValidatorInfo) public validators;
    address[] public validatorList;

    mapping(uint256 => Game) internal games;
    uint256 public nextGameId;

    constructor(address tokenAddress) {
        if (tokenAddress == address(0)) revert InvalidTokenAddress();
        token = IERC20(tokenAddress);
    }

    /// @notice Returns the number of addresses ever added to the validator list.
    function getValidatorCount() external view returns (uint256) {
        return validatorList.length;
    }

    /// @notice Opts the caller into validator selection and deposits collateral.
    function registerAsValidator(uint256 collateral) external nonReentrant {
        ValidatorInfo storage info = validators[msg.sender];
        if (info.registered) revert AlreadyRegisteredValidator();
        if (collateral < MIN_VALIDATOR_COLLATERAL) {
            revert InsufficientValidatorCollateral(MIN_VALIDATOR_COLLATERAL, collateral);
        }

        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), collateral);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != collateral) revert UnsupportedTokenTransfer(collateral, received);

        info.registered = true;
        info.collateral = collateral;
        validatorList.push(msg.sender);

        emit ValidatorRegistered(msg.sender, collateral);
    }

    /// @notice Opts the caller out and returns all collateral when no game is active.
    function unregisterAsValidator() external nonReentrant {
        ValidatorInfo storage info = validators[msg.sender];
        if (!info.registered) revert NotRegisteredValidator();
        if (info.activeGames != 0) revert ValidatorHasActiveGames(info.activeGames);

        uint256 collateral = info.collateral;
        info.registered = false;
        info.collateral = 0;
        _removeValidator(msg.sender);

        token.safeTransfer(msg.sender, collateral);

        emit ValidatorUnregistered(msg.sender, collateral);
    }

    /// @notice Adds collateral to an already registered validator.
    function addValidatorCollateral(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        ValidatorInfo storage info = validators[msg.sender];
        if (!info.registered) revert NotRegisteredValidator();

        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert UnsupportedTokenTransfer(amount, received);

        info.collateral += amount;

        emit ValidatorCollateralAdded(msg.sender, amount);
    }

    /// @notice Withdraws collateral not required for registration or active games.
    function withdrawValidatorCollateral(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        ValidatorInfo storage info = validators[msg.sender];
        if (!info.registered) revert NotRegisteredValidator();

        uint256 requiredCollateral = _requiredValidatorCollateral(info.activeGames);
        uint256 available = info.collateral > requiredCollateral
            ? info.collateral - requiredCollateral
            : 0;
        if (amount > available) {
            revert InsufficientWithdrawableCollateral(available, amount);
        }

        info.collateral -= amount;
        token.safeTransfer(msg.sender, amount);

        emit ValidatorCollateralWithdrawn(msg.sender, amount);
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

    function _selectValidators(address player, uint256 selectionSalt)
        internal
        view
        returns (address[3] memory committee)
    {
        uint256 validatorCount = validatorList.length;
        if (validatorCount < COMMITTEE_SIZE) {
            revert InsufficientEligibleValidators(COMMITTEE_SIZE, validatorCount);
        }

        uint256 startIndex = uint256(
            keccak256(abi.encode(player, selectionSalt, address(this)))
        ) % validatorCount;
        uint256 selected;

        for (uint256 offset; offset < validatorCount && selected < COMMITTEE_SIZE; ++offset) {
            address candidate = validatorList[(startIndex + offset) % validatorCount];
            ValidatorInfo storage info = validators[candidate];

            if (
                candidate != player && info.registered
                    && info.activeGames < MAX_VALIDATOR_ACTIVE_GAMES
                    && info.collateral
                        >= (info.activeGames + 1) * VALIDATOR_COLLATERAL_PER_GAME
            ) {
                committee[selected] = candidate;
                ++selected;
            }
        }

        if (selected != COMMITTEE_SIZE) {
            revert InsufficientEligibleValidators(COMMITTEE_SIZE, selected);
        }
    }

    function _reserveValidator(address validator) internal {
        ValidatorInfo storage info = validators[validator];
        if (
            !info.registered || info.activeGames >= MAX_VALIDATOR_ACTIVE_GAMES
                || info.collateral
                    < (info.activeGames + 1) * VALIDATOR_COLLATERAL_PER_GAME
        ) {
            revert ValidatorCapacityReached(validator);
        }

        ++info.activeGames;
    }

    function _requiredValidatorCollateral(uint256 activeGames)
        internal
        pure
        returns (uint256)
    {
        uint256 activeRequirement = activeGames * VALIDATOR_COLLATERAL_PER_GAME;
        return activeRequirement > MIN_VALIDATOR_COLLATERAL
            ? activeRequirement
            : MIN_VALIDATOR_COLLATERAL;
    }

    function _removeValidator(address validator) private {
        uint256 validatorCount = validatorList.length;
        for (uint256 index; index < validatorCount; ++index) {
            if (validatorList[index] == validator) {
                uint256 lastIndex = validatorCount - 1;
                if (index != lastIndex) {
                    validatorList[index] = validatorList[lastIndex];
                }
                validatorList.pop();
                return;
            }
        }
    }
}
