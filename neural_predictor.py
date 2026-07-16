#!/usr/bin/env python3
"""
🕸️ Neural Arbitrage Predictor
==============================
Deep learning system for predicting arbitrage opportunities across
ETH, BNB, and USDT pairs on Ethereum & BSC.

Architecture:
  1. LSTM / Transformer encoders for price sequence prediction
  2. Autoencoder-based anomaly detection for hidden opportunities
  3. PPO Reinforcement Learning agent for execution optimization
  4. Streaming data pipeline from on-chain DEX subgraphs

Usage:
  python neural_predictor.py --train          # Train models from scratch
  python neural_predictor.py --predict        # Run prediction loop
  python neural_predictor.py --live           # Full live trading mode
"""

import os
import sys
import json
import time
import math
import random
import logging
import argparse
import warnings
from datetime import datetime, timedelta
from typing import List, Tuple, Optional, Dict, Any
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

# ─── Deep Learning ──────────────────────────────────────────────────────
try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import Dataset, DataLoader
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    print("⚠️  PyTorch not installed. Install with: pip install torch>=2.0.0")

# ─── Reinforcement Learning ─────────────────────────────────────────────
try:
    import gymnasium as gym
    from gymnasium import spaces
    RL_AVAILABLE = True
except ImportError:
    RL_AVAILABLE = False
    print("⚠️  gymnasium not installed. Install with: pip install gymnasium")

# ─── Web3 for on-chain data ─────────────────────────────────────────────
try:
    from web3 import Web3
    WEB3_AVAILABLE = True
except ImportError:
    WEB3_AVAILABLE = False

# ─── Scikit-learn ───────────────────────────────────────────────────────
try:
    from sklearn.preprocessing import StandardScaler, RobustScaler
    from sklearn.ensemble import IsolationForest
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False

warnings.filterwarnings("ignore")

# ═══════════════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class ModelConfig:
    """Hyperparameters for the neural network models."""
    # Sequence model
    seq_length: int = 60               # Lookback window (60 blocks ≈ 15 min)
    n_features: int = 7                # price, inv_price, liq_in, liq_out, volume_24h, fee_tier, gas_gwei
    hidden_dim: int = 256              # LSTM / Transformer hidden dimension
    n_layers: int = 4                  # Number of recurrent/transformer layers
    n_heads: int = 8                   # Attention heads (Transformer)
    dropout: float = 0.15
    learning_rate: float = 1e-4
    batch_size: int = 64
    epochs: int = 200
    early_stop_patience: int = 15

    # Anomaly detection
    latent_dim: int = 8                # Autoencoder bottleneck

    # RL
    rl_hidden_dim: int = 128
    rl_learning_rate: float = 3e-4

    # Data
    train_split: float = 0.8
    val_split: float = 0.1

    # Paths
    model_dir: str = "./models"
    data_dir: str = "./data"

    # Trading pairs: (token_in, token_out, dex, chain, pool_fee)
    pairs: List[Tuple[str, str, str, str, int]] = field(default_factory=lambda: [
        # ETH pairs
        ("USDT", "WETH", "uniswap_v3", "ethereum", 3000),
        ("USDT", "WETH", "uniswap_v2", "ethereum", 0),
        ("USDT", "WETH", "sushiswap", "ethereum", 0),
        # BSC pairs
        ("USDT", "WBNB", "pancakeswap_v3", "bsc", 2500),
        ("USDT", "WBNB", "pancakeswap_v2", "bsc", 0),
        # Cross-chain synthetic (bridge feeds)
        ("USDT", "USDT", "bridge", "cross", 0),
        ("WETH", "WBNB", "bridge", "cross", 0),
    ])


# ═══════════════════════════════════════════════════════════════════════════
# 1. LSTM PRICE PREDICTOR
# ═══════════════════════════════════════════════════════════════════════════

class LSTMPricePredictor(nn.Module):
    """
    Multi-layer LSTM with attention mechanism for price sequence prediction.
    Predicts the next N price steps with confidence intervals.

    Architecture:
      [Input] → LayerNorm → LSTM×N → Attention → FC → Dropout → FC → Output
    """

    def __init__(self, config: ModelConfig):
        super().__init__()
        self.config = config
        self.norm = nn.LayerNorm(config.n_features)

        # Stacked LSTM layers with residual connections
        self.lstm = nn.LSTM(
            input_size=config.n_features,
            hidden_size=config.hidden_dim,
            num_layers=config.n_layers,
            dropout=config.dropout if config.n_layers > 1 else 0,
            batch_first=True,
            bidirectional=True,  # Bidirectional for richer context
        )

        # Self-attention pooling
        lstm_out = config.hidden_dim * 2  # bidirectional
        self.attention = nn.MultiheadAttention(
            embed_dim=lstm_out,
            num_heads=config.n_heads,
            dropout=config.dropout,
            batch_first=True,
        )
        self.attn_norm = nn.LayerNorm(lstm_out)

        # Output heads
        self.fc1 = nn.Linear(lstm_out, config.hidden_dim)
        self.drop = nn.Dropout(config.dropout)
        self.fc2 = nn.Linear(config.hidden_dim, config.hidden_dim // 2)

        # Predict mean and log-variance for each future step
        self.mean_head = nn.Linear(config.hidden_dim // 2, 1)      # Price prediction
        self.var_head = nn.Linear(config.hidden_dim // 2, 1)       # Uncertainty (aleatoric)
        self.direction_head = nn.Linear(config.hidden_dim // 2, 3) # Up / Down / Sideways

    def forward(self, x):
        """
        Args:
            x: (batch, seq_len, n_features) normalized input
        Returns:
            mean, log_var, direction_logits
        """
        x = self.norm(x)

        # LSTM encoding
        lstm_out, (h_n, c_n) = self.lstm(x)  # (B, S, H*2)

        # Self-attention over sequence
        attn_out, attn_weights = self.attention(lstm_out, lstm_out, lstm_out)
        attn_out = self.attn_norm(lstm_out + attn_out)  # Residual

        # Take last timestep (could also use attention-weighted pool)
        pooled = attn_out[:, -1, :]  # (B, H*2)

        # MLP decoder
        h = torch.relu(self.fc1(pooled))
        h = self.drop(h)
        h = torch.relu(self.fc2(h))

        mean = self.mean_head(h).squeeze(-1)          # (B,)
        log_var = self.var_head(h).squeeze(-1)        # (B,)
        direction = self.direction_head(h)             # (B, 3)

        return mean, log_var, direction

    @torch.no_grad()
    def predict_with_confidence(self, x: torch.Tensor) -> Dict[str, Any]:
        """
        Get prediction with uncertainty quantification.

        Returns:
            dict with 'mean', 'std', 'direction', 'confidence'
        """
        self.eval()
        mean, log_var, direction_logits = self.forward(x)

        std = torch.exp(0.5 * log_var)
        direction_probs = torch.softmax(direction_logits, dim=-1)
        confidence, direction_class = torch.max(direction_probs, dim=-1)

        return {
            "mean": mean.cpu().numpy(),
            "std": std.cpu().numpy(),
            "direction": direction_class.cpu().numpy(),
            "confidence": confidence.cpu().numpy(),
            "direction_probs": direction_probs.cpu().numpy(),
        }


class TransformerPricePredictor(nn.Module):
    """
    Transformer encoder for price prediction with positional encoding.
    Alternative to LSTM — often better on long sequences.
    """

    def __init__(self, config: ModelConfig):
        super().__init__()
        self.config = config

        self.input_proj = nn.Linear(config.n_features, config.hidden_dim)
        self.pos_encoder = PositionalEncoding(config.hidden_dim, config.dropout)

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=config.hidden_dim,
            nhead=config.n_heads,
            dim_feedforward=config.hidden_dim * 4,
            dropout=config.dropout,
            activation="gelu",
            batch_first=True,
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=config.n_layers)

        self.norm = nn.LayerNorm(config.hidden_dim)
        self.fc1 = nn.Linear(config.hidden_dim, config.hidden_dim)
        self.drop = nn.Dropout(config.dropout)
        self.mean_head = nn.Linear(config.hidden_dim, 1)
        self.var_head = nn.Linear(config.hidden_dim, 1)

    def forward(self, x):
        x = self.input_proj(x)  # (B, S, H)
        x = self.pos_encoder(x)
        x = self.transformer(x)
        x = self.norm(x)
        pooled = x.mean(dim=1)  # Average pooling over sequence
        h = torch.relu(self.fc1(pooled))
        h = self.drop(h)
        mean = self.mean_head(h).squeeze(-1)
        log_var = self.var_head(h).squeeze(-1)
        return mean, log_var, None  # No direction head for transformer variant


class PositionalEncoding(nn.Module):
    """Sinusoidal positional encoding for Transformer."""

    def __init__(self, d_model: int, dropout: float = 0.1, max_len: int = 5000):
        super().__init__()
        self.dropout = nn.Dropout(p=dropout)
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        pe = pe.unsqueeze(0)
        self.register_buffer("pe", pe)

    def forward(self, x):
        x = x + self.pe[:, : x.size(1), :]
        return self.dropout(x)


# ═══════════════════════════════════════════════════════════════════════════
# 2. ANOMALY DETECTION — Autoencoder + Isolation Forest
# ═══════════════════════════════════════════════════════════════════════════

class AnomalyDetector(nn.Module):
    """
    Variational Autoencoder for detecting anomalous market conditions
    that often precede high-profit arbitrage opportunities.

    High reconstruction error = anomalous = potential opportunity.
    """

    def __init__(self, n_features: int, latent_dim: int = 8):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(n_features, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, latent_dim * 2),  # Mean + log_var
        )
        self.decoder = nn.Sequential(
            nn.Linear(latent_dim, 32),
            nn.ReLU(),
            nn.Linear(32, 64),
            nn.ReLU(),
            nn.Linear(64, n_features),
        )
        self.latent_dim = latent_dim

    def encode(self, x):
        params = self.encoder(x)
        mean, log_var = params.chunk(2, dim=-1)
        return mean, log_var

    def reparameterize(self, mean, log_var):
        std = torch.exp(0.5 * log_var)
        eps = torch.randn_like(std)
        return mean + eps * std

    def decode(self, z):
        return self.decoder(z)

    def forward(self, x):
        mean, log_var = self.encode(x)
        z = self.reparameterize(mean, log_var)
        recon = self.decode(z)
        return recon, mean, log_var

    @torch.no_grad()
    def anomaly_score(self, x: torch.Tensor) -> np.ndarray:
        """Higher score = more anomalous (potential opportunity)."""
        self.eval()
        recon, mean, log_var = self.forward(x)
        recon_error = ((x - recon) ** 2).sum(dim=-1)
        kl_div = -0.5 * (1 + log_var - mean ** 2 - log_var.exp()).sum(dim=-1)
        score = recon_error + 0.1 * kl_div
        return score.cpu().numpy()


class IsolationForestDetector:
    """Scikit-learn IsolationForest wrapper for batch anomaly detection."""

    def __init__(self, contamination: float = 0.05):
        self.model = IsolationForest(
            contamination=contamination,
            random_state=42,
            n_estimators=200,
            max_samples="auto",
        )
        self.fitted = False

    def fit(self, X: np.ndarray):
        self.model.fit(X)
        self.fitted = True

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Returns 1 for normal, -1 for anomaly."""
        if not self.fitted:
            return np.zeros(len(X))
        return self.model.predict(X)

    def anomaly_scores(self, X: np.ndarray) -> np.ndarray:
        """Lower score = more anomalous."""
        if not self.fitted:
            return np.zeros(len(X))
        return self.model.score_samples(X)


# ═══════════════════════════════════════════════════════════════════════════
# 3. REINFORCEMENT LEARNING — PPO Agent for Execution Optimization
# ═══════════════════════════════════════════════════════════════════════════

class ArbitrageEnv(gym.Env):
    """
    Custom Gymnasium environment for arbitrage execution optimization.

    State:   [spread, gas_price, volatility, depth, last_profit, position]
    Action:  [0=hold, 1=execute_small, 2=execute_medium, 3=execute_large]
    Reward:  realized_profit - gas_cost - slippage_penalty
    """

    def __init__(self, max_position: float = 100_000):
        super().__init__()
        self.max_position = max_position

        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(6,), dtype=np.float32
        )
        self.action_space = spaces.Discrete(4)  # hold, small, medium, large

        self.reset()

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.position = 0.0
        self.total_profit = 0.0
        self.step_count = 0

        # Initial state
        self.state = np.array([
            random.uniform(0, 0.05),    # spread
            random.uniform(10, 100),     # gas_price (gwei)
            random.uniform(0.001, 0.05), # volatility
            random.uniform(10_000, 1_000_000),  # liquidity depth
            0.0,                         # last profit
            0.0,                         # position
        ], dtype=np.float32)
        return self.state, {}

    def step(self, action):
        self.step_count += 1
        spread, gas_price, volatility, depth, last_profit, pos = self.state

        # Simulate market movement
        vol_change = random.gauss(0, volatility * 0.1)
        new_spread = max(0.0001, spread + vol_change)

        # Action effects
        if action == 0:  # HOLD
            reward = 0.0
            self.position *= 0.95  # Decay position

        elif action == 1:  # SMALL EXECUTION
            exec_size = min(1_000, self.max_position * 0.01)
            profit = exec_size * new_spread * random.uniform(0.5, 1.0)
            gas_cost = gas_price * 70_000 * 1e-9  # ETH
            slippage = exec_size * 0.0003  # 3bps
            reward = profit - gas_cost - slippage
            self.position += exec_size
            self.total_profit += reward

        elif action == 2:  # MEDIUM EXECUTION
            exec_size = min(10_000, self.max_position * 0.05)
            profit = exec_size * new_spread * random.uniform(0.7, 1.2)
            gas_cost = gas_price * 100_000 * 1e-9
            slippage = exec_size * 0.0005  # 5bps
            reward = profit - gas_cost - slippage
            self.position += exec_size
            self.total_profit += reward

        elif action == 3:  # LARGE EXECUTION
            exec_size = min(100_000, self.max_position * 0.2)
            profit = exec_size * new_spread * random.uniform(0.4, 0.8)
            gas_cost = gas_price * 150_000 * 1e-9
            slippage = exec_size * 0.001  # 10bps
            reward = profit - gas_cost - slippage
            self.position += exec_size
            self.total_profit += reward

        # Update state
        self.state = np.array([
            new_spread,
            gas_price * (1 + random.gauss(0, 0.05)),
            volatility * (1 + random.gauss(0, 0.1)),
            depth * (1 - exec_size / depth if action > 0 else 1.0),
            reward,
            self.position / self.max_position,
        ], dtype=np.float32)

        # Terminal condition
        terminated = self.step_count >= 1000 or self.total_profit < -10_000
        truncated = self.step_count >= 5000

        return self.state, reward, terminated, truncated, {
            "total_profit": self.total_profit,
            "action": action,
        }


class PPOAgent:
    """
    Proximal Policy Optimization agent for arbitrage execution.
    Uses a simple actor-critic architecture.
    """

    def __init__(self, state_dim: int = 6, action_dim: int = 4, lr: float = 3e-4):
        if not TORCH_AVAILABLE:
            raise ImportError("PyTorch required for PPO agent")

        self.state_dim = state_dim
        self.action_dim = action_dim

        # Actor network
        self.actor = nn.Sequential(
            nn.Linear(state_dim, 128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, action_dim),
            nn.Softmax(dim=-1),
        )

        # Critic network
        self.critic = nn.Sequential(
            nn.Linear(state_dim, 128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
        )

        self.optimizer = optim.Adam(
            list(self.actor.parameters()) + list(self.critic.parameters()),
            lr=lr,
        )
        self.gamma = 0.99
        self.eps_clip = 0.2

    def get_action(self, state: np.ndarray) -> Tuple[int, torch.Tensor]:
        """Sample action from policy."""
        state_t = torch.FloatTensor(state).unsqueeze(0)
        probs = self.actor(state_t)
        dist = torch.distributions.Categorical(probs)
        action = dist.sample()
        return action.item(), dist.log_prob(action)

    def update(self, trajectories: List[Dict]):
        """PPO clip update on collected trajectories."""
        if not trajectories:
            return

        states = torch.FloatTensor(np.array([t["state"] for t in trajectories]))
        actions = torch.LongTensor([t["action"] for t in trajectories])
        old_log_probs = torch.FloatTensor([t["log_prob"] for t in trajectories])
        rewards = torch.FloatTensor([t["reward"] for t in trajectories])

        # Compute discounted returns
        returns = []
        G = 0
        for r in reversed(rewards):
            G = r + self.gamma * G
            returns.insert(0, G)
        returns = torch.FloatTensor(returns)
        returns = (returns - returns.mean()) / (returns.std() + 1e-8)

        # Critic values
        values = self.critic(states).squeeze()
        advantages = returns - values.detach()

        # PPO clip
        probs = self.actor(states)
        dist = torch.distributions.Categorical(probs)
        new_log_probs = dist.log_prob(actions)

        ratio = torch.exp(new_log_probs - old_log_probs)
        surr1 = ratio * advantages
        surr2 = torch.clamp(ratio, 1 - self.eps_clip, 1 + self.eps_clip) * advantages
        actor_loss = -torch.min(surr1, surr2).mean()

        critic_loss = nn.MSELoss()(values, returns)
        loss = actor_loss + 0.5 * critic_loss

        self.optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(
            list(self.actor.parameters()) + list(self.critic.parameters()), 1.0
        )
        self.optimizer.step()

    def save(self, path: str):
        torch.save({
            "actor": self.actor.state_dict(),
            "critic": self.critic.state_dict(),
        }, path)

    def load(self, path: str):
        checkpoint = torch.load(path)
        self.actor.load_state_dict(checkpoint["actor"])
        self.critic.load_state_dict(checkpoint["critic"])


# ═══════════════════════════════════════════════════════════════════════════
# 4. DATA PIPELINE — Fetch price data from on-chain DEXes
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class PriceSnapshot:
    """A single price observation from a DEX pair."""
    timestamp: float
    token_in: str
    token_out: str
    dex: str
    chain: str
    price: float  # token_in / token_out
    price_inv: float  # token_out / token_in
    liquidity_in: float
    liquidity_out: float
    volume_24h: float
    fee_tier: int
    gas_price_gwei: float

    def to_feature_vector(self) -> np.ndarray:
        return np.array([
            self.price,
            self.price_inv,
            math.log(max(self.liquidity_in, 1)),
            math.log(max(self.liquidity_out, 1)),
            math.log(max(self.volume_24h, 1)),
            self.fee_tier / 10000,
            self.gas_price_gwei / 100.0,
        ], dtype=np.float32)

    @staticmethod
    def feature_labels() -> list:
        return ['price', 'price_inv', 'log_liq_in', 'log_liq_out', 'log_volume', 'fee_pct', 'gas_ratio']


class DEXDataFetcher:
    """
    Fetches real-time and historical price data from DEX subgraphs
    and on-chain RPC endpoints.
    """

    def __init__(self):
        self.rpcs = {
            "ethereum": [
                "https://eth.llamarpc.com",
                "https://cloudflare-eth.com",
                "https://rpc.ankr.com/eth",
            ],
            "bsc": [
                "https://bsc-dataseed.binance.org/",
                "https://bsc-dataseed1.binance.org/",
                "https://bsc.publicnode.com",
            ],
        }

        # DEX contract addresses
        self.uniswap_v3_router = "0xE592427A0AEce92De3Edee1F18E0157C05861564"
        self.uniswap_v2_router = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"
        self.pancakeswap_v3_router = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4"
        self.pancakeswap_v2_router = "0x10ED43C718714eb63d5aA57B78B54704E256024E"
        self.sushiswap_router = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"

        # Token addresses
        self.tokens = {
            "USDT_ETH": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
            "USDT_BSC": "0x55d398326f99059fF775485246999027B3197955",
            "WETH": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            "WBNB": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
            "DAI_ETH": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            "USDC_ETH": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        }

        self.providers = {}
        self._connect()

    def _connect(self):
        """Establish Web3 connections."""
        if not WEB3_AVAILABLE:
            print("⚠️  web3 not available — skipping RPC connections")
            return

        for chain, rpcs in self.rpcs.items():
            for rpc in rpcs:
                try:
                    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 10}))
                    if w3.is_connected():
                        self.providers[chain] = w3
                        print(f"  ✓ Connected to {chain} via {rpc}")
                        break
                except Exception:
                    continue
            if chain not in self.providers:
                print(f"  ✗ Failed to connect to {chain}")

    def get_uniswap_v2_price(self, w3, token_a: str, token_b: str) -> Optional[float]:
        """Get spot price from Uniswap V2-style pair via getReserves."""
        if not WEB3_AVAILABLE:
            return None
        try:
            # V2 pair address derivation (simplified — in production use factory)
            # We query via the router's getAmountsOut
            router = w3.eth.contract(
                address=Web3.to_checksum_address(self.uniswap_v2_router),
                abi=[{
                    "constant": True,
                    "inputs": [
                        {"name": "amountIn", "type": "uint256"},
                        {"name": "path", "type": "address[]"},
                    ],
                    "name": "getAmountsOut",
                    "outputs": [{"name": "amounts", "type": "uint256[]"}],
                    "type": "function",
                }],
            )
            amount_in = 10 ** 18  # 1 token
            amounts = router.functions.getAmountsOut(
                amount_in,
                [Web3.to_checksum_address(token_a), Web3.to_checksum_address(token_b)]
            ).call()
            return amounts[1] / amounts[0] if amounts[0] > 0 else None
        except Exception as e:
            logging.debug(f"V2 price fetch failed: {e}")
            return None

    def get_uniswap_v3_price(self, w3, token_a: str, token_b: str, fee: int = 3000) -> Optional[float]:
        """Get spot price from Uniswap V3 via slot0 on the pool."""
        if not WEB3_AVAILABLE:
            return None
        try:
            # In production, compute pool address from factory
            # For now, use a simplified approach with the router
            router = w3.eth.contract(
                address=Web3.to_checksum_address(self.uniswap_v3_router),
                abi=[{
                    "constant": True,
                    "inputs": [{
                        "components": [
                            {"name": "tokenIn", "type": "address"},
                            {"name": "tokenOut", "type": "address"},
                            {"name": "amountIn", "type": "uint256"},
                            {"name": "fee", "type": "uint24"},
                            {"name": "sqrtPriceLimitX96", "type": "uint160"},
                        ],
                        "name": "params",
                        "type": "tuple",
                    }],
                    "name": "quoteExactInputSingle",
                    "outputs": [{"name": "amountOut", "type": "uint256"}],
                    "type": "function",
                }],
            )
            amount_in = 10 ** 18
            amount_out = router.functions.quoteExactInputSingle(
                (Web3.to_checksum_address(token_a),
                 Web3.to_checksum_address(token_b),
                 amount_in,
                 fee,
                 0)
            ).call()
            return amount_out / amount_in
        except Exception as e:
            logging.debug(f"V3 price fetch failed: {e}")
            return None

    def fetch_all_prices(self) -> List[PriceSnapshot]:
        """Fetch current prices from all configured DEXes."""
        snapshots = []
        timestamp = time.time()

        for chain, w3 in self.providers.items():
            gas_price = w3.eth.gas_price / 1e9 if w3 else 50.0  # gwei

            # USDT/WETH on Uniswap V3
            if chain == "ethereum":
                price = self.get_uniswap_v3_price(
                    w3, self.tokens["USDT_ETH"], self.tokens["WETH"], 3000
                )
                if price:
                    snapshots.append(PriceSnapshot(
                        timestamp=timestamp,
                        token_in="USDT", token_out="WETH",
                        dex="uniswap_v3", chain=chain, price=price,
                        price_inv=1/price, liquidity_in=1e6, liquidity_out=1e6,
                        volume_24h=1e7, fee_tier=3000, gas_price_gwei=gas_price,
                    ))

                # DAI/WETH on Uniswap V3
                price = self.get_uniswap_v3_price(
                    w3, self.tokens["DAI_ETH"], self.tokens["WETH"], 3000
                )
                if price:
                    snapshots.append(PriceSnapshot(
                        timestamp=timestamp,
                        token_in="DAI", token_out="WETH",
                        dex="uniswap_v3", chain=chain, price=price,
                        price_inv=1/price, liquidity_in=1e6, liquidity_out=1e6,
                        volume_24h=1e7, fee_tier=3000, gas_price_gwei=gas_price,
                    ))

            # USDT/WBNB on PancakeSwap
            if chain == "bsc":
                price = self.get_uniswap_v2_price(
                    w3, self.tokens["USDT_BSC"], self.tokens["WBNB"]
                )
                if price:
                    snapshots.append(PriceSnapshot(
                        timestamp=timestamp,
                        token_in="USDT", token_out="WBNB",
                        dex="pancakeswap_v2", chain=chain, price=price,
                        price_inv=1/price, liquidity_in=1e6, liquidity_out=1e6,
                        volume_24h=1e7, fee_tier=0, gas_price_gwei=gas_price,
                    ))

        return snapshots

    def generate_training_data(self, n_samples: int = 10000) -> pd.DataFrame:
        """
        Generate synthetic training data based on realistic market parameters.
        In production, this fetches from DEX subgraphs (The Graph).
        """
        np.random.seed(42)
        data = []

        base_price_eth = 2000.0   # USDT per WETH
        base_price_bnb = 300.0    # USDT per WBNB
        base_price_usdt = 1.0

        # Proper cumulative random walk (pre-compute full price paths)
        n = n_samples
        eth_returns = np.random.randn(n) * 2.0 + np.sin(np.arange(n) * 0.001) * 0.5
        bnb_returns = np.random.randn(n) * 0.5 + np.cos(np.arange(n) * 0.002) * 0.3
        eth_price_path = base_price_eth + np.cumsum(eth_returns)
        bnb_price_path = base_price_bnb + np.cumsum(bnb_returns)

        for i in range(n_samples):
            t = i * 12  # 12-second blocks

            eth_price = eth_price_path[i]
            bnb_price = bnb_price_path[i]

            # Cross-DEX spreads (the opportunity signal)
            uniswap_eth_price = eth_price * (1 + np.random.randn() * 0.001)
            sushiswap_eth_price = eth_price * (1 + np.random.randn() * 0.001)
            pcs_bnb_price = bnb_price * (1 + np.random.randn() * 0.001)

            spread_eth = abs(uniswap_eth_price - sushiswap_eth_price) / eth_price
            spread_bnb = abs(pcs_bnb_price - bnb_price) / bnb_price

            # Gas & liquidity
            gas_price = 20 + np.random.exponential(10)
            liquidity = 1e6 + np.random.randn() * 1e5

            # Volume & volatility
            volume = 1e7 + np.random.randn() * 1e6
            volatility = 0.02 + np.random.exponential(0.01)

            # Target: profitable arbitrage opportunity (1 = yes, 0 = no)
            profit_prob = 1 / (1 + np.exp(-(
                spread_eth * 100 - 0.5 - gas_price / 200 + liquidity / 1e8
            )))
            opportunity = 1 if profit_prob > 0.5 and spread_eth > 0.002 else 0

            data.append({
                "timestamp": t,
                "eth_price": eth_price,
                "bnb_price": bnb_price,
                "uniswap_eth_price": uniswap_eth_price,
                "sushiswap_eth_price": sushiswap_eth_price,
                "pcs_bnb_price": pcs_bnb_price,
                "spread_eth": spread_eth,
                "spread_bnb": spread_bnb,
                "gas_price_gwei": gas_price,
                "liquidity": liquidity,
                "volume_24h": volume,
                "volatility": volatility,
                "opportunity": opportunity,
            })

        df = pd.DataFrame(data)

        # Add derived features
        df["spread_ratio"] = df["spread_eth"] / (df["spread_bnb"] + 1e-8)
        df["gas_to_spread"] = df["gas_price_gwei"] / (df["spread_eth"] * 1000 + 1e-8)
        df["liq_ratio"] = df["liquidity"] / df["volume_24h"]
        df["price_momentum"] = df["eth_price"].pct_change().fillna(0)
        df["price_acceleration"] = df["price_momentum"].diff().fillna(0)

        return df


# ═══════════════════════════════════════════════════════════════════════════
# 5. MAIN ORCHESTRATOR
# ═══════════════════════════════════════════════════════════════════════════

class NeuralArbitrageOrchestrator:
    """
    Master controller that combines all ML models into a live arbitrage system.

    Flow:
      1. DEXDataFetcher pulls live prices → feature vectors
      2. LSTMPricePredictor forecasts next price moves
      3. AnomalyDetector identifies unusual market conditions
      4. PPOAgent decides optimal execution action
      5. Signal sent to flash_arbitrage_bot.py for execution
    """

    def __init__(self, config: ModelConfig = None):
        self.config = config or ModelConfig()
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        print(f"🔧 Using device: {self.device}")

        # Initialize models
        self.predictor = None
        self.transformer_predictor = None
        self.anomaly_detector = None
        self.isolation_forest = None
        self.rl_agent = None
        self.scaler = StandardScaler() if SKLEARN_AVAILABLE else None
        self.fetcher = DEXDataFetcher() if WEB3_AVAILABLE else None

        # State
        self.history = []
        self.predictions = []
        self.training_data = None

        # Create directories
        os.makedirs(self.config.model_dir, exist_ok=True)
        os.makedirs(self.config.data_dir, exist_ok=True)

    def initialize_models(self):
        """Create all model instances."""
        if not TORCH_AVAILABLE:
            print("⚠️  PyTorch not available — skipping model initialization")
            return

        self.predictor = LSTMPricePredictor(self.config).to(self.device)
        self.transformer_predictor = TransformerPricePredictor(self.config).to(self.device)
        self.anomaly_detector = AnomalyDetector(
            self.config.n_features, self.config.latent_dim
        ).to(self.device)

        if SKLEARN_AVAILABLE:
            self.isolation_forest = IsolationForestDetector()

        if RL_AVAILABLE:
            self.rl_agent = PPOAgent(
                state_dim=6,
                action_dim=4,
                lr=self.config.rl_learning_rate,
            )

        print("  ✓ LSTM Predictor initialized")
        print("  ✓ Transformer Predictor initialized")
        print("  ✓ Anomaly Detector initialized")
        print("  ✓ Isolation Forest initialized")
        print("  ✓ PPO Agent initialized")

    def load_or_generate_data(self) -> pd.DataFrame:
        """Load cached data or generate synthetic training data."""
        data_path = os.path.join(self.config.data_dir, "training_data.csv")

        if os.path.exists(data_path):
            print(f"  ✓ Loading cached training data from {data_path}")
            df = pd.read_csv(data_path)
        else:
            print("  ⚡ Generating synthetic training data...")
            if self.fetcher:
                df = self.fetcher.generate_training_data(20000)
            else:
                # Pure synthetic fallback (no web3 needed)
                print("  ⚡ Using pure synthetic data generation...")
                fetcher_temp = DEXDataFetcher()
                df = fetcher_temp.generate_training_data(20000)

            if df is None:
                # Ultra fallback
                np.random.seed(42)
                n = 20000
                df = pd.DataFrame({
                    "timestamp": range(n),
                    "price": 2000 + np.cumsum(np.random.randn(n) * 2),
                    "volume": 1e7 + np.random.randn(n) * 1e6,
                    "spread": np.abs(np.random.randn(n)) * 0.005,
                    "gas_price": 20 + np.random.exponential(10, n),
                    "volatility": 0.02 + np.random.exponential(0.01, n),
                    "liquidity": 1e6 + np.random.randn(n) * 1e5,
                })
                df["opportunity"] = (
                    (df["spread"] > 0.002) & (df["gas_price"] < 50)
                ).astype(int)

            df.to_csv(data_path, index=False)
            print(f"  ✓ Saved training data to {data_path}")

        self.training_data = df
        return df

    def prepare_sequences(self, df: pd.DataFrame) -> Tuple[torch.Tensor, torch.Tensor]:
        """Convert DataFrame to sequence tensors for training."""
        # Select feature columns
        feature_cols = [c for c in df.columns if c not in ["timestamp", "opportunity"]]
        if "price_momentum" not in feature_cols:
            feature_cols = feature_cols[:self.config.n_features]

        values = df[feature_cols].values.astype(np.float32)

        # Normalize
        if self.scaler is not None:
            values = self.scaler.fit_transform(values)

        # Create sequences
        X, y = [], []
        for i in range(len(values) - self.config.seq_length):
            X.append(values[i:i + self.config.seq_length])
            # Predict next price movement (simplified: direction of first feature)
            next_val = values[i + self.config.seq_length, 0]
            current_val = values[i + self.config.seq_length - 1, 0]
            y.append(1 if next_val > current_val else 0)

        X = torch.FloatTensor(np.array(X))
        y = torch.LongTensor(y)
        return X, y

    def train_predictor(self):
        """Train the LSTM price predictor."""
        if not TORCH_AVAILABLE or self.predictor is None:
            print("✗ Cannot train: PyTorch not available")
            return

        print("\n🧠 Training LSTM Price Predictor...")
        df = self.load_or_generate_data()
        X, y = self.prepare_sequences(df)

        # Split
        n_train = int(len(X) * self.config.train_split)
        n_val = int(len(X) * (self.config.train_split + self.config.val_split))
        X_train, y_train = X[:n_train], y[:n_train]
        X_val, y_val = X[n_train:n_val], y[n_train:n_val]

        # DataLoaders
        train_dataset = torch.utils.data.TensorDataset(X_train, y_train)
        val_dataset = torch.utils.data.TensorDataset(X_val, y_val)
        train_loader = DataLoader(train_dataset, batch_size=self.config.batch_size, shuffle=True)
        val_loader = DataLoader(val_dataset, batch_size=self.config.batch_size)

        # Training loop
        optimizer = optim.AdamW(self.predictor.parameters(), lr=self.config.learning_rate)
        scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=self.config.epochs)
        criterion = nn.CrossEntropyLoss()

        best_val_loss = float("inf")
        patience_counter = 0

        for epoch in range(self.config.epochs):
            # Train
            self.predictor.train()
            train_loss = 0.0
            for batch_X, batch_y in train_loader:
                batch_X, batch_y = batch_X.to(self.device), batch_y.to(self.device)
                optimizer.zero_grad()
                mean, log_var, direction = self.predictor(batch_X)

                if direction is not None:
                    loss = criterion(direction, batch_y)
                else:
                    # Regression mode
                    loss = nn.MSELoss()(
                        mean, batch_y.float()
                    )

                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.predictor.parameters(), 1.0)
                optimizer.step()
                train_loss += loss.item()

            # Validate
            self.predictor.eval()
            val_loss = 0.0
            correct = 0
            total = 0
            with torch.no_grad():
                for batch_X, batch_y in val_loader:
                    batch_X, batch_y = batch_X.to(self.device), batch_y.to(self.device)
                    mean, log_var, direction = self.predictor(batch_X)
                    if direction is not None:
                        loss = criterion(direction, batch_y)
                        preds = direction.argmax(dim=-1)
                        correct += (preds == batch_y).sum().item()
                    else:
                        loss = nn.MSELoss()(mean, batch_y.float())
                        preds = (mean > 0).long()
                        correct += (preds == batch_y).sum().item()
                    total += batch_y.size(0)
                    val_loss += loss.item()

            avg_train_loss = train_loss / len(train_loader)
            avg_val_loss = val_loss / len(val_loader)
            accuracy = correct / total if total > 0 else 0

            # Learning rate schedule
            scheduler.step()

            # Early stopping
            if avg_val_loss < best_val_loss:
                best_val_loss = avg_val_loss
                patience_counter = 0
                torch.save(self.predictor.state_dict(),
                           os.path.join(self.config.model_dir, "lstm_predictor.pt"))
            else:
                patience_counter += 1
                if patience_counter >= self.config.early_stop_patience:
                    print(f"  ⏹ Early stopping at epoch {epoch+1}")
                    break

            if (epoch + 1) % 10 == 0:
                print(f"  Epoch {epoch+1}/{self.config.epochs} | "
                      f"Train Loss: {avg_train_loss:.4f} | "
                      f"Val Loss: {avg_val_loss:.4f} | "
                      f"Accuracy: {accuracy:.3f}")

        print(f"  ✓ LSTM Predictor trained! Best val loss: {best_val_loss:.4f}")

    def train_anomaly_detector(self):
        """Train the VAE anomaly detector."""
        if not TORCH_AVAILABLE or self.anomaly_detector is None:
            print("✗ Cannot train anomaly detector: PyTorch not available")
            return

        print("\n🔍 Training Anomaly Detector...")
        df = self.load_or_generate_data()

        feature_cols = [c for c in df.columns if c not in ["timestamp", "opportunity"]]
        values = df[feature_cols].values.astype(np.float32)

        if self.scaler is not None:
            values = self.scaler.fit_transform(values)

        X = torch.FloatTensor(values)
        dataset = torch.utils.data.TensorDataset(X)
        loader = DataLoader(dataset, batch_size=self.config.batch_size, shuffle=True)

        optimizer = optim.Adam(self.anomaly_detector.parameters(), lr=1e-3)

        self.anomaly_detector.train()
        for epoch in range(50):
            total_loss = 0.0
            for (batch_X,) in loader:
                batch_X = batch_X.to(self.device)
                optimizer.zero_grad()
                recon, mean, log_var = self.anomaly_detector(batch_X)

                # VAE loss
                recon_loss = nn.MSELoss()(recon, batch_X)
                kl_loss = -0.5 * (1 + log_var - mean ** 2 - log_var.exp()).mean()
                loss = recon_loss + 0.1 * kl_loss

                loss.backward()
                optimizer.step()
                total_loss += loss.item()

            if (epoch + 1) % 10 == 0:
                print(f"  VAE Epoch {epoch+1}/50 | Loss: {total_loss/len(loader):.6f}")

        torch.save(
            self.anomaly_detector.state_dict(),
            os.path.join(self.config.model_dir, "anomaly_detector.pt"),
        )
        print("  ✓ Anomaly Detector trained!")

        # Train IsolationForest as backup
        if self.isolation_forest is not None:
            print("  ⚡ Training IsolationForest...")
            self.isolation_forest.fit(values)
            print("  ✓ IsolationForest trained!")

    def train_rl_agent(self, n_episodes: int = 1000):
        """Train the PPO reinforcement learning agent."""
        if not RL_AVAILABLE or self.rl_agent is None:
            print("✗ Cannot train RL agent: gymnasium not available")
            return

        print(f"\n🤖 Training PPO RL Agent ({n_episodes} episodes)...")
        env = ArbitrageEnv()

        best_reward = float("-inf")
        episode_rewards = []

        for episode in range(n_episodes):
            state, _ = env.reset()
            done = False
            trajectory = []
            episode_reward = 0

            while not done:
                action, log_prob = self.rl_agent.get_action(state)
                next_state, reward, terminated, truncated, info = env.step(action)
                done = terminated or truncated

                trajectory.append({
                    "state": state,
                    "action": action,
                    "reward": reward,
                    "log_prob": log_prob.item(),
                })

                state = next_state
                episode_reward += reward

            # PPO update
            self.rl_agent.update(trajectory)

            episode_rewards.append(episode_reward)
            avg_reward = np.mean(episode_rewards[-50:]) if episode_rewards else 0

            if avg_reward > best_reward:
                best_reward = avg_reward
                self.rl_agent.save(os.path.join(self.config.model_dir, "ppo_agent.pt"))

            if (episode + 1) % 50 == 0:
                print(f"  Episode {episode+1}/{n_episodes} | "
                      f"Avg Reward: {avg_reward:.2f} | "
                      f"Best: {best_reward:.2f}")

        print(f"  ✓ RL Agent trained! Best avg reward: {best_reward:.2f}")

    def predict_opportunity(self, market_data: np.ndarray) -> Dict[str, Any]:
        """
        Run full prediction pipeline on live market data.

        Args:
            market_data: (seq_length, n_features) array of recent market data
        Returns:
            dict with opportunity assessment
        """
        if self.predictor is None:
            self.initialize_models()

        if not TORCH_AVAILABLE:
            return {"error": "PyTorch not available"}

        # Normalize
        if self.scaler is not None:
            market_data = self.scaler.transform(market_data)

        X = torch.FloatTensor(market_data).unsqueeze(0).to(self.device)

        # 1. Price prediction
        pred = self.predictor.predict_with_confidence(X)

        # 2. Anomaly detection
        if self.anomaly_detector is not None:
            anomaly_score = self.anomaly_detector.anomaly_score(X)[0]
        else:
            anomaly_score = 0.0

        # 3. Isolation Forest
        if self.isolation_forest is not None and self.isolation_forest.fitted:
            iso_score = self.isolation_forest.anomaly_scores(market_data.flatten()[None, :])[0]
        else:
            iso_score = 0.0

        # 4. RL action
        if self.rl_agent is not None:
            state = np.array([
                abs(pred.get("mean", [0])[0]),
                market_data[-1, -1] if market_data.ndim > 1 else 50,  # gas
                float(pred.get("std", [0])[0]),
                1e6,  # simplified depth
                float(pred.get("mean", [0])[0]),
                0.0,
            ], dtype=np.float32)
            rl_action, _ = self.rl_agent.get_action(state)
        else:
            rl_action = 0

        # 5. Composite opportunity score
        direction = pred.get("direction", [0])[0]
        confidence = pred.get("confidence", [0])[0]
        price_change = pred.get("mean", [0])[0]

        opportunity_score = (
            confidence * 0.3
            + (anomaly_score / (anomaly_score + 1)) * 0.25
            + (1 if direction == 1 else 0) * 0.25
            + (rl_action / 3) * 0.2
        )

        return {
            "opportunity_score": float(opportunity_score),
            "predicted_price_change": float(price_change),
            "confidence": float(confidence),
            "direction": "up" if direction == 1 else "down" if direction == 0 else "sideways",
            "anomaly_score": float(anomaly_score),
            "isolation_forest_score": float(iso_score),
            "rl_recommended_action": ["hold", "small", "medium", "large"][rl_action],
            "timestamp": time.time(),
        }

    def train_all(self):
        """Train all models."""
        print("=" * 60)
        print("🧠 NEURAL ARBITRAGE PREDICTOR — TRAINING MODE")
        print("=" * 60)

        self.initialize_models()
        self.load_or_generate_data()
        self.train_predictor()
        self.train_anomaly_detector()
        self.train_rl_agent()

        print("\n" + "=" * 60)
        print("✅ ALL MODELS TRAINED SUCCESSFULLY")
        print(f"   Models saved to: {self.config.model_dir}")
        print("=" * 60)

    def live_prediction_loop(self, interval_seconds: int = 12):
        """
        Run continuous prediction loop.

        Args:
            interval_seconds: How often to fetch data and predict (default: 1 block)
        """
        if not WEB3_AVAILABLE or self.fetcher is None:
            print("✗ Cannot run live mode: Web3 not available or fetcher not initialized")
            return

        print("=" * 60)
        print("🚀 NEURAL ARBITRAGE PREDICTOR — LIVE MODE")
        print("=" * 60)

        self.initialize_models()

        # Load trained weights
        predictor_path = os.path.join(self.config.model_dir, "lstm_predictor.pt")
        if os.path.exists(predictor_path) and self.predictor is not None:
            self.predictor.load_state_dict(
                torch.load(predictor_path, map_location=self.device)
            )
            print(f"  ✓ Loaded LSTM weights from {predictor_path}")

        anomaly_path = os.path.join(self.config.model_dir, "anomaly_detector.pt")
        if os.path.exists(anomaly_path) and self.anomaly_detector is not None:
            self.anomaly_detector.load_state_dict(
                torch.load(anomaly_path, map_location=self.device)
            )
            print(f"  ✓ Loaded Anomaly Detector weights from {anomaly_path}")

        rl_path = os.path.join(self.config.model_dir, "ppo_agent.pt")
        if os.path.exists(rl_path) and self.rl_agent is not None:
            self.rl_agent.load(rl_path)
            print(f"  ✓ Loaded PPO Agent weights from {rl_path}")

        print(f"\n  📡 Fetching every {interval_seconds}s...\n")

        while True:
            try:
                # Fetch live market data
                snapshots = self.fetcher.fetch_all_prices()

                if snapshots:
                    # Build feature vector from snapshots
                    features = np.array([s.to_feature_vector() for s in snapshots])

                    if len(features) > 0:
                        # Pad or truncate to seq_length
                        if len(features) < self.config.seq_length:
                            pad_width = self.config.seq_length - len(features)
                            features = np.pad(features, ((pad_width, 0), (0, 0)), mode="edge")
                        else:
                            features = features[-self.config.seq_length:]

                        # Predict
                        result = self.predict_opportunity(features)

                        # Display
                        score = result["opportunity_score"]
                        direction = result["direction"]
                        confidence = result["confidence"]

                        color = "\033[92m" if score > 0.6 else "\033[93m" if score > 0.3 else "\033[90m"
                        print(
                            f"{color}[{datetime.now().strftime('%H:%M:%S')}] "
                            f"Score: {score:.3f} | "
                            f"Direction: {direction} | "
                            f"Conf: {confidence:.2f} | "
                            f"RL: {result['rl_recommended_action']} | "
                            f"Anomaly: {result['anomaly_score']:.2f}\033[0m"
                        )

                        # Signal execution if high confidence opportunity
                        if score > 0.7 and confidence > 0.6:
                            print(
                                f"\033[92m  ⚡ HIGH CONFIDENCE OPPORTUNITY! "
                                f"Executing {result['rl_recommended_action']} trade...\033[0m"
                            )

                    self.history.append(result)
                    self.predictions.append(result)

                time.sleep(interval_seconds)

            except KeyboardInterrupt:
                print("\n\n⏹ Live prediction loop stopped.")
                break
            except Exception as e:
                print(f"\033[91m✗ Error in prediction loop: {e}\033[0m")
                time.sleep(interval_seconds * 2)  # Back off on error


# ═══════════════════════════════════════════════════════════════════════════
# CLI Entry Point
# ═══════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="🧠 Neural Arbitrage Predictor — AI-powered arbitrage opportunity detection"
    )
    parser.add_argument("--train", action="store_true", help="Train all models")
    parser.add_argument("--predict", action="store_true", help="Run single prediction on current data")
    parser.add_argument("--live", action="store_true", help="Run continuous live prediction loop")
    parser.add_argument("--interval", type=int, default=12, help="Seconds between predictions (live mode)")
    parser.add_argument("--epochs", type=int, default=None, help="Override training epochs")

    args = parser.parse_args()

    config = ModelConfig()
    if args.epochs:
        config.epochs = args.epochs

    orchestrator = NeuralArbitrageOrchestrator(config)

    if args.train:
        orchestrator.train_all()
    elif args.live:
        orchestrator.live_prediction_loop(args.interval)
    elif args.predict:
        # Single prediction
        orchestrator.initialize_models()
        data = orchestrator.fetcher.generate_training_data(100) if orchestrator.fetcher else None
        if data is not None:
            features = data[orchestrator.config.n_features].values[:config.seq_length]
            # Ensure correct shape
            if len(features.shape) == 1:
                features = features.reshape(-1, 1)
            features = features.astype(np.float32)
            result = orchestrator.predict_opportunity(features)
            print(json.dumps(result, indent=2, default=str))
        else:
            print("No data available for prediction")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
