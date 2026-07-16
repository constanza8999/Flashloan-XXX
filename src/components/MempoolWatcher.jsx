import React, { useState, useRef, useCallback, useEffect } from 'react'
import { ethers } from 'ethers'
import { BSC_RPCS, ETH_RPCS } from '../constants'
import CopyButton from './shared/CopyButton'

const BACKEND_URL = 'http://localhost:8000'

export default function MempoolWatcher() {
  const [chain, setChain] = useState('bsc')
  const [maxTx, setMaxTx] = useState('20')
  const [timeout, setTimeout_] = useState('60')
  const [isWatching, setIsWatching] = useState(false)
  const [txs, setTxs] = useState([])
  const [error, setError] = useState('')
  const [anomalies, setAnomalies] = useState([])
  const [backendOnline, setBackendOnline] = useState(null)
  const abortRef = useRef(null)

  const rpcs = chain === 'bsc' ? BSC_RPCS : ETH_RPCS
  const explorer = chain === 'bsc' ? 'https://bscscan.com/tx/' : 'https://etherscan.io/tx/'

  const addTx = useCallback((txData) => {
    setTxs(prev => {
      const hash = typeof txData === 'string' ? txData : txData.hash
      if (prev.find(t => t.hash === hash)) return prev
      const entry = typeof txData === 'string'
        ? { hash, time: new Date().toLocaleTimeString(), id: prev.length + 1 }
        : { hash, time: new Date().toLocaleTimeString(), id: prev.length + 1,
            from: txData.from, to: txData.to, value: txData.value, gasPrice: txData.gas_price }
      return [entry, ...prev].slice(0, 100)
    })
  }, [])

  // Fetch anomalies from backend
  const fetchAnomalies = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/mempool/anomalies?chain=${chain}`, { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const data = await res.json()
        if (data.status === 'ok') {
          setAnomalies(data.anomalies || [])
          setBackendOnline(true)
        }
      }
    } catch { setBackendOnline(false) }
  }, [chain])

  const handleStart = async () => {
    setError('')
    setTxs([])
    setAnomalies([])
    setIsWatching(true)
    const max = parseInt(maxTx, 10) || 20
    const timeoutSec = parseInt(timeout, 10) || 60
    const abortCtrl = new AbortController()
    abortRef.current = abortCtrl

    // Try backend first for pending transactions
    let usedBackend = false
    try {
      const res = await fetch(`${BACKEND_URL}/api/mempool/pending?chain=${chain}&limit=${max}`, { signal: AbortSignal.timeout(10000) })
      if (res.ok) {
        const data = await res.json()
        if (data.status === 'ok' && data.transactions?.length > 0) {
          for (const tx of data.transactions) {
            addTx(tx)
          }
          setBackendOnline(true)
          usedBackend = true
          // Fetch anomalies too
          fetchAnomalies()
        }
      }
    } catch { /* fall through to direct RPC */ }

    // Direct RPC polling (always run as live monitor)
    let w3
    try {
      for (const rpc of rpcs) {
        const p = new ethers.JsonRpcProvider(rpc)
        await p.getNetwork()
        w3 = p
        break
      }
    } catch {
      if (!usedBackend) {
        setError('Could not connect to any RPC')
        setIsWatching(false)
        return
      }
    }

    const seen = new Set(txs.map(t => t.hash))
    const startTime = Date.now()

    const poll = async () => {
      while (!abortCtrl.signal.aborted) {
        if (Date.now() - startTime > timeoutSec * 1000) {
          setIsWatching(false)
          return
        }
        if (seen.size >= max) {
          setIsWatching(false)
          return
        }

        try {
          if (w3) {
            const block = await w3.getBlock('pending', true)
            if (block?.transactions) {
              for (const tx of block.transactions) {
                const hash = typeof tx.hash === 'string' ? tx.hash : tx.hash
                if (!seen.has(hash)) {
                  seen.add(hash)
                  addTx(hash)
                  if (seen.size >= max) break
                }
              }
            }
          }
        } catch {
          // RPC may not support pending blocks, just continue
        }

        // Periodically refresh anomalies from backend
        if (Math.floor((Date.now() - startTime) / 1000) % 10 === 0) {
          fetchAnomalies()
        }

        await new Promise(r => setTimeout(r, 1000))
      }
    }

    poll().catch(err => {
      setError(err.message)
      setIsWatching(false)
    })
  }

  const handleStop = () => {
    if (abortRef.current) abortRef.current.abort()
    setIsWatching(false)
  }

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">👁</span>
        <div>
          <h2>Mempool Watcher</h2>
          <p>Monitor pending transactions on BSC or Ethereum in real-time with anomaly detection</p>
        </div>
      </div>

      <div className="form-grid">
        <div className="form-group">
          <label>Chain</label>
          <div className="chain-toggle">
            <button className={`chain-btn ${chain === 'bsc' ? 'active' : ''}`} onClick={() => setChain('bsc')}>⛓ BSC</button>
            <button className={`chain-btn ${chain === 'eth' ? 'active' : ''}`} onClick={() => setChain('eth')}>🛡 ETH</button>
          </div>
        </div>

        <div className="form-group">
          <label>Max transactions</label>
          <input type="number" value={maxTx} onChange={e => setMaxTx(e.target.value)} className="input" />
        </div>

        <div className="form-group">
          <label>Timeout (seconds)</label>
          <input type="number" value={timeout} onChange={e => setTimeout_(e.target.value)} className="input" />
        </div>
      </div>

      <div className="form-actions">
        {!isWatching ? (
          <button className="btn btn-primary" onClick={handleStart}>▶ Start Watching</button>
        ) : (
          <button className="btn btn-danger" onClick={handleStop}>⏹ Stop</button>
        )}
        {backendOnline !== null && (
          <span style={{ fontSize: 11, color: backendOnline ? '#22c55e' : '#fbbf24', marginLeft: 8, alignSelf: 'center' }}>
            {backendOnline ? '🟢 Backend connected' : '🟡 Direct RPC only'}
          </span>
        )}
      </div>

      {error && <div className="error-box"><span className="error-icon">✕</span> {error}</div>}

      {isWatching && (
        <div className="live-indicator">
          <span className="live-dot"></span>
          Watching {chain.toUpperCase()} mempool...
          <span className="live-count">{txs.length} txs</span>
        </div>
      )}

      {/* Anomaly Detection Panel */}
      {anomalies.length > 0 && (
        <div className="config-panel" style={{ borderColor: 'rgba(239,68,68,0.2)' }}>
          <h3>⚠️ Anomaly Detection</h3>
          {anomalies.map((a, i) => (
            <div key={i} style={{
              padding: '8px 12px', borderRadius: 6, marginBottom: 6,
              background: a.severity === 'high' ? 'rgba(239,68,68,0.08)' : a.severity === 'medium' ? 'rgba(251,191,36,0.06)' : 'rgba(59,130,246,0.04)',
              border: `1px solid ${a.severity === 'high' ? 'rgba(239,68,68,0.2)' : a.severity === 'medium' ? 'rgba(251,191,36,0.15)' : 'rgba(59,130,246,0.1)'}`,
              fontSize: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: a.severity === 'high' ? '#ef4444' : a.severity === 'medium' ? '#fbbf24' : '#60a5fa' }}>
                  {a.type.replace(/_/g, ' ')} — {a.severity}
                </span>
                {a.gas_price_gwei && <span style={{ fontSize: 11, color: '#888' }}>{a.gas_price_gwei} gwei</span>}
              </div>
              <div style={{ marginTop: 4, color: '#aaa', fontSize: 11 }}>{a.description}</div>
            </div>
          ))}
        </div>
      )}

      {txs.length > 0 && (
        <div className="tx-table-wrapper">
          <table className="tx-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                <th>Transaction Hash</th>
                {txs[0]?.from && <th>From</th>}
                {txs[0]?.from && <th>To</th>}
                <th>Explorer</th>
              </tr>
            </thead>
            <tbody>
              {txs.map(tx => (
                <tr key={tx.hash}>
                  <td className="dim">{tx.id}</td>
                  <td className="dim">{tx.time}</td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    <CopyButton text={tx.hash} />
                    {tx.hash.slice(0, 18)}...{tx.hash.slice(-8)}
                  </td>
                  {tx.from && <td className="mono" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{tx.from.slice(0, 10)}...{tx.from.slice(-4)}</td>}
                  {tx.from && <td className="mono" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{tx.to ? `${tx.to.slice(0, 10)}...${tx.to.slice(-4)}` : '—'}</td>}
                  <td>
                    <a href={explorer + tx.hash} target="_blank" rel="noopener noreferrer" className="explorer-sm">
                      View →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
