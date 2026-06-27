// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal ERC-20 interface used by the vault.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title Premon PaymentGuard (Monad / EVM)
 * @notice On-chain spending-limit vault for x402 / agentic micropayments — the
 *         EVM rewrite of Premon's Soroban PaymentGuard.
 *
 * The off-chain firewall (the Premon analyzer + guard SDK) screens a tx before a
 * human signs it. This contract is the on-chain counterpart: the owner deposits
 * a token (e.g. USDC) and grants each merchant a per-transaction cap plus a
 * rolling 24-hour cap. An agent can then call {pay} to settle payments WITHOUT
 * the owner signing each one — the caps ARE the firewall. Payments above a cap,
 * to an unregistered merchant, or to a paused/revoked merchant revert on-chain.
 */
contract PaymentGuard {
    uint64 private constant DAY_SECONDS = 86_400;

    enum Status {
        Active,
        Paused,
        Revoked
    }

    struct Allowance {
        /// Largest single payment allowed to this merchant (atomic units).
        uint256 capPerTx;
        /// Cumulative spend allowed per rolling 24h window (atomic units).
        uint256 capPerDay;
        /// Spend recorded in the current rolling window.
        uint256 spentDay;
        /// Block timestamp the current rolling window started.
        uint64 dayStart;
        Status status;
        /// Distinguishes "never set" from a zero-cap allowance.
        bool exists;
    }

    address public immutable owner;
    IERC20 public immutable token;

    mapping(address => Allowance) private allowances;

    // ───── Errors (mirror the Soroban contract's error set) ─────
    error NotOwner();
    error NoAllowance();
    error NotActive();
    error ExceedsPerTx();
    error ExceedsDailyCap();
    error InvalidAmount();
    error TransferFailed();
    error Reentrancy();

    // ───── Events ─────
    event AllowanceSet(address indexed merchant, uint256 capPerTx, uint256 capPerDay);
    event StatusChanged(address indexed merchant, Status status);
    event Deposited(address indexed from, uint256 amount);
    event Paid(address indexed merchant, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    uint256 private _locked = 1;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    /// @param _owner Owning wallet (controls allowances + withdrawals).
    /// @param _token ERC-20 the vault spends in (e.g. USDC on Monad).
    constructor(address _owner, address _token) {
        require(_owner != address(0) && _token != address(0), "zero addr");
        owner = _owner;
        token = IERC20(_token);
    }

    /// @notice Grant or update a merchant's caps. Resets to Active and starts a fresh window.
    function setAllowance(address merchant, uint256 capPerTx, uint256 capPerDay) external onlyOwner {
        allowances[merchant] = Allowance({
            capPerTx: capPerTx,
            capPerDay: capPerDay,
            spentDay: 0,
            dayStart: uint64(block.timestamp),
            status: Status.Active,
            exists: true
        });
        emit AllowanceSet(merchant, capPerTx, capPerDay);
    }

    function pause(address merchant) external onlyOwner {
        _setStatus(merchant, Status.Paused);
    }

    function resume(address merchant) external onlyOwner {
        _setStatus(merchant, Status.Active);
    }

    function revoke(address merchant) external onlyOwner {
        _setStatus(merchant, Status.Revoked);
    }

    /// @notice Fund the vault. Caller must have approved this contract for `amount`.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        _safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /**
     * @notice Agentic spend. NO owner signature required — the per-tx and rolling
     *         daily caps the owner set are the firewall. Reverts if the merchant
     *         is unregistered, paused/revoked, or a cap would be breached.
     */
    function pay(address merchant, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        Allowance storage a = allowances[merchant];
        if (!a.exists) revert NoAllowance();
        if (a.status != Status.Active) revert NotActive();
        if (amount > a.capPerTx) revert ExceedsPerTx();

        // Roll the 24h window forward if it has elapsed.
        if (block.timestamp - a.dayStart >= DAY_SECONDS) {
            a.spentDay = 0;
            a.dayStart = uint64(block.timestamp);
        }
        if (a.spentDay + amount > a.capPerDay) revert ExceedsDailyCap();

        a.spentDay += amount;
        _safeTransfer(merchant, amount);
        emit Paid(merchant, amount);
    }

    /// @notice Owner pulls funds back out of the vault.
    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidAmount();
        _safeTransfer(owner, amount);
        emit Withdrawn(owner, amount);
    }

    // ───── Views ─────

    function getOwner() external view returns (address) {
        return owner;
    }

    function getToken() external view returns (address) {
        return address(token);
    }

    function getAllowance(address merchant) external view returns (Allowance memory) {
        Allowance memory a = allowances[merchant];
        if (!a.exists) revert NoAllowance();
        return a;
    }

    /// @notice Remaining spendable amount for a merchant in the current window.
    function availableToday(address merchant) external view returns (uint256) {
        Allowance memory a = allowances[merchant];
        if (!a.exists) revert NoAllowance();
        uint256 spent = (block.timestamp - a.dayStart >= DAY_SECONDS) ? 0 : a.spentDay;
        if (a.capPerDay <= spent) return 0;
        return a.capPerDay - spent;
    }

    // ───── Internals ─────

    function _setStatus(address merchant, Status status) internal {
        Allowance storage a = allowances[merchant];
        if (!a.exists) revert NoAllowance();
        a.status = status;
        emit StatusChanged(merchant, status);
    }

    function _safeTransfer(address to, uint256 amount) internal {
        bool ok = token.transfer(to, amount);
        if (!ok) revert TransferFailed();
    }

    function _safeTransferFrom(address from, address to, uint256 amount) internal {
        bool ok = token.transferFrom(from, to, amount);
        if (!ok) revert TransferFailed();
    }
}
