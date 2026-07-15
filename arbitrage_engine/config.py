"""
⚙️ Arbitrage Engine Configuration
Central config for gasless relay, propagation, and execution systems.
"""

import os
from dataclasses import dataclass, field
from typing import List, Dict, Optional


@dataclass
class ArbitrageEngineConfig:
    """
    Complete configuration for the arbitrage engine system.
    Load from environment variables with sensible defaults.
    """

    # ─── RPC Endpoints ────────────────────────────────────────────────
    eth_rpcs: List[str] = field(default_factory=lambda: [
        "https://eth.llamarpc.com",
        "https://cloudflare-eth.com",
        "https://rpc.ankr.com/eth",
        "https://ethereum-rpc.publicnode.com",
    ])

    bsc_rpcs: List[str] = field(default_factory=lambda: [
        "https://bsc-dataseed.binance.org/",
        "https://bsc-dataseed1.binance.org/",
        "https://bsc-dataseed2.binance.org/",
        "https://bsc.publicnode.com",
    ])

    # ─── Flashbots & Private RPCs ─────────────────────────────────────
    eth_protect_rpc: str = "https://rpc.flashbots.net"
    flashbots_relay_rpc: str = "https://relay.flashbots.net"
    bloxroute_rpc: str = ""            # Optional: https://eth-us-east.blxrbdn.com
    eden_rpc: str = ""                 # Optional: Eden Network
    secure_rpc: str = ""               # Optional: SecureRPC

    # Additional private mempool RPCs
    extra_private_rpcs: List[str] = field(default_factory=list)

    # ─── Contract Addresses ────────────────────────────────────────────
    trusted_forwarder_eth: str = ""    # Deployed TrustedForwarder on ETH
    trusted_forwarder_bsc: str = ""    # Deployed TrustedForwarder on BSC
    flash_arbitrage_eth: str = ""      # Deployed FlashArbitrage on ETH
    flash_arbitrage_bsc: str = ""      # Deployed FlashArbitrage on BSC

    # ─── Tokens ────────────────────────────────────────────────────────
    eth_usdt: str = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
    eth_weth: str = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
    bsc_usdt: str = "0x55d398326f99059fF775485246999027B3197955"
    bsc_wbnb: str = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"

    # ─── Wallet / Relayer Keys (loaded from env) ───────────────────────
    eth_relayer_key: str = field(default_factory=lambda: os.environ.get("ETH_RELAYER_KEY", ""))
    bsc_relayer_key: str = field(default_factory=lambda: os.environ.get("BSC_RELAYER_KEY", ""))
    user_key: str = field(default_factory=lambda: os.environ.get("USER_KEY", ""))

    # ─── Relay Network ─────────────────────────────────────────────────
    relayer_count: int = 3                          # Number of relay nodes to spin up
    relayer_regions: List[str] = field(default_factory=lambda: [
        "us-east", "eu-west", "ap-southeast"
    ])
    batch_size: int = 10                            # Max meta-txs per batch
    relayer_gas_premium_bps: int = 1100             # 11% premium for relayers

    # ─── Bridge Protocols ───────────────────────────────────────────────
    # Stargate Finance (LayerZero) — cross-chain swaps
    stargate_router_eth: str = "0x8731d54E9D02c286767d56ac03e8037C07e01e98"  # Stargate Router
    stargate_router_bsc: str = "0x4a364f8c717cAAD9A442634Eb0580C3A8C5F3b1F"  # Stargate Router
    stargate_usdt_pool_id: int = 2  # USDT pool ID on Stargate
    stargate_eth_chain_id: int = 101  # LayerZero chain ID for ETH
    stargate_bsc_chain_id: int = 102  # LayerZero chain ID for BSC

    # Across Protocol — optimistic bridge
    across_spoke_pool_eth: str = "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5"
    across_spoke_pool_bsc: str = "0x4e8Edc2C91fE9222cf61B7865AdF609805A2d505"
    across_relayer_fee_pct: float = 0.0003  # 0.03% relayer fee
    across_slow_delay: int = 7200  # 2 hours for slow relay (L2->L1)

    # 0x API — DEX aggregation for pre/post bridge swaps
    zero_x_api_key: str = ""

    # ─── Cross-Chain Arbitrage ──────────────────────────────────────────
    cross_chain_min_profit_usdt: float = 10.0
    cross_chain_max_slippage_bps: int = 50  # 0.50%
    cross_chain_enabled: bool = True
    preferred_bridge: str = "stargate"  # "stargate" | "across" | "auto"

    # ─── Gas & Fees ────────────────────────────────────────────────────
    max_gas_price_gwei_eth: float = 100.0
    max_gas_price_gwei_bsc: float = 5.0
    default_gas_limit: int = 300_000
    gas_buffer_multiplier: float = 1.2

    # ─── Validator Incentives ──────────────────────────────────────────
    validator_bribe_bps: int = 10        # 0.10% to block.coinbase
    relayer_reward_bps: int = 5          # 0.05% to relayer
    mev_share_bps: int = 20              # 0.20% MEV rebate to builders

    # ─── Forced Confirmation ────────────────────────────────────────────
    confirmation_poll_interval: float = 1.0  # seconds
    confirmation_timeout: int = 120           # seconds
    max_retry_attempts: int = 5
    parallel_submissions: int = 3             # Submit to N endpoints simultaneously

    # ─── Telegram ──────────────────────────────────────────────────────
    telegram_bot_token: str = field(default_factory=lambda: os.environ.get("TELEGRAM_BOT_TOKEN", ""))
    telegram_chat_id: str = field(default_factory=lambda: os.environ.get("TELEGRAM_CHAT_ID", ""))

    # ─── Logging ───────────────────────────────────────────────────────
    log_dir: str = "./logs"
    log_level: str = "INFO"
    stats_file: str = "./data/engine_stats.json"

    def __post_init__(self):
        os.makedirs(self.log_dir, exist_ok=True)
        os.makedirs(os.path.dirname(self.stats_file) or ".", exist_ok=True)

    @property
    def all_eth_rpcs(self) -> List[str]:
        """All Ethereum RPCs including private mempool endpoints."""
        rpcs = list(self.eth_rpcs)
        if self.eth_protect_rpc:
            rpcs.append(self.eth_protect_rpc)
        if self.bloxroute_rpc:
            rpcs.append(self.bloxroute_rpc)
        if self.eden_rpc:
            rpcs.append(self.eden_rpc)
        if self.secure_rpc:
            rpcs.append(self.secure_rpc)
        rpcs.extend(self.extra_private_rpcs)
        return rpcs

    @property
    def private_rpcs(self) -> List[str]:
        """Only private/MEV-protected RPCs."""
        privates = []
        if self.eth_protect_rpc:
            privates.append(self.eth_protect_rpc)
        if self.bloxroute_rpc:
            privates.append(self.bloxroute_rpc)
        if self.eden_rpc:
            privates.append(self.eden_rpc)
        if self.secure_rpc:
            privates.append(self.secure_rpc)
        privates.extend(self.extra_private_rpcs)
        return privates
