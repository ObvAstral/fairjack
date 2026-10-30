// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import {VRFV2PlusWrapperConsumerBase} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFV2PlusWrapperConsumerBase.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/// @notice ERC-20 blackjack bankroll with pool-funded Chainlink VRF v2.5.
/// @dev Native ETH donations finance the oracle; they do not mint token shares
///      and are not redeemable. Fee-on-transfer/rebasing wager tokens are unsupported.
///      No owner, subscription manager, cancellation, or randomness re-roll exists.
contract FairJackPool is ReentrancyGuard, VRFV2PlusWrapperConsumerBase {
    using SafeERC20 for IERC20;

    error InvalidTokenAddress();
    error InvalidOracleAddress();
    error InvalidOracleFeeLimit();
    error ZeroAmount();
    error ZeroShares();
    error ZeroSharesMinted();
    error ZeroWithdrawalAmount();
    error InsolventPool();
    error ActiveGamesPreventShareChanges();
    error InsufficientShares(uint256 available, uint256 requested);
    error InsufficientAvailableLiquidity(uint256 available, uint256 requested);
    error UnsupportedTokenTransfer(uint256 expected, uint256 received);
    error InsufficientOracleReserve(uint256 available, uint256 required);
    error OracleUnavailable();
    error NoQueuedRandomness();
    error OracleRequestLimitReached();
    error InvalidOracleRequest();
    error BetBelowMinimum(uint256 minimum, uint256 provided);
    error BetAboveMaximum(uint256 maximum, uint256 provided);
    error InsufficientTokenAllowance(uint256 available, uint256 required);
    error GameDoesNotExist(uint256 gameId);
    error InvalidGameState(GameState expected, GameState actual);
    error GameDeadlinePassed(uint256 deadline, uint256 currentTimestamp);
    error GameDeadlineNotReached(uint256 deadline, uint256 currentTimestamp);
    error TimeoutUnavailable(GameState state);
    error NotGamePlayer(address caller);
    error RandomnessNotReady();
    error DeckExhausted();
    error InvalidCard(uint8 card);
    error PlayerAlreadyBust();

    event PoolDeposit(
        address indexed user,
        uint256 amount,
        uint256 sharesMinted
    );
    event PoolWithdraw(
        address indexed user,
        uint256 amount,
        uint256 sharesBurned
    );
    event OracleReserveFunded(address indexed funder, uint256 amount);
    event RandomnessRequested(
        uint256 indexed gameId,
        uint256 indexed requestId,
        RandomnessPhase phase,
        uint256 paid
    );
    event OracleRequestDeferred(uint256 indexed gameId, RandomnessPhase phase);
    event RandomnessReceived(uint256 indexed gameId, uint256 indexed requestId);
    event PoolGameStarted(
        uint256 indexed gameId,
        address indexed player,
        uint256 bet,
        uint256 maxPayout
    );
    event CardDrawn(
        uint256 indexed gameId,
        bool indexed playerHand,
        uint8 card,
        uint256 handSize
    );
    event GameStarted(uint256 indexed gameId, address indexed player);
    event PlayerHit(uint256 indexed gameId, uint8 card, uint256 playerScore);
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
    event PlayerPenalized(
        uint256 indexed gameId,
        address indexed player,
        uint256 amount
    );
    event TimeoutClaimed(
        uint256 indexed gameId,
        address indexed claimant,
        GameState timedOutState
    );

    IERC20 public immutable token;
    uint256 public constant MIN_BET = 1 ether;
    uint256 public constant MAX_BET = 100 ether;
    uint256 public constant ACTION_DURATION = 5 minutes;
    uint32 public constant CALLBACK_GAS_LIMIT = 120_000;
    uint16 public constant REQUEST_CONFIRMATIONS = 3;
    // A non-bust hand has at most 11 cards: the 12 smallest cards total 24.
    // Conservatively reserve initial deal + 10 hits + one whole dealer phase.
    uint256 public constant MAX_RANDOMNESS_REQUESTS_PER_GAME = 12;
    uint256 public immutable maxOracleRequestCost;

    uint256 public poolBalance;
    uint256 public lockedLiquidity;
    uint256 public totalShares;
    uint256 public lockedOracleBudget;
    uint256 public totalOracleFunded;
    uint256 public totalOracleSpent;
    mapping(address => uint256) public sharesOf;

    enum GameState {
        Created,
        WaitingForRandomness,
        RandomnessReady,
        PlayerTurn,
        DealerTurn,
        Finished
    }
    enum GameResult {
        None,
        PlayerWin,
        DealerWin,
        Push
    }
    enum RandomnessPhase {
        InitialDeal,
        PlayerHit,
        Dealer
    }

    struct Game {
        address player;
        uint256 bet;
        uint256 maxPayout;
        GameState state;
        GameResult result;
        uint256 payout;
        uint8[] playerCards;
        uint8[] dealerCards;
        // Sparse Fisher-Yates deck. Zero means the original value at that index;
        // stored replacements are encoded as card + 1 to represent card zero.
        uint8[52] deck;
        bool[52] drawnCards;
        uint8 cardsDrawn;
        uint256 actionDeadline;
        uint256 pendingRequestId;
        uint256 requestCount;
        uint256 oracleBudgetRemaining;
        uint256 oracleSpent;
        RandomnessPhase queuedPhase;
        bool requestQueued;
    }

    struct RandomnessRequest {
        uint256 gameId;
        RandomnessPhase phase;
        bool exists;
        bool fulfilled;
        bool consumed;
        uint256 randomWord;
        uint256 paid;
    }

    mapping(uint256 => Game) internal games;
    mapping(uint256 => RandomnessRequest) public randomnessRequests;
    uint256 public nextGameId;

    constructor(
        address tokenAddress,
        address wrapperAddress,
        uint256 feeLimit
    ) VRFV2PlusWrapperConsumerBase(_validatedWrapper(wrapperAddress)) {
        if (tokenAddress == address(0)) revert InvalidTokenAddress();
        if (
            feeLimit == 0 ||
            feeLimit > type(uint256).max / MAX_RANDOMNESS_REQUESTS_PER_GAME
        ) {
            revert InvalidOracleFeeLimit();
        }
        token = IERC20(tokenAddress);
        maxOracleRequestCost = feeLimit;
    }

    function _validatedWrapper(
        address wrapperAddress
    ) private view returns (address) {
        if (wrapperAddress.code.length == 0) revert InvalidOracleAddress();
        return wrapperAddress;
    }

    /// @notice Irrevocable service-budget donation; no shares or withdrawal rights.
    function fundOracle() external payable {
        _recordOracleFunding();
    }
    receive() external payable {
        _recordOracleFunding();
    }

    function _recordOracleFunding() private {
        if (msg.value == 0) revert ZeroAmount();
        totalOracleFunded += msg.value;
        emit OracleReserveFunded(msg.sender, msg.value);
    }

    function vrfWrapper() external view returns (address) {
        return address(i_vrfV2PlusWrapper);
    }
    function getOracleReserve() external view returns (uint256) {
        return address(this).balance;
    }
    function getAvailableOracleReserve() public view returns (uint256) {
        return address(this).balance - lockedOracleBudget;
    }
    function getRequiredOracleBudget() public view returns (uint256) {
        return maxOracleRequestCost * MAX_RANDOMNESS_REQUESTS_PER_GAME;
    }
    function quoteOracleRequest() public view returns (uint256) {
        return
            i_vrfV2PlusWrapper.calculateRequestPriceNative(
                CALLBACK_GAS_LIMIT,
                1
            );
    }

    function startPoolGame(
        uint256 bet
    ) external nonReentrant returns (uint256 gameId) {
        if (bet < MIN_BET) revert BetBelowMinimum(MIN_BET, bet);
        if (bet > MAX_BET) revert BetAboveMaximum(MAX_BET, bet);
        uint256 allowance = token.allowance(msg.sender, address(this));
        if (allowance < bet) revert InsufficientTokenAllowance(allowance, bet);
        uint256 maxPayout = bet * 2;
        uint256 available = getAvailableLiquidity();
        if (available < maxPayout)
            revert InsufficientAvailableLiquidity(available, maxPayout);
        uint256 budget = getRequiredOracleBudget();
        uint256 oracleAvailable = getAvailableOracleReserve();
        if (oracleAvailable < budget)
            revert InsufficientOracleReserve(oracleAvailable, budget);

        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), bet);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != bet) revert UnsupportedTokenTransfer(bet, received);

        gameId = nextGameId++;
        Game storage game = games[gameId];
        game.player = msg.sender;
        game.bet = bet;
        game.maxPayout = maxPayout;
        game.oracleBudgetRemaining = budget;
        lockedLiquidity += maxPayout;
        lockedOracleBudget += budget;
        emit PoolGameStarted(gameId, msg.sender, bet, maxPayout);
        _requestRandomness(gameId, game, RandomnessPhase.InitialDeal);
    }

    function hit(uint256 gameId) external nonReentrant {
        Game storage game = _getGame(gameId);
        _requirePlayerTurn(game);
        uint8[] memory hand = game.playerCards;
        if (_calculateHandScore(hand) > 21) revert PlayerAlreadyBust();
        _requestRandomness(gameId, game, RandomnessPhase.PlayerHit);
    }

    function stand(uint256 gameId) external nonReentrant {
        Game storage game = _getGame(gameId);
        _requirePlayerTurn(game);
        uint8[] memory hand = game.playerCards;
        emit PlayerStand(gameId, _calculateHandScore(hand));
        uint8[] memory dealerHand = game.dealerCards;
        if (_calculateHandScore(dealerHand) >= 17) {
            game.state = GameState.DealerTurn;
            game.actionDeadline = 0;
            _finishDealer(gameId, game);
        } else {
            _requestRandomness(gameId, game, RandomnessPhase.Dealer);
        }
    }

    function _requestRandomness(
        uint256 gameId,
        Game storage game,
        RandomnessPhase phase
    ) private {
        game.state = GameState.WaitingForRandomness;
        game.actionDeadline = 0;
        game.queuedPhase = phase;
        game.requestQueued = true;
        if (!_dispatchRandomness(gameId, game)) {
            // A new game must fund/request successfully or its bet is rolled back.
            // Existing players have committed their action and cannot time out
            // while prices exceed the cap or the wrapper temporarily rejects it.
            if (phase == RandomnessPhase.InitialDeal)
                revert OracleUnavailable();
            emit OracleRequestDeferred(gameId, phase);
        }
    }

    /// @notice Sends the FIRST request for a committed action deferred by fees/outage.
    /// @dev Never replaces an existing request or changes the chosen action.
    function requestPendingRandomness(uint256 gameId) external nonReentrant {
        Game storage game = _getGame(gameId);
        _requireState(game, GameState.WaitingForRandomness);
        if (!game.requestQueued) revert NoQueuedRandomness();
        if (!_dispatchRandomness(gameId, game)) revert OracleUnavailable();
    }

    function _dispatchRandomness(
        uint256 gameId,
        Game storage game
    ) private returns (bool) {
        if (game.requestCount >= MAX_RANDOMNESS_REQUESTS_PER_GAME)
            revert OracleRequestLimitReached();
        uint256 fee;
        try
            i_vrfV2PlusWrapper.calculateRequestPriceNative(
                CALLBACK_GAS_LIMIT,
                1
            )
        returns (uint256 quoted) {
            if (quoted > maxOracleRequestCost) return false;
            fee = quoted;
        } catch {
            return false;
        }
        // The official wrapper consumer base verifies the callback sender.
        // Calling its native-payment interface directly lets a failed submission
        // leave an existing action queued, without punishing the player.
        try
            i_vrfV2PlusWrapper.requestRandomWordsInNative{value: fee}(
                CALLBACK_GAS_LIMIT,
                REQUEST_CONFIRMATIONS,
                1,
                VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: true})
                )
            )
        returns (uint256 requestId) {
            if (randomnessRequests[requestId].exists)
                revert InvalidOracleRequest();
            game.oracleBudgetRemaining -= fee;
            lockedOracleBudget -= fee;
            game.oracleSpent += fee;
            totalOracleSpent += fee;
            ++game.requestCount;
            game.requestQueued = false;
            game.pendingRequestId = requestId;
            randomnessRequests[requestId] = RandomnessRequest(
                gameId,
                game.queuedPhase,
                true,
                false,
                false,
                0,
                fee
            );
            emit RandomnessRequested(gameId, requestId, game.queuedPhase, fee);
            return true;
        } catch {
            return false;
        }
    }

    /// @dev Only the immutable Chainlink wrapper can reach this callback. Unknown,
    ///      duplicate, or malformed deliveries are ignored, never rerolled.
    ///      No token transfers, card draws, or external calls run in the callback.
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] memory words
    ) internal override {
        RandomnessRequest storage request = randomnessRequests[requestId];
        if (!request.exists || request.fulfilled || words.length != 1) return;
        Game storage game = games[request.gameId];
        if (
            game.requestQueued ||
            game.state != GameState.WaitingForRandomness ||
            game.pendingRequestId != requestId
        ) return;
        request.randomWord = words[0];
        request.fulfilled = true;
        game.state = GameState.RandomnessReady;
        emit RandomnessReceived(request.gameId, requestId);
    }

    /// @notice Permissionless, retryable processing of an already fixed result.
    /// @dev A failed token payout leaves the saved oracle response available.
    function processRandomness(uint256 gameId) external nonReentrant {
        Game storage game = _getGame(gameId);
        _requireState(game, GameState.RandomnessReady);
        RandomnessRequest storage request = randomnessRequests[
            game.pendingRequestId
        ];
        if (!request.fulfilled || request.consumed) revert RandomnessNotReady();
        request.consumed = true;
        bytes32 seed = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                gameId,
                game.pendingRequestId,
                request.randomWord
            )
        );
        if (request.phase == RandomnessPhase.InitialDeal) {
            _dealInitialCards(gameId, game, seed);
        } else if (request.phase == RandomnessPhase.PlayerHit) {
            uint8 card = _drawCard(game, seed, 0);
            game.playerCards.push(card);
            uint8[] memory hand = game.playerCards;
            uint256 score = _calculateHandScore(hand);
            emit CardDrawn(gameId, true, card, hand.length);
            emit PlayerHit(gameId, card, score);
            if (score > 21) {
                uint8[] memory dealerHand = game.dealerCards;
                _settleGame(
                    gameId,
                    game,
                    GameResult.DealerWin,
                    score,
                    _calculateHandScore(dealerHand)
                );
            } else {
                _beginPlayerTurn(game);
            }
        } else {
            game.state = GameState.DealerTurn;
            uint256 nonce;
            uint8[] memory dealerHand = game.dealerCards;
            while (_calculateHandScore(dealerHand) < 17) {
                uint8 card = _drawCard(game, seed, nonce++);
                game.dealerCards.push(card);
                emit CardDrawn(gameId, false, card, game.dealerCards.length);
                dealerHand = game.dealerCards;
            }
            _finishDealer(gameId, game);
        }
    }

    function _dealInitialCards(
        uint256 gameId,
        Game storage game,
        bytes32 seed
    ) private {
        for (uint256 index; index < 4; ++index) {
            uint8 card = _drawCard(game, seed, index);
            bool playerHand = index < 2;
            if (playerHand) game.playerCards.push(card);
            else game.dealerCards.push(card);
            emit CardDrawn(
                gameId,
                playerHand,
                card,
                playerHand ? game.playerCards.length : game.dealerCards.length
            );
        }
        _beginPlayerTurn(game);
        emit GameStarted(gameId, game.player);
    }

    function _beginPlayerTurn(Game storage game) private {
        game.state = GameState.PlayerTurn;
        game.actionDeadline = block.timestamp + ACTION_DURATION;
    }

    /// @dev Each draw removes an index from a virtual deck in bounded work.
    ///      The seed belongs only to the current committed action, never a future hit.
    function _drawCard(
        Game storage game,
        bytes32 seed,
        uint256 nonce
    ) internal returns (uint8 card) {
        uint8 remaining = 52 - game.cardsDrawn;
        if (remaining == 0) revert DeckExhausted();
        uint8 index = uint8(
            uint256(keccak256(abi.encode(seed, nonce))) % remaining
        );
        uint8 stored = game.deck[index];
        card = stored == 0 ? index : stored - 1;
        uint8 last = game.deck[remaining - 1];
        game.deck[index] = last == 0 ? remaining : last;
        game.drawnCards[card] = true;
        ++game.cardsDrawn;
    }

    function _finishDealer(uint256 gameId, Game storage game) private {
        uint8[] memory playerHand = game.playerCards;
        uint8[] memory dealerHand = game.dealerCards;
        uint256 playerScore = _calculateHandScore(playerHand);
        uint256 dealerScore = _calculateHandScore(dealerHand);
        bool bust = dealerScore > 21;
        emit DealerResolved(gameId, dealerScore, bust);
        GameResult result =
            bust || playerScore > dealerScore
                ? GameResult.PlayerWin
                : dealerScore > playerScore
                    ? GameResult.DealerWin
                    : GameResult.Push;
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
        game.actionDeadline = 0;
        lockedLiquidity -= game.maxPayout;
        lockedOracleBudget -= game.oracleBudgetRemaining;
        game.oracleBudgetRemaining = 0;
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
        if (payout != 0) token.safeTransfer(game.player, payout);
        emit GameFinished(gameId, result, payout, playerScore, dealerScore);
    }

    /// @notice Only player inactivity can time out; oracle results cannot be discarded.
    function claimTimeout(uint256 gameId) external nonReentrant {
        Game storage game = _getGame(gameId);
        if (game.state != GameState.PlayerTurn)
            revert TimeoutUnavailable(game.state);
        if (block.timestamp <= game.actionDeadline)
            revert GameDeadlineNotReached(game.actionDeadline, block.timestamp);
        uint8[] memory playerHand = game.playerCards;
        uint8[] memory dealerHand = game.dealerCards;
        emit TimeoutClaimed(gameId, msg.sender, game.state);
        emit PlayerPenalized(gameId, game.player, game.bet);
        _settleGame(
            gameId,
            game,
            GameResult.DealerWin,
            _calculateHandScore(playerHand),
            _calculateHandScore(dealerHand)
        );
    }

    function getGameCore(
        uint256 gameId
    )
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
    function getGameRandomness(
        uint256 gameId
    )
        external
        view
        returns (
            uint256 requestId,
            RandomnessPhase phase,
            uint256 requestCount,
            bool fulfilled,
            bool consumed,
            uint256 oracleSpent,
            uint256 oracleBudgetRemaining,
            bool queued
        )
    {
        Game storage game = _getGame(gameId);
        RandomnessRequest storage request = randomnessRequests[
            game.pendingRequestId
        ];
        return (
            game.requestQueued ? 0 : game.pendingRequestId,
            game.queuedPhase,
            game.requestCount,
            !game.requestQueued && request.fulfilled,
            !game.requestQueued && request.consumed,
            game.oracleSpent,
            game.oracleBudgetRemaining,
            game.requestQueued
        );
    }
    function getActionDeadline(uint256 gameId) external view returns (uint256) {
        return _getGame(gameId).actionDeadline;
    }
    function getPlayerCards(
        uint256 gameId
    ) external view returns (uint8[] memory) {
        return _getGame(gameId).playerCards;
    }
    function getDealerCards(
        uint256 gameId
    ) external view returns (uint8[] memory) {
        return _getGame(gameId).dealerCards;
    }
    function getCardsDrawn(uint256 gameId) external view returns (uint256) {
        return _getGame(gameId).cardsDrawn;
    }
    function isCardDrawn(
        uint256 gameId,
        uint8 card
    ) external view returns (bool) {
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
    function getGameResult(
        uint256 gameId
    ) external view returns (GameResult result, uint256 payout) {
        Game storage game = _getGame(gameId);
        return (game.result, game.payout);
    }

    /// @notice Deposits wager tokens into the house pool and mints accounting shares.
    /// @param amount Amount of tokens to deposit, expressed in token base units.
    function depositToHousePool(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        // Published/pending VRF results must not allow share trading at a stale NAV.
        if (lockedLiquidity != 0) revert ActiveGamesPreventShareChanges();

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
        if (received != amount)
            revert UnsupportedTokenTransfer(amount, received);

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

        if (lockedLiquidity != 0) revert ActiveGamesPreventShareChanges();

        sharesOf[msg.sender] = userShares - shares;
        totalShares -= shares;
        poolBalance -= amount;

        uint256 balanceBefore = token.balanceOf(msg.sender);
        token.safeTransfer(msg.sender, amount);
        uint256 received = token.balanceOf(msg.sender) - balanceBefore;
        if (received != amount)
            revert UnsupportedTokenTransfer(amount, received);

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

    function _calculateHandScore(
        uint8[] memory cards
    ) internal pure returns (uint256 score) {
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

    function _requirePlayerTurn(Game storage game) private view {
        _requireState(game, GameState.PlayerTurn);
        if (msg.sender != game.player) revert NotGamePlayer(msg.sender);
        if (block.timestamp > game.actionDeadline)
            revert GameDeadlinePassed(game.actionDeadline, block.timestamp);
    }
    function _requireState(Game storage game, GameState expected) private view {
        if (game.state != expected)
            revert InvalidGameState(expected, game.state);
    }
    function _getGame(
        uint256 gameId
    ) internal view returns (Game storage game) {
        game = games[gameId];
        if (game.player == address(0)) revert GameDoesNotExist(gameId);
    }
}
