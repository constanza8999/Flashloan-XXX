"""
⚡ Arbitrage Engine — Gasless Propagation & Forced Confirmation System

This package provides production-grade infrastructure for:

  🔹 Gasless Meta-Transactions (EIP-2771)
     Relay network that submits transactions on behalf of users.
     Users sign typed EIP-712 messages; relayers pay gas and get refunded.

  🔹 Private Propagation Network
     Multi-node broadcast system that sends transactions directly to
     Flashbots, private mempools, and miner endpoints simultaneously.

  🔹 Validator Incentive Engine
     Automated MEV sharing with block proposers via coinbase transfers
     and Flashbots builder tips.

  🔹 Forced Confirmation Engine
     Atomic flash loan execution, conditional logic, and multi-path
     submission to guarantee inclusion.

  🔹 Atomic Cross-Chain Swaps
     Bridge-integrated swaps with execution guarantees.

Architecture:
  Config → GaslessRelay → PropagationNetwork → ExecutionEngine
                    ↓              ↓                  ↓
            EIP-2771 txns    Private RPCs       Flash Loans
            MetaMask sigs    Miner Pools        Flashbots
            Relayer nodes    P2P Broadcast      Atomic Swaps
"""

from .config import ArbitrageEngineConfig
from .gasless import GaslessRelay, RelayNode, RelayNetwork
from .propagation import PropagationEngine, MempoolBroadcaster
from .execution import ForcedExecutionEngine, AtomicSwapEngine
from .cross_chain import (
    CrossChainExecutor, CrossChainOpportunityDetector,
    CrossChainOpportunity, BridgeResult, BridgeProtocol,
    StargateBridge, AcrossBridge, CrossChainPrice,
)

__version__ = "1.0.0"
__all__ = [
    "ArbitrageEngineConfig",
    "GaslessRelay",
    "RelayNode",
    "RelayNetwork",
    "PropagationEngine",
    "MempoolBroadcaster",
    "ForcedExecutionEngine",
    "AtomicSwapEngine",
    "CrossChainExecutor",
    "CrossChainOpportunityDetector",
    "CrossChainOpportunity",
    "BridgeResult",
    "BridgeProtocol",
    "StargateBridge",
    "AcrossBridge",
    "CrossChainPrice",
    # Dashboard live-update helpers
    "update_state",
    "set_profit",
    "add_opportunity",
    "set_node_health",
    "broadcast",
]
