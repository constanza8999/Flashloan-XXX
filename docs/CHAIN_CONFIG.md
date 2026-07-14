# Chain Configuration

## Supported Networks

| Network | Chain ID | Native Token | RPC Endpoints | Block Explorer |
|---------|----------|-------------|---------------|----------------|
| Binance Smart Chain | 56 | BNB | 5 public RPCs | [BscScan](https://bscscan.com) |
| Ethereum | 1 | ETH | 3 public RPCs + Flashbots | [Etherscan](https://etherscan.io) |

## Token Standards

| Chain | Standard | Example | Decimal Note |
|-------|----------|---------|--------------|
| **BSC** | BEP20 | BSC-USD | USDT = 18 decimals (⚠️ different from ETH) |
| **ETH** | ERC20 | Tether USD | USDT = 6 decimals (⚠️ different from BSC) |

## RPC Endpoints

### Binance Smart Chain (BSC)

```javascript
const BSC_RPCS = [
  'https://bsc-dataseed.binance.org/',        // Primary
  'https://bsc-dataseed1.defibit.io/',        // Mirror 1
  'https://bsc-dataseed1.ninicoin.io/',       // Mirror 2
  'https://bsc-dataseed2.defibit.io/',        // Mirror 3
  'https://bsc.publicnode.com',               // Public node
]
```

Notes:
- All endpoints are public and free-tier
- Rate limits apply (typically ~100 req/sec)
- For production, use a dedicated node service

### Ethereum (ETH)

```javascript
const ETH_RPCS = [
  'https://eth.llamarpc.com',          // Llama RPC (public)
  'https://cloudflare-eth.com',        // Cloudflare (public)
  'https://rpc.etherbase.com',         // Etherbase (public)
]

const ETH_PROTECT_RPC = 'https://rpc.flashbots.net'  // Flashbots Protect
```

Notes:
- Flashbots Protect RPC routes transactions through MEV-aware block builders
- Standard gas fees apply (ETH required for gas)
- No special API key required for basic usage

## Popular Tokens

### BSC (BEP20)

| Symbol | Address | Decimals |
|--------|---------|----------|
| **USDT** | `0x55d398326f99059fF775485246999027B3197955` | 18 |
| **USDC** | `0x8ac76a51cc950d9922a3688cd78fa7a438cc87e7` | 18 |
| **BUSD** | `0xe9e7cea3dedca5984780bafc599bd70ad0889439` | 18 |
| **DAI** | `0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3` | 18 |
| **WBNB** | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` | 18 |
| **BTCB** | `0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c` | 18 |
| **ETH** | `0x2170Ed0880ac9A755fd29B2688956BD959F933F8` | 18 |
| **CAKE** | `0x0E09FaBB73bd3aDe0a17ECC321fD13a19e81d82F` | 18 |
| **XRP** | `0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE` | 6 |
| **ADA** | `0x3EE2200Efb3400fAbB9A4F7d4c4F87b1acF4A091` | 6 |
| **DOGE** | `0xbA2aE424d96c24cA7021aeFA44901958Df5477aA` | 8 |
| **DOT** | `0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402` | 10 |
| **LINK** | `0xF8A0BF9cF54Bb92F17374d9e9A321E6f111A0B18` | 18 |
| **MATIC** | `0xCC42724C6683B7E573F7d1e4A4120f3aD4E4C5bA` | 18 |

### Ethereum (ERC20)

| Symbol | Address | Decimals |
|--------|---------|----------|
| **USDT** | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | **6** ⚠️ |
| **USDC** | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` | **6** ⚠️ |
| **DAI** | `0x6B175474E89094C44Da98b954EedeAC495271d0F` | 18 |
| **WETH** | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | 18 |
| **WBTC** | `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` | 8 |
| **stETH** | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` | 18 |
| **USDS** | `0xdC035D45d8E79868B3CC61c8d68c6c1FE3b9bDa1` | 18 |
| **UNI** | `0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984` | 18 |
| **LINK** | `0x514910771AF9Ca656af840dff83E8264EcF986CA` | 18 |
| **AAVE** | `0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DcE09` | 18 |

## ⚠️ Critical: Decimal Differences

**USDT has different decimals on each chain:**
- **BSC (BSC-USD):** 18 decimals — `send("0x...", 100)` sends 100 × 10^18
- **ETH (Tether):** 6 decimals — `send("0x...", 100)` sends 100 × 10^6

This means **100 USDT on BSC ≠ 100 USDT on ETH** at the contract level. The app auto-detects and validates this, but always verify in the transaction preview.

## How to Add a New Chain

To add support for a new chain (e.g., Polygon, Arbitrum):

1. **Add RPC endpoints** to `src/constants.js`:
   ```javascript
   export const POLYGON_RPCS = [
     'https://polygon-rpc.com',
     'https://rpc-mainnet.maticvigil.com',
   ]
   ```

2. **Add chain ID:**
   ```javascript
   export const POLYGON_CHAIN_ID = 137
   ```

3. **Add token catalog:**
   ```javascript
   export const POPULAR_POLYGON = {
     USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
     USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
     // ...
   }
   ```

4. **Add decimal cache:**
   ```javascript
   const _POLYGON_DECIMALS = {
     USDT: 6, USDC: 6, // ...
   }
   ```

5. **Create a new component** or extend existing ones with chain selection.
