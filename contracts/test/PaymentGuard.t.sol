// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PaymentGuard} from "../src/PaymentGuard.sol";
import {MockERC20} from "./MockERC20.sol";

contract PaymentGuardTest is Test {
    PaymentGuard internal guard;
    MockERC20 internal usdc;

    address internal owner = address(0xA11CE);
    address internal merchant = address(0xBEEF);
    address internal agent = address(0xA9E47);
    address internal stranger = address(0x5555);

    function setUp() public {
        usdc = new MockERC20();
        vm.prank(owner);
        guard = new PaymentGuard(owner, address(usdc));

        // Fund the owner and the vault.
        usdc.mint(owner, 1_000_000e6);
        vm.startPrank(owner);
        usdc.approve(address(guard), type(uint256).max);
        guard.deposit(500_000e6);
        vm.stopPrank();
    }

    function test_InitialState() public view {
        assertEq(guard.getOwner(), owner);
        assertEq(guard.getToken(), address(usdc));
        assertEq(usdc.balanceOf(address(guard)), 500_000e6);
    }

    function test_OnlyOwnerSetsAllowance() public {
        vm.expectRevert(PaymentGuard.NotOwner.selector);
        vm.prank(stranger);
        guard.setAllowance(merchant, 100e6, 1_000e6);
    }

    function test_PayWithinCaps() public {
        vm.prank(owner);
        guard.setAllowance(merchant, 100e6, 250e6);

        vm.prank(agent);
        guard.pay(merchant, 100e6);
        assertEq(usdc.balanceOf(merchant), 100e6);
        assertEq(guard.availableToday(merchant), 150e6);

        vm.prank(agent);
        guard.pay(merchant, 100e6);
        assertEq(guard.availableToday(merchant), 50e6);
    }

    function test_RevertsOverPerTxCap() public {
        vm.prank(owner);
        guard.setAllowance(merchant, 100e6, 1_000e6);
        vm.expectRevert(PaymentGuard.ExceedsPerTx.selector);
        vm.prank(agent);
        guard.pay(merchant, 101e6);
    }

    function test_RevertsOverDailyCap() public {
        vm.prank(owner);
        guard.setAllowance(merchant, 200e6, 250e6);
        vm.prank(agent);
        guard.pay(merchant, 200e6);
        vm.expectRevert(PaymentGuard.ExceedsDailyCap.selector);
        vm.prank(agent);
        guard.pay(merchant, 100e6);
    }

    function test_DailyWindowRolls() public {
        vm.prank(owner);
        guard.setAllowance(merchant, 200e6, 250e6);
        vm.prank(agent);
        guard.pay(merchant, 200e6);
        assertEq(guard.availableToday(merchant), 50e6);

        // Advance 24h+ — the rolling window resets.
        vm.warp(block.timestamp + 86_401);
        assertEq(guard.availableToday(merchant), 250e6);
        vm.prank(agent);
        guard.pay(merchant, 200e6);
        assertEq(usdc.balanceOf(merchant), 400e6);
    }

    function test_PauseResumeRevoke() public {
        vm.startPrank(owner);
        guard.setAllowance(merchant, 100e6, 1_000e6);
        guard.pause(merchant);
        vm.stopPrank();

        vm.expectRevert(PaymentGuard.NotActive.selector);
        vm.prank(agent);
        guard.pay(merchant, 10e6);

        vm.prank(owner);
        guard.resume(merchant);
        vm.prank(agent);
        guard.pay(merchant, 10e6);
        assertEq(usdc.balanceOf(merchant), 10e6);

        vm.prank(owner);
        guard.revoke(merchant);
        vm.expectRevert(PaymentGuard.NotActive.selector);
        vm.prank(agent);
        guard.pay(merchant, 10e6);
    }

    function test_RevertsUnregisteredMerchant() public {
        vm.expectRevert(PaymentGuard.NoAllowance.selector);
        vm.prank(agent);
        guard.pay(merchant, 10e6);
    }

    function test_OnlyOwnerWithdraws() public {
        vm.expectRevert(PaymentGuard.NotOwner.selector);
        vm.prank(stranger);
        guard.withdraw(1e6);

        uint256 before = usdc.balanceOf(owner);
        vm.prank(owner);
        guard.withdraw(100_000e6);
        assertEq(usdc.balanceOf(owner), before + 100_000e6);
    }

    function test_RejectsZeroAmounts() public {
        vm.prank(owner);
        guard.setAllowance(merchant, 100e6, 1_000e6);
        vm.expectRevert(PaymentGuard.InvalidAmount.selector);
        vm.prank(agent);
        guard.pay(merchant, 0);
    }

    function testFuzz_NeverExceedsDailyCap(uint96 capDay, uint96 a, uint96 b) public {
        vm.assume(capDay > 0 && capDay <= 500_000e6);
        vm.prank(owner);
        guard.setAllowance(merchant, capDay, capDay);

        uint256 paid;
        if (a > 0 && a <= capDay) {
            vm.prank(agent);
            guard.pay(merchant, a);
            paid += a;
        }
        if (b > 0 && b <= capDay && paid + b <= capDay) {
            vm.prank(agent);
            guard.pay(merchant, b);
            paid += b;
        }
        assertLe(paid, capDay);
        assertEq(usdc.balanceOf(merchant), paid);
    }
}
