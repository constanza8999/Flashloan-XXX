import { ethers } from 'ethers'

// RPC endpoints
export const BSC_RPCS = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.defibit.io/',
  'https://bsc-dataseed1.ninicoin.io/',
  'https://bsc-dataseed2.defibit.io/',
  'https://bsc.publicnode.com',
]

export const ETH_RPCS = [
  'https://eth.llamarpc.com',
  'https://cloudflare-eth.com',
  'https://rpc.etherbase.com',
]

export const ETH_PROTECT_RPC = 'https://rpc.flashbots.net'

// Token contracts
export const BSC_USDT = '0x55d398326f99059fF775485246999027B3197955'
export const ETH_USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'

// Chain IDs
export const BSC_CHAIN_ID = 56
export const ETH_CHAIN_ID = 1

// ERC20/BEP20 transfer(address,uint256) selector
export const TRANSFER_SELECTOR = '0xa9059cbb'

// Gas defaults
export const DEFAULT_BSC_GAS = 100000
export const DEFAULT_ETH_GAS = 100000

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

Object.entries(_BSC_DECIMALS).forEach(([sym, dec]) => {
  const addr = POPULAR_BEP20[sym]
  if (addr) _KNOWN_DECIMALS[addr.toLowerCase()] = dec
})

Object.entries(_ETH_DECIMALS).forEach(([sym, dec]) => {
  const addr = POPULAR_ERC20[sym]
  if (addr) _KNOWN_DECIMALS[addr.toLowerCase()] = dec
})

export const KNOWN_TOKEN_DECIMALS = _KNOWN_DECIMALS
