// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {FairJackPool} from "../FairJackPool.sol";

/// @dev Test-only access to bounded drawing; production has no seed setter.
contract CardDrawingHarness is FairJackPool {
    mapping(uint256 => bytes32) private seeds;
    mapping(uint256 => uint256) private nonces;
    constructor(
        address tokenAddress,
        address wrapperAddress
    ) FairJackPool(tokenAddress, wrapperAddress, 0.001 ether) {}
    function createCardTestGame(
        bytes32 seed
    ) external returns (uint256 gameId) {
        gameId = nextGameId++;
        games[gameId].player = msg.sender;
        games[gameId].state = GameState.PlayerTurn;
        seeds[gameId] = seed;
    }
    function drawCardsForTest(
        uint256 gameId,
        uint256 count,
        bool playerHand
    ) external returns (uint8[] memory cards) {
        Game storage game = _getGame(gameId);
        cards = new uint8[](count);
        for (uint256 i; i < count; ++i) {
            uint8 card = _drawCard(game, seeds[gameId], nonces[gameId]++);
            cards[i] = card;
            if (playerHand) game.playerCards.push(card);
            else game.dealerCards.push(card);
        }
    }
}
