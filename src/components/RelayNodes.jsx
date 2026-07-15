import React, { useState, useCallback } from 'react'

const REGIONS = ['us-east', 'eu-west', 'ap-southeast', 'us-west', 'eu-central', 'sa-east', 'me-central']

export default function RelayNodes() {
  const [nodes, setNodes] = useState([
    { id: 1, name: 'master-01', type: 'master', region: 'us-east', ip: '54.12.45.1', port: 8545, status: 'active', txCount: 1423, successCount: 1418, balanceEth: 2.45, latencyMs: 12, uptime: '99.8%' },
    { id: 2, name: 'slave-01', type: 'slave', region: 'eu-west', ip: '78.45.12.5', port: 8545, status: 'active', txCount: 876, successCount: 870, balanceEth: 1.23, latencyMs: 34, uptime: '99.5%' },
    { id: 3, name: 'slave-02', type: 'slave', region: 'ap-southeast', ip: '112.34.56.7', port: 8546, status: 'active', txCount: 654, successCount: 648, balanceEth: 0.89, latencyMs: 89, uptime: '98.2%' },
    { id: 4, name: 'follower-01', type: 'follower', region: 'us-west', ip: '45.67.89.1', port: 8545, status: 'degraded', txCount: 234, successCount: 220, balanceEth: 0.45, latencyMs: 156, uptime: '95.1%' },
  ])
  const [newNodeName, setNewNodeName] = useState('')
  const [newNodeType, setNewNodeType] = useState('slave')
  const [newNodeRegion, setNewNodeRegion] = useState('us-east')
  const [logs, setLogs] = useState([])
  const [networkConfig, setNetworkConfig] = useState({
    heartbeatInterval: 30,
    failoverThreshold: 3,
    rebalanceEnabled: true,
    autoDiscovery: true,
  })

  const addLog = useCallback((msg, type = 'info') => {
    setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg, type }, ...prev].slice(0, 100))
  }, [])

  const addNode = useCallback(() => {
    if (!newNodeName) return
    const newPort = newNodeType === 'master' ? 8545 : 8545 + Math.floor(Math.random() * 10)
    const node = {
      id: Date.now(),
      name: newNodeName,
      type: newNodeType,
      region: newNodeRegion,
      ip: `${Math.floor(Math.random() * 223) + 1}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      port: newPort,
      status: 'active',
      txCount: 0,
      successCount: 0,
      balanceEth: parseFloat((Math.random() * 3 + 0.1).toFixed(4)),
      latencyMs: Math.floor(Math.random() * 120),
      uptime: '100%',
    }
    setNodes(prev => [...prev, node])
    addLog(`✅ ${newNodeType === 'master' ? '👑' : '🔹'} ${node.name} (${newNodeRegion}) registered`, 'success')
    if (newNodeType === 'master') {
      setNodes(prev => prev.map(n => n.type === 'master' && n.id !== node.id ? { ...n, type: 'slave' } : n))
    }
    setNewNodeName('')
  }, [newNodeName, newNodeType, newNodeRegion, addLog])

  const removeNode = useCallback((id) => {
    const node = nodes.find(n => n.id === id)
    setNodes(prev => prev.filter(n => n.id !== id))
    addLog(`✕ Removed ${node?.name || 'node'}`, 'warning')
    if (node?.type === 'master') {
      addLog('👑 Promoting first slave to master...', 'info')
      setNodes(prev => {
        const slave = prev.find(n => n.type === 'slave' && n.status === 'active')
        if (slave) return prev.map(n => n.id === slave.id ? { ...n, type: 'master' } : n)
        return prev
      })
    }
  }, [nodes, addLog])

  const toggleNodeStatus = useCallback((id) => {
    setNodes(prev => prev.map(n =>
      n.id === id ? { ...n, status: n.status === 'active' ? 'offline' : 'active', latencyMs: n.status === 'offline' ? Math.floor(Math.random() * 80) : 0 } : n
    ))
    const node = nodes.find(n => n.id === id)
    if (node) addLog(`🔄 ${node.name} ${node.status === 'active' ? 'offline' : 'active'}`, 'info')
  }, [nodes, addLog])

  const runHealthCheck = useCallback(() => {
    addLog('🔍 Running comprehensive health check...', 'info')
    setNodes(prev => prev.map(n => {
      const health = Math.random()
      return {
        ...n,
        status: health > 0.15 ? 'active' : health > 0.05 ? 'degraded' : 'offline',
        latencyMs: Math.floor(Math.random() * 200),
        uptime: health > 0.15 ? '99.9%' : health > 0.05 ? '97.2%' : '0%',
      }
    }))
    const active = nodes.filter(n => n.status === 'active').length
    addLog(`✅ Health check complete: ${nodes.length} nodes checked`, 'success')

    // Auto-failover
    const masterOffline = nodes.find(n => n.type === 'master' && n.status === 'offline')
    if (masterOffline) {
      addLog('👑 Master offline — initiating failover...', 'warning')
      setNodes(prev => {
        const slave = prev.find(n => n.type === 'slave' && n.status === 'active')
        if (slave) {
          addLog(`👑 Promoting ${slave.name} to master`, 'success')
          return prev.map(n => n.id === slave.id ? { ...n, type: 'master' } : n)
        }
        return prev
      })
    }
  }, [nodes, addLog])

  const syncBalances = useCallback(() => {
    addLog('💰 Syncing relay node balances...', 'info')
    setNodes(prev => prev.map(n => ({
      ...n,
      balanceEth: parseFloat((Math.random() * 3 + 0.1).toFixed(4)),
    })))
    addLog('✅ Balances synced', 'success')
  }, [addLog])

  const activeCount = nodes.filter(n => n.status === 'active').length
  const totalTx = nodes.reduce((s, n) => s + n.txCount, 0)
  const totalSuccess = nodes.reduce((s, n) => s + n.successCount, 0)
  const totalBalance = nodes.reduce((s, n) => s + n.balanceEth, 0)

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
          <span className="stat-value" style={{ color: '#fbbf24' }}>
            {totalTx > 0 ? ((totalSuccess / totalTx) * 100).toFixed(1) : 0}%
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Total Balance</span>
          <span className="stat-value" style={{ color: '#22c55e', fontSize: 16 }}>{totalBalance.toFixed(2)} ETH</span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={runHealthCheck} style={{ fontSize: 12, padding: '8px 16px' }}>
          🔍 Health Check
        </button>
        <button className="btn btn-secondary" onClick={syncBalances} style={{ fontSize: 12, padding: '8px 16px' }}>
          💰 Sync Balances
        </button>
        <button className="btn btn-secondary" onClick={() => {
          setNodes(prev => prev.map(n => ({ ...n, status: 'active', latencyMs: Math.floor(Math.random() * 80) })))
          addLog('🔄 All nodes set to active', 'success')
        }} style={{ fontSize: 12, padding: '8px 16px' }}>
          🔄 Reset All
        </button>
      </div>

      {/* Add Node */}
      <div className="config-panel">
        <h3>➕ Add Relay Node</h3>
        <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr auto' }}>
          <div className="form-group">
            <label>Node Name</label>
            <input type="text" className="input" value={newNodeName}
              onChange={e => setNewNodeName(e.target.value)}
              placeholder="e.g., slave-03" style={{ fontSize: 12 }} />
          </div>
          <div className="form-group">
            <label>Type</label>
            <select className="input" value={newNodeType} onChange={e => setNewNodeType(e.target.value)}
              style={{ fontSize: 12 }}>
              <option value="master">👑 Master</option>
              <option value="slave">🔹 Slave</option>
              <option value="follower">🔸 Follower</option>
            </select>
          </div>
          <div className="form-group">
            <label>Region</label>
            <select className="input" value={newNodeRegion} onChange={e => setNewNodeRegion(e.target.value)}
              style={{ fontSize: 12 }}>
              {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-success" onClick={addNode}
              style={{ fontSize: 11, padding: '8px 16px', marginTop: 22 }}>
              ➕ Add
            </button>
          </div>
        </div>
      </div>

      {/* Node List */}
      <div className="config-panel">
        <h3>🗼 Relay Nodes</h3>
        <div className="relay-node-grid">
          {nodes.map((node, i) => (
            <div key={node.id} className={`relay-node-card ${node.status}`}>
              <div className="relay-node-header">
                <span className={`relay-node-dot ${node.status}`} />
                <strong className="relay-node-name">{node.name}</strong>
                <span className={`relay-node-type ${node.type}`}>
                  {node.type === 'master' ? '👑' : node.type === 'slave' ? '🔹' : '🔸'}
                </span>
                <button className="peer-remove" onClick={() => removeNode(node.id)} title="Remove">✕</button>
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
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <div className={`relay-node-status-badge ${node.status}`}>
                  {node.status === 'active' ? '🟢 Active' : node.status === 'degraded' ? '🟡 Degraded' : '🔴 Offline'}
                </div>
                <button
                  className={`btn ${node.status === 'active' ? 'btn-danger' : 'btn-success'}`}
                  onClick={() => toggleNodeStatus(node.id)}
                  style={{ fontSize: 10, padding: '3px 8px', marginLeft: 'auto' }}
                >
                  {node.status === 'active' ? '⏹ Stop' : '▶ Start'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Network Configuration */}
      <div className="config-panel">
        <h3>⚙️ Network Configuration</h3>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div className="form-group">
            <label>Heartbeat Interval</label>
            <input type="number" className="input" value={networkConfig.heartbeatInterval}
              onChange={e => setNetworkConfig(prev => ({ ...prev, heartbeatInterval: Number(e.target.value) }))}
              min={5} max={300} />
            <span className="form-hint">Seconds between heartbeats</span>
          </div>
          <div className="form-group">
            <label>Failover Threshold</label>
            <input type="number" className="input" value={networkConfig.failoverThreshold}
              onChange={e => setNetworkConfig(prev => ({ ...prev, failoverThreshold: Number(e.target.value) }))}
              min={1} max={10} />
            <span className="form-hint">Failed heartbeats before failover</span>
          </div>
          <div className="form-group">
            <label>&nbsp;</label>
            <label className="checkbox-label" style={{ fontWeight: 500, textTransform: 'none' }}>
              <input type="checkbox" checked={networkConfig.rebalanceEnabled}
                onChange={e => setNetworkConfig(prev => ({ ...prev, rebalanceEnabled: e.target.checked }))} />
              Auto-rebalance
            </label>
            <label className="checkbox-label" style={{ fontWeight: 500, textTransform: 'none' }}>
              <input type="checkbox" checked={networkConfig.autoDiscovery}
                onChange={e => setNetworkConfig(prev => ({ ...prev, autoDiscovery: e.target.checked }))} />
              Auto-discovery
            </label>
          </div>
        </div>
      </div>

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
    </div>
  )
}
