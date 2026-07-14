import { ethers } from 'ethers'
import { KNOWN_TOKEN_DECIMALS } from './constants'

const ERC20_META_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
]

/**
 * Fetch token decimals from the chain.
 * Uses cached KNOWN_TOKEN_DECIMALS first to avoid expensive RPC calls.
 */
export async function getTokenDecimals(provider, address) {
  const key = address.toLowerCase()
  // Return cached decimals instantly — no RPC call needed for known tokens
  if (KNOWN_TOKEN_DECIMALS[key] !== undefined) {
    return KNOWN_TOKEN_DECIMALS[key]
  }
  // Fall back to on-chain lookup for unknown tokens
  const contract = new ethers.Contract(address, ERC20_META_ABI, provider)
  return Number(await contract.decimals())
}

/**
 * Fetch token symbol from the chain.
 */
export async function getTokenSymbol(provider, address) {
  const contract = new ethers.Contract(address, ERC20_META_ABI, provider)
  return await contract.symbol()
}

/**
 * Fetch token name from the chain.
 */
export async function getTokenName(provider, address) {
  const contract = new ethers.Contract(address, ERC20_META_ABI, provider)
  return await contract.name()
}

/**
 * Encode an ERC20/BEP20 transfer(address,uint256) call data.
 */
export function encodeTransfer(to, amountWei, selector = 'a9059cbb') {
  return selector +
    to.slice(2).toLowerCase().padStart(64, '0') +
    amountWei.toString(16).padStart(64, '0')
}
