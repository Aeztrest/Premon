// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PaymentGuard} from "../src/PaymentGuard.sol";

/**
 * Deploy PaymentGuard to Monad.
 *
 *   forge script script/Deploy.s.sol \
 *     --rpc-url monad_testnet --broadcast \
 *     --private-key $PRIVATE_KEY
 *
 * Env:
 *   OWNER  - owning wallet (defaults to the broadcasting key's address)
 *   TOKEN  - ERC-20 the vault spends (e.g. Monad testnet USDC)
 */
contract Deploy is Script {
    function run() external returns (PaymentGuard guard) {
        address token = vm.envAddress("TOKEN");
        address owner = vm.envOr("OWNER", msg.sender);

        vm.startBroadcast();
        guard = new PaymentGuard(owner, token);
        vm.stopBroadcast();

        console.log("PaymentGuard deployed at:", address(guard));
        console.log("  owner:", owner);
        console.log("  token:", token);
    }
}
