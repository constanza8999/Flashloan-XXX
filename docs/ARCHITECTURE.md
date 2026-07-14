# Architecture

## Overview

Flashloan-XXX is a **client-only single-page application (SPA)** built with React 18 that provides a multi-chain token transfer interface. It runs entirely in the browser — no backend server required.

```
┌──────────────────────────────────────────────────────────────┐
│                        Browser (SPA)                         │
│                                                              │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌────────────┐  │
│  │Dashboard │  │ Send BSC │  │ Send ETH  │  │ Token Info │  │
│  │  (Home)  │  │  (BEP20) │  │(Flashbots)│  │  (Lookup)  │  │
│  └─────────┘  └────┬─────┘  └─────┬─────┘  └─────┬──────┘  │
│                    │              │              │          │
│  ┌────────────┐    │              │              │          │
│  │ Auto Bot   │◄───┘              │              │          │
│  │(Scheduled) │                   │              │          │
│  └────────────┘                   │              │          │
│  ┌────────────┐  ┌────────────┐   │              │          │
│  │ Mempool    │  │ Flash Send │   │              │          │
│  │ Watcher    │  │  (Legacy)  │   │              │          │
│  └────────────┘  └────────────┘   │              │          │
│                    │              │              │          │
│                    ▼              ▼              ▼          │
│              ┌──────────────────────────────────────┐       │
│              │         ethers.js (v6)               │       │
│              │  Provider • Signer • Contract ABI    │       │
│              └──────────┬───────────────────────────┘       │
│                         │                                   │
│                         ▼                                   │
│              ┌──────────────────────┐                       │
│              │   Public RPC Nodes   │                       │
│              │   BSC • ETH • FB     │                       │
│              └──────────────────────┘                       │
└──────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **UI Framework** | React 18 | Component-based UI |
| **Build Tool** | Vite 6 | Fast dev server & bundling |
| **Blockchain** | ethers.js v6 | RPC calls, signing, contract interaction |
| **Styling** | Pure CSS (no frameworks) | Dark theme, responsive layout |
| **Fonts** | Inter + JetBrains Mono | Typography |

## Project Structure

```
/
├── index.html                 # SPA entry point
├── package.json               # Dependencies & scripts
├── vite.config.js             # Vite configuration
├── README.md                  # Project overview
├── .gitignore                 # Git ignore rules
├── docs/                      # Documentation
│   ├── ARCHITECTURE.md        # This file
│   ├── SETUP.md               # Setup & deployment
│   ├── SECURITY.md            # Security model
│   ├── API.md                 # Blockchain API reference
│   ├── WIKI_HOME.md           # Wiki home page
│   ├── COMPONENTS.md          # Component tree & docs
│   └── CHAIN_CONFIG.md        # Chain & token config
├── public/                    # Static assets (if any)
├── src/
│   ├── main.jsx               # React entry point
│   ├── App.jsx                # Root component, tabs, layout
│   ├── styles.css             # Global styles
│   ├── constants.js           # RPCs, tokens, chain config
│   ├── hooks.js               # Custom React hooks
│   ├── utils.js               # Shared utility functions
│   └── components/
│       ├── Dashboard.jsx      # Home / overview page
│       ├── SendBSC.jsx        # BSC token transfer
│       ├── SendETH.jsx        # ETH Flashbots transfer
│       ├── TokenInfo.jsx      # Token metadata lookup
│       ├── AutoBot.jsx        # Scheduled transfers
│       ├── MempoolWatcher.jsx # Pending tx monitor
│       └── FlashSend.jsx      # Legacy send with Telegram
└── dist/                      # Build output (generated)
```

## Data Flow

### Transaction Flow (Send BSC / Send ETH)

```
User fills form
      │
      ▼
Preview Transaction
      │
      ├── Connect to RPC (public node)
      ├── Fetch nonce, fee data, token decimals
      ├── Build EIP-1559 transaction object
      ├── Encode ERC20 transfer data
      └── Display preview with all parameters
      │
      ▼
User confirms → Sign with private key (ethers.Wallet)
      │
      ▼
Send raw transaction via RPC
      │
      ▼
Wait for receipt → Display transaction hash & explorer link
```

### Auto-Bot Flow

```
User configures params (amount, interval, token, recipient)
      │
      ▼
Start Bot → Async loop:
  ├── 1. Connect to BSC RPC
  ├── 2. Get nonce, fee data for sender
  ├── 3. Build & sign transaction
  ├── 4. Submit to mempool
  ├── 5. Wait for receipt
  ├── 6. Log result → update stats
  └── 7. Countdown → repeat (or stop if max reached)
      │
      ▼
User: Pause | Resume | Stop (via AbortController)
```

## Key Design Decisions

1. **Client-only**: No backend. Private keys never leave the browser. All blockchain interaction happens via public RPCs + ethers.js.
2. **No MetaMask dependency**: Keys are entered directly for programmatic signing. This matches the original Python CLI workflow.
3. **EIP-1559**: Uses `maxPriorityFeePerGas` + `maxFeePerGas` for efficient fee market pricing.
4. **Chain-aware decimals**: USDT is 6 decimals on ETH, 18 on BSC. Decimal cache in constants.js auto-detects and validates.
5. **Flashbots for ETH**: ETH sends route through `rpc.flashbots.net` for MEV protection.
