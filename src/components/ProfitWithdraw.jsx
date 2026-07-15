import React, { useState, useCallback } from 'react'
import { ethers } from 'ethers'
import { ETH_RPCS, BSC_RPCS, DEFAULT_RECIPIENT } from '../constants'
import { useProvider } from '../hooks'
import { useWeb3 } from '../context/Web3Context'

const CHAINS = {
  ethereum: {
    label: 'Ethereum (ETH)',
    rpcs: ETH_RPCS,
    icon: '🔵',
    explorer: 'https://etherscan.io',
    nativeSymbol: 'ETH',
  },
  bsc: {
    label: 'BNB Smart Chain (BSC)',
    rpcs: BSC_RPCS,
    icon: '🟡',
    explorer: 'https://bscscan.com',
    nativeSymbol: 'BNB',
  },
}

const KNOWN_TOKENS = {
  USDT: { label: 'USDT', icon: '💵' },
  WETH: { label: 'WETH / WBNB', icon: '🔷' },
}

export default function ProfitWithdraw() {
  const [chain, setChain] = useState('ethereum')
  const [token, setToken] = useState('')
  const [destination, setDestination] = useState(DEFAULT_RECIPIENT)
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [balancesLoading, setBalancesLoading] = useState(false)
  const [balances, setBalances] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const chainCfg = CHAINS[chain]

  const fetchBalances = useCallback(async () => {
    setBalancesLoading(true)
    setError('')
    try {
      const resp = await fetch('/api/balances')
      const data = await resp.json()
      if (data.error) {
        setError(data.error)
        return
      }
      setBalances(data)
    } catch (err) {
      setError(`Failed to fetch balances: ${err.message}`)
    } finally {
      setBalancesLoading(false)
    }
  }, [])

  const handleWithdraw = useCallback(async (isSweep = false) => {
    setError('')
    setResult(null)

    if (!destination || !ethers.isAddress(destination)) {
      setError('Please enter a valid destination address')
      return
    }

    if (!isSweep && !confirm(`Withdraw funds to ${destination.slice(0, 10)}...?`)) {
      return
    }

    if (isSweep && !confirm(`⚠️ Sweep ALL funds from ${chain} contract to ${destination.slice(0, 10)}...? This will send multiple transactions.`)) {
      return
    }

    setLoading(true)
    try {
      const endpoint = isSweep ? '/api/sweep' : '/api/withdraw'
      const body = { chain, destination }
      if (!isSweep && token) body.token = token
      if (!isSweep && amount) body.amount = amount

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await resp.json()
      if (data.success) {
        setResult(data)
        // Refresh balances after a delay
        setTimeout(fetchBalances, 5000)
      } else {
        setError(data.error || data.detail || 'Transaction failed')
      }
    } catch (err) {
      setError(`Network error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [chain, token, amount, destination, fetchBalances])

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">💸</span>
        <div>
          <h2>Profit Withdraw</h2>
          <p>Withdraw arbitrage profits from the FlashArbitrage contract</p>
        </div>
      </div>

      {/* Contract Balances */}
      <div className="stat-card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, color: '#ccc' }}>💰 Contract Balances</h3>
          <button
            className="btn btn-secondary"
            style={{ fontSize: 11, padding: '6px 12px' }}
            onClick={fetchBalances}
            disabled={balancesLoading}
          >
            {balancesLoading ? '⏳' : '🔄 Refresh'}
          </button>
        </div>
        {balances ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {Object.entries(balances).map(([c, data]) => {
              const cfg = CHAINS[c]
              if (!cfg) return null
              return (
                <div key={c} style={{
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: 10, padding: 14,
                  border: '1px solid rgba(255,255,255,0.08)',
                }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                    {cfg.icon} {cfg.label}
                  </div>
                  {data.error ? (
                    <div style={{ color: '#ef4444', fontSize: 12 }}>{data.error}</div>
                  ) : (
                    <>
                      <div style={{ marginBottom: 8 }}>
                        <span style={{ color: '#22c55e', fontSize: 18, fontWeight: 700 }}>
                          {data.native?.balance_formatted?.toFixed(6) || '0'}
                        </span>
                        <span style={{ color: '#888', fontSize: 12, marginLeft: 6 }}>
                          {data.native?.symbol || cfg.nativeSymbol}
                        </span>
                      </div>
                      {Object.entries(data.tokens || {}).map(([name, t]) =>
                        t.balance_formatted > 0 ? (
                          <div key={name} style={{ fontSize: 12, color: '#aaa' }}>
                            {t.balance_formatted.toFixed(4)} {t.symbol}
                          </div>
                        ) : null
                      )}
                      {data.contract_address ? (
                        <div style={{ fontSize: 10, color: '#555', marginTop: 6, fontFamily: 'monospace' }}>
                          Contract: {data.contract_address.slice(0, 10)}...
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 20, color: '#666', fontStyle: 'italic' }}>
            Click "Refresh" to load contract balances
          </div>
        )}
      </div>

      {/* Withdraw Form */}
      <div className="config-panel">
        <h3>💸 Withdraw Funds</h3>

        <div className="form-grid">
          {/* Chain */}
          <div className="form-group">
            <label>Chain</label>
            <select value={chain} onChange={e => setChain(e.target.value)} className="input">
              {Object.entries(CHAINS).map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {v.label}</option>
              ))}
            </select>
          </div>

          {/* Token */}
          <div className="form-group">
            <label>Asset</label>
            <select value={token} onChange={e => setToken(e.target.value)} className="input">
              <option value="">Native ({chainCfg.nativeSymbol})</option>
              {Object.entries(KNOWN_TOKENS).map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {v.label}</option>
              ))}
            </select>
          </div>

          {/* Amount */}
          <div className="form-group">
            <label>Amount</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                className="input"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="Leave empty for max"
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-secondary"
                style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700 }}
                onClick={() => setAmount('')}
              >
                MAX
              </button>
            </div>
            <span className="form-hint">Leave empty to withdraw entire balance</span>
          </div>

          {/* Chain config display */}
          <div className="form-group" style={{
            background: 'rgba(0,0,0,0.15)',
            borderRadius: 6, padding: '8px 12px',
            display: 'flex', flexDirection: 'column',
            gap: 4, justifyContent: 'center',
          }}>
            <div style={{ fontSize: 11, color: '#888' }}>
              Explorer: {chainCfg.explorer}
            </div>
            <div style={{ fontSize: 11, color: '#888' }}>
              Contract: rescueTokens() / rescueNative()
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="form-actions">
          <button
            className="btn btn-primary"
            onClick={() => handleWithdraw(false)}
            disabled={loading}
          >
            {loading ? '⏳ Processing...' : '💸 Withdraw'}
          </button>
          <button
            className="btn btn-danger"
            onClick={() => handleWithdraw(true)}
            disabled={loading}
          >
            {loading ? '⏳ Sweeping...' : '🧹 Sweep All'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={fetchBalances}
            disabled={balancesLoading}
          >
            {balancesLoading ? '⏳ Loading...' : '🔄 Refresh Balances'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="error-box">
          <span className="error-icon">⚠</span> {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="result-panel success">
          <h3>✅ Withdraw {result.status || 'Sent'}</h3>
          {result.transactions ? (
            // Sweep results
            <div>
              <p>Sweep completed with {result.transactions.length} transaction(s)</p>
              {result.transactions.map((tx, i) => (
                <div key={i} className="result-hash" style={{ marginTop: i > 0 ? 8 : 0 }}>
                  <span>
                    {tx.type === 'native' ? '💰 Native' : `🔸 ${tx.name || 'Token'}`}:
                  </span>
                  {tx.tx_hash ? (
                    <>
                      <span>{tx.tx_hash.slice(0, 18)}...</span>
                      <a
                        href={`${chainCfg.explorer}/tx/${tx.tx_hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="explorer-link"
                      >
                        ↗ Explorer
                      </a>
                    </>
                  ) : (
                    <span style={{ color: '#ef4444' }}>❌ {tx.error}</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            // Single withdraw result
            <div>
              <p>
                {result.amount === 'all' ? 'All' : result.amount} {result.token || result.chain} →
                {result.destination.slice(0, 10)}...
              </p>
              <div className="result-hash">
                <span>Tx: {result.tx_hash.slice(0, 18)}...</span>
                <span style={{ color: '#888' }}>Block: {result.block_number || 'pending'}</span>
                <a
                  href={result.explorer_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="explorer-link"
                >
                  ↗ Explorer
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
