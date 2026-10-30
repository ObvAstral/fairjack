// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IVRFReceiver {
    function rawFulfillRandomWords(
        uint256 requestId,
        uint256[] calldata words
    ) external;
}

/// @dev Local/test-only native-payment wrapper. It is NOT a randomness oracle.
///      Anyone can choose its outputs; deploy scripts restrict it to Hardhat Local.
contract MockVRFWrapper {
    address public immutable link;
    uint256 public fee = 0.0001 ether;
    uint256 public lastRequestId;
    bool public requestsEnabled = true;
    function setRequestsEnabled(bool value) external {
        requestsEnabled = value;
    }
    struct Request {
        address consumer;
        uint32 gasLimit;
        bool fulfilled;
    }
    mapping(uint256 => Request) public requests;
    event MockFulfilled(uint256 indexed requestId, bool success);

    constructor(address tokenAddress) {
        link = tokenAddress;
    }
    function setFee(uint256 value) external {
        fee = value;
    }
    function calculateRequestPriceNative(
        uint32,
        uint32
    ) external view returns (uint256) {
        return fee;
    }
    function requestRandomWordsInNative(
        uint32 gasLimit,
        uint16 confirmations,
        uint32 numWords,
        bytes calldata extraArgs
    ) external payable returns (uint256 requestId) {
        require(requestsEnabled, "requests disabled");
        require(msg.value == fee, "wrong payment");
        require(numWords == 1 && confirmations >= 3, "wrong configuration");
        require(
            keccak256(extraArgs) ==
                keccak256(
                    abi.encodeWithSelector(
                        bytes4(keccak256("VRF ExtraArgsV1")),
                        true
                    )
                ),
            "native payment required"
        );
        requestId = ++lastRequestId;
        requests[requestId] = Request(msg.sender, gasLimit, false);
    }
    function fulfillRandomWords(uint256 requestId, uint256 word) external {
        Request storage request = requests[requestId];
        require(
            request.consumer != address(0) && !request.fulfilled,
            "invalid request"
        );
        request.fulfilled = true;
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        (bool success, ) = request.consumer.call{gas: request.gasLimit}(
            abi.encodeCall(
                IVRFReceiver.rawFulfillRandomWords,
                (requestId, words)
            )
        );
        emit MockFulfilled(requestId, success);
    }
    /// @dev Test-only delivery hook for duplicate, unknown, and malformed callbacks.
    function deliverForTest(
        address consumer,
        uint256 requestId,
        uint256[] calldata words
    ) external {
        IVRFReceiver(consumer).rawFulfillRandomWords(requestId, words);
    }
}
