import React, { useState, useMemo } from 'react'
import useTransactionHistory from '../hooks/useTransactionHistory'

function formatTime(ts) {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch { /* clipboard not available */ }
}

function StatusBadge({ status }) {
  if (status === 'confirmed') return <span className="th-status confirmed">Confirmed</span>
  if (status === 'failed') return <span className="th-status failed">Failed</span>
  return <span className="th-status pending">Pending</span>
}

function MethodBadge({ method }) {
  if (method === 'wallet') return <span className="th-method wallet">🦊 Wallet</span>
  return <span className="th-method key">🔑 Key</span>
}

export default function TransactionHistory() {
  const { txs, clearHistory, removeTx, totalCount } = useTransactionHistory()
  const [chainFilter, setChainFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const [showConfirmClear, setShowConfirmClear] = useState(false)

  const filtered = useMemo(() => {
    return txs.filter(tx => {
      if (chainFilter !== 'all' && !tx.chain.toLowerCase().includes(chainFilter)) return false
      if (statusFilter !== 'all' && tx.status !== statusFilter) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        return (
          tx.txHash?.toLowerCase().includes(q) ||
          tx.recipient?.toLowerCase().includes(q) ||
          tx.sender?.toLowerCase().includes(q) ||
          tx.tokenSymbol?.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [txs, chainFilter, statusFilter, searchQuery])

  const handleCopy = async (id, hash) => {
    await copyToClipboard(hash)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  const chainCounts = useMemo(() => {
    const counts = {}
    txs.forEach(tx => {
      const key = tx.chain || 'Unknown'
      counts[key] = (counts[key] || 0) + 1
    })
    return counts
  }, [txs])

  if (totalCount === 0) {
    return (
      <div className="tool-page">
        <div className="tool-header">
          <span className="tool-icon">📜</span>
          <div>
            <h2>Transaction History</h2>
            <p>Track and review your past token transfers</p>
          </div>
        </div>
        <div className="th-empty">
          <span className="th-empty-icon">📭</span>
          <h3>No transactions yet</h3>
          <p>When you send tokens using Send BSC, Send ETH, or Flash Send, they will appear here automatically.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">📜</span>
        <div>
          <h2>Transaction History</h2>
          <p>{totalCount} transaction{totalCount !== 1 ? 's' : ''} recorded</p>
        </div>
      </div>

      {/* Filters */}
      <div className="th-filters">
        <div className="th-filter-row">
          <div className="th-filter-group">
            <label>Chain</label>
            <select value={chainFilter} onChange={e => setChainFilter(e.target.value)} className="input th-select">
              <option value="all">All Chains</option>
              <option value="bsc">BSC</option>
              <option value="eth">Ethereum</option>
              <option value="flashbots">ETH (Flashbots)</option>
              <option value="polygon">Polygon</option>
              <option value="arbitrum">Arbitrum</option>
            </select>
          </div>

          <div className="th-filter-group">
            <label>Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input th-select">
              <option value="all">All Status</option>
              <option value="confirmed">Confirmed</option>
              <option value="broadcast">Broadcast</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div className="th-filter-group th-search-group">
            <label>Search</label>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search hash, address, token..."
              className="input th-search-input"
            />
          </div>

          <div className="th-filter-group th-action-group">
            <label>&nbsp;</label>
            {showConfirmClear ? (
              <div className="th-confirm-clear">
                <span>Clear all {totalCount} records?</span>
                <button className="btn btn-danger th-btn-sm" onClick={() => { clearHistory(); setShowConfirmClear(false) }}>Yes</button>
                <button className="btn th-btn-sm" onClick={() => setShowConfirmClear(false)} style={{ background: 'var(--bg-card)' }}>Cancel</button>
              </div>
            ) : (
              <button className="btn th-btn-sm" onClick={() => setShowConfirmClear(true)} style={{ background: 'var(--accent-red-dim)', color: '#fca5a5' }}>
                🗑 Clear History
              </button>
            )}
          </div>
        </div>

        {/* Chain summary chips */}
        <div className="th-chain-chips">
          {Object.entries(chainCounts).map(([chain, count]) => (
            <span key={chain} className="th-chain-chip">
              {chain === 'BSC' ? '⛓' : chain.includes('Flashbots') ? '🛡' : chain === 'Polygon' ? '🔶' : chain === 'Arbitrum' ? '🌀' : '🔷'} {chain}
              <span className="th-chip-count">{count}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Transaction List */}
      <div className="th-list">
        {filtered.length === 0 ? (
          <div className="th-empty-small">
            No transactions match your filters.
          </div>
        ) : (
          filtered.map(tx => (
            <div key={tx.id} className={`th-card ${tx.status}`}>
              <div className="th-card-header">
                <div className="th-card-left">
                  <span className="th-card-chain">
                    {tx.chain === 'BSC' ? '⛓' : tx.chain?.includes('Flashbots') ? '🛡' : tx.chain === 'Polygon' ? '🔶' : tx.chain === 'Arbitrum' ? '🌀' : '🔷'}
                  </span>
                  <div className="th-card-meta">
                    <span className="th-card-symbol">{tx.tokenSymbol || '?'}</span>
                    <span className="th-card-amount">{tx.amount}</span>
                  </div>
                </div>
                <div className="th-card-right">
                  <StatusBadge status={tx.status} />
                  <span className="th-card-time">{formatTime(tx.timestamp)}</span>
                </div>
              </div>

              <div className="th-card-body">
                <div className="th-card-row">
                  <span className="th-label">TX Hash</span>
                  <span className="th-value mono">{tx.txHash?.slice(0, 16)}...{tx.txHash?.slice(-8)}</span>
                  <button
                    className="th-copy-btn"
                    onClick={() => handleCopy(tx.id, tx.txHash)}
                    title="Copy hash"
                  >
                    {copiedId === tx.id ? '✓' : '📋'}
                  </button>
                  {tx.explorerUrl && (
                    <a href={tx.explorerUrl} target="_blank" rel="noopener noreferrer" className="th-explorer-link" title="Open explorer">
                      ↗
                    </a>
                  )}
                </div>

                <div className="th-card-row">
                  <span className="th-label">From</span>
                  <span className="th-value mono">{tx.sender?.slice(0, 10)}...{tx.sender?.slice(-6)}</span>
                </div>

                <div className="th-card-row">
                  <span className="th-label">To</span>
                  <span className="th-value mono">{tx.recipient?.slice(0, 10)}...{tx.recipient?.slice(-6)}</span>
                </div>

                <div className="th-card-footer-row">
                  <MethodBadge method={tx.method} />
                  {tx.blockNumber && (
                    <span className="th-block">Block {tx.blockNumber}</span>
                  )}
                  <button
                    className="th-remove-btn"
                    onClick={() => removeTx(tx.id)}
                    title="Remove from history"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <p className="th-note">
        💾 Transaction history is stored locally in your browser. Clearing browser data will remove it.
      </p>
    </div>
  )
}
