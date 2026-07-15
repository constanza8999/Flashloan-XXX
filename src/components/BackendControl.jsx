import React, { useState, useEffect, useRef, useCallback } from 'react'
import CopyButton from './shared/CopyButton'

const BACKEND_URL = 'http://localhost:8000'
const CHECK_INTERVAL = 15000 // re-check every 15s

async function checkHealth() {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return null
    const data = await res.json()
    return data
  } catch {
    return null
  }
}

export default function BackendControl({ compact = false }) {
  const [status, setStatus] = useState(null) // null = checking, 'online', 'offline'
  const [healthData, setHealthData] = useState(null)
  const [showDetails, setShowDetails] = useState(false)
  const intervalRef = useRef(null)

  const runHealthCheck = useCallback(async () => {
    setStatus(null)
    const data = await checkHealth()
    if (data) {
      setStatus('online')
      setHealthData(data)
    } else {
      setStatus('offline')
      setHealthData(null)
    }
  }, [])

  // Initial check
  useEffect(() => {
    runHealthCheck()
    // Periodic re-check
    intervalRef.current = setInterval(runHealthCheck, CHECK_INTERVAL)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [runHealthCheck])

  // Start command with visual typing effect
  const [typedCmd, setTypedCmd] = useState('')
  const [showCursor, setShowCursor] = useState(true)
  const CMD = 'python server.py'

  useEffect(() => {
    if (status === 'offline') {
      let i = 0
      setTypedCmd('')
      const timer = setInterval(() => {
        if (i < CMD.length) {
          setTypedCmd(CMD.slice(0, i + 1))
          i++
        } else {
          clearInterval(timer)
        }
      }, 40)
      return () => clearInterval(timer)
    }
  }, [status])

  // Blinking cursor
  useEffect(() => {
    const timer = setInterval(() => setShowCursor(c => !c), 530)
    return () => clearInterval(timer)
  }, [])

  if (compact) {
    // Mini version for header/footer
    return (
      <button
        className={`backend-mini ${status || 'checking'}`}
        onClick={runHealthCheck}
        title={status === 'online' ? 'Backend Online - Click to refresh' : 'Backend Offline - Click to check again'}
      >
        <span className={`backend-mini-dot ${status || 'checking'}`} />
        <span className="backend-mini-label">
          {status === null ? '...' : status === 'online' ? 'Backend' : 'Start Backend'}
        </span>
      </button>
    )
  }

  return (
    <div className="backend-control">
      <div className="backend-header">
        <div className="backend-header-left">
          <span className="backend-icon">
            {status === 'online' ? '🟢' : status === 'offline' ? '🔴' : '🟡'}
          </span>
          <div>
            <strong className="backend-title">Backend Server</strong>
            <span className="backend-subtitle">
              {status === null ? 'Checking connection...' :
               status === 'online' ? 'Server is running and healthy' :
               'Server is offline — start it to unlock features'}
            </span>
          </div>
        </div>
        <div className="backend-header-right">
          <span className={`backend-badge ${status || 'checking'}`}>
            {status === null ? 'CHECKING' : status === 'online' ? 'ONLINE' : 'OFFLINE'}
          </span>
          <button className="backend-refresh-btn" onClick={runHealthCheck} title="Check again">
            🔄
          </button>
          <button
            className="backend-toggle-btn"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? '▲ Less' : '▼ More'}
          </button>
        </div>
      </div>

      {showDetails && (
        <div className="backend-details">
          {/* Terminal */}
          <div className="backend-terminal">
            <div className="terminal-header">
              <span className="terminal-dot red" />
              <span className="terminal-dot yellow" />
              <span className="terminal-dot green" />
              <span className="terminal-title">server.py — localhost:8000</span>
            </div>
            <div className="terminal-body">
              {status === 'online' ? (
                <>
                  <div className="terminal-line">
                    <span className="terminal-prompt">$</span>
                    <span className="terminal-cmd">python server.py</span>
                  </div>
                  <div className="terminal-line success">[OK] Server started on http://localhost:8000</div>
                  <div className="terminal-line info">[API] http://localhost:8000/docs</div>
                  <div className="terminal-line info">[API] http://localhost:8000/health</div>
                  <div className="terminal-line info">[API] POST /api/balances, /api/withdraw, /api/sweep</div>
                  <div className="terminal-line info">[API] POST /api/auth/login, /api/auth/register</div>
                  <div className="terminal-line info">[API] POST /api/subscriptions/purchase</div>
                  {healthData && (
                    <div className="terminal-line success">
                      [health] status={healthData.status} | web3={healthData.web3_available ? 'ok' : 'n/a'} | {healthData.timestamp?.slice(11, 19)}
                    </div>
                  )}
                  <div className="terminal-line">
                    <span className="terminal-prompt">$</span>
                    <span className="terminal-cursor blinking">_</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="terminal-line">
                    <span className="terminal-prompt">$</span>
                    <span className="terminal-cmd">{typedCmd}<span className={`terminal-cursor ${showCursor ? 'visible' : ''}`}>|</span></span>
                  </div>
                  <div className="terminal-line dim"># Server not started yet</div>
                  <div className="terminal-line dim"># Copy the command below and run it in your terminal:</div>
                  <div className="terminal-line cmd-block">
                    <code>python server.py</code>
                    <CopyButton text="python server.py" />
                  </div>
                  <div className="terminal-line dim" style={{ marginTop: 8 }}>
                    # Make sure you have fastapi and uvicorn installed:
                  </div>
                  <div className="terminal-line cmd-block">
                    <code>pip install fastapi uvicorn web3 eth-account python-dotenv</code>
                    <CopyButton text="pip install fastapi uvicorn web3 eth-account python-dotenv" />
                  </div>
                  <div className="terminal-line dim" style={{ marginTop: 8 }}>
                    # Or create a .env file with your keys:
                  </div>
                  <div className="terminal-line cmd-block">
                    <code>cp .env.example .env</code>
                    <CopyButton text="cp .env.example .env" />
                  </div>
                  <div className="terminal-line gap" />
                  <div className="terminal-line">
                    <span className="terminal-prompt">$</span>
                    <span className="terminal-cursor blinking">_</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Quick actions */}
          {status === 'offline' && (
            <div className="backend-quick-actions">
              <p className="backend-qa-title">Quick Start</p>
              <div className="backend-qa-steps">
                <div className="backend-qa-step">
                  <span className="qa-step-num">1</span>
                  <span className="qa-step-text">Install dependencies: <code>pip install fastapi uvicorn web3 eth-account python-dotenv</code></span>
                </div>
                <div className="backend-qa-step">
                  <span className="qa-step-num">2</span>
                  <span className="qa-step-text">Copy env template: <code>cp .env.example .env</code></span>
                </div>
                <div className="backend-qa-step">
                  <span className="qa-step-num">3</span>
                  <span className="qa-step-text">Edit <code>.env</code> with your Ethereum/BSC relayer keys</span>
                </div>
                <div className="backend-qa-step">
                  <span className="qa-step-num">4</span>
                  <span className="qa-step-text">Run: <code>python server.py</code></span>
                </div>
                <div className="backend-qa-step">
                  <span className="qa-step-num">5</span>
                  <span className="qa-step-text">Click <strong>"Check Again"</strong> above once the server is running</span>
                </div>
              </div>
            </div>
          )}

          {status === 'online' && (
            <div className="backend-quick-actions">
              <p className="backend-qa-title">Server Status</p>
              <div className="backend-server-stats">
                <div className="backend-stat-item">
                  <span className="bs-label">Status</span>
                  <span className="bs-value success">Healthy</span>
                </div>
                <div className="backend-stat-item">
                  <span className="bs-label">web3.py</span>
                  <span className={`bs-value ${healthData?.web3_available ? 'success' : 'dim'}`}>
                    {healthData?.web3_available ? 'Available' : 'Not installed'}
                  </span>
                </div>
                <div className="backend-stat-item">
                  <span className="bs-label">API Docs</span>
                  <span className="bs-value">
                    <a href="http://localhost:8000/docs" target="_blank" rel="noopener noreferrer">
                      http://localhost:8000/docs ↗
                    </a>
                  </span>
                </div>
                <div className="backend-stat-item">
                  <span className="bs-label">Endpoints</span>
                  <span className="bs-value">/health, /api/config, /api/balances, /api/withdraw, /api/sweep, /api/auth/*, /api/subscriptions/*, /api/admin/*</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
