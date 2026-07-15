import { ethers } from 'ethers'

// RPC endpoints
export const BSC_RPCS = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.binance.org/',
  'https://bsc-dataseed2.binance.org/',
  'https://bsc-dataseed3.binance.org/',
  'https://bsc-dataseed4.binance.org/',
  'https://bsc.publicnode.com',
  'https://binance.llamarpc.com',
]

export const ETH_RPCS = [
  'https://eth.llamarpc.com',
  'https://cloudflare-eth.com',
  'https://rpc.ankr.com/eth',
  'https://ethereum-rpc.publicnode.com',
  'https://eth.drpc.org',
]

export const ETH_PROTECT_RPC = 'https://rpc.flashbots.net'
export const FLASHBOTS_RELAY_RPC = 'https://relay.flashbots.net'

// Polygon RPCs
export const POLYGON_RPCS = [
  'https://polygon-rpc.com',
  'https://rpc-mainnet.maticvigil.com',
  'https://rpc-mainnet.matic.network',
  'https://polygon.llamarpc.com',
]

// Arbitrum RPCs
export const ARBITRUM_RPCS = [
  'https://arb1.arbitrum.io/rpc',
  'https://arbitrum.llamarpc.com',
  'https://arbitrum-mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
]

// Token contracts
export const BSC_USDT = '0x55d398326f99059fF775485246999027B3197955'
export const ETH_USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'

// Chain IDs
export const BSC_CHAIN_ID = 56
export const ETH_CHAIN_ID = 1
export const POLYGON_CHAIN_ID = 137
export const ARBITRUM_CHAIN_ID = 42161

// ERC20/BEP20 transfer(address,uint256) selector
export const TRANSFER_SELECTOR = '0xa9059cbb'

// ─── DEX Router Addresses ────────────────────────────────────────────────
export const UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564'
export const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
export const SUSHISWAP_ROUTER = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F'
export const PANCAKESWAP_V3_ROUTER = '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4'
export const PANCAKESWAP_V2_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E'
export const AAVE_V3_POOL_PROVIDER_ETH = '0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e'
export const AAVE_V3_POOL_PROVIDER_BSC = '0x0180085d4546857dfF58223c6c97C3A000A85501'
export const ZEROX_EXCHANGE_PROXY = '0xdef1c0ded9bec7f1a1670819833240f027b25eff'

// ─── Token Addresses ─────────────────────────────────────────────────────
// Token contract addresses (some already defined above)
export const ETH_WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
export const ETH_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
export const ETH_DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
export const BSC_WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
export const BSC_USDC = '0x8ac76a51cc950d9922a3688cd78fa7a438cc87e7'
export const BSC_BTCB = '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c'
export const BSC_WETH = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8'

// Native token constants
export const NATIVE_TOKEN = 'NATIVE'
export const NATIVE_ETH_DECIMALS = 18
export const NATIVE_ETH_SYMBOL = 'ETH'
export const NATIVE_SEND_GAS = 21000

// Gas defaults
export const DEFAULT_BSC_GAS = 100000
export const DEFAULT_ETH_GAS = 100000
export const DEFAULT_POLYGON_GAS = 200000
export const DEFAULT_ARBITRUM_GAS = 300000

// Popular BEP20 tokens on BSC
export const POPULAR_BEP20 = {
  USDT:  '0x55d398326f99059fF775485246999027B3197955',
  USDC:  '0x8ac76a51cc950d9922a3688cd78fa7a438cc87e7',
  BUSD:  '0xe9e7cea3dedca5984780bafc599bd70ad0889439',
  DAI:   '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
  BTCB:  '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
  ETH:   '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  WBNB:  '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  CAKE:  '0x0E09FaBB73bd3aDe0a17ECC321fD13a19e81d82F',
  XRP:   '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE',
  ADA:   '0x3EE2200Efb3400fAbB9A4F7d4c4F87b1acF4A091',
  DOGE:  '0xbA2aE424d96c24cA7021aeFA44901958Df5477aA',
  DOT:   '0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402',
  LINK:  '0xF8A0BF9cF54Bb92F17374d9e9A321E6f111A0B18',
  MATIC: '0xCC42724C6683B7E573F7d1e4A4120f3aD4E4C5bA',
}

// Popular tokens on Polygon
export const POPULAR_POLYGON = {
  USDT:  '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  USDC:  '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  USDCe: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  DAI:   '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
  WETH:  '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  WBTC:  '0x1bfd67037b42cf73acF2047067bd4F2C47D9BfD6',
  LINK:  '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39',
  WMATIC:'0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  CRV:   '0x172370d5Cd63279eFa6d502DAB29171933a610AF',
  AAVE:  '0xD6DF932A45C0f255f85145f286eA0b292B21C90B',
}

// Popular tokens on Arbitrum
export const POPULAR_ARBITRUM = {
  USDT:  '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  USDC:  '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  USDCe: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
  DAI:   '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
  WETH:  '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  WBTC:  '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  ARB:   '0x912CE59144291C1204dE78fC2D2A8EaFB0C6e5c1',
  LINK:  '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4',
  UNI:   '0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0',
  GMX:   '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a',
}

// Popular ERC20 tokens on Ethereum
export const POPULAR_ERC20 = {
  USDT:  '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  USDC:  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  DAI:   '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  WETH:  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  WBTC:  '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  stETH: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
  USDS:  '0xdC035D45d8E79868B3CC61c8d68c6c1FE3b9bDa1',
  UNI:   '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
  LINK:  '0x514910771AF9Ca656af840dff83E8264EcF986CA',
  AAVE:  '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DcE09',
}

// Known token decimals cache (address -> decimals)
const _KNOWN_DECIMALS = {}

const _BSC_DECIMALS = {
  USDT: 18, USDC: 18, BUSD: 18, DAI: 18,
  WBNB: 18, BTCB: 18, ETH: 18, LINK: 18,
  CAKE: 18, MATIC: 18, XRP: 6, ADA: 6,
  DOGE: 8, DOT: 10,
}

const _ETH_DECIMALS = {
  USDT: 6, USDC: 6, DAI: 18, WETH: 18,
  WBTC: 8, stETH: 18, USDS: 18,
  UNI: 18, LINK: 18, AAVE: 18,
}

const _POLYGON_DECIMALS = {
  USDT: 6, USDC: 6, USDCe: 6, DAI: 18,
  WETH: 18, WBTC: 8, LINK: 18, WMATIC: 18,
  CRV: 18, AAVE: 18,
}

const _ARBITRUM_DECIMALS = {
  USDT: 6, USDC: 6, USDCe: 6, DAI: 18,
  WETH: 18, WBTC: 8, ARB: 18, LINK: 18,
  UNI: 18, GMX: 18,
}

Object.entries(_BSC_DECIMALS).forEach(([sym, dec]) => {
  const addr = POPULAR_BEP20[sym]
  if (addr) _KNOWN_DECIMALS[addr.toLowerCase()] = dec
})

Object.entries(_ETH_DECIMALS).forEach(([sym, dec]) => {
  const addr = POPULAR_ERC20[sym]
  if (addr) _KNOWN_DECIMALS[addr.toLowerCase()] = dec
})

Object.entries(_POLYGON_DECIMALS).forEach(([sym, dec]) => {
  const addr = POPULAR_POLYGON[sym]
  if (addr) _KNOWN_DECIMALS[addr.toLowerCase()] = dec
})

Object.entries(_ARBITRUM_DECIMALS).forEach(([sym, dec]) => {
  const addr = POPULAR_ARBITRUM[sym]
  if (addr) _KNOWN_DECIMALS[addr.toLowerCase()] = dec
})

export const KNOWN_TOKEN_DECIMALS = _KNOWN_DECIMALS
