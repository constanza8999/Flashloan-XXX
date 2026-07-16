import React, { useState, useCallback, useEffect, useRef } from 'react'
import { ethers } from 'ethers'
import StatsBar from './shared/StatsBar'
import LoadingButton from './shared/LoadingButton'
import ErrorBox from './shared/ErrorBox'
import CopyButton from './shared/CopyButton'

const BACKEND_URL = 'http://localhost:8000'

export default function QuantumEnginePanel() {
  // ─── Engine state ──────────────────────────────────────────────────
  const [engineStatus, setEngineStatus] = useState(null)
  const [config, setConfig] = useState(null)
  const [backendOnline, setBackendOnline] = useState(null)
  const [binaryAvailable, setBinaryAvailable] = useState(true)

  // ─── MEV Shield ────────────────────────────────────────────────────
  const [mevTxId, setMevTxId] = useState('')
  const [mevActive, setMevActive] = useState(false)
  const [mevResult, setMevResult] = useState(null)

  // ─── Gasless ───────────────────────────────────────────────────────
  const [gaslessRecipient, setGaslessRecipient] = useState('')
  const [gaslessAmount, setGaslessAmount] = useState('1')

  // ─── Quantum Random ────────────────────────────────────────────────
  const [randMin, setRandMin] = useState('1')
  const [randMax, setRandMax] = useState('100')
  const [randResult, setRandResult] = useState(null)
  const [rand32Result, setRand32Result] = useState(null)

  // ─── Enhancer ──────────────────────────────────────────────────────
  const [forceSuccess, setForceSuccess] = useState(false)
  const [enhanceResult, setEnhanceResult] = useState(null)

  // ─── Stats ─────────────────────────────────────────────────────────
  const [stats, setStats] = useState({
    mevProtected: 0,
    gaslessAttempted: 0,
    gaslessSucceeded: 0,
    randomGenerated: 0,
  })

  // ─── UI state ──────────────────────────────────────────────────────
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(null) // which action is loading
  const [error, setError] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const refreshTimer = useRef(null)

  const addLog = useCallback((msg, type = 'info') => {
    setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg: String(msg), type }, ...prev].slice(0, 80))
  }, [])

  // ─── API helpers ───────────────────────────────────────────────────
  const apiCall = useCallback(async (endpoint, options = {}) => {
    try {
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        signal: AbortSignal.timeout(15000),
        ...options,
      })
      const data = await res.json()
      if (data.fallback) setBinaryAvailable(false)
      return data
    } catch (err) {
      addLog(`❌ Backend error: ${err.message}`, 'error')
      return null
    }
  }, [addLog])

  // ─── Check backend + fetch status ──────────────────────────────────
  const checkBackend = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        const data = await res.json()
        setBackendOnline(data.status === 'ok')
        return true
      }
    } catch { /* offline */ }
    setBackendOnline(false)
    return false
  }, [])

  const fetchStatus = useCallback(async () => {
    const data = await apiCall('/api/quantum/status')
    if (data) {
      setEngineStatus(data)
      setConfig(data.config)
      addLog(`📊 Engine status: ${data.engine || 'unknown'} | caps: ${data.entropy_caps_removed ? 'removed' : 'normal'} | force: ${data.force_success ? 'ON' : 'off'}`, 'info')
    }
  }, [apiCall, addLog])

  const fetchConfig = useCallback(async () => {
    const data = await apiCall('/api/quantum/config')
    if (data && data.status === 'ok') setConfig(data)
  }, [apiCall])

  // ─── Initial load ──────────────────────────────────────────────────
  useEffect(() => {
    addLog('🚀 Quantum Engine Panel initialized', 'system')
    checkBackend().then(online => {
      if (online) {
        addLog('✅ Backend server online — connecting to quantum engine...', 'success')
        fetchStatus()
        fetchConfig()
      } else {
        addLog('⚠️ Backend offline. Start server.py to access the quantum engine.', 'warn')
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Auto-refresh status ───────────────────────────────────────────
  useEffect(() => {
    if (!autoRefresh || !backendOnline) return
    refreshTimer.current = setInterval(() => fetchStatus(), 15000)
    return () => clearInterval(refreshTimer.current)
  }, [autoRefresh, backendOnline, fetchStatus])

  // ─── Actions ───────────────────────────────────────────────────────

  const handleRefresh = useCallback(async () => {
    setLoading('refresh')
    await fetchStatus()
    await fetchConfig()
    setLoading(null)
  }, [fetchStatus, fetchConfig])

  const handleRandom = useCallback(async () => {
    const mn = parseInt(randMin) || 0
    const mx = parseInt(randMax) || 100
    if (mn > mx) { setError('❌ Min must be ≤ Max'); return }
    setError('')
    setLoading('random')
    addLog(`🎲 Generating quantum random [${mn}, ${mx}]...`, 'info')
    const data = await apiCall('/api/quantum/random', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ min_val: mn, max_val: mx }),
    })
    if (data && data.status === 'ok') {
      setRandResult(data)
      setStats(s => ({ ...s, randomGenerated: s.randomGenerated + 1 }))
      addLog(`🎲 Quantum random: ${data.value} (range ${data.min}-${data.max})${data.fallback ? ' [fallback]' : ''}`, 'success')
    }
    setLoading(null)
  }, [randMin, randMax, apiCall, addLog])

  const handleRandom32 = useCallback(async () => {
    setError('')
    setLoading('random32')
    addLog('🔢 Generating 32-bit quantum entropy...', 'info')
    const data = await apiCall('/api/quantum/random32')
    if (data && data.status === 'ok') {
      setRand32Result(data)
      setStats(s => ({ ...s, randomGenerated: s.randomGenerated + 1 }))
      addLog(`🔢 32-bit entropy: ${data.value} (${data.hex})${data.fallback ? ' [fallback]' : ''}`, 'success')
    }
    setLoading(null)
  }, [apiCall, addLog])

  const handleMevShield = useCallback(async () => {
    const txId = mevTxId.trim() || `TX-QFL-${Date.now().toString(36).toUpperCase()}`
    setError('')
    setLoading('mev')
    setMevActive(true)
    addLog(`🛡️ Engaging MEV shield for tx ${txId}...`, 'info')

    const data = await apiCall('/api/quantum/mev-shield', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx_id: txId }),
    })

    setMevActive(false)
    if (data && data.status === 'ok') {
      setMevResult(data)
      setStats(s => ({ ...s, mevProtected: s.mevProtected + 1 }))
      addLog(`🛡️ MEV shield active — ${data.delay_ms}ms delay applied for ${data.tx_id}${data.fallback ? ' [fallback]' : ''}`, 'success')
    } else if (data) {
      addLog(`❌ MEV shield failed: ${data.error}`, 'error')
    }
    setLoading(null)
  }, [mevTxId, apiCall, addLog])

  const handleGasless = useCallback(async () => {
    if (!gaslessRecipient.trim()) { setError('❌ Recipient address required'); return }
    if (!ethers.isAddress(gaslessRecipient.trim())) { setError('❌ Invalid Ethereum address'); return }
    const amount = parseFloat(gaslessAmount)
    if (!amount || amount <= 0) { setError('❌ Amount must be > 0'); return }

    // Convert to wei using ethers for precision (avoids Number.MAX_SAFE_INTEGER overflow)
    let amountWei
    try {
      amountWei = ethers.parseEther(gaslessAmount).toString()
    } catch {
      setError('❌ Invalid amount format'); return
    }
    setError('')
    setLoading('gasless')
    addLog(`⚡ Executing gasless tx → ${gaslessRecipient.slice(0, 12)}... (${amount} ETH)...`, 'info')

    const data = await apiCall('/api/quantum/gasless', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: gaslessRecipient.trim(), amount: amountWei }),
    })

    if (data) {
      setStats(s => ({
        ...s,
        gaslessAttempted: s.gaslessAttempted + 1,
        gaslessSucceeded: s.gaslessSucceeded + (data.success ? 1 : 0),
      }))
      if (data.success) {
        addLog(`✅ Gasless tx succeeded via quantum relayer! (${data.executions} attempts, ${data.successes} successes)${data.fallback ? ' [fallback]' : ''}`, 'profit')
      } else {
        addLog(`❌ Gasless tx failed — quantum roll didn't hit threshold${data.fallback ? ' [fallback]' : ''}`, 'error')
      }
    }
    setLoading(null)
  }, [gaslessRecipient, gaslessAmount, apiCall, addLog])

  const handleEnhance = useCallback(async () => {
    setError('')
    setLoading('enhance')
    addLog(`🔥 Activating QuantumEnhancer${forceSuccess ? ' (force success mode)' : ''}...`, 'info')

    const data = await apiCall('/api/quantum/enhance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force_success: forceSuccess }),
    })

    if (data && data.status === 'ok') {
      setEnhanceResult(data)
      addLog(`🔥 Quantum power ${data.entropy_caps_removed ? 'UNLIMITED' : 'normal'}${data.force_success ? ' | Force success: ON' : ''} | test roll: ${data.test_roll} → ${data.test_success ? 'SUCCESS' : 'fail'}${data.fallback ? ' [fallback]' : ''}`, data.test_success ? 'profit' : 'info')
      // Refresh status to reflect enhanced state
      setTimeout(() => fetchStatus(), 500)
    }
    setLoading(null)
  }, [forceSuccess, apiCall, addLog, fetchStatus])

  // ─── Derived values ────────────────────────────────────────────────
  const capsRemoved = engineStatus?.entropy_caps_removed
  const forceSuccessOn = engineStatus?.force_success

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">⚛</span>
        <div>
          <h2>Quantum Engine</h2>
          <p>Quantum-inspired entropy, MEV shield, and gasless execution powered by the C++ QuantumFlash CLI</p>
        </div>
      </div>

      {/* ─── Stats Bar ──────────────────────────────────────────────── */}
      <StatsBar stats={[
        { label: 'Backend', value: backendOnline === null ? '⏳' : backendOnline ? '🟢 Online' : '🔴 Offline', color: backendOnline ? '#22c55e' : '#ef4444' },
        { label: 'Binary', value: binaryAvailable ? '⚙️ Native' : '🐍 Fallback', color: binaryAvailable ? '#60a5fa' : '#fbbf24' },
        { label: 'MEV Protected', value: stats.mevProtected, color: '#a78bfa' },
        { label: 'Gasless', value: `${stats.gaslessSucceeded}/${stats.gaslessAttempted}`, color: '#22c55e' },
        { label: 'Random Gen', value: stats.randomGenerated, color: '#fbbf24' },
      ]} />

      {/* ─── Engine Status Panel ────────────────────────────────────── */}
      <div className="config-panel" style={{ borderColor: 'rgba(168,85,247,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>⚛ Engine Status</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} style={{ cursor: 'pointer' }} />
              Auto-refresh
            </label>
            <LoadingButton
              loading={loading === 'refresh'}
              loadingText="⏳"
              onClick={handleRefresh}
              style={{ fontSize: 11, padding: '6px 14px' }}
            >
              🔄 Refresh
            </LoadingButton>
          </div>
        </div>

        {engineStatus ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.12)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>ENGINE</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#a78bfa' }}>{engineStatus.engine || 'QuantumEngine'}</div>
            </div>
            <div style={{ padding: '10px 14px', borderRadius: 8, background: capsRemoved ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.02)', border: `1px solid ${capsRemoved ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.06)'}`, boxShadow: capsRemoved ? '0 0 20px rgba(251,191,36,0.15)' : 'none' }}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>ENTROPY CAPS</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: capsRemoved ? '#fbbf24' : '#888' }}>
                {capsRemoved ? '🔓 UNLIMITED' : '🔒 Normal'}
              </div>
            </div>
            <div style={{ padding: '10px 14px', borderRadius: 8, background: forceSuccessOn ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${forceSuccessOn ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.06)'}` }}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>FORCE SUCCESS</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: forceSuccessOn ? '#22c55e' : '#888' }}>
                {forceSuccessOn ? '✅ ACTIVE' : '⚪ Disabled'}
              </div>
            </div>
            <div style={{ padding: '10px 14px', borderRadius: 8, background: capsRemoved ? 'rgba(251,191,36,0.06)' : 'rgba(59,130,246,0.04)', border: `1px solid ${capsRemoved ? 'rgba(251,191,36,0.15)' : 'rgba(59,130,246,0.1)'}`, boxShadow: capsRemoved ? '0 0 12px rgba(251,191,36,0.1)' : 'none' }}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>QUANTUM STATE</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: capsRemoved ? '#fbbf24' : '#60a5fa', fontFamily: 'var(--font-mono)' }}>
                {capsRemoved ? '∞' : (engineStatus.quantum_state_size || 0)}{' '}
                <span style={{ fontSize: 11, fontWeight: 400, color: capsRemoved ? '#fbbf24' : '#888' }}>qubits</span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: 20, textAlign: 'center', color: '#666', fontSize: 12 }}>
            {backendOnline === false ? '🔴 Backend offline — start server.py to connect' : '⏳ Loading engine status...'}
          </div>
        )}

        {/* Config display — with ∞ when caps removed */}
        {config && (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(0,0,0,0.15)', border: `1px solid ${capsRemoved ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.04)'}`, fontSize: 11, fontFamily: 'var(--font-mono)', color: capsRemoved ? '#fbbf24' : '#999' }}>
            <span style={{ color: capsRemoved ? '#fbbf24' : '#60a5fa' }}>⚛ quantum:</span>{' '}
            entropy [{capsRemoved ? '-∞' : (config.min_quantum_entropy ?? config.quantum_parameters?.min_quantum_entropy)}–{capsRemoved ? '∞' : (config.max_quantum_entropy ?? config.quantum_parameters?.max_quantum_entropy)}] ·
            threshold {config.success_quantum_threshold ?? config.quantum_parameters?.success_quantum_threshold} ·
            <span style={{ color: capsRemoved ? '#fbbf24' : '#888' }}> ⚡ MEV [{config.mev_min_delay_ms ?? config.mev_protection?.min_delay_ms}–{config.mev_max_delay_ms ?? config.mev_protection?.max_delay_ms}ms] ·
            relayer {config.relayer_timeout ?? config.gasless_relayer?.relayer_timeout}s</span>
          </div>
        )}
      </div>

      {/* ─── Quantum Random Generator ──────────────────────────────── */}
      <div className="config-panel">
        <h3>🎲 Quantum Random Generator</h3>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>
          Generate quantum-inspired random numbers using the C++ entropy engine (std::mt19937 seeded by hardware entropy).
        </p>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
          <div className="form-group">
            <label>Min</label>
            <input type="number" className="input" value={randMin} onChange={e => setRandMin(e.target.value)} style={{ fontSize: 13 }} />
          </div>
          <div className="form-group">
            <label>Max</label>
            <input type="number" className="input" value={randMax} onChange={e => setRandMax(e.target.value)} style={{ fontSize: 13 }} />
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <LoadingButton
              loading={loading === 'random'}
              loadingText="🎲..."
              onClick={handleRandom}
              disabled={!backendOnline}
              style={{ fontSize: 12, padding: '10px 18px', minWidth: 100 }}
            >
              🎲 Generate
            </LoadingButton>
          </div>
        </div>

        {randResult && (
          <div style={{ marginTop: 10, padding: '12px 16px', borderRadius: 8, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)' }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: '#fbbf24', fontFamily: 'var(--font-mono)' }}>{randResult.value}</span>
            <span style={{ marginLeft: 12, fontSize: 11, color: '#888' }}>range [{randResult.min}, {randResult.max}]</span>
            {randResult.fallback && <span style={{ marginLeft: 8, fontSize: 10, color: '#f97316' }}>🐍 fallback</span>}
          </div>
        )}

        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <LoadingButton
            loading={loading === 'random32'}
            loadingText="🔢..."
            onClick={handleRandom32}
            disabled={!backendOnline}
            style={{ fontSize: 12, padding: '8px 16px' }}
          >
            🔢 Generate 32-bit Entropy
          </LoadingButton>
          {rand32Result && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mono" style={{ fontSize: 14, color: '#60a5fa', fontWeight: 600 }}>{rand32Result.hex}</span>
              <span style={{ fontSize: 11, color: '#888' }}>({rand32Result.value})</span>
              <CopyButton text={rand32Result.hex} />
              {rand32Result.fallback && <span style={{ fontSize: 10, color: '#f97316' }}>🐍 fallback</span>}
            </div>
          )}
        </div>
      </div>

      {/* ─── MEV Shield ─────────────────────────────────────────────── */}
      <div className="config-panel" style={{ borderColor: 'rgba(167,139,250,0.2)' }}>
        <h3>🛡 MEV Shield</h3>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>
          Apply entropy-based MEV protection delays to transactions. The C++ MevShield adds a quantum-random delay
          (configurable via config.json) to thwart MEV bots from front-running.
        </p>
        <div className="form-grid" style={{ gridTemplateColumns: '2fr auto' }}>
          <div className="form-group">
            <label>Transaction ID</label>
            <input
              type="text" className="input mono" value={mevTxId}
              onChange={e => setMevTxId(e.target.value)}
              placeholder="TX-QFL-001 (leave empty for auto-generated)"
              style={{ fontSize: 12 }}
            />
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <LoadingButton
              loading={loading === 'mev'}
              loadingText={mevActive ? '🛡 Shielding...' : '⏳'}
              onClick={handleMevShield}
              disabled={!backendOnline}
              style={{
                fontSize: 12, padding: '10px 20px', minWidth: 160,
                background: mevActive ? undefined : 'linear-gradient(135deg, #a78bfa, #7c3aed)',
                border: 'none',
              }}
            >
              🛡 Engage Shield
            </LoadingButton>
          </div>
        </div>

        {mevResult && (
          <div style={{ marginTop: 10, padding: '12px 16px', borderRadius: 8, background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.15)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>TX ID</span>
                <div className="mono" style={{ fontSize: 13, color: '#a78bfa' }}>{mevResult.tx_id}</div>
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Delay Applied</span>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fbbf24', fontFamily: 'var(--font-mono)' }}>{mevResult.delay_ms} ms</div>
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Protected</span>
                <div style={{ fontSize: 13, color: '#22c55e' }}>✅ {mevResult.protected_count} tx(s)</div>
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Entropy Secrets</span>
                <div style={{ fontSize: 13, color: '#60a5fa' }}>{mevResult.secrets_generated} generated</div>
              </div>
              {mevResult.fallback && <span style={{ fontSize: 10, color: '#f97316' }}>🐍 fallback</span>}
            </div>
          </div>
        )}
      </div>

      {/* ─── Gasless Executor ───────────────────────────────────────── */}
      <div className="config-panel" style={{ borderColor: 'rgba(34,197,94,0.2)' }}>
        <h3>⚡ Gasless Executor</h3>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>
          Execute simulated gasless transactions via the quantum relayer model. The engine rolls a quantum-random
          number — if it hits the success threshold, the gasless tx succeeds. Use the Enhancer to improve odds.
        </p>
        <div className="form-grid">
          <div className="form-group">
            <label>Recipient Address</label>
            <input
              type="text" className="input mono" value={gaslessRecipient}
              onChange={e => setGaslessRecipient(e.target.value)}
              placeholder="0x... (ETH address)"
              style={{ fontSize: 12 }}
            />
          </div>
          <div className="form-group">
            <label>Amount (ETH)</label>
            <input
              type="text" className="input" value={gaslessAmount}
              onChange={e => setGaslessAmount(e.target.value)}
              placeholder="e.g. 1.0"
              style={{ fontSize: 12 }}
            />
          </div>
        </div>
        <div className="form-actions">
          <LoadingButton
            loading={loading === 'gasless'}
            loadingText="⚡ Executing..."
            onClick={handleGasless}
            disabled={!backendOnline || !gaslessRecipient}
            style={{
              fontSize: 13, padding: '12px 24px',
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              border: 'none',
            }}
          >
            ⚡ Execute Gasless Tx
          </LoadingButton>
          {stats.gaslessAttempted > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              Success rate: {((stats.gaslessSucceeded / stats.gaslessAttempted) * 100).toFixed(0)}%
              ({stats.gaslessSucceeded}/{stats.gaslessAttempted})
            </span>
          )}
        </div>
        {!capsRemoved && !forceSuccessOn && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 6 }}>
            💡 Tip: Activate the Quantum Enhancer below to improve gasless success rate
          </div>
        )}
      </div>

      {/* ─── Quantum Enhancer ───────────────────────────────────────── */}
      <div className="config-panel" style={{ borderColor: 'rgba(251,191,36,0.2)' }}>
        <h3>🔥 Quantum Enhancer</h3>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>
          Remove entropy caps for unlimited quantum power. Enable <strong>Force Success</strong> to guarantee all
          gasless rolls succeed (cheat mode).
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            padding: '8px 14px', borderRadius: 8,
            background: forceSuccess ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${forceSuccess ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.06)'}`,
            fontSize: 12,
          }}>
            <input
              type="checkbox" checked={forceSuccess}
              onChange={e => setForceSuccess(e.target.checked)}
              style={{ cursor: 'pointer', width: 16, height: 16 }}
            />
            <span style={{ fontWeight: 600, color: forceSuccess ? '#22c55e' : '#888' }}>
              {forceSuccess ? '✅ Force Success Mode' : 'Force Success Mode'}
            </span>
          </label>
          <LoadingButton
            loading={loading === 'enhance'}
            loadingText="🔥 Enhancing..."
            onClick={handleEnhance}
            disabled={!backendOnline}
            style={{
              fontSize: 13, padding: '10px 22px',
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
              border: 'none', color: '#1a1a2e', fontWeight: 700,              }}
            >
              {capsRemoved ? '⚡ Power Already UNLIMITED' : '🔥 Activate Enhancer'}
            </LoadingButton>
        </div>

        {enhanceResult && (
          <div style={{ padding: '12px 16px', borderRadius: 8, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)' }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Entropy Caps</span>
                <div style={{ fontSize: 13, color: enhanceResult.entropy_caps_removed ? '#fbbf24' : '#888' }}>
                  {enhanceResult.entropy_caps_removed ? '🔓 Removed' : '🔒 Normal'}
                </div>
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Force Success</span>
                <div style={{ fontSize: 13, color: enhanceResult.force_success ? '#22c55e' : '#888' }}>
                  {enhanceResult.force_success ? '✅ ON' : '⚪ OFF'}
                </div>
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Test Roll</span>
                <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: '#60a5fa' }}>{enhanceResult.test_roll}</div>
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Test Result</span>
                <div style={{ fontSize: 13, fontWeight: 700, color: enhanceResult.test_success ? '#22c55e' : '#ef4444' }}>
                  {enhanceResult.test_success ? '✅ SUCCESS' : '❌ FAIL'}
                </div>
              </div>
              {enhanceResult.fallback && <span style={{ fontSize: 10, color: '#f97316' }}>🐍 fallback</span>}
            </div>
          </div>
        )}
      </div>

      {/* ─── Error ──────────────────────────────────────────────────── */}
      {error && <ErrorBox>{error}</ErrorBox>}

      {/* ─── Activity Log ───────────────────────────────────────────── */}
      {logs.length > 0 && (
        <div className="log-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>📋 Quantum Engine Log</h3>
            <button className="btn btn-secondary" onClick={() => setLogs([])} style={{ fontSize: 9, padding: '4px 10px' }}>Clear</button>
          </div>
          <div className="log-container" style={{ maxHeight: 300 }}>
            {logs.map((log, i) => (
              <div key={i} className={`log-entry ${log.type}`}>
                <span className="log-time">{log.time}</span>
                <span className="log-msg">{log.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Info ───────────────────────────────────────────────────── */}
      <div style={{
        padding: '14px 18px', borderRadius: 8, marginTop: 12,
        background: 'rgba(168,85,247,0.04)', border: '1px solid rgba(168,85,247,0.12)',
        fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6,
      }}>
        <strong style={{ color: '#a78bfa' }}>⚛ Quantum Engine</strong> — native C++ CLI integrated via FastAPI subprocess bridge.
        <ul style={{ margin: '6px 0 0 16px', color: '#888' }}>
          <li><strong>🎲 Random:</strong> Quantum-inspired RNG (std::mt19937 + hardware entropy)</li>
          <li><strong>🛡 MEV Shield:</strong> Random delay injection to prevent front-running</li>
          <li><strong>⚡ Gasless:</strong> Simulated gasless relay with quantum success roll</li>
          <li><strong>🔥 Enhancer:</strong> Remove entropy caps & force success mode</li>
          <li>Backend calls <code>quantumflash.exe</code> — falls back to Python if binary not found</li>
          <li>Configuration loaded from <code>config.json</code></li>
        </ul>
      </div>
    </div>
  )
}
