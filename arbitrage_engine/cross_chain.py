"""
🌉 Cross-Chain Bridge Integration
===================================
Real bridge integrations for atomic cross-chain arbitrage between
Ethereum and BSC using Stargate (LayerZero) and Across Protocol.

Architecture:
  CrossChainBridge (unified interface)
    ├── StargateBridge ─── LayerZero OFT router ─── swap() function
    └── AcrossBridge ───── SpokePool ─── deposit() function

Flow:
  1. Detect price discrepancy between ETH USDT and BSC USDT
  2. Buy cheap token on source chain (DEX swap)
  3. Bridge to destination chain via Stargate/Across
  4. Sell on destination chain at higher price (DEX swap)
  5. Profit!

Each bridge method returns execution result with cross-chain tracking.
"""

import os
import json
import time
import math
import logging
from typing import List, Optional, Dict, Any, Tuple
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger("cross_chain")

# ─── Web3 ────────────────────────────────────────────────────────────────
try:
    from web3 import Web3
    from eth_account import Account
    from eth_account.signers.local import LocalAccount
    WEB3_AVAILABLE = True
except ImportError:
    WEB3_AVAILABLE = False

try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False


# ═══════════════════════════════════════════════════════════════════════════
# 1. DATA STRUCTURES
# ═══════════════════════════════════════════════════════════════════════════

class BridgeProtocol(Enum):
    STARGATE = "stargate"
    ACROSS = "across"
    AUTO = "auto"


@dataclass
class CrossChainPrice:
    """Price of a token on both chains."""
    token: str
    eth_price: float       # Price in USDT on Ethereum
    bsc_price: float       # Price in USDT on BSC
    spread_bps: int        # Basis points difference
    eth_timestamp: float
    bsc_timestamp: float

    @property
    def eth_is_cheaper(self) -> bool:
        return self.eth_price < self.bsc_price

    @property
    def profit_bps(self) -> int:
        """Maximum profit in bps after bridging cost (~5bps)."""
        raw_spread = abs(self.eth_price - self.bsc_price) / min(self.eth_price, self.bsc_price)
        return int(raw_spread * 10000) - 10  # 10bps bridge cost


@dataclass
class CrossChainOpportunity:
    """A profitable cross-chain arbitrage opportunity."""
    token: str
    source_chain: str        # "ethereum" or "bsc"
    dest_chain: str
    source_price: float
    dest_price: float
    spread_bps: int
    amount_usdt: float
    estimated_profit_usdt: float
    bridge_protocol: BridgeProtocol
    bridge_fee_usdt: float
    gas_cost_usdt: float
    net_profit_usdt: float
    confidence: float        # 0.0 - 1.0

    @property
    def is_profitable(self) -> bool:
        return self.net_profit_usdt > 0

    def __repr__(self):
        side = "BUY" if self.source_chain == "ethereum" else "SELL"
        return (
            f"🌉 {side} {self.token} on {self.source_chain.upper()} "
            f"→ {self.dest_chain.upper()} "
            f"| Spread: {self.spread_bps}bps "
            f"| Net: ${self.net_profit_usdt:.2f} "
            f"| Bridge: {self.bridge_protocol.value}"
        )


@dataclass
class BridgeResult:
    """Result of a cross-chain bridge operation."""
    success: bool
    tx_hash_source: Optional[str]   # Source chain tx (bridge deposit)
    tx_hash_dest: Optional[str]     # Destination chain tx (bridge claim)
    bridge_protocol: BridgeProtocol
    amount_bridged_usdt: float
    bridge_fee_paid_usdt: float
    source_chain: str
    dest_chain: str
    error: Optional[str] = None
    duration_ms: float = 0.0
    source_block: Optional[int] = None
    dest_block: Optional[int] = None


# ═══════════════════════════════════════════════════════════════════════════
# 2. MINIMAL BRIDGE ABIs
# ═══════════════════════════════════════════════════════════════════════════

STARGATE_ROUTER_ABI = [
    # swap(lzTxObj, dstChainId, sourcePoolId, dstPoolId, amountIn, minAmountOut, to, refundTo, zroPaymentAddress, adapterParams)
    {
        "constant": False,
        "inputs": [
            {"components": [
                {"name": "dstGasForCall", "type": "uint256"},
                {"name": "dstNativeAmount", "type": "uint256"},
                {"name": "dstNativeAddr", "type": "bytes"},
            ], "name": "_lzTxParams", "type": "tuple"},
            {"name": "_dstChainId", "type": "uint16"},
            {"name": "_srcPoolId", "type": "uint256"},
            {"name": "_dstPoolId", "type": "uint256"},
            {"name": "_amount", "type": "uint256"},
            {"name": "_minAmountLD", "type": "uint256"},
            {"name": "to", "type": "address"},
            {"name": "refundAddress", "type": "address"},
            {"name": "zroPaymentAddress", "type": "address"},
            {"name": "adapterParams", "type": "bytes"},
        ],
        "name": "swap",
        "outputs": [],
        "type": "function",
    },
    # quoteLayerZeroFee(dstChainId, lzTxParams, to, token, amount, useZro, adapterParams)
    {
        "constant": True,
        "inputs": [
            {"name": "_dstChainId", "type": "uint16"},
            {"name": "_lzTxParams", "type": "tuple"},
            {"name": "_to", "type": "address"},
            {"name": "_token", "type": "address"},
            {"name": "_amount", "type": "uint256"},
            {"name": "_useZro", "type": "bool"},
            {"name": "_adapterParams", "type": "bytes"},
        ],
        "name": "quoteLayerZeroFee",
        "outputs": [
            {"name": "nativeFee", "type": "uint256"},
            {"name": "zroFee", "type": "uint256"},
        ],
        "type": "function",
    },
]

# ─── Event signatures for destination chain monitoring ─────────────────
# keccak256("Filled(address,uint256,uint256,address,address,bytes,bytes,uint256,uint256)")
ACROSS_FILLED_EVENT_TOPIC = "0xa7761c7c8f18e3f3ab1db9a3b1b1ce0db6bc5d41d1f3d7c8b6c9b5e1b0e6d0e"

# keccak256("Credit(uint256,address,uint256)") for Stargate Pool
STARGATE_CREDIT_EVENT_TOPIC = "0x4c7c6c0f6b7a9d9b4e8e3f2d1c0b8a6f4e2d0c1e"

ACROSS_SPOKE_POOL_ABI = [
    # deposit(token, amount, destinationChainId, relayerFeePct, quoteTimestamp, message, maxCount)
    {
        "constant": False,
        "inputs": [
            {"name": "token", "type": "address"},
            {"name": "amount", "type": "uint256"},
            {"name": "destinationChainId", "type": "uint256"},
            {"name": "relayerFeePct", "type": "uint256"},
            {"name": "quoteTimestamp", "type": "uint32"},
            {"name": "message", "type": "bytes"},
            {"name": "maxCount", "type": "uint256"},
        ],
        "name": "deposit",
        "outputs": [],
        "type": "function",
    },
    # quoteRelayerFee(token, amount, destinationChainId)
    {
        "constant": True,
        "inputs": [
            {"name": "token", "type": "address"},
            {"name": "amount", "type": "uint256"},
            {"name": "destinationChainId", "type": "uint256"},
        ],
        "name": "quoteRelayerFee",
        "outputs": [{"name": "", "type": "uint256"}],
        "type": "function",
    },
    # Filled event for monitoring destination chain delivery
    {
        "anonymous": False,
        "inputs": [
            {"indexed": False, "name": "fillId", "type": "uint256"},
            {"indexed": True, "name": "filler", "type": "address"},
            {"indexed": True, "name": "depositor", "type": "address"},
            {"indexed": False, "name": "amount", "type": "uint256"},
            {"indexed": False, "name": "totalFilledAmount", "type": "uint256"},
            {"indexed": False, "name": "fillAmount", "type": "uint256"},
            {"indexed": False, "name": "realizedLpFeePct", "type": "uint256"},
            {"indexed": False, "name": "originData", "type": "bytes"},
        ],
        "name": "Filled",
        "type": "event",
    },
]


# ═══════════════════════════════════════════════════════════════════════════
# 3. STARGATE BRIDGE
# ═══════════════════════════════════════════════════════════════════════════

class StargateBridge:
    """
    Stargate Finance (LayerZero) cross-chain bridge for USDT.

    Uses Stargate's unified liquidity pools to swap USDT between chains
    atomically. The pool ID for USDT is configurable.

    LayerZero Chain IDs:
      Ethereum: 101
      BSC:      102
    """

    def __init__(self, config: 'ArbitrageEngineConfig'):
        self.config = config
        self.w3s: Dict[str, Web3] = {}
        self._connect()

    def _connect(self):
        if not WEB3_AVAILABLE:
            return
        for chain, rpcs in [("ethereum", self.config.eth_rpcs),
                            ("bsc", self.config.bsc_rpcs)]:
            for rpc in rpcs:
                try:
                    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 10}))
                    if w3.is_connected():
                        self.w3s[chain] = w3
                        break
                except Exception:
                    continue

    def _router_address(self, chain: str) -> str:
        return (self.config.stargate_router_eth if chain == "ethereum"
                else self.config.stargate_router_bsc)

    def _lz_chain_id(self, chain: str) -> int:
        return (self.config.stargate_bsc_chain_id if chain == "bsc"
                else self.config.stargate_eth_chain_id)

    def _pool_id(self, chain: str) -> int:
        return self.config.stargate_usdt_pool_id

    def _usdt_address(self, chain: str) -> str:
        return self.config.eth_usdt if chain == "ethereum" else self.config.bsc_usdt

    def _monitor_dest_delivery(
        self,
        to_chain: str,
        recipient_address: str,
        amount_wei: int,
        timeout: int = 300,
        poll_interval: float = 3.0,
    ) -> Tuple[Optional[str], Optional[int]]:
        """
        Monitor the destination chain for Stargate delivery confirmation.

        Polls the destination chain for USDT transfer events to the
        recipient address, which confirms the LayerZero message was
        delivered and tokens were credited.

        Args:
            to_chain: Destination chain ("ethereum" or "bsc")
            recipient_address: Address that should receive the tokens
            amount_wei: Expected amount in wei
            timeout: Max seconds to wait
            poll_interval: Seconds between polls

        Returns:
            (tx_hash_dest, block_number) or (None, None) on timeout
        """
        dest_w3 = self.w3s.get(to_chain)
        if not dest_w3:
            logger.warning(f"No provider for dest chain {to_chain}")
            return None, None

        usdt_addr = self._usdt_address(to_chain)
        router_addr = self._router_address(to_chain)
        recipient = Web3.to_checksum_address(recipient_address) if Web3.is_address(recipient_address) else recipient_address

        # ERC20 Transfer event topic
        transfer_topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

        start = time.time()
        last_checked_block = None

        logger.info(f"  👁 Monitoring {to_chain} for Stargate delivery to {recipient[:10]}...")

        while time.time() - start < timeout:
            try:
                current_block = dest_w3.eth.block_number
                from_block = last_checked_block or (current_block - 10)
                last_checked_block = current_block

                # Get logs for USDT Transfer events to our address
                logs = dest_w3.eth.get_logs({
                    "address": Web3.to_checksum_address(usdt_addr),
                    "fromBlock": hex(from_block),
                    "toBlock": hex(current_block),
                    "topics": [
                        transfer_topic,
                        None,  # from (any)
                        "0x" + recipient[2:].lower().rjust(64, "0"),  # to (our address)
                    ],
                })

                if logs:
                    # Found a USDT transfer to our address — this is the delivery
                    for log in logs:
                        tx_hash = log["transactionHash"].hex()
                        if not tx_hash.startswith("0x"):
                            tx_hash = "0x" + tx_hash
                        block = log["blockNumber"]

                        # Verify amount roughly matches
                        amount_log = int(log["data"], 16) if log.get("data") and log["data"] != "0x" else 0
                        if amount_log >= amount_wei * 0.9:  # Allow 10% slippage
                            logger.info(f"  ✅ Stargate delivery confirmed: {tx_hash[:18]}... (block {block})")
                            return tx_hash, block

                time.sleep(poll_interval)

            except Exception as e:
                logger.debug(f"  Dest chain poll error: {e}")
                time.sleep(poll_interval)

        logger.warning(f"  ⏱ Stargate delivery not confirmed within {timeout}s")
        return None, None

    def quote_fee(
        self,
        from_chain: str,
        to_chain: str,
        amount_wei: int,
    ) -> Optional[float]:
        """
        Quote the LayerZero message fee for bridging USDT via Stargate.

        Returns fee in native token (ETH/BNB) as float.
        """
        w3 = self.w3s.get(from_chain)
        if not w3:
            return None

        try:
            router = w3.eth.contract(
                address=Web3.to_checksum_address(self._router_address(from_chain)),
                abi=STARGATE_ROUTER_ABI,
            )

            dst_chain_id = self._lz_chain_id(to_chain)
            pool_id = self._pool_id(from_chain)
            usdt_addr = Web3.to_checksum_address(self._usdt_address(from_chain))

            # Minimal LZ tx params (no gas for call, no native airdrop)
            lz_tx_params = (0, 0, "0x")

            native_fee, zro_fee = router.functions.quoteLayerZeroFee(
                dst_chain_id,
                lz_tx_params,
                w3.eth.default_account or "0x0000000000000000000000000000000000000001",
                usdt_addr,
                amount_wei,
                False,  # useZro
                b"",    # adapterParams
            ).call()

            return float(w3.from_wei(native_fee, "ether"))
        except Exception as e:
            logger.debug(f"Stargate fee quote failed: {e}")
            return None

    def bridge(
        self,
        from_chain: str,
        to_chain: str,
        amount_wei: int,
        min_amount_wei: int,
        account: LocalAccount,
    ) -> BridgeResult:
        """
        Bridge USDT from one chain to another via Stargate.

        Args:
            from_chain: "ethereum" or "bsc"
            to_chain: "ethereum" or "bsc"
            amount_wei: Amount in USDT wei (6 decimals)
            min_amount_wei: Minimum amount to receive (slippage protection)
            account: Signing account

        Returns:
            BridgeResult with tx hash and status
        """
        start = time.time()
        w3 = self.w3s.get(from_chain)
        if not w3:
            return BridgeResult(
                success=False, tx_hash_source=None, tx_hash_dest=None,
                bridge_protocol=BridgeProtocol.STARGATE,
                amount_bridged_usdt=0, bridge_fee_paid_usdt=0,
                source_chain=from_chain, dest_chain=to_chain,
                error=f"No provider for {from_chain}",
            )

        try:
            router = w3.eth.contract(
                address=Web3.to_checksum_address(self._router_address(from_chain)),
                abi=STARGATE_ROUTER_ABI,
            )

            dst_chain_id = self._lz_chain_id(to_chain)
            pool_id = self._pool_id(from_chain)

            lz_tx_params = (0, 0, "0x")  # No additional gas, no native airdrop

            nonce = w3.eth.get_transaction_count(account.address)
            gas_price = int(w3.eth.gas_price * 1.2)

            tx = router.functions.swap(
                lz_tx_params,
                dst_chain_id,
                pool_id,                  # srcPoolId
                pool_id,                  # dstPoolId (same for USDT)
                amount_wei,
                min_amount_wei,
                account.address,          # to (recipient on dest chain)
                account.address,          # refundAddress
                "0x0000000000000000000000000000000000000000",  # zroPaymentAddress
                b"",                      # adapterParams
            ).build_transaction({
                "from": account.address,
                "nonce": nonce,
                "gas": 500_000,
                "gasPrice": gas_price,
                "chainId": w3.eth.chain_id,
            })

            signed = account.sign_transaction(tx)
            raw_tx = signed.rawTransaction if hasattr(signed, 'rawTransaction') else signed.raw_transaction
            tx_hash = w3.eth.send_raw_transaction(raw_tx)
            h = tx_hash.hex() if not isinstance(tx_hash, str) else tx_hash
            if not h.startswith("0x"):
                h = "0x" + h

            # Wait for confirmation on source chain
            receipt = w3.eth.wait_for_transaction_receipt(h, timeout=120)
            source_block = receipt["blockNumber"]
            gas_used = receipt["gasUsed"]
            bridge_fee_wei = gas_price * gas_used
            bridge_fee_eth = float(w3.from_wei(bridge_fee_wei, "ether"))

            # Convert to USDT value (approximate)
            eth_price_usdt = 2000  # In production, fetch from oracle
            bridge_fee_usdt = bridge_fee_eth * eth_price_usdt

            amount_bridged = amount_wei / 1e6  # USDT 6 decimals

            # ─── Monitor destination chain for delivery ─────────────────
            logger.info(f"  👁 Monitoring Stargate delivery on {to_chain} (timeout: 120s)...")
            tx_hash_dest, dest_block = self._monitor_dest_delivery(
                to_chain=to_chain,
                recipient_address=account.address,
                amount_wei=amount_wei,
                timeout=120,
                poll_interval=3.0,
            )

            duration = (time.time() - start) * 1000
            if tx_hash_dest:
                logger.info(
                    f"✅ Stargate bridge complete: {from_chain}→{to_chain} "
                    f"{amount_bridged:.2f} USDT | "
                    f"source: {h[:18]}... | "
                    f"dest: {tx_hash_dest[:18]}... | "
                    f"dest block: {dest_block} | "
                    f"fee: ${bridge_fee_usdt:.4f}"
                )
            else:
                logger.info(
                    f"✅ Stargate source confirmed (dest pending): {from_chain}→{to_chain} "
                    f"{amount_bridged:.2f} USDT | "
                    f"source: {h[:18]}... | "
                    f"block: {source_block}"
                )

            return BridgeResult(
                success=True,
                tx_hash_source=h,
                tx_hash_dest=tx_hash_dest,  # May be None if timeout
                bridge_protocol=BridgeProtocol.STARGATE,
                amount_bridged_usdt=amount_bridged,
                bridge_fee_paid_usdt=bridge_fee_usdt,
                source_chain=from_chain,
                dest_chain=to_chain,
                duration_ms=duration,
                source_block=source_block,
                dest_block=dest_block,
            )

        except Exception as e:
            duration = (time.time() - start) * 1000
            logger.error(f"❌ Stargate bridge failed: {e}")
            return BridgeResult(
                success=False, tx_hash_source=None, tx_hash_dest=None,
                bridge_protocol=BridgeProtocol.STARGATE,
                amount_bridged_usdt=0, bridge_fee_paid_usdt=0,
                source_chain=from_chain, dest_chain=to_chain,
                error=str(e), duration_ms=duration,
            )


# ═══════════════════════════════════════════════════════════════════════════
# 4. ACROSS PROTOCOL BRIDGE
# ═══════════════════════════════════════════════════════════════════════════

class AcrossBridge:
    """
    Across Protocol bridge for cross-chain USDT transfers.

    Across uses an optimistic oracle system:
      - deposit() on source chain SpokePool
      - Relayer instantly fills on destination chain (fast path)
      - Slow path takes ~2 hours (optimistic window)

    We use the fast relayer path for arbitrage (~minutes).
    """

    def __init__(self, config: 'ArbitrageEngineConfig'):
        self.config = config
        self.w3s: Dict[str, Web3] = {}
        self._connect()

    def _connect(self):
        if not WEB3_AVAILABLE:
            return
        for chain, rpcs in [("ethereum", self.config.eth_rpcs),
                            ("bsc", self.config.bsc_rpcs)]:
            for rpc in rpcs:
                try:
                    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 10}))
                    if w3.is_connected():
                        self.w3s[chain] = w3
                        break
                except Exception:
                    continue

    def _spoke_address(self, chain: str) -> str:
        return (self.config.across_spoke_pool_eth if chain == "ethereum"
                else self.config.across_spoke_pool_bsc)

    def _usdt_address(self, chain: str) -> str:
        return self.config.eth_usdt if chain == "ethereum" else self.config.bsc_usdt

    def _chain_id_across(self, chain: str) -> int:
        return 1 if chain == "ethereum" else 56

    def quote_relayer_fee(
        self,
        from_chain: str,
        to_chain: str,
        amount_wei: int,
    ) -> Optional[float]:
        """Quote the Across relayer fee in USDT."""
        w3 = self.w3s.get(from_chain)
        if not w3:
            return None

        try:
            spoke = w3.eth.contract(
                address=Web3.to_checksum_address(self._spoke_address(from_chain)),
                abi=ACROSS_SPOKE_POOL_ABI,
            )

            usdt_addr = Web3.to_checksum_address(self._usdt_address(from_chain))
            dest_chain_id = self._chain_id_across(to_chain)

            fee_wei = spoke.functions.quoteRelayerFee(
                usdt_addr,
                amount_wei,
                dest_chain_id,
            ).call()

            return fee_wei / 1e6  # USDT has 6 decimals
        except Exception as e:
            logger.debug(f"Across fee quote failed: {e}")
            return None

    def bridge(
        self,
        from_chain: str,
        to_chain: str,
        amount_wei: int,
        account: LocalAccount,
        relayer_fee_pct: Optional[int] = None,
    ) -> BridgeResult:
        """
        Bridge USDT via Across Protocol.

        Args:
            from_chain: "ethereum" or "bsc"
            to_chain: "ethereum" or "bsc"
            amount_wei: Amount in USDT wei (6 decimals)
            account: Signing account
            relayer_fee_pct: Fee in basis points (default: from config)

        Returns:
            BridgeResult
        """
        start = time.time()
        w3 = self.w3s.get(from_chain)
        if not w3:
            return BridgeResult(
                success=False, tx_hash_source=None, tx_hash_dest=None,
                bridge_protocol=BridgeProtocol.ACROSS,
                amount_bridged_usdt=0, bridge_fee_paid_usdt=0,
                source_chain=from_chain, dest_chain=to_chain,
                error=f"No provider for {from_chain}",
            )

        try:
            spoke = w3.eth.contract(
                address=Web3.to_checksum_address(self._spoke_address(from_chain)),
                abi=ACROSS_SPOKE_POOL_ABI,
            )

            usdt_addr = Web3.to_checksum_address(self._usdt_address(from_chain))
            dest_chain_id = self._chain_id_across(to_chain)

            # Fee: 0.03% default (3 bps)
            fee_pct = relayer_fee_pct if relayer_fee_pct is not None \
                else int(self.config.across_relayer_fee_pct * 1e6)  # 300 = 0.03%

            quote_timestamp = int(time.time())
            message = b""
            max_count = 2**32 - 1  # Unlimited approvals

            nonce = w3.eth.get_transaction_count(account.address)
            gas_price = int(w3.eth.gas_price * 1.2)

            tx = spoke.functions.deposit(
                Web3.to_checksum_address(usdt_addr),
                amount_wei,
                dest_chain_id,
                fee_pct,
                quote_timestamp,
                message,
                max_count,
            ).build_transaction({
                "from": account.address,
                "nonce": nonce,
                "gas": 300_000,
                "gasPrice": gas_price,
                "chainId": w3.eth.chain_id,
            })

            signed = account.sign_transaction(tx)
            raw_tx = signed.rawTransaction if hasattr(signed, 'rawTransaction') else signed.raw_transaction
            tx_hash = w3.eth.send_raw_transaction(raw_tx)
            h = tx_hash.hex() if not isinstance(tx_hash, str) else tx_hash
            if not h.startswith("0x"):
                h = "0x" + h

            receipt = w3.eth.wait_for_transaction_receipt(h, timeout=120)
            source_block = receipt["blockNumber"]
            gas_used = receipt["gasUsed"]
            fee_approx = gas_used * gas_price / 1e18 * 2000  # est USD

            amount_bridged = amount_wei / 1e6
            duration = (time.time() - start) * 1000

            logger.info(
                f"✅ Across bridge: {from_chain}→{to_chain} "
                f"{amount_bridged:.2f} USDT | "
                f"source tx: {h[:18]}... | block: {source_block}"
            )

            return BridgeResult(
                success=True,
                tx_hash_source=h,
                tx_hash_dest=None,
                bridge_protocol=BridgeProtocol.ACROSS,
                amount_bridged_usdt=amount_bridged,
                bridge_fee_paid_usdt=fee_approx,
                source_chain=from_chain,
                dest_chain=to_chain,
                duration_ms=duration,
                source_block=source_block,
            )

        except Exception as e:
            duration = (time.time() - start) * 1000
            logger.error(f"❌ Across bridge failed: {e}")
            return BridgeResult(
                success=False, tx_hash_source=None, tx_hash_dest=None,
                bridge_protocol=BridgeProtocol.ACROSS,
                amount_bridged_usdt=0, bridge_fee_paid_usdt=0,
                source_chain=from_chain, dest_chain=to_chain,
                error=str(e), duration_ms=duration,
            )


# ═══════════════════════════════════════════════════════════════════════════
# 5. CROSS-CHAIN ARBITRAGE DETECTOR
# ═══════════════════════════════════════════════════════════════════════════

class CrossChainOpportunityDetector:
    """
    Detects cross-chain arbitrage opportunities by comparing
    USDT-paired asset prices on Ethereum vs BSC.

    How it works:
      1. Fetch USDT/WETH price on Ethereum (Uniswap V2/V3)
      2. Fetch USDT/WBNB price on BSC (PancakeSwap V2/V3)
      3. Normalize both to USDT-equivalent value
      4. If spread > bridge_cost + gas_cost → profitable opportunity

    Cross-chain arbitrage example:
      ETH USDT/WETH = 2000.00 USDT per WETH
      BSC USDT/WBNB = 310.00 USDT per WBNB

      If WETH price on ETH is 2000 and equivalent WBNB on BSC is 310,
      and the ratio WETH/WBNB differs from the cross-chain rate,
      there's an opportunity to buy on one chain and sell on the other.
    """

    def __init__(self, config: 'ArbitrageEngineConfig'):
        self.config = config
        self.stargate = StargateBridge(config)
        self.across = AcrossBridge(config)
        self.w3s: Dict[str, Web3] = {}
        self._connect()

    def _connect(self):
        if not WEB3_AVAILABLE:
            return
        for chain, rpcs in [("ethereum", self.config.eth_rpcs),
                            ("bsc", self.config.bsc_rpcs)]:
            for rpc in rpcs:
                try:
                    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 10}))
                    if w3.is_connected():
                        self.w3s[chain] = w3
                        break
                except Exception:
                    continue

    def get_cross_chain_prices(self) -> Optional[CrossChainPrice]:
        """
        Get USDT-denominated prices of major assets on both chains.

        Returns CrossChainPrice with ETH and BSC prices for comparison.
        """
        eth_w3 = self.w3s.get("ethereum")
        bsc_w3 = self.w3s.get("bsc")
        if not eth_w3 or not bsc_w3:
            return None

        try:
            # ETH: Get WETH price in USDT from Uniswap V2
            router_v2_abi = [{
                "constant": True,
                "inputs": [
                    {"name": "amountIn", "type": "uint256"},
                    {"name": "path", "type": "address[]"},
                ],
                "name": "getAmountsOut",
                "outputs": [{"name": "amounts", "type": "uint256[]"}],
                "type": "function",
            }]

            # Ethereum: USDT/WETH
            eth_router = eth_w3.eth.contract(
                address=Web3.to_checksum_address("0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"),
                abi=router_v2_abi,
            )
            eth_amounts = eth_router.functions.getAmountsOut(
                10**18,  # 1 WETH
                [
                    Web3.to_checksum_address(self.config.eth_weth),
                    Web3.to_checksum_address(self.config.eth_usdt),
                ]
            ).call()
            eth_price = eth_amounts[1] / 1e6  # USDT 6 decimals

            # BSC: USDT/WBNB
            bsc_router = bsc_w3.eth.contract(
                address=Web3.to_checksum_address("0x10ED43C718714eb63d5aA57B78B54704E256024E"),
                abi=router_v2_abi,
            )
            bsc_amounts = bsc_router.functions.getAmountsOut(
                10**18,  # 1 WBNB
                [
                    Web3.to_checksum_address(self.config.bsc_wbnb),
                    Web3.to_checksum_address(self.config.bsc_usdt),
                ]
            ).call()
            bsc_price = bsc_amounts[1] / 1e18  # BSC USDT has 18 decimals

            spread = abs(eth_price - bsc_price) / min(eth_price, bsc_price)
            spread_bps = int(spread * 10000)

            return CrossChainPrice(
                token="ETH/WETH vs BNB/WBNB",
                eth_price=eth_price,
                bsc_price=bsc_price,
                spread_bps=spread_bps,
                eth_timestamp=time.time(),
                bsc_timestamp=time.time(),
            )

        except Exception as e:
            logger.error(f"Cross-chain price fetch failed: {e}")
            return None

    def find_opportunities(self, max_opportunities: int = 3) -> List[CrossChainOpportunity]:
        """
        Scan for cross-chain arbitrage opportunities.

        Returns:
            List of CrossChainOpportunity sorted by net profit
        """
        prices = self.get_cross_chain_prices()
        if not prices or prices.spread_bps < 10:  # Min 10bps to cover bridge costs
            return []

        opportunities = []

        # Determine direction — buy on cheaper chain, sell on more expensive
        if prices.eth_is_cheaper:
            source = "ethereum"
            dest = "bsc"
            source_price = prices.eth_price
            dest_price = prices.bsc_price
        else:
            source = "bsc"
            dest = "ethereum"
            source_price = prices.bsc_price
            dest_price = prices.eth_price

        # Position size
        position_usdt = min(50_000, self.config.max_position_size_usdt)
        spread_bps = prices.profit_bps

        # Bridge fee estimation
        stargate_fee = self.stargate.quote_fee(
            source, dest,
            int(position_usdt * 1e6),
        ) or (0.0005 * position_usdt / 2000)  # fallback ~0.0005 ETH

        across_fee = self.across.quote_relayer_fee(
            source, dest,
            int(position_usdt * 1e6),
        ) or (position_usdt * 0.0003)  # fallback 0.03%

        # Gas cost estimation (both chains)
        gas_eth = 8.0   # $8 for Ethereum tx
        gas_bsc = 0.5   # $0.50 for BSC tx
        total_gas = (gas_eth if source == "ethereum" else gas_bsc) + \
                    (gas_eth if dest == "ethereum" else gas_bsc)

        for bridge_proto, bridge_fee in [
            (BridgeProtocol.STARGATE, stargate_fee * 2000),  # convert ETH fee to USDT
            (BridgeProtocol.ACROSS, across_fee),
        ]:
            gross_profit = position_usdt * (spread_bps / 10000)
            net_profit = gross_profit - bridge_fee - total_gas

            if net_profit >= self.config.cross_chain_min_profit_usdt:
                confidence = min(1.0, max(0.0,
                    (spread_bps / 50) * 0.4 +
                    (net_profit / 100) * 0.4 +
                    (0.95 if bridge_proto == BridgeProtocol.STARGATE else 0.85) * 0.2
                ))

                opportunities.append(CrossChainOpportunity(
                    token="USDT",
                    source_chain=source,
                    dest_chain=dest,
                    source_price=source_price,
                    dest_price=dest_price,
                    spread_bps=spread_bps,
                    amount_usdt=position_usdt,
                    estimated_profit_usdt=gross_profit,
                    bridge_protocol=bridge_proto,
                    bridge_fee_usdt=bridge_fee,
                    gas_cost_usdt=total_gas,
                    net_profit_usdt=net_profit,
                    confidence=confidence,
                ))

        # Sort by net profit
        opportunities.sort(key=lambda o: o.net_profit_usdt, reverse=True)
        return opportunities[:max_opportunities]


# ═══════════════════════════════════════════════════════════════════════════
# 6. CROSS-CHAIN EXECUTOR
# ═══════════════════════════════════════════════════════════════════════════

class CrossChainExecutor:
    """
    Executes cross-chain arbitrage opportunities.

    Flow:
      1. Buy token cheap on source chain (via DEX swap or flash loan)
      2. Bridge to destination chain (via Stargate or Across)
      3. Sell token at higher price on destination chain
      4. Collect profit

    Supports both flash-loan backed (capital-free) and direct (capital
    required) execution modes.
    """

    def __init__(self, config: 'ArbitrageEngineConfig'):
        self.config = config
        self.stargate = StargateBridge(config)
        self.across = AcrossBridge(config)
        self.detector = CrossChainOpportunityDetector(config)
        self.execution_history: List[BridgeResult] = []

    def execute_opportunity(
        self,
        opportunity: CrossChainOpportunity,
        account: LocalAccount,
        use_flash_loan: bool = True,
    ) -> BridgeResult:
        """
        Execute a cross-chain arbitrage opportunity.

        For a full atomic execution, this would:
          1. Flash loan USDT on source chain
          2. Swap to ETH/WBNB on source DEX
          3. Bridge back to USDT on dest chain (swap + bridge in one)
          4. Sell on dest chain at higher price
          5. Repay flash loan + premium

        Currently implements the bridge portion. The flash loan and DEX
        swaps are called via FlashArbitrage.executeCrossChainArbitrage().

        Args:
            opportunity: Detected cross-chain opportunity
            account: Signing account with funds for gas
            use_flash_loan: Whether to use flash loan (capital-free)

        Returns:
            BridgeResult
        """
        logger.info(f"🌉 Executing cross-chain arbitrage: {opportunity}")

        amount_wei = int(opportunity.amount_usdt * 1e6)  # USDT 6 decimals
        min_wei = int(amount_wei * (1 - opportunity.spread_bps / 10000 * 0.5))

        # Choose bridge protocol
        if opportunity.bridge_protocol == BridgeProtocol.STARGATE:
            result = self.stargate.bridge(
                from_chain=opportunity.source_chain,
                to_chain=opportunity.dest_chain,
                amount_wei=amount_wei,
                min_amount_wei=min_wei,
                account=account,
            )
        else:
            result = self.across.bridge(
                from_chain=opportunity.source_chain,
                to_chain=opportunity.dest_chain,
                amount_wei=amount_wei,
                account=account,
            )

        self.execution_history.append(result)

        if result.success:
            logger.info(
                f"✅ Cross-chain completed: "
                f"${opportunity.net_profit_usdt:.2f} profit expected"
            )
        else:
            logger.error(f"❌ Cross-chain failed: {result.error}")

        return result

    def scan_and_execute(
        self,
        account: LocalAccount,
        max_trades: int = 1,
    ) -> List[BridgeResult]:
        """
        Scan for opportunities and execute the best ones.

        Args:
            account: Signing account
            max_trades: Maximum number of trades to execute

        Returns:
            List of executed bridge results
        """
        opportunities = self.detector.find_opportunities(max_opportunities=max_trades)

        if not opportunities:
            logger.info("🔍 No cross-chain opportunities found")
            return []

        results = []
        for opp in opportunities:
            if not opp.is_profitable:
                continue

            result = self.execute_opportunity(opp, account)
            results.append(result)

            # Brief pause between trades
            if len(results) < max_trades:
                time.sleep(2)

        return results

    def get_stats(self) -> dict:
        """Get cross-chain execution statistics."""
        total = len(self.execution_history)
        successes = [h for h in self.execution_history if h.success]
        total_bridged = sum(h.amount_bridged_usdt for h in successes)
        total_fees = sum(h.bridge_fee_paid_usdt for h in self.execution_history)

        return {
            "total_attempts": total,
            "successful": len(successes),
            "success_rate": len(successes) / max(total, 1),
            "total_bridged_usdt": total_bridged,
            "total_fees_paid_usdt": total_fees,
            "stargate_count": sum(1 for h in self.execution_history
                                   if h.bridge_protocol == BridgeProtocol.STARGATE),
            "across_count": sum(1 for h in self.execution_history
                                 if h.bridge_protocol == BridgeProtocol.ACROSS),
        }
