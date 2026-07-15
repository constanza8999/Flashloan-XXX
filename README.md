# Multi-Chain Token Toolkit

<div align="center">

[![Deploy to GitHub Pages](https://github.com/constanza8999/Flashloan-XXX/actions/workflows/deploy.yml/badge.svg)](https://github.com/constanza8999/Flashloan-XXX/actions/workflows/deploy.yml)
[![Live Site](https://img.shields.io/badge/%F0%9F%8C%90-Live%20Site-3b82f6?style=flat-square)](https://constanza8999.github.io/Flashloan-XXX/)
[![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react)](https://react.dev)
[![ethers.js](https://img.shields.io/badge/ethers.js-v6-2536c7?style=flat-square)](https://docs.ethers.org)

</div>

A comprehensive single-page React application for multi-chain token transfers, combining all the functionality from the original Python CLI tools into a beautiful, responsive web interface.

## Features

- **⛓ Send BSC Tokens** — Transfer any BEP20 token on Binance Smart Chain with EIP-1559 fee estimation, dry-run mode, and full transaction preview
- **🛡 Send ETH via Flashbots** — Send ERC20 tokens on Ethereum mainnet through Flashbots Protect RPC for MEV protection
- **◎ Token Info** — Look up token decimals, symbol, name, total supply, and wallet balance from any contract address
- **⚡ Auto-Send Bot** — Schedule automatic BSC token transfers at configurable intervals with pause/resume/stop controls
- **👁 Mempool Watcher** — Monitor pending transactions on BSC or Ethereum in real-time
- **⚙ Flash Send (Legacy)** — Quick USDT send on Ethereum with optional Telegram notification

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Installation

```bash
# Install dependencies
npm install

# Start the development server
npm run dev

# Build for production
npm run build

# Preview the production build
npm run preview
```

The app will be available at `http://localhost:3000`.

## Tech Stack

- **React 18** — UI framework
- **Vite** — Build tool and dev server
- **ethers.js v6** — Ethereum/BSC blockchain interaction
- **Pure CSS** — Dark theme with responsive design (no external CSS frameworks)

## Environment

This is a client-only application. Private keys are used in-browser via ethers.js for signing and are never sent to any server. Blockchain interaction happens through public RPC endpoints.

## Security Notes

- **Private keys never leave your browser** — All signing happens client-side via ethers.js
- **Flashbots Protect is used for ETH sends** — MEV protection by routing through Flashbots-aware block builders
- **Real gas fees apply** — Mainnet transactions require ETH/BNB for gas
- **Decimal awareness** — USDT is 6 decimals on Ethereum, 18 decimals on BSC. The app auto-detects and validates this
