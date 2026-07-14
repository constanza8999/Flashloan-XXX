import { ethers } from 'ethers'

const ERC20_META_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
]

/**
 * Fetch token decimals from the chain.
 */
export async function getTokenDecimals(provider, address) {
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
