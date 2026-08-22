// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FairJackPool} from "../FairJackPool.sol";

/// @dev Test-only access to deterministic card drawing before initial dealing
///      and player actions are introduced in later phases.
contract CardDrawingHarness is FairJackPool {
    constructor(address tokenAddress) FairJackPool(tokenAddress) {}

    function createCardTestGame(bytes32 seed) external returns (uint256 gameId) {
        gameId = nextGameId;
        ++nextGameId;

        Game storage game = games[gameId];
        game.player = msg.sender;
        game.state = GameState.PlayerTurn;
        game.finalSeed = seed;
    }

    function drawCardsForTest(
        uint256 gameId,
        uint256 count,
        bool playerHand
    ) external returns (uint8[] memory cards) {
        Game storage game = _getGame(gameId);
        cards = new uint8[](count);

        for (uint256 index; index < count; ++index) {
            uint8 card = _drawCard(game);
            cards[index] = card;
            if (playerHand) {
                game.playerCards.push(card);
            } else {
                game.dealerCards.push(card);
            }
        }
    }
}
