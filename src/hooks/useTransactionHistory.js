import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'flashloan_tx_history'
const MAX_TXS = 100

/**
 * A transaction record stored in history.
 * @typedef {Object} TxRecord
 * @property {string} id - Unique ID (timestamp + random)
 * @property {number} timestamp - Unix ms
 * @property {string} chain - 'BSC' | 'ETH (Flashbots)' | 'ETH'
 * @property {string} tokenSymbol - e.g. 'USDT'
 * @property {string} tokenAddress - Contract address
 * @property {string} amount - Human-readable amount
 * @property {string} recipient - Recipient address
 * @property {string} sender - Sender address
 * @property {string} txHash - Transaction hash
 * @property {string} explorerUrl - Link to block explorer
 * @property {string} status - 'confirmed' | 'pending' | 'failed'
 * @property {number} blockNumber - Block number
 * @property {string} method - 'wallet' | 'key'
 * @property {string} [error] - Error message if failed
 */

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

function saveHistory(txs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(txs))
  } catch (e) {
    console.warn('Failed to save tx history:', e)
  }
}

/**
 * Hook for managing transaction history stored in localStorage.
 */
export default function useTransactionHistory() {
  const [txs, setTxs] = useState([])

  // Load on mount
  useEffect(() => {
    setTxs(loadHistory())
  }, [])

  const addTx = useCallback((record) => {
    const newTx = {
      id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      status: 'confirmed',
      ...record,
    }

    setTxs(prev => {
      const updated = [newTx, ...prev].slice(0, MAX_TXS)
      saveHistory(updated)
      return updated
    })

    return newTx.id
  }, [])

  const addFailedTx = useCallback((record) => {
    const newTx = {
      id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      status: 'failed',
      ...record,
    }
    setTxs(prev => {
      const updated = [newTx, ...prev].slice(0, MAX_TXS)
      saveHistory(updated)
      return updated
    })
    return newTx.id
  }, [])

  /**
   * Update an existing transaction's status and optional fields.
   * Used to mark broadcast transactions as confirmed once mined.
   * @param {string} id - The tx ID returned by addTx
   * @param {string} status - 'confirmed' | 'failed' | 'broadcast'
   * @param {object} [extra] - Extra fields to merge (e.g. blockNumber, blockHash)
   */
  const updateTxStatus = useCallback((id, status, extra = {}) => {
    setTxs(prev => {
      const updated = prev.map(t => {
        if (t.id !== id) return t
        return { ...t, status, ...extra }
      })
      saveHistory(updated)
      return updated
    })
  }, [])

  const clearHistory = useCallback(() => {
    setTxs([])
    saveHistory([])
  }, [])

  const removeTx = useCallback((id) => {
    setTxs(prev => {
      const updated = prev.filter(t => t.id !== id)
      saveHistory(updated)
      return updated
    })
  }, [])

  return {
    txs,
    addTx,
    addFailedTx,
    updateTxStatus,
    clearHistory,
    removeTx,
    totalCount: txs.length,
  }
}
