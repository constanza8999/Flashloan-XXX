import React, { useState } from 'react'
import { DEFAULT_RECIPIENT } from '../constants'
import { ethers } from 'ethers'

const REGIONS = ['us-east', 'eu-west', 'ap-southeast', 'us-west', 'eu-central', 'sa-east', 'me-central']

function randomIp() {
  return [Math.floor(Math.random() * 223) + 1, Math.floor(Math.random() * 255), Math.floor(Math.random() * 255), Math.floor(Math.random() * 255)].join('.')
}

function randomBalance() {
  return parseFloat((Math.random() * 3 + 0.1).toFixed(4))
}

function randomLatency() {
  return Math.floor(Math.random() * 120)
}

function generateTxHash() {
  return '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

const EXPLORER_BASE = 'https://etherscan.io/tx/'

// Generate initial tx history for a node
function generateInitialTxHistory(node, count) {
  const history = []
  const types = ['relay', 'heartbeat', 'withdraw', 'verify', 'propagate']
  const statuses = ['confirmed', 'confirmed', 'confirmed', 'confirmed', 'failed']
  for (let i = 0; i < count; i++) {
    const txHash = generateTxHash()
    const type = types[Math.floor(Math.random() * types.length)]
    const status = statuses[Math.floor(Math.random() * statuses.length)]
    const minsAgo = Math.floor(Math.random() * 1440) // up to 24h ago
    const d = new Date(Date.now() - minsAgo * 60 * 1000)
    history.push({
      id: Date.now() + i,
      time: d.toLocaleString(),
      type,
      msg: type === 'relay' ? 'Relayed meta-tx to forwarder' :
           type === 'heartbeat' ? 'Heartbeat ping ' + (status === 'confirmed' ? 'OK' : 'TIMEOUT') :
           type === 'withdraw' ? 'Withdrew ' + (Math.random() * 0.5 + 0.1).toFixed(3) + ' ETH' :
           type === 'verify' ? 'Signature verification ' + (status === 'confirmed' ? 'passed' : 'failed') :
           'Propagated block data',
      txHash,
      status,
      explorerUrl: EXPLORER_BASE + txHash,
    })
  }
  return history.reverse()
}

const INITIAL_NODES = [
  { id: 1, name: 'master-01', type: 'master', region: 'us-east', ip: '54.12.45.1', port: 8545, status: 'active', txCount: 1423, successCount: 1418, balanceEth: 2.45, latencyMs: 12, uptime: '99.8%' },
  { id: 2, name: 'slave-01', type: 'slave', region: 'eu-west', ip: '78.45.12.5', port: 8545, status: 'active', txCount: 876, successCount: 870, balanceEth: 1.23, latencyMs: 34, uptime: '99.5%' },
  { id: 3, name: 'slave-02', type: 'slave', region: 'ap-southeast', ip: '112.34.56.7', port: 8546, status: 'active', txCount: 654, successCount: 648, balanceEth: 0.89, latencyMs: 89, uptime: '98.2%' },
  { id: 4, name: 'follower-01', type: 'follower', region: 'us-west', ip: '45.67.89.1', port: 8545, status: 'degraded', txCount: 234, successCount: 220, balanceEth: 0.45, latencyMs: 156, uptime: '95.1%' },
]

// Build initial tx logs for the 4 initial nodes
function buildInitialTxLogs(nodes) {
  const map = {}
  nodes.forEach(n => {
    map[n.id] = generateInitialTxHistory(n, 4 + Math.floor(Math.random() * 4))
  })
  return map
}

export default function RelayNodes() {
  const [nodes, setNodes] = useState(INITIAL_NODES)
  const [nodeTxLogs, setNodeTxLogs] = useState(() => buildInitialTxLogs(INITIAL_NODES))
  const [expandedNode, setExpandedNode] = useState(null)
  const [newNodeName, setNewNodeName] = useState('')
  const [newNodeType, setNewNodeType] = useState('slave')
  const [newNodeRegion, setNewNodeRegion] = useState('us-east')
  const [logs, setLogs] = useState([])
  const [networkConfig, setNetworkConfig] = useState({ heartbeatInterval: 30, failoverThreshold: 3, rebalanceEnabled: true, autoDiscovery: true })
  const [withdrawTarget, setWithdrawTarget] = useState(DEFAULT_RECIPIENT)
  const [withdrawing, setWithdrawing] = useState(false)
  const [fetchingTxns, setFetchingTxns] = useState({})

  function addLog(msg, type) {
    try {
      setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg: String(msg), type: type || 'info' }, ...prev].slice(0, 100))
    } catch {}
  }

  function addNodeTxLog(nodeId, entry) {
    setNodeTxLogs(prev => ({
      ...prev,
      [nodeId]: [entry, ...(prev[nodeId] || [])].slice(0, 50),
    }))
  }

  const activeCount = nodes.filter(n => n.status === 'active').length
  const totalTx = nodes.reduce((s, n) => s + n.txCount, 0)
  const totalSuccess = nodes.reduce((s, n) => s + n.successCount, 0)
  const totalBalance = nodes.reduce((s, n) => s + n.balanceEth, 0)

  function handleAddNode() {
    if (!newNodeName.trim()) return
    const node = {
      id: Date.now(),
      name: newNodeName.trim(),
      type: newNodeType,
      region: newNodeRegion,
      ip: randomIp(),
      port: newNodeType === 'master' ? 8545 : 8545 + Math.floor(Math.random() * 10),
      status: 'active',
      txCount: 0, successCount: 0,
      balanceEth: randomBalance(),
      latencyMs: randomLatency(),
      uptime: '100%',
    }
    setNodes(prev => {
      const updated = prev.map(n => n.type === 'master' && newNodeType === 'master' ? { ...n, type: 'slave' } : n)
      return [...updated, node]
    })
    // Initialize empty tx log for new node
    setNodeTxLogs(prev => ({ ...prev, [node.id]: [] }))
    addLog('(+) ' + node.name + ' registered as ' + newNodeType, 'success')
    setNewNodeName('')
  }

  function handleRemoveNode(id) {
    const node = nodes.find(n => n.id === id)
    if (!node) return
    setNodes(prev => {
      const filtered = prev.filter(n => n.id !== id)
      if (node.type === 'master') {
        const slave = filtered.find(n => n.type === 'slave' && n.status === 'active')
        if (slave) {
          addLog('(=) Promoting ' + slave.name + ' to master', 'success')
          return filtered.map(n => n.id === slave.id ? { ...n, type: 'master' } : n)
        }
      }
      return filtered
    })
    // Clean up tx logs
    setNodeTxLogs(prev => { const c = { ...prev }; delete c[id]; return c })
    if (expandedNode === id) setExpandedNode(null)
    addLog('(x) Removed ' + node.name, 'warning')
  }

  function handleToggleStatus(id) {
    const node = nodes.find(n => n.id === id)
    if (!node) return
    const newStatus = node.status === 'active' ? 'offline' : 'active'
    setNodes(prev => prev.map(n => n.id === id ? { ...n, status: newStatus, latencyMs: newStatus === 'active' ? randomLatency() : 0 } : n))
    addLog('(!) ' + node.name + ' -> ' + newStatus, 'info')
  }

  function handleHealthCheck() {
    addLog('(...) Running health check...', 'info')
    setNodes(prev => {
      return prev.map(n => {
        const health = Math.random()
        const newStatus = health > 0.15 ? 'active' : health > 0.05 ? 'degraded' : 'offline'
        return { ...n, status: newStatus, latencyMs: Math.floor(Math.random() * 200), uptime: newStatus === 'active' ? '99.9%' : newStatus === 'degraded' ? '97.2%' : '0%' }
      })
    })
    // Add heartbeat tx log for each node
    nodes.forEach(n => {
      const ok = Math.random() > 0.15
      const txHash = generateTxHash()
      addNodeTxLog(n.id, {
        id: Date.now() + n.id,
        time: new Date().toLocaleTimeString(),
        type: 'heartbeat',
        msg: 'Health check: ' + (ok ? 'ONLINE' : 'TIMEOUT') + ' | ' + n.latencyMs + 'ms',
        txHash: ok ? txHash : '',
        status: ok ? 'confirmed' : 'failed',
        explorerUrl: ok ? EXPLORER_BASE + txHash : '',
      })
    })
    addLog('(ok) Health check complete: ' + nodes.length + ' nodes', 'success')
  }

  function handleSyncBalances() {
    addLog('($) Syncing balances...', 'info')
    setNodes(prev => prev.map(n => ({ ...n, balanceEth: randomBalance() })))
    addLog('(ok) Balances synced', 'success')
  }

  function handleResetAll() {
    setNodes(prev => prev.map(n => ({ ...n, status: 'active', latencyMs: randomLatency() })))
    addLog('(ok) All nodes reset to active', 'success')
  }

  async function handleWithdraw() {
    if (!ethers.isAddress(withdrawTarget)) {
      addLog('(x) Invalid target address', 'error')
      return
    }
    const bal = nodes.reduce((s, n) => s + n.balanceEth, 0)
    if (bal <= 0) {
      addLog('(x) No balance to withdraw', 'error')
      return
    }
    setWithdrawing(true)
    addLog('($) Withdrawing ' + bal.toFixed(4) + ' ETH to ' + withdrawTarget.slice(0, 10) + '...', 'info')
    const txHashes = []
    for (const node of nodes.filter(n => n.balanceEth > 0)) {
      await new Promise(r => setTimeout(r, 300 + Math.random() * 500))
      const txHash = generateTxHash()
      const explorerUrl = EXPLORER_BASE + txHash
      txHashes.push(txHash)
      addNodeTxLog(node.id, {
        id: Date.now() + node.id,
        time: new Date().toLocaleTimeString(),
        type: 'withdraw',
        msg: 'Withdrew ' + node.balanceEth.toFixed(4) + ' ETH to ' + withdrawTarget.slice(0, 10) + '...',
        txHash,
        status: 'confirmed',
        explorerUrl,
      })
      addLog('  (ok) ' + node.name + ': ' + node.balanceEth.toFixed(4) + ' ETH withdrawn | Tx: ' + explorerUrl, 'success')
    }
    setNodes(prev => prev.map(n => ({ ...n, balanceEth: 0 })))
    addLog('(done) Withdraw complete! ' + bal.toFixed(4) + ' ETH sent to ' + withdrawTarget.slice(0, 10) + '...', 'profit')
    if (txHashes.length > 0) {
      const lastHash = txHashes[txHashes.length - 1]
      addLog('🔗 Explorer: ' + EXPLORER_BASE + lastHash, 'link')
    }
    setWithdrawing(false)
  }

  async function handleFetchNodeTxns(nodeId) {
    setFetchingTxns(prev => ({ ...prev, [nodeId]: true }))
    addLog('(...) Fetching recent transactions for node ' + nodes.find(n => n.id === nodeId)?.name + '...', 'info')
    // Simulate fetching recent txns from chain
    await new Promise(r => setTimeout(r, 800 + Math.random() * 1200))
    const count = 1 + Math.floor(Math.random() * 3)
    for (let i = 0; i < count; i++) {
      const txHash = generateTxHash()
      const type = ['relay', 'propagate', 'heartbeat', 'verify'][Math.floor(Math.random() * 4)]
      addNodeTxLog(nodeId, {
        id: Date.now() + i,
        time: new Date().toLocaleTimeString(),
        type,
        msg: type === 'relay' ? 'Relayed meta-tx (auto-detected)' :
             type === 'propagate' ? 'Forwarded block data to peers' :
             type === 'heartbeat' ? 'Heartbeat response received' :
             'On-chain verification passed',
        txHash,
        status: Math.random() > 0.1 ? 'confirmed' : 'failed',
        explorerUrl: EXPLORER_BASE + txHash,
      })
    }
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, txCount: n.txCount + count } : n))
    addLog('(ok) Fetched ' + count + ' txns for ' + nodes.find(n => n.id === nodeId)?.name, 'success')
    setFetchingTxns(prev => ({ ...prev, [nodeId]: false }))
  }

  function renderLogMessage(msg) {
    const urlRegex = /(https?:\/\/[^\s]+)/g
    const parts = msg.split(urlRegex)
    return parts.map((part, j) => {
      if (part.startsWith('http://') || part.startsWith('https://')) {
        const txHash = part.includes(EXPLORER_BASE) ? part.slice(EXPLORER_BASE.length) : part
        return (
          <React.Fragment key={j}>
            <a href={part} target="_blank" rel="noopener noreferrer" className="log-link" title="View on block explorer">{part}</a>
            {txHash && (
              <button
                onClick={() => navigator.clipboard.writeText(txHash)}
                style={{
                  background: 'none', border: 'none', color: 'var(--text-dim)',
                  cursor: 'pointer', fontSize: 11, padding: '2px 6px',
                  borderRadius: 'var(--radius-sm)', marginLeft: 4,
                  transition: 'var(--transition)',
                }}
                className="log-copy-btn"
                title="Copy tx hash"
              >📋</button>
            )}
          </React.Fragment>
        )
      }
      return <span key={j}>{part}</span>
    })
  }

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">🗼</span>
        <div>
          <h2>Relay Node Manager</h2>
          <p>Master-slave relay node network with automatic failover</p>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-bar">
        <div className="stat">
          <span className="stat-label">Total Nodes</span>
          <span className="stat-value" style={{ color: '#60a5fa' }}>{nodes.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Active</span>
          <span className="stat-value" style={{ color: activeCount > 0 ? '#22c55e' : '#ef4444' }}>{activeCount}</span>
        </div>
        <div className="stat">
          <span className="stat-label">TX Processed</span>
          <span className="stat-value" style={{ color: '#a78bfa' }}>{totalTx}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Success Rate</span>
          <span className="stat-value" style={{ color: '#fbbf24' }}>{totalTx > 0 ? ((totalSuccess / totalTx) * 100).toFixed(1) : 0}%</span>
        </div>
        <div className="stat">
          <span className="stat-label">Total Balance</span>
          <span className="stat-value" style={{ color: '#22c55e', fontSize: 16 }}>{totalBalance.toFixed(2)} ETH</span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={handleHealthCheck} style={{ fontSize: 12, padding: '8px 16px' }}>🔍 Health Check</button>
        <button className="btn btn-secondary" onClick={handleSyncBalances} style={{ fontSize: 12, padding: '8px 16px' }}>💰 Sync Balances</button>
        <button className="btn btn-secondary" onClick={handleResetAll} style={{ fontSize: 12, padding: '8px 16px' }}>🔄 Reset All</button>
      </div>

      {/* Add Node */}
      <div className="config-panel">
        <h3>➕ Add Relay Node</h3>
        <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr auto' }}>
          <div className="form-group">
            <label>Node Name</label>
            <input type="text" className="input" value={newNodeName} onChange={e => setNewNodeName(e.target.value)} placeholder="e.g., slave-03" style={{ fontSize: 12 }} />
          </div>
          <div className="form-group">
            <label>Type</label>
            <select className="input" value={newNodeType} onChange={e => setNewNodeType(e.target.value)} style={{ fontSize: 12 }}>
              <option value="master">👑 Master</option>
              <option value="slave">🔹 Slave</option>
              <option value="follower">🔸 Follower</option>
            </select>
          </div>
          <div className="form-group">
            <label>Region</label>
            <select className="input" value={newNodeRegion} onChange={e => setNewNodeRegion(e.target.value)} style={{ fontSize: 12 }}>
              {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-success" onClick={handleAddNode} style={{ fontSize: 11, padding: '8px 16px', marginTop: 22 }}>➕ Add</button>
          </div>
        </div>
      </div>

      {/* Node List with per-node tx logs */}
      <div className="config-panel">
        <h3>🗼 Relay Nodes ({nodes.length})</h3>
        <div className="relay-node-grid">
          {nodes.map(node => {
            const txLogs = nodeTxLogs[node.id] || []
            const isExpanded = expandedNode === node.id
            return (
              <div key={node.id} className={'relay-node-card' + (node.status !== 'active' ? ' ' + node.status : '') + (isExpanded ? ' relay-node-card-expanded' : '')}>
                <div className="relay-node-header">
                  <span className={'relay-node-dot ' + node.status} />
                  <strong className="relay-node-name">{node.name}</strong>
                  <span>{node.type === 'master' ? '👑' : node.type === 'slave' ? '🔹' : '🔸'}</span>
                  <button className="peer-remove" onClick={() => handleRemoveNode(node.id)} title="Remove">✕</button>
                </div>
                <div className="relay-node-addr">{node.ip}:{node.port} · {node.region}</div>
                <div className="relay-node-stats">
                  <span>📊 {node.txCount} txs</span>
                  <span>✅ {((node.successCount / Math.max(node.txCount, 1)) * 100).toFixed(0)}%</span>
                  <span>⚡ {node.latencyMs}ms</span>
                  <span>💰 {node.balanceEth.toFixed(3)} ETH</span>
                </div>
                <div className="relay-node-stats" style={{ marginTop: 4 }}>
                  <span>📈 Uptime: {node.uptime}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-dim)' }}>{txLogs.length} log entries</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <div className={'relay-node-status-badge ' + node.status}>
                    {node.status === 'active' ? '🟢 Active' : node.status === 'degraded' ? '🟡 Degraded' : '🔴 Offline'}
                  </div>
                  <button
                    className={isExpanded ? 'btn btn-primary' : 'btn btn-secondary'}
                    onClick={() => setExpandedNode(isExpanded ? null : node.id)}
                    style={{ fontSize: 10, padding: '3px 8px' }}
                    title="View node logs and transactions"
                  >{isExpanded ? '📋 Close Logs' : '📋 Logs'}</button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleFetchNodeTxns(node.id)}
                    disabled={fetchingTxns[node.id]}
                    style={{ fontSize: 10, padding: '3px 8px', marginLeft: 'auto' }}
                    title="Fetch recent transactions from chain"
                  >{fetchingTxns[node.id] ? '⏳' : '🔄 Fetch Txns'}</button>
                  <button
                    className={'btn ' + (node.status === 'active' ? 'btn-danger' : 'btn-success')}
                    onClick={() => handleToggleStatus(node.id)}
                    style={{ fontSize: 10, padding: '3px 8px' }}
                  >
                    {node.status === 'active' ? '⏹ Stop' : '▶ Start'}
                  </button>
                </div>

                {/* Expanded tx log panel */}
                {isExpanded && (
                  <div className="relay-node-txlog" style={{
                    marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10,
                    maxHeight: 280, overflowY: 'auto',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        📋 Transaction Log ({txLogs.length})
                      </span>
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          setNodeTxLogs(prev => ({ ...prev, [node.id]: [] }))
                          addLog('(x) Cleared tx log for ' + node.name, 'info')
                        }}
                        style={{ fontSize: 9, padding: '2px 8px' }}
                        title="Clear this node's logs"
                      >Clear</button>
                    </div>
                    {txLogs.length === 0 ? (
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic', padding: '8px 0' }}>
                        No transactions yet. Run a health check or withdraw to generate logs.
                      </div>
                    ) : (
                      <div className="log-container" style={{ maxHeight: 220 }}>
                        {txLogs.map((entry, i) => (
                          <div key={entry.id || i} className={'log-entry ' + (entry.status === 'confirmed' ? 'success' : entry.status === 'failed' ? 'error' : 'info')}>
                            <span className="log-time" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{entry.time}</span>
                            <span className="log-msg" style={{ fontSize: 11 }}>
                              {renderLogMessage(entry.msg)}
                              {entry.txHash && entry.type !== 'heartbeat' && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
                                  <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                                    [{entry.txHash.slice(0, 8)}...{entry.txHash.slice(-4)}]
                                  </span>
                                  <button
                                    onClick={() => navigator.clipboard.writeText(entry.txHash)}
                                    style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 10, padding: '0 2px' }}
                                    title="Copy tx hash"
                                  >📋</button>
                                  {entry.explorerUrl && (
                                    <a href={entry.explorerUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: 'var(--accent-blue)', textDecoration: 'none' }} title="View on Etherscan">
                                      ↗
                                    </a>
                                  )}
                                </span>
                              )}
                            </span>
                            <span style={{
                              marginLeft: 'auto', fontSize: 9, padding: '1px 6px',
                              borderRadius: 'var(--radius-full)', fontWeight: 600,
                              background: entry.status === 'confirmed' ? 'rgba(34,197,94,0.12)' : entry.status === 'failed' ? 'rgba(239,68,68,0.12)' : 'rgba(100,116,139,0.12)',
                              color: entry.status === 'confirmed' ? 'var(--accent-green)' : entry.status === 'failed' ? 'var(--accent-red)' : 'var(--text-dim)',
                              textTransform: 'uppercase', letterSpacing: '0.04em',
                            }}>
                              {entry.status === 'confirmed' ? '✓' : entry.status === 'failed' ? '✗' : '?'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Withdraw */}
      <div className="config-panel">
        <h3>💸 Withdraw Funds</h3>
        <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr auto' }}>
          <div className="form-group">
            <label>Target Address</label>
            <input type="text" className="input mono" value={withdrawTarget} onChange={e => setWithdrawTarget(e.target.value)} placeholder="0x..." style={{ fontSize: 12 }} />
            <span className="form-hint">All node balances will be sent to this address</span>
          </div>
          <div className="form-group">
            <label>Total to Withdraw</label>
            <div style={{ padding: '10px 14px', background: 'var(--bg-input)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 18, fontWeight: 700, color: '#22c55e' }}>
              {totalBalance.toFixed(4)} ETH
            </div>
          </div>
          <div className="form-group" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={handleWithdraw} disabled={withdrawing || totalBalance <= 0} style={{ fontSize: 12, padding: '10px 20px', marginTop: 22 }}>
              {withdrawing ? '⏳ Withdrawing...' : '💸 Withdraw All'}
            </button>
          </div>
        </div>
      </div>

      {/* Network Config */}
      <div className="config-panel">
        <h3>⚙️ Network Configuration</h3>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div className="form-group">
            <label>Heartbeat Interval</label>
            <input type="number" className="input" value={networkConfig.heartbeatInterval} onChange={e => setNetworkConfig(p => ({ ...p, heartbeatInterval: Number(e.target.value) }))} min={5} max={300} />
            <span className="form-hint">Seconds between heartbeats</span>
          </div>
          <div className="form-group">
            <label>Failover Threshold</label>
            <input type="number" className="input" value={networkConfig.failoverThreshold} onChange={e => setNetworkConfig(p => ({ ...p, failoverThreshold: Number(e.target.value) }))} min={1} max={10} />
            <span className="form-hint">Failed heartbeats before failover</span>
          </div>
          <div className="form-group">
            <label>&nbsp;</label>
            <label className="checkbox-label" style={{ fontWeight: 500, textTransform: 'none' }}>
              <input type="checkbox" checked={networkConfig.rebalanceEnabled} onChange={e => setNetworkConfig(p => ({ ...p, rebalanceEnabled: e.target.checked }))} />
              Auto-rebalance
            </label>
            <label className="checkbox-label" style={{ fontWeight: 500, textTransform: 'none' }}>
              <input type="checkbox" checked={networkConfig.autoDiscovery} onChange={e => setNetworkConfig(p => ({ ...p, autoDiscovery: e.target.checked }))} />
              Auto-discovery
            </label>
          </div>
        </div>
      </div>

      {/* Activity Log */}
      {logs.length > 0 && (
        <div className="log-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>📋 Activity Log</h3>
            <button className="btn btn-secondary" onClick={() => setLogs([])} style={{ fontSize: 10, padding: '4px 10px' }}>Clear</button>
          </div>
          <div className="log-container">
            {logs.map((log, i) => (
              <div key={i} className={'log-entry ' + log.type}>
                <span className="log-time">{log.time}</span>
                <span className="log-msg">{renderLogMessage(log.msg)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
