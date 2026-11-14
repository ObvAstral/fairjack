// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Bounded gameplay permissions. Never authorizes arbitrary calls or withdrawals.
abstract contract GameSessions is EIP712 {
    error InvalidSession();
    error InvalidSessionSignature();
    error InvalidSessionNonce();
    error SessionExpired();
    error SessionBudgetExceeded();
    error InvalidSessionAction();

    uint256 public constant MAX_SESSION_DURATION = 30 minutes;
    uint256 public constant MAX_ACTION_DURATION = 60 seconds;
    bytes32 public immutable sessionDeploymentId;
    bytes32 private constant GRANT_TYPEHASH = keccak256("SessionGrant(address player,address sessionKey,uint256 nonce,uint256 validUntil,uint256 maxBet,uint256 budget,bytes32 deploymentId)");
    bytes32 private constant ACTION_TYPEHASH = keccak256("SessionAction(bytes32 sessionId,uint256 nonce,uint8 kind,uint256 argument,uint256 validUntil)");

    struct SessionGrant {
        address player;
        address sessionKey;
        uint256 nonce;
        uint256 validUntil;
        uint256 maxBet;
        uint256 budget;
        bytes32 deploymentId;
    }
    struct SessionAction {
        bytes32 sessionId;
        uint256 nonce;
        uint8 kind; // 0: start (argument = bet), 1: hit, 2: stand (argument = gameId)
        uint256 argument;
        uint256 validUntil;
    }
    struct Session {
        address player;
        address sessionKey;
        uint256 validUntil;
        uint256 maxBet;
        uint256 remainingBudget;
        uint256 actionNonce;
        bool revoked;
    }
    mapping(address => uint256) public sessionNonces;
    mapping(address => bytes32) public activeSession;
    mapping(bytes32 => Session) private sessions;
    event SessionRegistered(bytes32 indexed sessionId, address indexed player, address sessionKey, uint256 validUntil, uint256 budget, uint256 maxBet);
    event SessionRevoked(bytes32 indexed sessionId, address indexed player);
    event SessionActionExecuted(bytes32 indexed sessionId, uint256 nonce, uint8 kind, uint256 argument);

    constructor() EIP712("FairJackPool", "2") {
        // Separates persisted relay jobs and signatures across local redeploys.
        sessionDeploymentId = keccak256(abi.encode(address(this), block.chainid, block.timestamp, blockhash(block.number - 1)));
    }

    function registerSession(SessionGrant calldata grant, bytes calldata signature) external returns (bytes32 id) {
        if (grant.player == address(0) || grant.sessionKey == address(0) || grant.deploymentId != sessionDeploymentId || grant.budget < grant.maxBet || !_validSessionBet(grant.maxBet)) revert InvalidSession();
        if (grant.validUntil <= block.timestamp || grant.validUntil > block.timestamp + MAX_SESSION_DURATION) revert SessionExpired();
        if (grant.nonce != sessionNonces[grant.player]) revert InvalidSessionNonce();
        id = _hashTypedDataV4(keccak256(abi.encode(GRANT_TYPEHASH, grant)));
        if (!SignatureChecker.isValidSignatureNow(grant.player, id, signature)) revert InvalidSessionSignature();
        ++sessionNonces[grant.player];
        bytes32 previous = activeSession[grant.player];
        if (previous != bytes32(0)) {
            sessions[previous].revoked = true;
            emit SessionRevoked(previous, grant.player);
        }
        activeSession[grant.player] = id;
        sessions[id] = Session(grant.player, grant.sessionKey, grant.validUntil, grant.maxBet, grant.budget, 0, false);
        emit SessionRegistered(id, grant.player, grant.sessionKey, grant.validUntil, grant.budget, grant.maxBet);
    }

    function revokeSession(bytes32 id) external {
        Session storage session = sessions[id];
        if (session.player == address(0) || msg.sender != session.player) revert InvalidSession();
        session.revoked = true;
        if (activeSession[msg.sender] == id) activeSession[msg.sender] = bytes32(0);
        ++sessionNonces[msg.sender];
        emit SessionRevoked(id, msg.sender);
    }

    function getSession(bytes32 id) external view returns (Session memory) {
        return sessions[id];
    }

    function _authorizeSessionAction(SessionAction calldata action, bytes calldata signature) internal returns (address player) {
        Session storage session = sessions[action.sessionId];
        player = session.player;
        if (player == address(0) || session.revoked || activeSession[player] != action.sessionId) revert InvalidSession();
        if (block.timestamp >= session.validUntil || action.validUntil < block.timestamp || action.validUntil > session.validUntil || action.validUntil > block.timestamp + MAX_ACTION_DURATION) revert SessionExpired();
        if (action.nonce != session.actionNonce) revert InvalidSessionNonce();
        if (action.kind > 2) revert InvalidSessionAction();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(ACTION_TYPEHASH, action)));
        if (ECDSA.recover(digest, signature) != session.sessionKey) revert InvalidSessionSignature();
        if (action.kind == 0) {
            if (action.argument > session.maxBet || action.argument > session.remainingBudget) revert SessionBudgetExceeded();
            session.remainingBudget -= action.argument;
        }
        ++session.actionNonce;
        emit SessionActionExecuted(action.sessionId, action.nonce, action.kind, action.argument);
    }

    function _validSessionBet(uint256 bet) internal pure virtual returns (bool);
}
