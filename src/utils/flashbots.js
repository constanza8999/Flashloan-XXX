import { ethers } from 'ethers'
import { ETH_PROTECT_RPC, FLASHBOTS_RELAY_RPC } from '../constants'

/**
 * Build a raw signed transaction object suitable for a Flashbots bundle.
 * @param {ethers.Wallet|ethers.Signer} signer - The wallet or signer to sign the tx
 * @param {object} tx - The transaction object (to, value, data, gasLimit, chainId, etc.)
 * @returns {Promise<string>} - The raw signed transaction hex
 */
export async function signTxForBundle(signer, tx) {
  const signedTx = await signer.signTransaction(tx)
  return signedTx
}

/**
 * Get the current gas price from the network.
 * Uses eth_gasPrice RPC directly (works on EIP-1559 networks where feeData.gasPrice is null).
 * @param {ethers.Provider} provider - Any Ethereum provider
 * @returns {Promise<bigint>} - Current gas price in wei
 */
export async function getGasPrice(provider) {
  try {
    const gasPrice = await provider.send('eth_gasPrice', [])
    return BigInt(gasPrice)
  } catch {
    // Fallback to a reasonable minimum for mainnet
    return ethers.parseUnits('5', 'gwei')
  }
}

/**
 * Submit a signed transaction directly via Flashbots Protect RPC (eth_sendRawTransaction).
 * This works from browsers (CORS-enabled) and provides MEV protection.
 *
 * @param {string} signedTx - The raw signed transaction hex
 * @returns {Promise<{ok: boolean, txHash?: string, error?: string}>}
 */
export async function sendPrivateTx(signedTx) {
  if (!signedTx) {
    return { ok: false, error: 'No signed transaction provided' }
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_sendRawTransaction',
    params: [signedTx],
  })

  try {
    const response = await fetch(ETH_PROTECT_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    if (!response.ok) {
      return { ok: false, error: `Flashbots RPC returned ${response.status}: ${response.statusText}` }
    }

    const data = await response.json()

    if (data.error) {
      return { ok: false, error: data.error.message || JSON.stringify(data.error) }
    }

    // eth_sendRawTransaction returns the transaction hash on success
    const txHash = data.result
    if (!txHash || txHash === '0x' + '0'.repeat(64)) {
      return { ok: false, error: 'Flashbots RPC returned invalid tx hash' }
    }

    return { ok: true, txHash }
  } catch (err) {
    // Catch network errors (CORS, DNS, timeout, etc.)
    const msg = err.message || 'Failed to submit transaction'
    return { ok: false, error: msg }
  }
}

/**
 * Submit a signed transaction via the Flashbots Relay as a bundle (eth_sendBundle).
 * The Relay bundles the tx with MEV protection and submits to validators directly.
 * Unlike Protect RPC (simple eth_sendRawTransaction), Relay uses the Flashbots
 * Bundle API which offers stronger privacy guarantees.
 *
 * @param {string} signedTx - The raw signed transaction hex
 * @param {object} options
 * @param {bigint|number} options.blockNumber - The target block number for the bundle
 * @param {bigint|number} [options.minTimestamp] - Optional minimum timestamp (seconds)
 * @param {bigint|number} [options.maxTimestamp] - Optional maximum timestamp (seconds)
 * @returns {Promise<{ok: boolean, bundleHash?: string, txHash?: string, error?: string}>}
 */
export async function sendFlashbotsBundle(signedTx, options) {
  if (!signedTx) {
    return { ok: false, error: 'No signed transaction provided' }
  }

  if (!options || !options.blockNumber) {
    return { ok: false, error: 'blockNumber is required for Relay bundle submission' }
  }

  const blockHex = '0x' + BigInt(options.blockNumber).toString(16)

  // Build the eth_sendBundle params
  const bundleParams = {
    txs: [signedTx],
    blockNumber: blockHex,
  }

  // Optional timestamps
  if (options.minTimestamp !== undefined && options.minTimestamp !== null) {
    bundleParams.minTimestamp = '0x' + BigInt(options.minTimestamp).toString(16)
  }
  if (options.maxTimestamp !== undefined && options.maxTimestamp !== null) {
    bundleParams.maxTimestamp = '0x' + BigInt(options.maxTimestamp).toString(16)
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_sendBundle',
    params: [bundleParams],
  })

  try {
    const response = await fetch(FLASHBOTS_RELAY_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    if (!response.ok) {
      return { ok: false, error: `Flashbots Relay returned ${response.status}: ${response.statusText}` }
    }

    const data = await response.json()

    if (data.error) {
      return { ok: false, error: data.error.message || JSON.stringify(data.error) }
    }

    const bundleHash = data.result?.bundleHash
    if (!bundleHash) {
      return { ok: false, error: 'Flashbots Relay returned no bundleHash' }
    }

    return { ok: true, bundleHash }
  } catch (err) {
    const msg = err.message || 'Failed to submit bundle to Flashbots Relay'
    return { ok: false, error: msg }
  }
}
