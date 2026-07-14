import { ethers } from 'ethers'
import { FLASHBOTS_RELAY_RPC } from '../constants'

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
 * Compute the next valid block number for a Flashbots bundle.
 * Returns the current block + 1 (best for single-block bundles).
 * @param {ethers.Provider} provider - An Ethereum provider
 * @returns {Promise<number>} - Target block number
 */
export async function getNextBlockNumber(provider) {
  const block = await provider.getBlock('latest')
  return block.number + 1
}

/**
 * Submit a bundle to the Flashbots relay.
 * 
 * Authentication: The request body is signed with the user's private key
 * to produce the X-Flashbots-Signature header.
 * 
 * @param {string[]} signedTxs - Array of raw signed transaction hex strings
 * @param {number} blockNumber - Target block number for the bundle
 * @param {ethers.Wallet|ethers.Signer} authSigner - Signer used to authenticate with Flashbots relay
 * @param {object} [opts] - Optional parameters
 * @param {number} [opts.minTimestamp] - Minimum Unix timestamp
 * @param {number} [opts.maxTimestamp] - Maximum Unix timestamp
 * @param {string[]} [opts.revertingTxHashes] - TX hashes allowed to revert
 * @param {string} [opts.replacementUuid] - UUID to replace a previous bundle
 * @returns {Promise<{ok: boolean, bundleHash?: string, error?: string}>}
 */
export async function submitBundle(signedTxs, blockNumber, authSigner, opts = {}) {
  if (!signedTxs || signedTxs.length === 0) {
    return { ok: false, error: 'No transactions in bundle' }
  }
  if (!authSigner) {
    return { ok: false, error: 'Auth signer is required to sign the bundle request' }
  }

  const params = {
    txs: signedTxs,
    blockNumber: '0x' + blockNumber.toString(16),
  }

  if (opts.minTimestamp !== undefined) params.minTimestamp = opts.minTimestamp
  if (opts.maxTimestamp !== undefined) params.maxTimestamp = opts.maxTimestamp
  if (opts.revertingTxHashes && opts.revertingTxHashes.length > 0) params.revertingTxHashes = opts.revertingTxHashes
  if (opts.replacementUuid) params.replacementUuid = opts.replacementUuid

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_sendBundle',
    params: [params],
  })

  try {
    // Sign the request body for X-Flashbots-Signature
    const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(body))
    const flatSig = await authSigner.signMessage(ethers.getBytes(payloadHash))
    const signature = flatSig

    const address = await authSigner.getAddress()

    const response = await fetch(FLASHBOTS_RELAY_RPC, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flashbots-Signature': `${address}:${signature}`,
      },
      body,
    })

    const data = await response.json()

    if (data.error) {
      return { ok: false, error: data.error.message || JSON.stringify(data.error) }
    }

    // Flashbots relay returns bundleHash on success
    const bundleHash = data.result?.bundleHash || null
    return { ok: true, bundleHash }
  } catch (err) {
    return { ok: false, error: err.message || 'Failed to submit bundle' }
  }
}

/**
 * Check the status of a submitted bundle by its hash.
 * @param {string} bundleHash - The bundle hash from submitBundle
 * @param {ethers.Wallet|ethers.Signer} authSigner - Signer for authentication
 * @returns {Promise<{ok: boolean, status?: string, error?: string}>}
 */
export async function getBundleStatus(bundleHash, authSigner) {
  if (!bundleHash) return { ok: false, error: 'Bundle hash required' }
  if (!authSigner) return { ok: false, error: 'Auth signer required' }

  const params = { bundleHash }
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'flashbots_getBundleStats',
    params: [params],
  })

  try {
    const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(body))
    const flatSig = await authSigner.signMessage(ethers.getBytes(payloadHash))
    const address = await authSigner.getAddress()

    const response = await fetch(FLASHBOTS_RELAY_RPC, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flashbots-Signature': `${address}:${flatSig}`,
      },
      body,
    })

    const data = await response.json()
    if (data.error) {
      return { ok: false, error: data.error.message || JSON.stringify(data.error) }
    }
    return { ok: true, status: data.result }
  } catch (err) {
    return { ok: false, error: err.message || 'Failed to get bundle status' }
  }
}
