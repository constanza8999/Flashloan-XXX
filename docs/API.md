# API Reference

## Blockchain Interaction Methods

This document describes the core blockchain interaction methods used throughout the application. All methods use **ethers.js v6**.

---

### `getTokenDecimals(provider, address)`

Fetches the decimals of an ERC20/BEP20 token contract.

**Source:** `src/utils.js`

**Parameters:**
- `provider: ethers.Provider` — Connected RPC provider
- `address: string` — Token contract address

**Returns:** `Promise<number>` — Number of decimal places

**Example:**
```javascript
import { getTokenDecimals } from '../utils'

const decimals = await getTokenDecimals(provider, '0xdAC17F958D2ee523a2206206994597C13D831ec7')
// Returns 6 for USDT on Ethereum
```

---

### `getTokenSymbol(provider, address)`

Fetches the symbol of an ERC20/BEP20 token contract.

**Source:** `src/utils.js`

**Parameters:**
- `provider: ethers.Provider` — Connected RPC provider
- `address: string` — Token contract address

**Returns:** `Promise<string>` — Token symbol (e.g. "USDT")

---

### `getTokenName(provider, address)`

Fetches the full name of an ERC20/BEP20 token contract.

**Source:** `src/utils.js`

**Parameters:**
- `provider: ethers.Provider` — Connected RPC provider
- `address: string` — Token contract address

**Returns:** `Promise<string>` — Token name (e.g. "Tether USD")

---

### `encodeTransfer(to, amountWei, selector)`

ABI-encodes an ERC20/BEP20 `transfer(address,uint256)` function call.

**Source:** `src/utils.js`

**Parameters:**
- `to: string` — Recipient address (will be checksummed)
- `amountWei: bigint | string` — Amount in the smallest unit (wei-equivalent)
- `selector: string` (optional) — Function selector, defaults to `'a9059cbb'`

**Returns:** `string` — Hex-encoded transaction data

**Example:**
```javascript
import { encodeTransfer } from '../utils'

const data = encodeTransfer(
  '0x9850f7eEAbe8E4FfF2662652aFF28b3De14C53F6',
  ethers.parseUnits('100', 18),
  '0xa9059cbb'
)
```

---

### `useProvider(rpcs)` (Custom Hook)

Connects to the first available RPC in a list and returns the provider.

**Source:** `src/hooks.js`

**Parameters:**
- `rpcs: string[]` — Array of RPC URLs

**Returns:** `ethers.JsonRpcProvider | null` (null while connecting)

**Usage:**
```javascript
import { useProvider } from '../hooks'
import { BSC_RPCS } from '../constants'

function MyComponent() {
  const provider = useProvider(BSC_RPCS)
  // provider is null while connecting, then available
}
```

---

### EIP-1559 Fee Estimation (Inlined per Component)

EIP-1559 fee estimation (`maxPriorityFeePerGas`, `maxFeePerGas`) is implemented **inline** within the `SendBSC.jsx` and `SendETH.jsx` components (not extracted to a shared utility). The logic:

```javascript
// Inside handlePreview() in SendBSC.jsx / SendETH.jsx
const feeData = await w3.getFeeData()
const priority = ethers.parseUnits(priorityGwei, 'gwei')
const maxFee = maxFeeGwei
  ? ethers.parseUnits(maxFeeGwei, 'gwei')
  : feeData.maxFeePerGas || (feeData.gasPrice || ethers.parseUnits('20', 'gwei'))
```

If `maxFeeGwei` is explicitly provided, it's used directly. Otherwise, the latest block's `baseFeePerGas` is read and the priority tip is added to it.

---

### EIP-1559 Transaction Object

```javascript
{
  to: '0x...',                    // Token contract address
  value: 0n,                      // No native coin sent
  gasLimit: 100000n,             // Max gas units
  nonce: 5,                       // Sender's current nonce
  chainId: 56,                    // BSC = 56, ETH = 1
  maxPriorityFeePerGas: 1000000000n,   // 1 Gwei (priority tip)
  maxFeePerGas: 30000000000n,         // 30 Gwei (base fee + tip)
  data: '0xa9059cbb...',              // Encoded transfer(address,uint256)
}
```

---

### Transaction Flow

1. **Build**: Construct the transaction object with `to`, `value`, `gasLimit`, `nonce`, `chainId`, fee params, and encoded `data`
2. **Sign**: `wallet.signTransaction(tx)` or `wallet.sendTransaction(tx)` using ethers.js `Wallet` from private key
3. **Submit**: `provider.send('eth_sendRawTransaction', [signedTx])` — sent through public RPC (BSC) or Flashbots Protect RPC (ETH)
4. **Confirm**: `provider.waitForTransaction(hash)` — returns receipt with block number, gas used, status
