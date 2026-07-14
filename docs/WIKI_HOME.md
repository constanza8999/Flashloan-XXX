# Flashloan-XXX Wiki

Welcome to the **Flashloan-XXX** wiki — a multi-chain token transfer toolkit with a beautiful React interface.

## 🚀 Quick Links

| | |
|---|---|
| [📖 Architecture](ARCHITECTURE.md) | Learn about the app's internal design |
| [🛠 Setup Guide](SETUP.md) | Install, configure, and deploy |
| [🔒 Security Model](SECURITY.md) | How we keep your keys safe |
| [📚 API Reference](API.md) | Blockchain interaction methods |
| [🧩 Component Docs](COMPONENTS.md) | UI component tree and props |
| [⛓ Chain Config](CHAIN_CONFIG.md) | Supported chains, tokens, RPCs |

---

## ✨ Features

### ⛓ Send BSC Tokens
Transfer any BEP20 token on **Binance Smart Chain** with EIP-1559 fee estimation, dry-run mode, and full transaction preview.

### 🛡 Send ETH via Flashbots
Send ERC20 tokens on **Ethereum mainnet** through the **Flashbots Protect RPC** for MEV protection — no sandwich attacks.

### ◎ Token Info Lookup
Query any token contract for decimals, symbol, name, total supply, and wallet balance. Supports both BSC and Ethereum.

### ⚡ Auto-Send Bot
Schedule automatic BSC token transfers at configurable intervals. Features pause/resume/stop controls, live logs, and safety limits.

### 👁 Mempool Watcher
Monitor pending transactions on BSC or Ethereum in real-time. Read-only — never signs or submits transactions.

### ⚙ Flash Send (Legacy)
Quick USDT send on Ethereum using Infura RPC with optional **Telegram notification** via bot API.

---

## 🏗 Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 18 | UI framework |
| Vite | 6 | Build tool |
| ethers.js | 6 | Blockchain interaction |
| Pure CSS | — | Styling (dark theme) |

## 🔐 Security Philosophy

- **Private keys never leave your browser** — all signing is done client-side
- **No backend server** — purely static frontend
- **No cookies, no localStorage for keys** — ephemeral in-memory only
- **Flashbots Protection** — ETH transactions bypass the public mempool

## 🌐 Supported Networks

| Network | Chain ID | Native Coin | Token Standard |
|---------|----------|-------------|----------------|
| Binance Smart Chain | 56 | BNB | BEP20 |
| Ethereum | 1 | ETH | ERC20 |

## 📦 Project Status

**Version:** 1.0.0  
**License:** MIT  
**Repository:** [github.com/constanza8999/Flashloan-XXX](https://github.com/constanza8999/Flashloan-XXX)
