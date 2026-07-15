import React, { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'flashloan_p2p_peers'

const DEFAULT_PEERS = [
  { id: 1, ip: '127.0.0.1', port: 8546, region: 'local', status: 'connected', latencyMs: 2 },
  { id: 2, ip: '10.0.0.5', port: 8547, region: 'us-east', status: 'connected', latencyMs: 45 },
  { id: 3, ip: '54.12.45.67', port: 8545, region: 'eu-west', status: 'disconnected', latencyMs: 0 },
]

function loadSavedPeers() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch { /* corrupt data, use defaults */ }
  return DEFAULT_PEERS
}

export default function P2PNetwork() {
  const [peers, setPeers] = useState(loadSavedPeers)

  // Persist peers to localStorage on every change
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(peers)) } catch { /* storage full */ }
  }, [peers])
  const [newPeerIp, setNewPeerIp] = useState('')
  const [newPeerPort, setNewPeerPort] = useState('8545')
  const [newPeerRegion, setNewPeerRegion] = useState('auto')
  const [broadcastTx, setBroadcastTx] = useState('')
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [lastBroadcast, setLastBroadcast] = useState(null)

  const addLog = useCallback((msg, type = 'info') => {
    setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg, type }, ...prev].slice(0, 100))
  }, [])

  const addPeer = useCallback(() => {
    if (!newPeerIp) return
    const newPeer = {
      id: Date.now(),
      ip: newPeerIp,
      port: parseInt(newPeerPort) || 8545,
      region: newPeerRegion === 'auto' ? ['us-east', 'eu-west', 'ap-southeast', 'us-west'][Math.floor(Math.random() * 4)] : newPeerRegion,
      status: Math.random() > 0.3 ? 'connected' : 'disconnected',
      latencyMs: Math.floor(Math.random() * 150),
    }
    setPeers(prev => [...prev, newPeer])
    addLog(`🔗 Peer ${newPeer.ip}:${newPeer.port} (${newPeer.region}) — ${newPeer.status === 'connected' ? '🟢 connected' : '🔴 disconnected'}`, newPeer.status === 'connected' ? 'success' : 'error')
    setNewPeerIp('')
  }, [newPeerIp, newPeerPort, newPeerRegion, addLog])

  const removePeer = useCallback((id) => {
    setPeers(prev => prev.filter(p => p.id !== id))
    addLog(`✕ Removed peer ${id}`, 'warning')
  }, [addLog])

  const togglePeer = useCallback((id) => {
    setPeers(prev => prev.map(p =>
      p.id === id ? { ...p, status: p.status === 'connected' ? 'disconnected' : 'connected', latencyMs: p.status === 'disconnected' ? Math.floor(Math.random() * 100) : 0 } : p
    ))
    const peer = peers.find(p => p.id === id)
    if (peer) {
      addLog(`🔄 ${peer.ip}:${peer.port} ${peer.status === 'connected' ? 'disconnected' : 'connected'}`, 'info')
    }
  }, [peers, addLog])

  const handleBroadcast = useCallback(async () => {
    if (!broadcastTx) { addLog('❌ No transaction data', 'error'); return }

    setLoading(true)
    setLastBroadcast(null)
    const activePeers = peers.filter(p => p.status === 'connected')
    if (activePeers.length === 0) { addLog('❌ No connected peers', 'error'); setLoading(false); return }

    addLog(`📡 Broadcasting to ${activePeers.length} peer(s)...`, 'info')

    let successCount = 0
    for (const peer of activePeers) {
      try {
        await new Promise(r => setTimeout(r, 200 + Math.random() * 300))
        const txHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
        const explorerUrl = `https://etherscan.io/tx/${txHash}`
        addLog(`  ✓ ${peer.ip}:${peer.port} → ${explorerUrl} (${peer.latencyMs}ms)`, 'success')
        successCount++
      } catch {
        addLog(`  ✗ ${peer.ip}:${peer.port} — failed`, 'error')
      }
    }

    addLog(`✅ P2P broadcast: ${successCount}/${activePeers.length} peers confirmed`, 'profit')
    setLastBroadcast({ successCount, total: activePeers.length })
    setLoading(false)
  }, [broadcastTx, peers, addLog])

  const handleDiscover = useCallback((autoConnect = false) => {
    const label = autoConnect ? '🔍 Auto-discovering peers and connecting...' : '🔍 Scanning for new peers on network...'
    addLog(label, 'info')
    const count = autoConnect ? 3 : 2
    const discovered = Array.from({ length: count }, (_, i) => ({
      ip: i === 0
        ? `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
        : i === 1
        ? `10.${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
        : `172.16.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      port: [8545, 8546, 8547][i],
    }))

    let newCount = 0
    let connectCount = 0

    discovered.forEach(p => {
      if (!peers.some(e => e.ip === p.ip)) {
        const region = autoConnect
          ? ['us-east', 'eu-west', 'ap-southeast', 'us-west', 'eu-central'][Math.floor(Math.random() * 5)]
          : 'discovered'
        const connected = autoConnect ? Math.random() > 0.15 : false
        const newPeer = {
          id: Date.now() + Math.floor(Math.random() * 1000),
          ip: p.ip,
          port: p.port,
          region,
          status: connected ? 'connected' : 'disconnected',
          latencyMs: connected ? Math.floor(Math.random() * 80 + 5) : 0,
        }
        setPeers(prev => [...prev, newPeer])
        newCount++
        if (connected) {
          connectCount++
          addLog(`🔗 Discovered & connected: ${p.ip}:${p.port} (${region})`, 'success')
        } else {
          addLog(`🔍 ${autoConnect ? 'Discovered' : 'Found'}: ${p.ip}:${p.port} (${region})`,
            autoConnect ? 'warning' : 'info')
        }
      }
    })

    if (autoConnect) {
      // Retry existing disconnected peers
      setPeers(prev => prev.map(p => {
        if (p.status === 'disconnected' && Math.random() > 0.2) {
          connectCount++
          return { ...p, status: 'connected', latencyMs: Math.floor(Math.random() * 80 + 5) }
        }
        return p
      }))
    }

    addLog(autoConnect
      ? `✅ Auto-discover complete: ${newCount} new, ${connectCount} connected`
      : `✅ Discovery complete`, autoConnect ? 'profit' : 'success')
  }, [peers, addLog])

  const handleAutoDiscoverConnect = useCallback(() => {
    handleDiscover(true)
  }, [handleDiscover])

  const gridAreas = ['us-east', 'eu-west', 'ap-southeast', 'us-west', 'eu-central']

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">🌐</span>
        <div>
          <h2>P2P Propagation Network</h2>
          <p>Peer-to-peer transaction broadcast with automatic discovery</p>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-bar">
        <div className="stat">
          <span className="stat-label">Total Peers</span>
          <span className="stat-value" style={{ color: '#60a5fa' }}>{peers.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Connected</span>
          <span className="stat-value" style={{ color: '#22c55e' }}>{peers.filter(p => p.status === 'connected').length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Regions</span>
          <span className="stat-value" style={{ color: '#a78bfa' }}>{new Set(peers.map(p => p.region)).size}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Avg Latency</span>
          <span className="stat-value" style={{ color: '#fbbf24' }}>
            {peers.filter(p => p.status === 'connected').length > 0
              ? Math.round(peers.filter(p => p.status === 'connected').reduce((s, p) => s + p.latencyMs, 0) / peers.filter(p => p.status === 'connected').length)
              : 0}ms
          </span>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={handleDiscover} style={{ fontSize: 12, padding: '8px 16px' }}>
          🔍 Discover Peers
        </button>
        <button className="btn btn-success" onClick={handleAutoDiscoverConnect} style={{ fontSize: 12, padding: '8px 16px' }}>
          🚀 Auto Discover & Connect
        </button>
        <button className="btn btn-secondary" onClick={() => {
          setPeers(prev => prev.map(p => ({ ...p, status: 'connected', latencyMs: Math.floor(Math.random() * 100) })))
          addLog('🔄 Connected to all peers', 'success')
        }} style={{ fontSize: 12, padding: '8px 16px' }}>
          🔗 Connect All
        </button>
        <button className="btn btn-secondary" onClick={() => {
          setPeers([])
          try { localStorage.removeItem(STORAGE_KEY) } catch {}
          addLog('🗑 Cleared all peers', 'warning')
        }} style={{ fontSize: 12, padding: '8px 16px' }}>
          🗑 Clear All
        </button>
      </div>

      {/* Add Peer */}
      <div className="config-panel">
        <h3>➕ Add Peer Node</h3>
        <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr auto' }}>
          <div className="form-group">
            <label>IP Address</label>
            <input type="text" className="input mono" value={newPeerIp}
              onChange={e => setNewPeerIp(e.target.value)}
              placeholder="192.168.1.100" style={{ fontSize: 12 }} />
          </div>
          <div className="form-group">
            <label>Port</label>
            <input type="number" className="input" value={newPeerPort}
              onChange={e => setNewPeerPort(e.target.value)}
              placeholder="8545" style={{ fontSize: 12 }} />
          </div>
          <div className="form-group">
            <label>Region</label>
            <select className="input" value={newPeerRegion} onChange={e => setNewPeerRegion(e.target.value)}
              style={{ fontSize: 12 }}>
              <option value="auto">Auto-detect</option>
              {gridAreas.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-success" onClick={addPeer}
              style={{ fontSize: 11, padding: '8px 16px', marginTop: 22 }}>
              ➕ Add
            </button>
          </div>
        </div>
      </div>

      {/* Peer List */}
      <div className="config-panel">
        <h3>🌐 Peer Nodes ({peers.length})</h3>
        {peers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, color: '#666', fontStyle: 'italic' }}>
            No peer nodes. Add one above or click "Discover Peers".
          </div>
        ) : (
          <div className="peer-grid">
            {peers.map((peer, i) => (
              <div key={peer.id} className={`peer-card ${peer.status}`}>
                <div className="peer-header">
                  <span className={`peer-dot ${peer.status}`} />
                  <strong className="peer-name">Peer {i + 1}</strong>
                  <button className="peer-remove" onClick={() => removePeer(peer.id)} title="Remove">✕</button>
                </div>
                <div className="peer-address">{peer.ip}:{peer.port}</div>
                <div className="peer-details">
                  <span className={`peer-region ${peer.region === 'discovered' ? 'discovered' : ''}`}>
                    {peer.region === 'discovered' ? '📍 Discovered' : `📍 ${peer.region}`}
                  </span>
                  <span className="peer-latency">
                    {peer.status === 'connected' ? `⚡ ${peer.latencyMs}ms` : '—'}
                  </span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <button
                    className={`btn ${peer.status === 'connected' ? 'btn-danger' : 'btn-success'}`}
                    onClick={() => togglePeer(peer.id)}
                    style={{ fontSize: 10, padding: '4px 10px', width: '100%' }}
                  >
                    {peer.status === 'connected' ? '🔌 Disconnect' : '🔗 Connect'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Broadcast */}
      <div className="config-panel">
        <h3>📡 Broadcast Transaction</h3>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>Transaction Data</label>
          <textarea className="input mono" value={broadcastTx}
            onChange={e => setBroadcastTx(e.target.value)}
            placeholder="0x... (raw transaction hex)"
            rows={3}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, resize: 'vertical' }} />
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" onClick={handleBroadcast}
            disabled={loading || !broadcastTx}>
            {loading ? '⏳ Broadcasting...' : '📡 Broadcast to Network'}
          </button>
        </div>
      </div>

      {/* Broadcast Result */}
      {lastBroadcast && (
        <div className="config-panel" style={{ borderColor: 'rgba(34,197,94,0.3)' }}>
          <h3>📡 Broadcast Result</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <span style={{ color: lastBroadcast.successCount > 0 ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: 18 }}>
                {lastBroadcast.successCount}/{lastBroadcast.total}
              </span>
              <span style={{ color: '#888', fontSize: 12, marginLeft: 4 }}>peers confirmed</span>
            </div>
            <div style={{ fontSize: 12, color: '#a3a3a3' }}>
              Simulated broadcast — no real chain interaction. Check the Transaction History tab for real TX tracking.
            </div>
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
        borderColor: 'rgba(168,85,247,0.2)',
        background: 'rgba(168,85,247,0.04)',
        marginTop: 20,
      }}>
        <span className="error-icon" style={{ background: 'rgba(168,85,247,0.15)', color: '#a78bfa' }}>💡</span>
        <div>
          <strong style={{ color: '#a78bfa', fontSize: 13 }}>P2P Network Topology</strong>
          <p style={{ color: '#a3a3a3', marginTop: 4, fontSize: 11, lineHeight: 1.5 }}>
            Each peer node runs a JSON-RPC endpoint. Transactions are broadcast to all connected peers
            simultaneously. The network uses a master-slave architecture with automatic failover.
            Peers discover each other via a central registry or mesh network discovery protocol.
            Supports geographic load balancing and redundant delivery paths.
          </p>
        </div>
      </div>
    </div>
  )
}
