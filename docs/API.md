# API Reference

## Blockchain Interaction Methods

This document describes the core blockchain interaction methods used throughout the application. All methods use **ethers.js v6**.

---

### `connect(rpcs)`

Connects to the first available RPC endpoint from a list.

**Parameters:**
- `rpcs: string[]` — Array of RPC URLs

**Returns:** `Promise<ethers.JsonRpcProvider>`

**Throws:** If no RPC is reachable

**Used by:** All components via the `useProvider` hook

---

### `getTokenDecimals(provider, address)`

Fetches the decimals of an ERC20/BEP20 token contract.

**Parameters:**
- `provider: ethers.Provider` — Connected RPC provider
- `address: string` — Token contract address

**Returns:** `Promise<number>` — Number of decimal places

**Example:**
```javascript
const decimals = await getTokenDecimals(provider, '0xdAC17F958D2ee523a2206206994597C13D831ec7')
// Returns 6 for USDT on Ethereum
```

---

### `getTokenSymbol(provider, address)`

Fetches the symbol of an ERC20/BEP20 token contract.

**Parameters:**
- `provider: ethers.Provider` — Connected RPC provider
- `address: string` — Token contract address

**Returns:** `Promise<string>` — Token symbol (e.g. "USDT")

---

### `getTokenName(provider, address)`

Fetches the full name of an ERC20/BEP20 token contract.

**Parameters:**
- `provider: ethers.Provider` — Connected RPC provider
- `address: string` — Token contract address

**Returns:** `Promise<string>` — Token name (e.g. "Tether USD")

---

### `encodeTransfer(to, amountWei, selector)`

ABI-encodes an ERC20/BEP20 `transfer(address,uint256)` function call.

**Parameters:**
- `to: string` — Recipient address (will be checksummed)
- `amountWei: bigint | string` — Amount in the smallest unit (wei-equivalent)
- `selector: string` (optional) — Function selector, defaults to `'a9059cbb'`

**Returns:** `string` — Hex-encoded transaction data

**Example:**
```javascript
const data = encodeTransfer(
  '0x9850f7eEAbe8E4FfF2662652aFF28b3De14C53F6',
  ethers.parseUnits('100', 18),
  '0xa9059cbb'
)
// Returns: 0xa9059cbb0000000000000000000000009850f7eeabe8e4fff2662652aff28b3de14c53f6000000000000000000000000000000000000000000056bc75e2d63100000
```

---

### `estimateEip1559(provider, priorityGwei, maxFeeGwei)`

Estimates EIP-1559 fee parameters (`maxPriorityFeePerGas`, `maxFeePerGas`).

**Parameters:**
- `provider: ethers.Provider` — Connected RPC provider
- `priorityGwei: string` — Priority fee in Gwei
- `maxFeeGwei: string` (optional) — Max fee in Gwei (auto-derived if omitted)

**Returns:** `object`
- `maxPriorityFeePerGas: bigint` — In wei
- `maxFeePerGas: bigint` — In wei

---

### `sendTransaction(wallet, tx)`

Signs and sends a transaction, then waits for confirmation.

**Parameters:**
- `wallet: ethers.Wallet` — Signing wallet instance
- `tx: ethers.TransactionRequest` — Transaction object

**Returns:** `Promise<object>`
- `hash: string` — Transaction hash
- `blockNumber: number` — Block number of confirmation
- `receipt: ethers.ContractTransactionReceipt` — Full receipt

---

### EIP-1559 Transaction Object

```javascript
{
  to: '0x...',                    // Token contract address
  value: 0n,                      // No native coin sent
  gasLimit: 100000n,             // Max gas units
  nonce: 5,                       // Sender's current nonce
  chainId: 56,                    // BSC = 56, ETH = 1
  maxPriorityFeePerGas: 1000000000n,   // 1 Gwei
  maxFeePerGas: 30000000000n,         // 30 Gwei
  data: '0xa9059cbb...',              // Encoded transfer data
}
```

---

## Custom React Hooks

### `useProvider(rpcs)`

Connects to the first available RPC in a list and returns the provider.

**Parameters:**
- `rpcs: string[]` — Array of RPC URLs

**Returns:** `ethers.JsonRpcProvider | null`

**Usage:**
```javascript
import { useProvider } from '../hooks'
import { BSC_RPCS } from '../constants'

function MyComponent() {
  const provider = useProvider(BSC_RPCS)
  // provider is null while connecting, then available
}
```
