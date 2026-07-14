import React, { useState, useRef, useCallback } from 'react'
import { ethers } from 'ethers'
import { POPULAR_BEP20, BSC_RPCS, BSC_CHAIN_ID, TRANSFER_SELECTOR, DEFAULT_BSC_GAS } from '../constants'

const DEFAULT_RECIPIENT = '0x9850f7eEAbe8E4FfF2662652aFF28b3De14C53F6'

function fmtSeconds(s) {
  s = Math.max(0, Math.floor(s))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`
}

function parseInterval(text) {
  const s = String(text).trim().toLowerCase()
  if (!s) throw new Error('Empty interval')
  const suffix = s.slice(-1)
  let n
  if (/^\d$/.test(suffix)) {
    n = parseInt(s, 10)
  } else if (suffix === 's') {
    n = parseInt(s.slice(0, -1), 10)
  } else if (suffix === 'm') {
    n = parseInt(s.slice(0, -1), 10) * 60
  } else if (suffix === 'h') {
    n = parseInt(s.slice(0, -1), 10) * 3600
  } else {
    throw new Error(`Unsupported suffix: ${suffix}`)
  }
  if (n <= 0) throw new Error(`Interval must be positive: ${n}`)
  return n
}

export default function AutoBot() {
  const [amount, setAmount] = useState('')
  const [interval, setInterval] = useState('60')
  const [maxCount, setMaxCount] = useState('')
  const [token, setToken] = useState('USDT')
  const [customToken, setCustomToken] = useState('')
  const [recipient, setRecipient] = useState(DEFAULT_RECIPIENT)
  const [priorityGwei, setPriorityGwei] = useState('0.5')
  const [maxFeeGwei, setMaxFeeGwei] = useState('')
  const [gasLimit, setGasLimit] = useState(String(DEFAULT_BSC_GAS))
  const [privateKey, setPrivateKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [dryRun, setDryRun] = useState(false)

  const [botStatus, setBotStatus] = useState('idle') // idle | running | paused | stopped
  const [logs, setLogs] = useState([])
  const [stats, setStats] = useState({ sent: 0, failed: 0, totalWei: 0n })
  const [error, setError] = useState('')

  const abortRef = useRef(null)
  const pausedRef = useRef(false)

  const addLog = useCallback((msg, type = 'info') => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg, type }])
  }, [])

  const getTokenAddress = () => {
    if (token === 'CUSTOM') return customToken.trim()
    return POPULAR_BEP20[token]
  }

  const handleStart = async () => {
    setError('')
    setLogs([])
    setStats({ sent: 0, failed: 0, totalWei: 0n })

    if (!amount || parseFloat(amount) <= 0) { setError('Invalid amount'); return }
    if (!privateKey) { setError('Private key is required'); return }
    if (!ethers.isAddress(recipient)) { setError('Invalid recipient address'); return }
    if (token === 'CUSTOM' && (!customToken || !ethers.isAddress(customToken))) {
      setError('Invalid custom token address'); return
    }

    let intervalSec
    try {
      intervalSec = parseInterval(interval)
    } catch (e) {
      setError(e.message); return
    }

    const maxCountNum = maxCount ? parseInt(maxCount, 10) : null
    if (maxCountNum !== null && maxCountNum <= 0) { setError('--max-count must be > 0'); return }

    const tokenAddr = getTokenAddress()
    const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
    const wallet = new ethers.Wallet(pk)
    const sender = wallet.address
    const toAddr = ethers.getAddress(recipient)

    setBotStatus('running')
    pausedRef.current = false
    let iteration = 0
    let sentOk = 0
    let sentFail = 0
    let totalWei = 0n
    const abortCtrl = new AbortController()
    abortRef.current = abortCtrl

    // First connect to get token info
    let w3
    try {
      for (const rpc of BSC_RPCS) {
        const p = new ethers.JsonRpcProvider(rpc)
        await p.getNetwork()
        w3 = p
        break
      }
    } catch {
      setError('Could not connect to any BSC RPC')
      setBotStatus('idle')
      return
    }

    const tokenContract = new ethers.Contract(tokenAddr, ['function decimals() view returns (uint8)', 'function symbol() view returns (string)'], w3)
    let tokenDecimals, tokenSymbol
    try {
      tokenDecimals = Number(await tokenContract.decimals())
      tokenSymbol = await tokenContract.symbol()
    } catch {
      tokenDecimals = 18
      tokenSymbol = token
    }
    const amountWei = ethers.parseUnits(amount, tokenDecimals)

    addLog(`Bot started: ${amount} ${tokenSymbol} → ${toAddr.slice(0, 10)}... every ${fmtSeconds(intervalSec)}`, 'success')
    addLog(`Sender: ${sender} | Token: ${tokenSymbol} (${tokenAddr.slice(0, 10)}...)`, 'info')
    addLog(`Max count: ${maxCountNum ?? '∞'} | Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`, 'info')

    const runLoop = async () => {
      while (!abortCtrl.signal.aborted) {
        if (maxCountNum !== null && sentOk >= maxCountNum) {
          addLog(`Reached --max-count=${maxCountNum}. Bot stopping.`, 'success')
          break
        }
        if (pausedRef.current) {
          await new Promise(r => setTimeout(r, 500))
          continue
        }

        iteration++
        addLog(`--- Send #${iteration} ---`, 'highlight')

        try {
          const nonce = await w3.getTransactionCount(sender)
          const feeData = await w3.getFeeData()
          const priority = ethers.parseUnits(priorityGwei, 'gwei')
          const maxFee = maxFeeGwei
            ? ethers.parseUnits(maxFeeGwei, 'gwei')
            : feeData.maxFeePerGas || ethers.parseUnits('5', 'gwei')

          const data = TRANSFER_SELECTOR +
            toAddr.slice(2).toLowerCase().padStart(64, '0') +
            amountWei.toString(16).padStart(64, '0')

          const tx = {
            to: ethers.getAddress(tokenAddr),
            value: 0n,
            gasLimit: BigInt(gasLimit),
            nonce,
            chainId: BSC_CHAIN_ID,
            maxPriorityFeePerGas: priority,
            maxFeePerGas: maxFee,
            data,
          }

          if (!dryRun) {
            const signingWallet = wallet.connect(w3)
            const sentTx = await signingWallet.sendTransaction(tx)
            const receipt = await sentTx.wait()
            addLog(`✓ Sent #${iteration}: ${sentTx.hash.slice(0, 18)}... (block ${receipt.blockNumber})`, 'success')
            totalWei += amountWei
          } else {
            addLog(`✓ Dry-Run #${iteration}: tx built (not submitted)`, 'success')
          }
          sentOk++
        } catch (err) {
          sentFail++
          addLog(`✗ Send #${iteration} FAILED: ${err.message?.slice(0, 80) || err}`, 'error')
        }

        setStats({ sent: sentOk, failed: sentFail, totalWei })

        // Countdown
        if (!abortCtrl.signal.aborted && !(maxCountNum !== null && sentOk >= maxCountNum)) {
          try {
            await countdown(intervalSec, abortCtrl.signal, pausedRef)
          } catch {
            break
          }
        }
      }

      setBotStatus('stopped')
      const totalHuman = totalWei > 0n ? ethers.formatUnits(totalWei, tokenDecimals) : '0'
      addLog(`Bot stopped. Sent: ${sentOk} | Failed: ${sentFail} | Total: ${totalHuman} ${tokenSymbol}`, 'highlight')
    }

    runLoop().catch(err => {
      addLog(`Bot error: ${err.message}`, 'error')
      setBotStatus('stopped')
    })
  }

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort()
    }
    setBotStatus('stopped')
  }

  const handlePause = () => {
    pausedRef.current = true
    setBotStatus('paused')
    addLog('Bot paused', 'warning')
  }

  const handleResume = () => {
    pausedRef.current = false
    setBotStatus('running')
    addLog('Bot resumed', 'success')
  }

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">⚡</span>
        <div>
          <h2>Auto-Send Bot</h2>
          <p>Schedule automatic BSC token transfers at regular intervals</p>
        </div>
      </div>

      <div className="form-grid">
        <div className="form-group">
          <label>Private Key</label>
          <div className="input-with-toggle">
            <input type={showKey ? 'text' : 'password'} value={privateKey} onChange={e => setPrivateKey(e.target.value)} placeholder="0x..." className="input mono" />
            <button className="toggle-btn" onClick={() => setShowKey(!showKey)}>{showKey ? '🙈' : '👁'}</button>
          </div>
        </div>

        <div className="form-group">
          <label>Token</label>
          <select value={token} onChange={e => setToken(e.target.value)} className="input">
            {Object.entries(POPULAR_BEP20).map(([sym, addr]) => (<option key={sym} value={sym}>{sym}</option>))}
            <option value="CUSTOM">Custom</option>
          </select>
          {token === 'CUSTOM' && (
            <input type="text" value={customToken} onChange={e => setCustomToken(e.target.value)} placeholder="0x..." className="input mono" style={{ marginTop: 8 }} />
          )}
        </div>

        <div className="form-group">
          <label>Amount per send</label>
          <input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 10" className="input" />
        </div>

        <div className="form-group">
          <label>Interval</label>
          <input type="text" value={interval} onChange={e => setInterval(e.target.value)} placeholder="60 | 30s | 5m | 1h" className="input" />
        </div>

        <div className="form-group">
          <label>Max sends (optional)</label>
          <input type="number" value={maxCount} onChange={e => setMaxCount(e.target.value)} placeholder="∞ if empty" className="input" />
        </div>

        <div className="form-group">
          <label>Recipient</label>
          <input type="text" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder={DEFAULT_RECIPIENT} className="input mono" />
        </div>

        <div className="form-group">
          <label>Priority (Gwei)</label>
          <input type="number" step="0.1" value={priorityGwei} onChange={e => setPriorityGwei(e.target.value)} className="input" />
        </div>

        <div className="form-group">
          <label>Max Fee (Gwei)</label>
          <input type="number" step="0.1" value={maxFeeGwei} onChange={e => setMaxFeeGwei(e.target.value)} placeholder="Auto" className="input" />
        </div>

        <div className="form-group">
          <label>Gas Limit</label>
          <input type="number" value={gasLimit} onChange={e => setGasLimit(e.target.value)} className="input" />
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
            <span>Dry Run (simulate only)</span>
          </label>
        </div>
      </div>

      <div className="form-actions">
        {botStatus === 'idle' && (
          <button className="btn btn-success" onClick={handleStart}>▶ Start Bot</button>
        )}
        {botStatus === 'running' && (
          <>
            <button className="btn btn-warning" onClick={handlePause}>⏸ Pause</button>
            <button className="btn btn-danger" onClick={handleStop}>⏹ Stop</button>
          </>
        )}
        {botStatus === 'paused' && (
          <>
            <button className="btn btn-success" onClick={handleResume}>▶ Resume</button>
            <button className="btn btn-danger" onClick={handleStop}>⏹ Stop</button>
          </>
        )}
        {botStatus === 'stopped' && (
          <button className="btn btn-success" onClick={handleStart}>🔄 Restart Bot</button>
        )}
      </div>

      {error && <div className="error-box"><span className="error-icon">✕</span> {error}</div>}

      {stats.sent + stats.failed > 0 && (
        <div className="stats-bar">
          <div className="stat"><span className="stat-label">Sent</span><span className="stat-value success">{stats.sent}</span></div>
          <div className="stat"><span className="stat-label">Failed</span><span className="stat-value danger">{stats.failed}</span></div>
          <div className="stat"><span className="stat-label">Status</span><span className={`stat-value ${botStatus === 'running' ? 'success' : botStatus === 'paused' ? 'warning' : ''}`}>{botStatus}</span></div>
        </div>
      )}

      {logs.length > 0 && (
        <div className="log-panel">
          <h3>Bot Logs</h3>
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

function countdown(seconds, signal, pausedRef) {
  return new Promise((resolve, reject) => {
    const end = Date.now() + seconds * 1000
    const tick = () => {
      if (signal.aborted) { resolve(); return }
      if (pausedRef.current) { setTimeout(tick, 200); return }
      const remaining = Math.max(0, Math.floor((end - Date.now()) / 1000))
      if (remaining <= 0) { resolve(); return }
      setTimeout(tick, 200)
    }
    tick()
  })
}
