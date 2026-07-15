"""
⛽ Gasless Transaction Relay System
====================================
Implements EIP-2771 meta-transactions with a distributed relay node network.

Architecture:
  User signs typed EIP-712 ForwardRequest → sends to RelayNetwork
    → RelayNetwork picks best relay node → relay node calls TrustedForwarder.execute()
      → Forwarder verifies sig, forwards to FlashArbitrage, pays gas
        → Relayer gets refund + premium from forwarder's ETH balance

Components:
  - MetaTxSigner: Builds and signs EIP-712 ForwardRequests
  - RelayNode: A single relayer that submits meta-txs
  - RelayNetwork: Manages multiple relay nodes with failover
  - GaslessRelay: High-level API combining signing + relay selection
"""

import os
import json
import time
import hmac
import hashlib
import logging
from typing import List, Optional, Dict, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

logger = logging.getLogger("gasless")

# ─── Web3 ────────────────────────────────────────────────────────────────
try:
    from web3 import Web3
    from eth_account import Account
    from eth_account.messages import encode_typed_data
    from eth_account.signers.local import LocalAccount
    WEB3_AVAILABLE = True
except ImportError:
    WEB3_AVAILABLE = False
    logger.warning("web3 not available. Install: pip install web3>=6.15.0")


# ═══════════════════════════════════════════════════════════════════════════
# 1. DATA STRUCTURES
# ═══════════════════════════════════════════════════════════════════════════

class RelayNodeStatus(Enum):
    OFFLINE = "offline"
    ACTIVE = "active"
    BUSY = "busy"
    DEGRADED = "degraded"


@dataclass
class ForwardRequest:
    """
    EIP-2771 ForwardRequest struct matching the smart contract.
    """
    from_addr: str        # Original sender (who signed)
    to: str                # Target contract (e.g. FlashArbitrage)
    value: int             # Native token value in wei
    gas: int               # Gas limit for forwarding
    nonce: int             # Anti-replay nonce
    data: str              # Hex-encoded function call data
    deadline: int          # Unix timestamp expiry

    def to_typed_data(self, chain_id: int, verifying_contract: str) -> dict:
        """Convert to EIP-712 typed data structure for signing."""
        return {
            "types": {
                "EIP712Domain": [
                    {"name": "name", "type": "string"},
                    {"name": "version", "type": "string"},
                    {"name": "chainId", "type": "uint256"},
                    {"name": "verifyingContract", "type": "address"},
                ],
                "ForwardRequest": [
                    {"name": "from", "type": "address"},
                    {"name": "to", "type": "address"},
                    {"name": "value", "type": "uint256"},
                    {"name": "gas", "type": "uint256"},
                    {"name": "nonce", "type": "uint256"},
                    {"name": "data", "type": "bytes"},
                    {"name": "deadline", "type": "uint256"},
                ],
            },
            "primaryType": "ForwardRequest",
            "domain": {
                "name": "TrustedForwarder",
                "version": "1.0.0",
                "chainId": chain_id,
                "verifyingContract": verifying_contract,
            },
            "message": {
                "from": self.from_addr,
                "to": self.to,
                "value": str(self.value),
                "gas": str(self.gas),
                "nonce": str(self.nonce),
                "data": self.data,
                "deadline": str(self.deadline),
            },
        }

    def to_tuple(self) -> tuple:
        """Return as tuple matching the Solidity struct."""
        return (self.from_addr, self.to, self.value, self.gas,
                self.nonce, self.data, self.deadline)


@dataclass
class RelayNodeInfo:
    """Information about a registered relay node."""
    address: str
    name: str
    region: str
    rpc_url: str
    status: RelayNodeStatus = RelayNodeStatus.ACTIVE
    tx_count: int = 0
    success_count: int = 0
    total_gas_saved: int = 0
    last_seen: float = 0.0
    latency_ms: float = 0.0
    is_slave: bool = False
    master_address: str = ""


# ═══════════════════════════════════════════════════════════════════════════
# 2. META-TRANSACTION SIGNER
# ═══════════════════════════════════════════════════════════════════════════

class MetaTxSigner:
    """
    Builds and signs EIP-712 typed ForwardRequests on behalf of a user.
    The user signs with their private key; the relayer submits.
    """

    def __init__(self, user_key: str, chain_id: int = 1):
        """
        Args:
            user_key: User's private key (0x-prefixed hex)
            chain_id: Target chain ID (1=ETH, 56=BSC)
        """
        if not WEB3_AVAILABLE:
            raise ImportError("web3 required for MetaTxSigner")

        self.chain_id = chain_id
        self.account: LocalAccount = Account.from_key(
            user_key if user_key.startswith("0x") else "0x" + user_key
        )
        self.address = self.account.address
        logger.info(f"MetaTxSigner initialized for {self.address}")

    def get_nonce(self, w3: Web3, forwarder_address: str) -> int:
        """Get the current nonce from the TrustedForwarder contract."""
        forwarder_abi = [
            {
                "constant": True,
                "inputs": [{"name": "user", "type": "address"}],
                "name": "nonces",
                "outputs": [{"name": "", "type": "uint256"}],
                "type": "function",
            }
        ]
        contract = w3.eth.contract(
            address=Web3.to_checksum_address(forwarder_address),
            abi=forwarder_abi,
        )
        return contract.functions.nonces(self.address).call()

    def build_request(
        self,
        to: str,
        data: str,
        value: int = 0,
        gas: int = 200_000,
        deadline_minutes: int = 10,
        w3: Optional[Web3] = None,
        forwarder_address: Optional[str] = None,
        nonce: Optional[int] = None,
    ) -> ForwardRequest:
        """
        Build a ForwardRequest struct ready for signing.

        Args:
            to: Target contract address
            data: Hex-encoded function call data
            value: Native token value in wei
            gas: Gas limit for forwarding
            deadline_minutes: Minutes until request expires
            w3: Web3 provider (needed if nonce not provided)
            forwarder_address: Forwarder contract address
            nonce: Explicit nonce (fetches from chain if not provided)

        Returns:
            ForwardRequest struct
        """
        if nonce is None:
            if w3 is None or forwarder_address is None:
                raise ValueError("Must provide w3+forwarder_address or explicit nonce")
            nonce = self.get_nonce(w3, forwarder_address)

        deadline = int(time.time()) + deadline_minutes * 60

        return ForwardRequest(
            from_addr=self.address,
            to=to,
            value=value,
            gas=gas,
            nonce=nonce,
            data=data,
            deadline=deadline,
        )

    def sign_request(
        self,
        request: ForwardRequest,
        verifying_contract: str,
    ) -> str:
        """
        Sign a ForwardRequest using EIP-712 typed data signing.

        Args:
            request: The ForwardRequest to sign
            verifying_contract: TrustedForwarder contract address

        Returns:
            Hex-encoded signature (0x-prefixed)
        """
        typed_data = request.to_typed_data(self.chain_id, verifying_contract)
        signed = Account.sign_typed_data(
            self.account.key,
            typed_data,
        )
        return "0x" + signed.signature.hex()

    def build_and_sign(
        self,
        to: str,
        data: str,
        forwarder_address: str,
        w3: Web3,
        value: int = 0,
        gas: int = 200_000,
        deadline_minutes: int = 10,
    ) -> Tuple[ForwardRequest, str]:
        """
        Build and sign a ForwardRequest in one call.

        Returns:
            (ForwardRequest, signature_hex)
        """
        request = self.build_request(
            to=to, data=data, value=value, gas=gas,
            deadline_minutes=deadline_minutes,
            w3=w3, forwarder_address=forwarder_address,
        )
        signature = self.sign_request(request, forwarder_address)
        return request, signature


# ═══════════════════════════════════════════════════════════════════════════
# 3. RELAY NODE
# ═══════════════════════════════════════════════════════════════════════════

class RelayNode:
    """
    A single relay node that submits meta-transactions to the
    TrustedForwarder contract. Each node has its own relayer key
    and can operate independently.
    """

    def __init__(
        self,
        name: str,
        region: str,
        relayer_key: str,
        rpc_urls: List[str],
        forwarder_address: str,
        chain_id: int = 1,
        is_slave: bool = False,
        master_address: str = "",
    ):
        if not WEB3_AVAILABLE:
            raise ImportError("web3 required for RelayNode")

        self.name = name
        self.region = region
        self.chain_id = chain_id
        self.forwarder_address = forwarder_address
        self.is_slave = is_slave
        self.master_address = master_address

        # Relayer wallet
        key = relayer_key if relayer_key.startswith("0x") else "0x" + relayer_key
        self.account: LocalAccount = Account.from_key(key)
        self.address = self.account.address

        # Connect to first available RPC
        self.w3: Optional[Web3] = None
        for rpc in rpc_urls:
            try:
                w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 10}))
                if w3.is_connected():
                    self.w3 = w3
                    break
            except Exception:
                continue

        if not self.w3:
            raise ConnectionError(f"RelayNode {name}: no RPC available")

        # TrustedForwarder contract interface
        self.forwarder = self.w3.eth.contract(
            address=Web3.to_checksum_address(forwarder_address),
            abi=self._forwarder_abi(),
        )

        # Stats
        self.info = RelayNodeInfo(
            address=self.address,
            name=name,
            region=region,
            rpc_url=rpc_urls[0] if rpc_urls else "",
            status=RelayNodeStatus.ACTIVE,
            is_slave=is_slave,
            master_address=master_address,
        )
        self.info.last_seen = time.time()

        logger.info(f"RelayNode '{name}' ({region}) ready: {self.address}")

    @staticmethod
    def _forwarder_abi() -> list:
        """Minimal ABI for the TrustedForwarder contract."""
        return [
            {
                "constant": False,
                "inputs": [
                    {"components": [
                        {"name": "from", "type": "address"},
                        {"name": "to", "type": "address"},
                        {"name": "value", "type": "uint256"},
                        {"name": "gas", "type": "uint256"},
                        {"name": "nonce", "type": "uint256"},
                        {"name": "data", "type": "bytes"},
                        {"name": "deadline", "type": "uint256"},
                    ], "name": "req", "type": "tuple"},
                    {"name": "signature", "type": "bytes"},
                ],
                "name": "execute",
                "outputs": [
                    {"name": "success", "type": "bool"},
                    {"name": "returnData", "type": "bytes"},
                ],
                "type": "function",
            },
            {
                "constant": False,
                "inputs": [
                    {"components": [
                        {"name": "from", "type": "address"},
                        {"name": "to", "type": "address"},
                        {"name": "value", "type": "uint256"},
                        {"name": "gas", "type": "uint256"},
                        {"name": "nonce", "type": "uint256"},
                        {"name": "data", "type": "bytes"},
                        {"name": "deadline", "type": "uint256"},
                    ], "name": "requests", "type": "tuple[]"},
                    {"name": "signatures", "type": "bytes[]"},
                ],
                "name": "executeBatch",
                "outputs": [
                    {"name": "successes", "type": "bool[]"},
                    {"name": "returnDatas", "type": "bytes[]"},
                ],
                "type": "function",
            },
            {
                "constant": True,
                "inputs": [],
                "name": "nonces",
                "outputs": [{"name": "", "type": "uint256"}],
                "type": "function",
            },
        ]

    def submit(
        self,
        request: ForwardRequest,
        signature: str,
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Submit a meta-transaction to the TrustedForwarder.

        Args:
            request: Signed ForwardRequest
            signature: EIP-712 signature hex

        Returns:
            (success, tx_hash_or_none, error_or_none)
        """
        try:
            tx = self.forwarder.functions.execute(
                request.to_tuple(),
                signature,
            ).build_transaction({
                "from": self.address,
                "nonce": self.w3.eth.get_transaction_count(self.address),
                "gas": 300_000,
                "gasPrice": self.w3.eth.gas_price,
                "chainId": self.chain_id,
            })

            signed = self.account.sign_transaction(tx)
            raw_tx = signed.rawTransaction if hasattr(signed, 'rawTransaction') else signed.raw_transaction
            tx_hash = self.w3.eth.send_raw_transaction(raw_tx)
            h = tx_hash.hex() if not isinstance(tx_hash, str) else tx_hash
            if not h.startswith("0x"):
                h = "0x" + h

            # Update stats
            self.info.tx_count += 1
            self.info.last_seen = time.time()

            logger.info(f"RelayNode {self.name}: submitted tx {h[:18]}...")
            return True, h, None

        except Exception as e:
            logger.error(f"RelayNode {self.name}: submission failed: {e}")
            return False, None, str(e)

    def submit_batch(
        self,
        requests: List[ForwardRequest],
        signatures: List[str],
    ) -> Tuple[bool, Optional[List[bool]], Optional[str]]:
        """
        Submit a batch of meta-transactions.

        Args:
            requests: List of signed ForwardRequests
            signatures: List of EIP-712 signatures

        Returns:
            (success, successes_list_or_none, error_or_none)
        """
        if len(requests) != len(signatures):
            return False, None, "Length mismatch"

        try:
            tx = self.forwarder.functions.executeBatch(
                [r.to_tuple() for r in requests],
                signatures,
            ).build_transaction({
                "from": self.address,
                "nonce": self.w3.eth.get_transaction_count(self.address),
                "gas": 500_000 + 100_000 * len(requests),
                "gasPrice": self.w3.eth.gas_price,
                "chainId": self.chain_id,
            })

            signed = self.account.sign_transaction(tx)
            raw_tx = signed.rawTransaction if hasattr(signed, 'rawTransaction') else signed.raw_transaction
            self.w3.eth.send_raw_transaction(raw_tx)

            self.info.tx_count += len(requests)
            self.info.last_seen = time.time()

            logger.info(f"RelayNode {self.name}: batch of {len(requests)} submitted")
            return True, [True] * len(requests), None

        except Exception as e:
            logger.error(f"RelayNode {self.name}: batch failed: {e}")
            return False, None, str(e)

    def get_balance(self) -> float:
        """Get relayer wallet balance in ETH."""
        balance_wei = self.w3.eth.get_balance(self.address)
        return float(self.w3.from_wei(balance_wei, "ether"))

    def health_check(self) -> bool:
        """Check if the node is functioning."""
        try:
            block = self.w3.eth.block_number
            balance = self.w3.eth.get_balance(self.address)
            self.info.last_seen = time.time()
            self.info.status = RelayNodeStatus.ACTIVE if balance > 0 else RelayNodeStatus.DEGRADED
            return True
        except Exception:
            self.info.status = RelayNodeStatus.OFFLINE
            return False

    def latency(self) -> float:
        """Measure RPC latency in ms."""
        start = time.time()
        try:
            self.w3.eth.block_number
            self.info.latency_ms = (time.time() - start) * 1000
        except Exception:
            self.info.latency_ms = -1.0
        return self.info.latency_ms


# ═══════════════════════════════════════════════════════════════════════════
# 4. RELAY NETWORK — Master/Slave Node Management
# ═══════════════════════════════════════════════════════════════════════════

class RelayNetwork:
    """
    Distributed relay node network with master-slave architecture.

    Master node:
      - Coordinates relay tasks
      - Maintains the relayer whitelist on-chain
      - Monitors slave health
      - Routes meta-tx requests to the best available node

    Slave nodes:
      - Execute relay tasks
      - Report status to master (off-chain)
      - Auto-failover if master goes down

    Features:
      ✅ Automatic failover
      ✅ Geographic load balancing
      ✅ Health monitoring with heartbeat
      ✅ Batch execution support
      ✅ Balance management
    """

    def __init__(
        self,
        config: 'ArbitrageEngineConfig' = None,
        forwarder_address: str = "",
        chain_id: int = 1,
        rpc_urls: Optional[List[str]] = None,
    ):
        self.config = config
        self.forwarder_address = forwarder_address
        self.chain_id = chain_id
        self.rpc_urls = rpc_urls or []
        self.nodes: Dict[str, RelayNode] = {}
        self.master_node: Optional[RelayNode] = None
        self.metrics = {
            "total_relayed": 0,
            "total_gas_saved_eth": 0.0,
            "success_rate": 0.0,
            "active_nodes": 0,
        }

    def add_node(
        self,
        name: str,
        region: str,
        relayer_key: str,
        is_slave: bool = False,
        master_address: str = "",
    ) -> RelayNode:
        """Register and connect a new relay node."""
        node = RelayNode(
            name=name,
            region=region,
            relayer_key=relayer_key,
            rpc_urls=self.rpc_urls,
            forwarder_address=self.forwarder_address,
            chain_id=self.chain_id,
            is_slave=is_slave,
            master_address=master_address or (self.master_node.address if self.master_node else ""),
        )
        self.nodes[name] = node

        if not is_slave and self.master_node is None:
            self.master_node = node

        self.metrics["active_nodes"] = len(self.nodes)
        logger.info(f"RelayNetwork: added node '{name}' ({region}) "
                    f"{'slave' if is_slave else 'master'}")
        return node

    def get_best_node(self) -> Optional[RelayNode]:
        """
        Select the best available relay node based on:
        1. Health check
        2. Lowest latency
        3. Highest success rate
        """
        healthy = []
        for name, node in self.nodes.items():
            if node.health_check():
                node.latency()
                healthy.append(node)

        if not healthy:
            logger.error("RelayNetwork: no healthy nodes available")
            return None

        # Prefer master, then lowest latency
        if self.master_node and self.master_node in healthy:
            return self.master_node

        healthy.sort(key=lambda n: n.info.latency_ms)
        return healthy[0]

    def submit_via_best_node(
        self,
        request: ForwardRequest,
        signature: str,
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Submit via the best available relay node.
        Falls through to next node on failure.
        """
        best = self.get_best_node()
        if not best:
            return False, None, "No relay nodes available"

        success, tx_hash, error = best.submit(request, signature)

        if success:
            self.metrics["total_relayed"] += 1
            self.metrics["total_gas_saved_eth"] += 0.001  # Approximate
            self.metrics["success_rate"] = (
                self.metrics["total_relayed"] /
                (self.metrics["total_relayed"] + 1)
            )
            return True, tx_hash, None

        # Try another node as fallback
        for name, node in self.nodes.items():
            if node == best:
                continue
            success, tx_hash, error = node.submit(request, signature)
            if success:
                self.metrics["total_relayed"] += 1
                return True, tx_hash, None

        return False, None, error or "All relay nodes failed"

    def submit_batch(
        self,
        requests: List[ForwardRequest],
        signatures: List[str],
    ) -> Tuple[bool, Optional[List[bool]], Optional[str]]:
        """Submit a batch via the best relay node."""
        best = self.get_best_node()
        if not best:
            return False, None, "No relay nodes available"

        return best.submit_batch(requests, signatures)

    def check_all_nodes(self) -> Dict[str, str]:
        """Health check all nodes and return status map."""
        statuses = {}
        for name, node in self.nodes.items():
            ok = node.health_check()
            statuses[name] = "healthy" if ok else "offline"
            if not ok and node == self.master_node:
                # Auto-failover: promote first healthy slave
                for n_name, n_node in self.nodes.items():
                    if n_node != node and n_node.health_check():
                        self.master_node = n_node
                        logger.info(f"RelayNetwork: failover to {n_name}")
                        break
        return statuses

    def get_status(self) -> dict:
        """Get complete network status."""
        return {
            "master": self.master_node.address if self.master_node else None,
            "total_nodes": len(self.nodes),
            "active_nodes": sum(1 for n in self.nodes.values() if n.health_check()),
            "total_relayed": self.metrics["total_relayed"],
            "total_gas_saved_eth": self.metrics["total_gas_saved_eth"],
            "nodes": {name: {
                "address": node.address,
                "region": node.region,
                "status": node.info.status.value,
                "tx_count": node.info.tx_count,
                "latency_ms": node.info.latency_ms,
                "balance_eth": node.get_balance(),
            } for name, node in self.nodes.items()},
        }


# ═══════════════════════════════════════════════════════════════════════════
# 5. GASLESS RELAY — High-Level API
# ═══════════════════════════════════════════════════════════════════════════

class GaslessRelay:
    """
    High-level API for gasless meta-transactions.

    Usage:
        relay = GaslessRelay(user_key="0x...", chain_id=1)
        relay.configure_forwarder("0xforwarder...")
        relay.add_relay_node("node1", "us-east", "0xrelayer_key...")

        # Gasless transaction
        tx_hash = relay.send_gasless(
            to="0xflashArbitrage...",
            data="0x...",  # encoded function call
        )
    """

    def __init__(self, user_key: str, chain_id: int = 1):
        if not WEB3_AVAILABLE:
            raise ImportError("web3 required for GaslessRelay")

        self.signer = MetaTxSigner(user_key, chain_id)
        self.network: Optional[RelayNetwork] = None
        self.w3: Optional[Web3] = None
        self.forwarder_address: str = ""
        self.chain_id = chain_id

    def configure_forwarder(
        self,
        forwarder_address: str,
        rpc_urls: Optional[List[str]] = None,
    ):
        """Configure the TrustedForwarder contract and RPC."""
        self.forwarder_address = forwarder_address
        self.rpc_urls = rpc_urls or [
            "https://eth.llamarpc.com",
            "https://cloudflare-eth.com",
        ]

        for rpc in self.rpc_urls:
            try:
                w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 10}))
                if w3.is_connected():
                    self.w3 = w3
                    break
            except Exception:
                continue

        if not self.w3:
            raise ConnectionError("No RPC available")

        self.network = RelayNetwork(
            forwarder_address=forwarder_address,
            chain_id=self.chain_id,
            rpc_urls=self.rpc_urls,
        )

        logger.info(f"GaslessRelay: forwarder={forwarder_address}, chain_id={chain_id}")

    def add_relay_node(
        self,
        name: str,
        region: str,
        relayer_key: str,
        is_master: bool = False,
    ):
        """Register a relay node."""
        if self.network is None:
            raise RuntimeError("Configure forwarder first")

        self.network.add_node(
            name=name,
            region=region,
            relayer_key=relayer_key,
            is_slave=not is_master,
        )

    def send_gasless(
        self,
        to: str,
        data: str,
        value: int = 0,
        gas: int = 200_000,
        deadline_minutes: int = 10,
    ) -> Optional[str]:
        """
        Send a gasless meta-transaction.

        The user signs a typed EIP-712 message. A relay node submits
        it to the TrustedForwarder, paying gas. The user pays nothing.

        Args:
            to: Target contract address
            data: Hex-encoded function call data
            value: Native token value in wei
            gas: Gas limit for the forwarded call
            deadline_minutes: Minutes until the request expires

        Returns:
            Transaction hash if successful, None otherwise.
        """
        if not self.w3 or not self.network:
            raise RuntimeError("GaslessRelay not configured")

        # Build and sign the meta-transaction
        request, signature = self.signer.build_and_sign(
            to=to,
            data=data,
            forwarder_address=self.forwarder_address,
            w3=self.w3,
            value=value,
            gas=gas,
            deadline_minutes=deadline_minutes,
        )

        # Submit via relay network
        success, tx_hash, error = self.network.submit_via_best_node(
            request, signature
        )

        if success:
            logger.info(f"Gasless tx submitted: {tx_hash}")
            return tx_hash
        else:
            logger.error(f"Gasless tx failed: {error}")
            return None

    def send_batch_gasless(
        self,
        targets_and_data: List[Tuple[str, str]],
        deadline_minutes: int = 10,
    ) -> Optional[str]:
        """
        Send multiple gasless meta-transactions in one batch.

        Args:
            targets_and_data: List of (to_address, encoded_data) tuples
            deadline_minutes: Minutes until expiry

        Returns:
            Batch transaction hash if successful
        """
        if not self.w3 or not self.network:
            raise RuntimeError("GaslessRelay not configured")

        requests = []
        signatures = []

        for to, data in targets_and_data:
            request = self.signer.build_request(
                to=to, data=data,
                w3=self.w3, forwarder_address=self.forwarder_address,
                deadline_minutes=deadline_minutes,
            )
            sig = self.signer.sign_request(request, self.forwarder_address)
            requests.append(request)
            signatures.append(sig)

            # Increment nonce manually for next request in batch
            self.signer.get_nonce(self.w3, self.forwarder_address)

        success, results, error = self.network.submit_batch(requests, signatures)

        if success:
            logger.info(f"Batch of {len(requests)} gasless txs submitted")
            return "batch_success"
        else:
            logger.error(f"Batch gasless failed: {error}")
            return None

    def status(self) -> dict:
        """Get current system status."""
        if not self.network:
            return {"error": "Not configured"}
        return {
            "user_address": self.signer.address,
            "forwarder": self.forwarder_address,
            "chain_id": self.chain_id,
            "network": self.network.get_status(),
        }
