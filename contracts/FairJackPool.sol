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
    error BetBelowMinimum(uint256 minimum, uint256 provided);
    error BetAboveMaximum(uint256 maximum, uint256 provided);
    error InsufficientTokenAllowance(uint256 available, uint256 required);
    error GameDoesNotExist(uint256 gameId);
    error InvalidGameState(GameState expected, GameState actual);
    error GameDeadlinePassed(uint256 deadline, uint256 currentTimestamp);
    error NotGamePlayer(address caller);
    error NotSelectedValidator(address caller);
    error InvalidCommitment();
    error CommitAlreadySubmitted(address participant);
    error SecretAlreadyRevealed(address participant);
    error SecretDoesNotMatchCommit(address participant);
    error RandomnessNotReady();
    error DeckExhausted();
    error InvalidCard(uint8 card);
    error PlayerAlreadyBust();

    event PoolDeposit(address indexed user, uint256 amount, uint256 sharesMinted);
    event PoolWithdraw(address indexed user, uint256 amount, uint256 sharesBurned);
    event ValidatorRegistered(address indexed validator, uint256 collateral);
    event ValidatorUnregistered(address indexed validator, uint256 collateralReturned);
    event ValidatorCollateralAdded(address indexed validator, uint256 amount);
    event ValidatorCollateralWithdrawn(address indexed validator, uint256 amount);
    event PoolGameStarted(
        uint256 indexed gameId,
        address indexed player,
        uint256 bet,
        uint256 maxPayout
    );
    event ValidatorsSelected(
        uint256 indexed gameId,
        address validator0,
        address validator1,
        address validator2
    );
    event CommitSubmitted(
        uint256 indexed gameId,
        address indexed participant,
        bool indexed isPlayer,
        bytes32 commitment
    );
    event SecretRevealed(
        uint256 indexed gameId,
        address indexed participant,
        bool indexed isPlayer
    );
    event FinalSeedGenerated(uint256 indexed gameId, bytes32 finalSeed);
    event CardDrawn(
        uint256 indexed gameId,
        bool indexed playerHand,
        uint8 card,
        uint256 handSize
    );
    event GameStarted(uint256 indexed gameId, address indexed player);
    event PlayerHit(
        uint256 indexed gameId,
        uint8 card,
        uint256 playerScore
    );
    event PlayerStand(uint256 indexed gameId, uint256 playerScore);
    event DealerResolved(
        uint256 indexed gameId,
        uint256 dealerScore,
        bool dealerBust
    );
    event GameFinished(
        uint256 indexed gameId,
        GameResult result,
        uint256 payout,
        uint256 playerScore,
        uint256 dealerScore
    );
    event ValidatorSlashed(
        uint256 indexed gameId,
        address indexed validator,
        uint256 amount
    );
    event GameCancelled(uint256 indexed gameId);
    event TimeoutClaimed(
        uint256 indexed gameId,
        address indexed claimant,
        GameState timedOutState
    );

    IERC20 public token;

    uint256 public constant COMMITTEE_SIZE = 3;
    uint256 public constant MIN_VALIDATOR_COLLATERAL = 100 ether;
    uint256 public constant VALIDATOR_COLLATERAL_PER_GAME = 100 ether;
    uint256 public constant MAX_VALIDATOR_ACTIVE_GAMES = 10;
    uint256 public constant MIN_BET = 1 ether;
    uint256 public constant MAX_BET = 100 ether;
    uint256 public constant COMMIT_DURATION = 15 minutes;
    uint256 public constant REVEAL_DURATION = 15 minutes;
    uint256 public constant ACTION_DURATION = 5 minutes;

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

    enum GameResult {
        None,
        PlayerWin,
        DealerWin,
        Push
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
        GameResult result;
        uint256 payout;

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

    /// @notice Creates a pool-backed game before the player submits a commit.
    function startPoolGame(uint256 bet)
        external
        nonReentrant
        returns (uint256 gameId)
    {
        if (bet < MIN_BET) revert BetBelowMinimum(MIN_BET, bet);
        if (bet > MAX_BET) revert BetAboveMaximum(MAX_BET, bet);

        uint256 allowance = token.allowance(msg.sender, address(this));
        if (allowance < bet) revert InsufficientTokenAllowance(allowance, bet);

        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), bet);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != bet) revert UnsupportedTokenTransfer(bet, received);

        uint256 maxPayout = bet * 2;
        uint256 availableLiquidity = getAvailableLiquidity();
        if (availableLiquidity < maxPayout) {
            revert InsufficientAvailableLiquidity(availableLiquidity, maxPayout);
        }

        gameId = nextGameId;
        ++nextGameId;

        Game storage game = games[gameId];
        game.player = msg.sender;
        game.bet = bet;
        game.maxPayout = maxPayout;
        game.state = GameState.Created;

        address[3] memory committee = _selectValidators(msg.sender, gameId);
        for (uint256 index; index < COMMITTEE_SIZE; ++index) {
            game.selectedValidators[index] = committee[index];
            _reserveValidator(committee[index]);
        }

        lockedLiquidity += maxPayout;
        game.commitDeadline = block.timestamp + COMMIT_DURATION;
        game.state = GameState.WaitingForCommits;

        emit PoolGameStarted(gameId, msg.sender, bet, maxPayout);
        emit ValidatorsSelected(
            gameId,
            committee[0],
            committee[1],
            committee[2]
        );
    }

    function submitPlayerCommit(uint256 gameId, bytes32 commitment) external {
        Game storage game = _getGame(gameId);
        _requireState(game, GameState.WaitingForCommits);
        _requireBeforeDeadline(game.commitDeadline);
        if (msg.sender != game.player) revert NotGamePlayer(msg.sender);
        if (game.playerCommitted) revert CommitAlreadySubmitted(msg.sender);
        if (commitment == bytes32(0)) revert InvalidCommitment();

        game.playerCommit = commitment;
        game.playerCommitted = true;
        ++game.commitCount;

        emit CommitSubmitted(gameId, msg.sender, true, commitment);
        _beginRevealPhaseIfReady(game);
    }

    function submitValidatorCommit(uint256 gameId, bytes32 commitment) external {
        Game storage game = _getGame(gameId);
        _requireState(game, GameState.WaitingForCommits);
        _requireBeforeDeadline(game.commitDeadline);
        (bool selected, uint256 validatorIndex) = _findValidator(game, msg.sender);
        if (!selected) revert NotSelectedValidator(msg.sender);
        if (game.validatorCommitted[validatorIndex]) {
            revert CommitAlreadySubmitted(msg.sender);
        }
        if (commitment == bytes32(0)) revert InvalidCommitment();

        game.validatorCommits[validatorIndex] = commitment;
        game.validatorCommitted[validatorIndex] = true;
        ++game.commitCount;

        emit CommitSubmitted(gameId, msg.sender, false, commitment);
        _beginRevealPhaseIfReady(game);
    }

    function revealPlayerSecret(uint256 gameId, bytes32 secret) external {
        Game storage game = _getGame(gameId);
        _requireState(game, GameState.WaitingForReveals);
        _requireBeforeDeadline(game.revealDeadline);
        if (msg.sender != game.player) revert NotGamePlayer(msg.sender);
        if (game.playerRevealed) revert SecretAlreadyRevealed(msg.sender);
        if (_commitmentFor(secret, gameId, msg.sender) != game.playerCommit) {
            revert SecretDoesNotMatchCommit(msg.sender);
        }

        game.playerSecret = secret;
        game.playerRevealed = true;
        ++game.revealCount;

        emit SecretRevealed(gameId, msg.sender, true);
        _generateFinalSeedIfReady(gameId, game);
    }

    function revealValidatorSecret(uint256 gameId, bytes32 secret) external {
        Game storage game = _getGame(gameId);
        _requireState(game, GameState.WaitingForReveals);
        _requireBeforeDeadline(game.revealDeadline);
        (bool selected, uint256 validatorIndex) = _findValidator(game, msg.sender);
        if (!selected) revert NotSelectedValidator(msg.sender);
        if (game.validatorRevealed[validatorIndex]) {
            revert SecretAlreadyRevealed(msg.sender);
        }
        if (
            _commitmentFor(secret, gameId, msg.sender)
                != game.validatorCommits[validatorIndex]
        ) {
            revert SecretDoesNotMatchCommit(msg.sender);
        }

        game.validatorSecrets[validatorIndex] = secret;
        game.validatorRevealed[validatorIndex] = true;
        ++game.revealCount;

        emit SecretRevealed(gameId, msg.sender, false);
        _generateFinalSeedIfReady(gameId, game);
    }

    function computeCommitment(
        bytes32 secret,
        uint256 gameId,
        address participant
    ) external view returns (bytes32) {
        return _commitmentFor(secret, gameId, participant);
    }

    function hit(uint256 gameId) external nonReentrant {
        Game storage game = _getGame(gameId);
        _requireState(game, GameState.PlayerTurn);
        _requireBeforeDeadline(game.actionDeadline);
        if (msg.sender != game.player) revert NotGamePlayer(msg.sender);

        uint8[] memory currentHand = game.playerCards;
        if (_calculateHandScore(currentHand) > 21) revert PlayerAlreadyBust();

        uint8 card = _drawCard(game);
        game.playerCards.push(card);
        uint8[] memory updatedHand = game.playerCards;
        uint256 playerScore = _calculateHandScore(updatedHand);

        emit CardDrawn(gameId, true, card, game.playerCards.length);
        emit PlayerHit(gameId, card, playerScore);

        if (playerScore > 21) {
            uint8[] memory dealerHand = game.dealerCards;
            _settleGame(
                gameId,
                game,
                GameResult.DealerWin,
                playerScore,
                _calculateHandScore(dealerHand)
            );
        } else {
            game.actionDeadline = block.timestamp + ACTION_DURATION;
        }
    }

    function stand(uint256 gameId) external nonReentrant {
        Game storage game = _getGame(gameId);
        _requireState(game, GameState.PlayerTurn);
        _requireBeforeDeadline(game.actionDeadline);
        if (msg.sender != game.player) revert NotGamePlayer(msg.sender);

        uint8[] memory playerHand = game.playerCards;
        uint256 playerScore = _calculateHandScore(playerHand);
        emit PlayerStand(gameId, playerScore);

        game.state = GameState.DealerTurn;
        _resolveDealer(gameId, game, playerScore);
    }

    function getGameCore(uint256 gameId)
        external
        view
        returns (
            address player,
            uint256 bet,
            uint256 maxPayout,
            GameState state
        )
    {
        Game storage game = _getGame(gameId);
        return (game.player, game.bet, game.maxPayout, game.state);
    }

    function getGameValidators(uint256 gameId)
        external
        view
        returns (address[3] memory)
    {
        return _getGame(gameId).selectedValidators;
    }

    function getGameDeadlines(uint256 gameId)
        external
        view
        returns (
            uint256 commitDeadline,
            uint256 revealDeadline,
            uint256 actionDeadline
        )
    {
        Game storage game = _getGame(gameId);
        return (
            game.commitDeadline,
            game.revealDeadline,
            game.actionDeadline
        );
    }

    function getGameRandomnessProgress(uint256 gameId)
        external
        view
        returns (
            bytes32 playerCommit,
            bool playerCommitted,
            bool playerRevealed,
            uint8 commitCount,
            uint8 revealCount,
            bytes32 finalSeed
        )
    {
        Game storage game = _getGame(gameId);
        return (
            game.playerCommit,
            game.playerCommitted,
            game.playerRevealed,
            game.commitCount,
            game.revealCount,
            game.finalSeed
        );
    }

    function getValidatorRandomnessStatus(uint256 gameId, address validator)
        external
        view
        returns (
            bytes32 commitment,
            bool committed,
            bool revealed
        )
    {
        Game storage game = _getGame(gameId);
        (bool selected, uint256 validatorIndex) = _findValidator(game, validator);
        if (!selected) revert NotSelectedValidator(validator);
        return (
            game.validatorCommits[validatorIndex],
            game.validatorCommitted[validatorIndex],
            game.validatorRevealed[validatorIndex]
        );
    }

    function getPlayerCards(uint256 gameId)
        external
        view
        returns (uint8[] memory)
    {
        return _getGame(gameId).playerCards;
    }

    function getDealerCards(uint256 gameId)
        external
        view
        returns (uint8[] memory)
    {
        return _getGame(gameId).dealerCards;
    }

    function getCardNonce(uint256 gameId) external view returns (uint256) {
        return _getGame(gameId).cardNonce;
    }

    function isCardDrawn(uint256 gameId, uint8 card)
        external
        view
        returns (bool)
    {
        if (card >= 52) return false;
        return _getGame(gameId).drawnCards[card];
    }

    function getPlayerScore(uint256 gameId) external view returns (uint256) {
        uint8[] memory cards = _getGame(gameId).playerCards;
        return _calculateHandScore(cards);
    }

    function getDealerScore(uint256 gameId) external view returns (uint256) {
        uint8[] memory cards = _getGame(gameId).dealerCards;
        return _calculateHandScore(cards);
    }

    function getGameResult(uint256 gameId)
        external
        view
        returns (GameResult result, uint256 payout)
    {
        Game storage game = _getGame(gameId);
        return (game.result, game.payout);
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

    function _beginRevealPhaseIfReady(Game storage game) private {
        if (game.commitCount == COMMITTEE_SIZE + 1) {
            game.state = GameState.WaitingForReveals;
            game.revealDeadline = block.timestamp + REVEAL_DURATION;
        }
    }

    function _commitmentFor(
        bytes32 secret,
        uint256 gameId,
        address participant
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(secret, gameId, participant, address(this))
        );
    }

    function _generateFinalSeedIfReady(uint256 gameId, Game storage game) private {
        if (game.revealCount == COMMITTEE_SIZE + 1) {
            game.finalSeed = keccak256(
                abi.encode(
                    gameId,
                    game.playerSecret,
                    game.validatorSecrets[0],
                    game.validatorSecrets[1],
                    game.validatorSecrets[2],
                    address(this)
                )
            );

            emit FinalSeedGenerated(gameId, game.finalSeed);
            _dealInitialCards(gameId, game);
        }
    }

    function _drawCard(Game storage game) internal returns (uint8 card) {
        if (game.finalSeed == bytes32(0)) revert RandomnessNotReady();
        if (game.playerCards.length + game.dealerCards.length == 52) {
            revert DeckExhausted();
        }

        while (true) {
            card = uint8(
                uint256(
                    keccak256(abi.encode(game.finalSeed, game.cardNonce))
                ) % 52
            );
            ++game.cardNonce;

            if (!game.drawnCards[card]) {
                game.drawnCards[card] = true;
                return card;
            }
        }
    }

    function _calculateHandScore(uint8[] memory cards)
        internal
        pure
        returns (uint256 score)
    {
        uint256 aces;

        for (uint256 index; index < cards.length; ++index) {
            uint8 card = cards[index];
            if (card >= 52) revert InvalidCard(card);

            uint8 rank = card % 13;
            if (rank == 0) {
                score += 11;
                ++aces;
            } else if (rank >= 9) {
                score += 10;
            } else {
                score += rank + 1;
            }
        }

        while (score > 21 && aces > 0) {
            score -= 10;
            --aces;
        }
    }

    function _dealInitialCards(uint256 gameId, Game storage game) private {
        for (uint256 index; index < 2; ++index) {
            uint8 playerCard = _drawCard(game);
            game.playerCards.push(playerCard);
            emit CardDrawn(
                gameId,
                true,
                playerCard,
                game.playerCards.length
            );
        }

        for (uint256 index; index < 2; ++index) {
            uint8 dealerCard = _drawCard(game);
            game.dealerCards.push(dealerCard);
            emit CardDrawn(
                gameId,
                false,
                dealerCard,
                game.dealerCards.length
            );
        }

        game.state = GameState.PlayerTurn;
        game.actionDeadline = block.timestamp + ACTION_DURATION;

        emit GameStarted(gameId, game.player);
    }

    function _resolveDealer(
        uint256 gameId,
        Game storage game,
        uint256 playerScore
    ) private {
        uint8[] memory dealerHand = game.dealerCards;
        uint256 dealerScore = _calculateHandScore(dealerHand);

        while (dealerScore < 17) {
            uint8 card = _drawCard(game);
            game.dealerCards.push(card);
            dealerHand = game.dealerCards;
            dealerScore = _calculateHandScore(dealerHand);
            emit CardDrawn(gameId, false, card, game.dealerCards.length);
        }

        bool dealerBust = dealerScore > 21;
        emit DealerResolved(gameId, dealerScore, dealerBust);

        GameResult result;
        if (dealerBust || playerScore > dealerScore) {
            result = GameResult.PlayerWin;
        } else if (dealerScore > playerScore) {
            result = GameResult.DealerWin;
        } else {
            result = GameResult.Push;
        }

        _settleGame(gameId, game, result, playerScore, dealerScore);
    }

    function _settleGame(
        uint256 gameId,
        Game storage game,
        GameResult result,
        uint256 playerScore,
        uint256 dealerScore
    ) private {
        game.state = GameState.Finished;
        game.result = result;
        lockedLiquidity -= game.maxPayout;

        for (uint256 index; index < COMMITTEE_SIZE; ++index) {
            --validators[game.selectedValidators[index]].activeGames;
        }

        uint256 payout;
        if (result == GameResult.PlayerWin) {
            poolBalance -= game.bet;
            payout = game.maxPayout;
        } else if (result == GameResult.DealerWin) {
            poolBalance += game.bet;
        } else {
            payout = game.bet;
        }
        game.payout = payout;

        if (payout != 0) {
            token.safeTransfer(game.player, payout);
        }

        emit GameFinished(
            gameId,
            result,
            payout,
            playerScore,
            dealerScore
        );
    }

    function _findValidator(Game storage game, address participant)
        private
        view
        returns (bool selected, uint256 validatorIndex)
    {
        for (uint256 index; index < COMMITTEE_SIZE; ++index) {
            if (game.selectedValidators[index] == participant) {
                return (true, index);
            }
        }
    }

    function _requireState(Game storage game, GameState expected) private view {
        if (game.state != expected) {
            revert InvalidGameState(expected, game.state);
        }
    }

    function _requireBeforeDeadline(uint256 deadline) private view {
        if (block.timestamp > deadline) {
            revert GameDeadlinePassed(deadline, block.timestamp);
        }
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

    function _getGame(uint256 gameId) internal view returns (Game storage game) {
        game = games[gameId];
        if (game.player == address(0)) revert GameDoesNotExist(gameId);
    }
}
