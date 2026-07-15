import React, { useState, useRef, useCallback, useEffect } from 'react'
import { ethers } from 'ethers'
import { BSC_RPCS, ETH_RPCS } from '../constants'
import CopyButton from './shared/CopyButton'

export default function MempoolWatcher() {
  const [chain, setChain] = useState('bsc')
  const [maxTx, setMaxTx] = useState('20')
  const [timeout, setTimeout_] = useState('60')
  const [isWatching, setIsWatching] = useState(false)
  const [txs, setTxs] = useState([])
  const [error, setError] = useState('')
  const abortRef = useRef(null)

  const rpcs = chain === 'bsc' ? BSC_RPCS : ETH_RPCS
  const explorer = chain === 'bsc' ? 'https://bscscan.com/tx/' : 'https://etherscan.io/tx/'

  const addTx = useCallback((hash) => {
    setTxs(prev => {
      if (prev.find(t => t.hash === hash)) return prev
      return [{ hash, time: new Date().toLocaleTimeString(), id: prev.length + 1 }, ...prev]
    })
  }, [])

  const handleStart = async () => {
    setError('')
    setTxs([])
    setIsWatching(true)
    const max = parseInt(maxTx, 10) || 20
    const timeoutSec = parseInt(timeout, 10) || 60
    const abortCtrl = new AbortController()
    abortRef.current = abortCtrl

    // Connect
    let w3
    try {
      for (const rpc of rpcs) {
        const p = new ethers.JsonRpcProvider(rpc)
        await p.getNetwork()
        w3 = p
        break
      }
    } catch {
      setError('Could not connect to any RPC')
      setIsWatching(false)
      return
    }

    const seen = new Set()
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
        } catch {
          // RPC may not support pending blocks, just continue
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
          <p>Monitor pending transactions on BSC or Ethereum in real-time (read-only)</p>
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
      </div>

      {error && <div className="error-box"><span className="error-icon">✕</span> {error}</div>}

      {isWatching && (
        <div className="live-indicator">
          <span className="live-dot"></span>
          Watching {chain.toUpperCase()} mempool...
          <span className="live-count">{txs.length} txs</span>
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
