# Premon PaymentGuard (Monad / EVM)

On-chain spending-limit vault for x402 / agentic micropayments — the **Solidity
rewrite** of Premon's Soroban `payment-guard` contract.

The off-chain firewall (Premon analyzer + `@premon/guard`) screens a tx
before a human signs it. This contract is the on-chain counterpart: the owner
deposits a token (e.g. USDC), grants each merchant a per-transaction cap plus a
rolling 24-hour cap, and an agent calls `pay()` to settle micropayments **without
the owner signing each one** — the caps ARE the firewall.

## Mapping from the Soroban original

| Soroban (Rust)                  | Solidity                              |
| ------------------------------- | ------------------------------------- |
| `init(owner, token)`            | `constructor(owner, token)`           |
| `i128` amounts                  | `uint256`                             |
| `Address` (`C…`/`G…`)           | `address` (0x)                        |
| `token::TokenClient.transfer`   | `IERC20.transfer` / `transferFrom`    |
| `from.require_auth()`           | `msg.sender` + `onlyOwner`            |
| `env.ledger().timestamp()`      | `block.timestamp`                     |
| `panic_with_error!(Error::X)`   | `revert X()` (custom errors)          |
| `env.events().publish(...)`     | `emit Event(...)`                     |
| persistent storage `DataKey`    | `mapping(address => Allowance)`       |

`deposit` uses `transferFrom` (caller must `approve` first), matching the EVM
pull pattern; `pay`/`withdraw` use `transfer` from the vault.

## Develop

```bash
forge build
forge test -vv          # 11 tests incl. a fuzz invariant
forge fmt
```

## Deploy (Monad testnet, chainId 10143)

```bash
export TOKEN=0x...            # Monad testnet USDC
export PRIVATE_KEY=0x...
forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --private-key $PRIVATE_KEY
```
