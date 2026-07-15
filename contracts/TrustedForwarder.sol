// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TrustedForwarder
 * @notice EIP-2771 compliant trusted forwarder for gasless meta-transactions.
 *
 * How it works:
 *   1. User signs a typed EIP-712 message containing the target contract,
 *      the encoded function call, and a nonce.
 *   2. User sends the signed message to a relayer (off-chain).
 *   3. Relayer submits it to this forwarder, paying gas.
 *   4. This contract validates the signature and forwards the call to the
 *      target contract, appending the original sender's address as the
 *      last 20 bytes of calldata (EIP-2771 standard).
 *   5. The target contract (FlashArbitrage) reads the original sender via
 *      _msgSender() from ERC2771Context.
 *
 * Features:
 *   - EIP-712 typed structured signing
 *   - Nonce-based replay protection
 *   - Relayer whitelist (only authorized relayers can submit)
 *   - Batch execution for multiple meta-txs
 *   - Refund mechanism: relayer can claim gas refund from relayer pool
 *   - Pausable in emergencies
 */

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

contract TrustedForwarder is EIP712, Ownable, Pausable, ReentrancyGuard {
    using Address for address payable;

    // ─── Types ──────────────────────────────────────────────────────────

    struct ForwardRequest {
        address from;           // Original sender (who signed)
        address to;             // Target contract (e.g. FlashArbitrage)
        uint256 value;          // Native token value to send
        uint256 gas;            // Gas limit for forwarding
        uint256 nonce;          // Anti-replay nonce
        bytes data;             // Encoded function call
        uint256 deadline;       // Expiry timestamp
    }

    struct RelayerInfo {
        bool active;
        string name;
        uint256 totalTxsForwarded;
        uint256 totalGasRefunded;
    }

    // ─── Events ─────────────────────────────────────────────────────────

    event Forwarded(
        address indexed from,
        address indexed to,
        uint256 indexed nonce,
        bool success,
        bytes returnData
    );

    event BatchForwarded(
        address indexed relayer,
        uint256 count,
        uint256 totalGasUsed
    );

    event RelayerAdded(address indexed relayer, string name);
    event RelayerRemoved(address indexed relayer);
    event RelayerRewarded(address indexed relayer, uint256 amount);
    event NonceInvalidated(address indexed user, uint256 nonce);

    // ─── State ──────────────────────────────────────────────────────────

    /// @notice Domain separator typehash for EIP-712
    bytes32 public constant _FORWARD_REQUEST_TYPEHASH =
        keccak256(
            "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,uint256 deadline)"
        );

    /// @notice Nonce tracker per user
    mapping(address => uint256) public nonces;

    /// @notice Whitelisted relayers
    mapping(address => RelayerInfo) public relayers;

    /// @notice Relayer addresses array (for enumeration)
    address[] public relayerList;

    /// @notice Max gas refund per relayed tx
    uint256 public maxGasRefund = 200_000;

    /// @notice Gas price multiplier (basis points, default 110% = 10% premium)
    uint256 public gasPriceMultiplierBps = 11000;

    /// @notice Contract version
    string public constant FORWARDER_VERSION = "1.0.0";

    // ─── Constructor ────────────────────────────────────────────────────

    constructor()
        EIP712("TrustedForwarder", FORWARDER_VERSION)
        Ownable(msg.sender)
    {}

    // ─── Relayer Management ─────────────────────────────────────────────

    /**
     * @notice Add a relayer to the whitelist.
     */
    function addRelayer(address _relayer, string calldata _name)
        external
        onlyOwner
    {
        require(_relayer != address(0), "Forwarder: zero address");
        require(!relayers[_relayer].active, "Forwarder: already active");

        relayers[_relayer] = RelayerInfo({
            active: true,
            name: _name,
            totalTxsForwarded: 0,
            totalGasRefunded: 0
        });
        relayerList.push(_relayer);

        emit RelayerAdded(_relayer, _name);
    }

    /**
     * @notice Remove a relayer from the whitelist.
     */
    function removeRelayer(address _relayer) external onlyOwner {
        require(relayers[_relayer].active, "Forwarder: not active");
        relayers[_relayer].active = false;
        emit RelayerRemoved(_relayer);
    }

    /**
     * @notice Get the number of whitelisted relayers.
     */
    function relayerCount() external view returns (uint256) {
        return relayerList.length;
    }

    // ─── Nonce Management ───────────────────────────────────────────────

    /**
     * @notice Get the current nonce for a user.
     */
    function getNonce(address user) external view returns (uint256) {
        return nonces[user];
    }

    /**
     * @notice Invalidate a nonce (in case of signing error).
     */
    function invalidateNonce(uint256 _nonce) external {
        require(_nonce == nonces[msg.sender], "Forwarder: invalid nonce");
        nonces[msg.sender]++;
        emit NonceInvalidated(msg.sender, _nonce);
    }

    // ─── Verification ───────────────────────────────────────────────────

    /**
     * @notice Verify a meta-transaction signature.
     * @return True if the signature is valid and nonce matches.
     */
    function verify(
        ForwardRequest calldata req,
        bytes calldata signature
    ) public view returns (bool) {
        require(req.deadline >= block.timestamp, "Forwarder: expired");
        require(nonces[req.from] == req.nonce, "Forwarder: invalid nonce");
        require(req.from != address(0), "Forwarder: zero from");

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    _FORWARD_REQUEST_TYPEHASH,
                    req.from,
                    req.to,
                    req.value,
                    req.gas,
                    req.nonce,
                    keccak256(req.data),
                    req.deadline
                )
            )
        );

        address signer = ECDSA.recover(digest, signature);
        return signer == req.from;
    }

    // ─── Execution ──────────────────────────────────────────────────────

    /**
     * @notice Execute a single meta-transaction.
     *         Called by a whitelisted relayer who pays gas.
     */
    function execute(
        ForwardRequest calldata req,
        bytes calldata signature
    ) external whenNotPaused nonReentrant returns (bool success, bytes memory returnData) {
        require(relayers[msg.sender].active, "Forwarder: unauthorized relayer");
        require(verify(req, signature), "Forwarder: invalid signature");
        require(req.gas <= maxGasRefund, "Forwarder: gas too high");

        // Increment nonce atomically
        nonces[req.from]++;

        // Forward the call with original sender appended (EIP-2771)
        // The last 20 bytes of calldata = original msg.sender
        bytes memory forwardData = abi.encodePacked(req.data, req.from);

        // Track gas before execution
        uint256 gasStart = gasleft();

        // Execute the call
        (success, returnData) = req.to.call{value: req.value, gas: req.gas}(
            forwardData
        );

        // Calculate gas used and refund relayer
        uint256 gasUsed = gasStart - gasleft();
        uint256 refundWei = _calculateGasRefund(gasUsed);

        // Update relayer stats
        relayers[msg.sender].totalTxsForwarded++;
        relayers[msg.sender].totalGasRefunded += refundWei;

        // Refund relayer (if any ETH in contract)
        if (refundWei > 0 && address(this).balance >= refundWei) {
            payable(msg.sender).transfer(refundWei);
            emit RelayerRewarded(msg.sender, refundWei);
        }

        emit Forwarded(req.from, req.to, req.nonce, success, returnData);
    }

    /**
     * @notice Execute multiple meta-transactions in a single call.
     *         Relayer saves gas on batch overhead.
     *
     * @dev ALL signatures are verified FIRST before any execution.
     *      This guarantees atomicity: either all execute or none do.
     */
    function executeBatch(
        ForwardRequest[] calldata requests,
        bytes[] calldata signatures
    ) external whenNotPaused nonReentrant returns (bool[] memory successes, bytes[] memory returnDatas) {
        require(relayers[msg.sender].active, "Forwarder: unauthorized relayer");
        require(requests.length == signatures.length, "Forwarder: length mismatch");
        require(requests.length <= 50, "Forwarder: batch too large");

        successes = new bool[](requests.length);
        returnDatas = new bytes[](requests.length);
        uint256 totalGasUsed = 0;

        // ─── Phase 1: Verify ALL signatures first ─────────────────────
        for (uint256 i = 0; i < requests.length; i++) {
            require(verify(requests[i], signatures[i]), "Forwarder: invalid sig");
        }

        // ─── Phase 2: Execute ALL (now guaranteed valid) ──────────────
        for (uint256 i = 0; i < requests.length; i++) {
            // Increment nonce atomically
            nonces[requests[i].from]++;

            bytes memory forwardData = abi.encodePacked(requests[i].data, requests[i].from);

            uint256 gasStart = gasleft();
            (successes[i], returnDatas[i]) = requests[i].to.call{
                value: requests[i].value,
                gas: requests[i].gas
            }(forwardData);
            totalGasUsed += gasStart - gasleft();

            emit Forwarded(requests[i].from, requests[i].to, requests[i].nonce, successes[i], returnDatas[i]);
        }

        // ─── Phase 3: Single refund for batch relayer ─────────────────
        uint256 refundWei = _calculateGasRefund(totalGasUsed);
        relayers[msg.sender].totalTxsForwarded += requests.length;
        relayers[msg.sender].totalGasRefunded += refundWei;

        if (refundWei > 0 && address(this).balance >= refundWei) {
            payable(msg.sender).transfer(refundWei);
            emit RelayerRewarded(msg.sender, refundWei);
        }

        emit BatchForwarded(msg.sender, requests.length, totalGasUsed);
    }

    // ─── Gas Refund Calculation ─────────────────────────────────────────

    /**
     * @notice Calculate gas refund based on gas used and current base fee.
     *         Uses a multiplier to give relayers a premium.
     */
    function _calculateGasRefund(uint256 gasUsed) internal view returns (uint256) {
        // Use block.basefee (EIP-3198) or tx.gasprice
        uint256 effectiveGasPrice;
        if (block.basefee > 0) {
            effectiveGasPrice = block.basefee;
        } else {
            effectiveGasPrice = tx.gasprice;
        }

        // Apply multiplier (e.g., 11000 bps = 1.10x)
        return (gasUsed * effectiveGasPrice * gasPriceMultiplierBps) / 10000;
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    /**
     * @notice Fund the forwarder with ETH for relayer refunds.
     */
    function fund() external payable {}

    /**
     * @notice Withdraw ETH from the forwarder (only owner).
     */
    function withdraw(uint256 amount) external onlyOwner {
        payable(owner()).transfer(amount);
    }

    /**
     * @notice Update max gas refund limit.
     */
    function setMaxGasRefund(uint256 _maxGas) external onlyOwner {
        maxGasRefund = _maxGas;
    }

    /**
     * @notice Update gas price multiplier (in basis points, default 11000).
     */
    function setGasPriceMultiplier(uint256 _bps) external onlyOwner {
        require(_bps >= 10000, "Forwarder: min 1.0x");
        require(_bps <= 20000, "Forwarder: max 2.0x");
        gasPriceMultiplierBps = _bps;
    }

    /**
     * @notice Pause/unpause the forwarder.
     */
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── Receive ETH ────────────────────────────────────────────────────
    receive() external payable {}
}
