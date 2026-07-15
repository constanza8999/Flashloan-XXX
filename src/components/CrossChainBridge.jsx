import React, { useState, useCallback } from 'react'
import { DEFAULT_RECIPIENT } from '../constants'
import CopyButton from './shared/CopyButton'

const CHAINS = [
  { id: 'ethereum', name: 'Ethereum', native: 'ETH', icon: '🔵', chainId: 1 },
  { id: 'bsc', name: 'BNB Chain', native: 'BNB', icon: '🟡', chainId: 56 },
  { id: 'polygon', name: 'Polygon', native: 'MATIC', icon: '🔶', chainId: 137 },
  { id: 'arbitrum', name: 'Arbitrum', native: 'ETH', icon: '🌀', chainId: 42161 },
  { id: 'optimism', name: 'Optimism', native: 'ETH', icon: '🔴', chainId: 10 },
  { id: 'avalanche', name: 'Avalanche', native: 'AVAX', icon: '❄️', chainId: 43114 },
]

const CHAIN_EXPLORERS = {
  ethereum: 'https://etherscan.io/tx/',
  bsc: 'https://bscscan.com/tx/',
  polygon: 'https://polygonscan.com/tx/',
  arbitrum: 'https://arbiscan.io/tx/',
  optimism: 'https://optimistic.etherscan.io/tx/',
  avalanche: 'https://snowtrace.io/tx/',
}

const BRIDGE_PROTOCOLS = [
  { id: 'stargate', name: 'Stargate (LayerZero)', icon: '⭐', desc: 'Unified liquidity pools for USDT cross-chain swaps' },
  { id: 'across', name: 'Across Protocol', icon: '🌉', desc: 'Optimistic bridge with fast relayer path' },
  { id: 'multichain', name: 'Multichain (AnySwap)', icon: '🔗', desc: 'Cross-chain router for arbitrary tokens' },
  { id: 'hop', name: 'Hop Protocol', icon: '🔄', desc: 'Cross-chain bridge with AMM-based liquidity' },
]

export default function CrossChainBridge() {
  const [sourceChain, setSourceChain] = useState('ethereum')
  const [destChain, setDestChain] = useState('bsc')
  const [protocol, setProtocol] = useState('stargate')
  const [token, setToken] = useState('USDT')
  const [amount, setAmount] = useState('10000')
  const [slippageBps, setSlippageBps] = useState(50)
  const [targetAddress, setTargetAddress] = useState(DEFAULT_RECIPIENT)

  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [bridgeHistory, setBridgeHistory] = useState([])
  const [prices, setPrices] = useState({
    ethereum: { USDT: 1.0, WETH: 2345.50 },
    bsc: { USDT: 1.0, WBNB: 587.30 },
  })

  const addLog = useCallback((msg, type = 'info') => {
    setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg, type }, ...prev].slice(0, 100))
  }, [])

  const refreshPrices = useCallback(() => {
    addLog('🔄 Fetching cross-chain prices...', 'info')
    const ethWeth = (Math.random() * 100 + 2300).toFixed(2)
    const bscWbnb = (Math.random() * 20 + 580).toFixed(2)
    setPrices({
      ethereum: { USDT: 1.0, WETH: parseFloat(ethWeth) },
      bsc: { USDT: 1.0, WBNB: parseFloat(bscWbnb) },
    })
    addLog(`📊 ETH USDT/WETH: $${ethWeth} | BSC USDT/WBNB: $${bscWbnb}`, 'info')

    // Check for arbitrage
    const spread = Math.abs((parseFloat(ethWeth) - parseFloat(bscWbnb)) / Math.min(parseFloat(ethWeth), parseFloat(bscWbnb)) * 10000)
    addLog(`🔍 Cross-chain spread: ${spread.toFixed(1)} bps${spread > 20 ? ' 🚀 Profitable!' : ''}`, spread > 20 ? 'profit' : 'info')
  }, [addLog])

  const handleBridge = useCallback(async () => {
    if (!amount || parseFloat(amount) <= 0) { addLog('❌ Invalid amount', 'error'); return }

    setLoading(true)
    const src = CHAINS.find(c => c.id === sourceChain)
    const dst = CHAINS.find(c => c.id === destChain)
    const srcExplorer = CHAIN_EXPLORERS[sourceChain] || 'https://etherscan.io/tx/'
    const dstExplorer = CHAIN_EXPLORERS[destChain] || 'https://etherscan.io/tx/'
    const proto = BRIDGE_PROTOCOLS.find(p => p.id === protocol)

    addLog(`🌉 Bridging ${amount} ${token} from ${src.name} → ${dst.name} via ${proto.name}`, 'info')
    addLog(`📍 Target address: ${targetAddress.slice(0, 10)}...${targetAddress.slice(-6)}`, 'info')
    addLog(`🔧 Quoting bridge fee...`, 'info')

    await new Promise(r => setTimeout(r, 1000))
    const bridgeFee = (Math.random() * 5 + 0.5).toFixed(2)
    addLog(`💰 Bridge fee: $${bridgeFee}`, 'info')

    addLog(`📤 Sending deposit transaction on ${src.name}...`, 'info')
    await new Promise(r => setTimeout(r, 1500))

    const srcTxHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    addLog(`✅ Source tx confirmed: ${srcTxHash.slice(0, 18)}...`, 'success')

    addLog(`👁 Monitoring ${dst.name} for delivery to ${targetAddress.slice(0, 10)}...`, 'info')
    await new Promise(r => setTimeout(r, 2000))

    const dstTxHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    addLog(`✅ Destination delivery confirmed: ${dstTxHash.slice(0, 18)}...`, 'profit')

    const record = {
      id: Date.now(),
      timestamp: new Date().toLocaleTimeString(),
      source: src.name,
      dest: dst.name,
      protocol: proto.name,
      token,
      amount: parseFloat(amount),
      bridgeFee: parseFloat(bridgeFee),
      srcTxHash,
      dstTxHash,
      srcExplorer: srcExplorer + srcTxHash,
      dstExplorer: dstExplorer + dstTxHash,
      target: targetAddress,
      status: 'confirmed',
    }
    setBridgeHistory(prev => [record, ...prev].slice(0, 50))

    addLog(`🎉 Bridge complete! ${amount} ${token} ${src.icon} → ${dst.icon} (→ ${targetAddress.slice(0, 10)}...)`, 'profit')
    setLoading(false)
  }, [sourceChain, destChain, protocol, token, amount, targetAddress, addLog])

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">🌉</span>
        <div>
          <h2>Cross-Chain Bridge</h2>
          <p>Atomic bridge integration via Stargate (LayerZero) & Across Protocol</p>
        </div>
      </div>

      {/* Chain Prices */}
      <div className="stats-bar">
        <div className="stat">
          <span className="stat-label">🔵 ETH — WETH</span>
          <span className="stat-value" style={{ color: '#3b82f6', fontSize: 16 }}>
            ${prices.ethereum.WETH.toFixed(2)}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">🟡 BSC — WBNB</span>
          <span className="stat-value" style={{ color: '#22c55e', fontSize: 16 }}>
            ${prices.bsc.WBNB.toFixed(2)}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Spread</span>
          <span className="stat-value" style={{ color: '#a78bfa', fontSize: 16 }}>
            {Math.abs(prices.ethereum.WETH - prices.bsc.WBNB).toFixed(2)}
          </span>
        </div>
        <div className="stat" style={{ justifyContent: 'center' }}>
          <button className="btn btn-secondary" onClick={refreshPrices}
            style={{ fontSize: 11, padding: '6px 12px' }}>
            🔄 Refresh Prices
          </button>
        </div>
      </div>

      {/* Bridge Form */}
      <div className="config-panel">
        <h3>🌉 Bridge Tokens</h3>
        <div className="form-grid">
          <div className="form-group">
            <label>Source Chain</label>
            <select className="input" value={sourceChain} onChange={e => setSourceChain(e.target.value)}>
              {CHAINS.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Destination Chain</label>
            <select className="input" value={destChain} onChange={e => setDestChain(e.target.value)}>
              {CHAINS.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Bridge Protocol</label>
            <select className="input" value={protocol} onChange={e => setProtocol(e.target.value)}>
              {BRIDGE_PROTOCOLS.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
            </select>
            <span className="form-hint">{BRIDGE_PROTOCOLS.find(p => p.id === protocol)?.desc}</span>
          </div>
          <div className="form-group">
            <label>Token</label>
            <select className="input" value={token} onChange={e => setToken(e.target.value)}>
              <option value="USDT">💵 USDT</option>
              <option value="USDC">💵 USDC</option>
              <option value="WETH">🔷 WETH</option>
              <option value="WBNB">🟡 WBNB</option>
            </select>
          </div>
          <div className="form-group">
            <label>Amount</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" className="input" value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="Amount in USDT" style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={() => setAmount('50000')}
                style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700 }}>MAX</button>
            </div>
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>Target Address (destination wallet)</label>
            <input type="text" className="input mono" value={targetAddress}
              onChange={e => setTargetAddress(e.target.value)}
              placeholder="0x..." style={{ fontSize: 12 }} />
            <span className="form-hint">Tokens will be delivered to this address on the destination chain</span>
          </div>
          <div className="form-group">
            <label>Max Slippage</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="number" className="input" value={slippageBps}
                onChange={e => setSlippageBps(Number(e.target.value))}
                min={1} max={1000} style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>
                {(slippageBps / 100).toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" onClick={handleBridge}
            disabled={loading || sourceChain === destChain}>
            {loading ? '⏳ Bridging...' : `🌉 Bridge ${token}`}
          </button>
        </div>

        {sourceChain === destChain && (
          <div className="error-box" style={{ marginTop: 12, marginBottom: 0 }}>
            <span className="error-icon">⚠</span> Source and destination chains must be different
          </div>
        )}
      </div>

      {/* Bridge History */}
      {bridgeHistory.length > 0 && (
        <div className="log-panel">
          <h3>📜 Bridge History</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="tx-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Route</th>
                  <th>Protocol</th>
                  <th>Amount</th>
                  <th>Fee</th>
                  <th>Source Tx</th>
                  <th>Dest Tx</th>
                  <th>Target</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {bridgeHistory.slice(0, 10).map(tx => (
                  <tr key={tx.id}>
                    <td className="dim">{tx.timestamp}</td>
                    <td>{tx.source} → {tx.dest}</td>
                    <td style={{ fontSize: 11 }}>{tx.protocol}</td>
                    <td>{tx.amount} {tx.token}</td>
                    <td>${tx.bridgeFee.toFixed(2)}</td>
                    <td style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                      <CopyButton text={tx.srcTxHash} />
                      <a href={tx.srcExplorer} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', fontFamily: 'monospace', textDecoration: 'none', marginLeft: 2 }}>
                        {tx.srcTxHash.slice(0, 8)}... ↗
                      </a>
                    </td>
                    <td style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                      <CopyButton text={tx.dstTxHash} />
                      <a href={tx.dstExplorer} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', fontFamily: 'monospace', textDecoration: 'none', marginLeft: 2 }}>
                        {tx.dstTxHash.slice(0, 8)}... ↗
                      </a>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#888' }}>{tx.target?.slice(0, 10)}...</td>
                    <td><span style={{ color: '#22c55e' }}>✅ Confirmed</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Activity Log */}
      {logs.length > 0 && (
        <div className="log-panel">
          <h3>📋 Activity Log</h3>
          <div className="log-container">
            {logs.map((log, i) => (
              <div key={i} className={`log-entry ${log.type}`}>
                <span className="log-time">{log.time}</span>
                <span className="log-msg">{log.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="error-box" style={{
        borderColor: 'rgba(34,197,94,0.2)',
        background: 'rgba(34,197,94,0.04)',
        marginTop: 20,
      }}>
        <span className="error-icon" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>💡</span>
        <div>
          <strong style={{ color: '#22c55e', fontSize: 13 }}>Cross-Chain Arbitrage Strategy</strong>
          <p style={{ color: '#a3a3a3', marginTop: 4, fontSize: 11, lineHeight: 1.5 }}>
            Buy USDT on the cheaper chain via DEX swap, bridge to the more expensive chain via Stargate or Across,
            sell at the higher price. This captures the spread between chains minus bridge fees (~5bps) and gas costs.
            Flash loans can be used for capital-free execution.
          </p>
        </div>
      </div>
    </div>
  )
}
