// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FairJackPool} from "../contracts/FairJackPool.sol";
import {MockERC20} from "../contracts/MockERC20.sol";

contract FairJackPoolHarness is FairJackPool {
    constructor(address tokenAddress) FairJackPool(tokenAddress) {}

    function setLockedLiquidity(uint256 amount) external {
        lockedLiquidity = amount;
    }

    function recordPoolProfit(uint256 amount) external {
        poolBalance += amount;
    }

    function erasePoolBalance() external {
        poolBalance = 0;
    }
}

contract FeeOnTransferToken is MockERC20 {
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, to, value - fee);
            super._update(from, address(0), fee);
        } else {
            super._update(from, to, value);
        }
    }
}

contract PoolUser {
    function approveAndDeposit(MockERC20 token, FairJackPool pool, uint256 amount) external {
        token.approve(address(pool), amount);
        pool.depositToHousePool(amount);
    }

    function withdraw(FairJackPool pool, uint256 shares) external {
        pool.withdrawFromHousePool(shares);
    }
}

contract FairJackPoolTest {
    MockERC20 internal token;
    FairJackPool internal pool;
    FairJackPoolHarness internal poolHarness;

    function setUp() public {
        token = new MockERC20();
        poolHarness = new FairJackPoolHarness(address(token));
        pool = FairJackPool(address(poolHarness));
    }

    function testMintAndApprove() public {
        uint256 amount = 100 ether;
        token.mint(address(this), amount);
        token.approve(address(pool), amount);

        require(token.balanceOf(address(this)) == amount, "mint balance mismatch");
        require(token.totalSupply() == amount, "total supply mismatch");
        require(token.allowance(address(this), address(pool)) == amount, "allowance mismatch");
    }

    function testInitialDepositMintsSharesOneToOne() public {
        uint256 amount = 100 ether;
        token.mint(address(this), amount);
        token.approve(address(pool), amount);
        pool.depositToHousePool(amount);

        require(token.balanceOf(address(pool)) == amount, "pool token balance mismatch");
        require(pool.poolBalance() == amount, "pool accounting mismatch");
        require(pool.totalShares() == amount, "total shares mismatch");
        require(pool.sharesOf(address(this)) == amount, "user shares mismatch");
    }

    function testSecondUserDepositMintsCorrectShares() public {
        uint256 firstAmount = 100 ether;
        uint256 secondAmount = 40 ether;
        token.mint(address(this), firstAmount);
        token.approve(address(pool), firstAmount);
        pool.depositToHousePool(firstAmount);

        PoolUser secondUser = new PoolUser();
        token.mint(address(secondUser), secondAmount);
        secondUser.approveAndDeposit(token, pool, secondAmount);

        require(pool.poolBalance() == firstAmount + secondAmount, "combined pool balance mismatch");
        require(pool.totalShares() == firstAmount + secondAmount, "combined shares mismatch");
        require(pool.sharesOf(address(secondUser)) == secondAmount, "second user shares mismatch");
    }

    function testDepositUsesProportionalSharePriceAfterPoolProfit() public {
        uint256 initialDeposit = 100 ether;
        uint256 profit = 50 ether;
        uint256 secondDeposit = 60 ether;
        token.mint(address(this), initialDeposit);
        token.approve(address(pool), initialDeposit);
        pool.depositToHousePool(initialDeposit);

        token.mint(address(pool), profit);
        poolHarness.recordPoolProfit(profit);

        PoolUser secondUser = new PoolUser();
        token.mint(address(secondUser), secondDeposit);
        secondUser.approveAndDeposit(token, pool, secondDeposit);

        uint256 expectedShares = 40 ether;
        require(pool.sharesOf(address(secondUser)) == expectedShares, "proportional shares mismatch");
        require(pool.totalShares() == initialDeposit + expectedShares, "proportional total shares mismatch");
        require(pool.poolBalance() == initialDeposit + profit + secondDeposit, "profit pool balance mismatch");
    }

    function testDepositRejectsZeroAmount() public {
        (bool success, bytes memory result) =
            address(pool).call(abi.encodeCall(FairJackPool.depositToHousePool, (0)));

        require(!success, "zero deposit should revert");
        require(_revertSelector(result) == FairJackPool.ZeroAmount.selector, "wrong zero deposit error");
    }

    function testDepositRejectsFeeOnTransferTokenWithoutChangingBalances() public {
        FeeOnTransferToken feeToken = new FeeOnTransferToken();
        FairJackPool feePool = new FairJackPool(address(feeToken));
        uint256 amount = 100 ether;
        feeToken.mint(address(this), amount);
        feeToken.approve(address(feePool), amount);

        (bool success, bytes memory result) =
            address(feePool).call(abi.encodeCall(FairJackPool.depositToHousePool, (amount)));

        require(!success, "fee-on-transfer deposit should revert");
        require(
            _revertSelector(result) == FairJackPool.UnsupportedTokenTransfer.selector,
            "wrong unsupported token error"
        );
        require(feeToken.balanceOf(address(this)) == amount, "failed deposit changed user tokens");
        require(feeToken.balanceOf(address(feePool)) == 0, "failed deposit changed pool tokens");
        require(feePool.poolBalance() == 0, "failed deposit changed accounting");
    }

    function testDepositRejectsInsolventPoolExplicitly() public {
        uint256 amount = 100 ether;
        token.mint(address(this), amount * 2);
        token.approve(address(pool), amount * 2);
        pool.depositToHousePool(amount);
        poolHarness.erasePoolBalance();

        (bool success, bytes memory result) =
            address(pool).call(abi.encodeCall(FairJackPool.depositToHousePool, (amount)));

        require(!success, "insolvent pool deposit should revert");
        require(_revertSelector(result) == FairJackPool.InsolventPool.selector, "wrong insolvency error");
        require(pool.totalShares() == amount, "failed insolvent deposit changed shares");
    }

    function testPartialWithdrawalBurnsSharesAndReturnsTokens() public {
        uint256 depositAmount = 100 ether;
        uint256 sharesToWithdraw = 40 ether;
        token.mint(address(this), depositAmount);
        token.approve(address(pool), depositAmount);
        pool.depositToHousePool(depositAmount);

        pool.withdrawFromHousePool(sharesToWithdraw);

        require(token.balanceOf(address(this)) == sharesToWithdraw, "withdrawn token balance mismatch");
        require(token.balanceOf(address(pool)) == depositAmount - sharesToWithdraw, "contract balance mismatch");
        require(pool.poolBalance() == depositAmount - sharesToWithdraw, "pool balance after withdraw mismatch");
        require(pool.totalShares() == depositAmount - sharesToWithdraw, "total shares after withdraw mismatch");
        require(pool.sharesOf(address(this)) == depositAmount - sharesToWithdraw, "user shares after withdraw mismatch");
    }

    function testFullWithdrawalResetsPoolAccounting() public {
        uint256 amount = 100 ether;
        token.mint(address(this), amount);
        token.approve(address(pool), amount);
        pool.depositToHousePool(amount);

        pool.withdrawFromHousePool(amount);

        require(token.balanceOf(address(this)) == amount, "full withdrawal token mismatch");
        require(token.balanceOf(address(pool)) == 0, "pool retained tokens");
        require(pool.poolBalance() == 0, "pool balance not reset");
        require(pool.totalShares() == 0, "total shares not reset");
        require(pool.sharesOf(address(this)) == 0, "user shares not reset");
        require(pool.getSharePrice() == 1 ether, "empty pool share price mismatch");
    }

    function testTwoUsersRecoverProportionalValueAfterProfit() public {
        uint256 firstDeposit = 100 ether;
        uint256 profit = 50 ether;
        uint256 secondDeposit = 60 ether;
        token.mint(address(this), firstDeposit);
        token.approve(address(pool), firstDeposit);
        pool.depositToHousePool(firstDeposit);
        token.mint(address(pool), profit);
        poolHarness.recordPoolProfit(profit);

        PoolUser secondUser = new PoolUser();
        token.mint(address(secondUser), secondDeposit);
        secondUser.approveAndDeposit(token, pool, secondDeposit);

        secondUser.withdraw(pool, 40 ether);
        pool.withdrawFromHousePool(firstDeposit);

        require(token.balanceOf(address(secondUser)) == secondDeposit, "second user value mismatch");
        require(token.balanceOf(address(this)) == firstDeposit + profit, "first user profit mismatch");
        require(token.balanceOf(address(pool)) == 0, "pool token conservation mismatch");
        require(pool.poolBalance() == 0, "pool accounting conservation mismatch");
        require(pool.totalShares() == 0, "share conservation mismatch");
    }

    function testWithdrawalRejectsInsufficientSharesWithoutChangingState() public {
        uint256 depositAmount = 100 ether;
        token.mint(address(this), depositAmount);
        token.approve(address(pool), depositAmount);
        pool.depositToHousePool(depositAmount);

        (bool success, bytes memory result) = address(pool).call(
            abi.encodeCall(FairJackPool.withdrawFromHousePool, (depositAmount + 1))
        );

        require(!success, "excess withdrawal should revert");
        require(_revertSelector(result) == FairJackPool.InsufficientShares.selector, "wrong shares error");
        require(pool.poolBalance() == depositAmount, "failed withdrawal changed pool balance");
        require(pool.totalShares() == depositAmount, "failed withdrawal changed total shares");
        require(pool.sharesOf(address(this)) == depositAmount, "failed withdrawal changed user shares");
    }

    function testWithdrawalRejectsLockedLiquidityWithoutChangingState() public {
        uint256 depositAmount = 100 ether;
        token.mint(address(this), depositAmount);
        token.approve(address(pool), depositAmount);
        pool.depositToHousePool(depositAmount);
        poolHarness.setLockedLiquidity(80 ether);

        (bool success, bytes memory result) =
            address(pool).call(abi.encodeCall(FairJackPool.withdrawFromHousePool, (30 ether)));

        require(!success, "locked liquidity withdrawal should revert");
        require(
            _revertSelector(result) == FairJackPool.InsufficientAvailableLiquidity.selector,
            "wrong liquidity error"
        );
        require(pool.poolBalance() == depositAmount, "failed withdrawal changed pool balance");
        require(pool.totalShares() == depositAmount, "failed withdrawal changed total shares");
        require(pool.sharesOf(address(this)) == depositAmount, "failed withdrawal changed user shares");
    }

    function testWithdrawalRejectsZeroShares() public {
        (bool success, bytes memory result) =
            address(pool).call(abi.encodeCall(FairJackPool.withdrawFromHousePool, (0)));

        require(!success, "zero-share withdrawal should revert");
        require(_revertSelector(result) == FairJackPool.ZeroShares.selector, "wrong zero shares error");
    }

    function testInitialPoolViewsAndTokenAddress() public view {
        require(address(pool.token()) == address(token), "configured token mismatch");
        require(pool.poolBalance() == 0, "initial pool balance should be zero");
        require(pool.lockedLiquidity() == 0, "initial locked liquidity should be zero");
        require(pool.totalShares() == 0, "initial shares should be zero");
        require(pool.getAvailableLiquidity() == 0, "initial available liquidity should be zero");
        require(pool.getSharePrice() == 1 ether, "initial share price mismatch");
    }

    function testAvailableLiquiditySubtractsLockedFunds() public {
        uint256 depositAmount = 100 ether;
        token.mint(address(this), depositAmount);
        token.approve(address(pool), depositAmount);
        pool.depositToHousePool(depositAmount);
        poolHarness.setLockedLiquidity(35 ether);

        require(pool.getAvailableLiquidity() == 65 ether, "available liquidity mismatch");
    }

    function testSharePriceReflectsPoolProfit() public {
        uint256 depositAmount = 100 ether;
        uint256 profit = 50 ether;
        token.mint(address(this), depositAmount);
        token.approve(address(pool), depositAmount);
        pool.depositToHousePool(depositAmount);
        token.mint(address(pool), profit);
        poolHarness.recordPoolProfit(profit);

        require(pool.getSharePrice() == 1.5 ether, "share price after profit mismatch");
    }

    function testConstructorRejectsZeroTokenAddress() public {
        try new FairJackPool(address(0)) returns (FairJackPool) {
            revert("zero token constructor should revert");
        } catch (bytes memory result) {
            require(_revertSelector(result) == FairJackPool.InvalidTokenAddress.selector, "wrong constructor error");
        }
    }

    function _revertSelector(bytes memory revertData) private pure returns (bytes4 selector) {
        if (revertData.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := mload(add(revertData, 0x20))
        }
    }
}
