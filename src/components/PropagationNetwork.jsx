import React, { useState, useCallback, useEffect } from 'react'
import { ethers } from 'ethers'
import { ETH_RPCS, BSC_RPCS, ETH_PROTECT_RPC, DEFAULT_RECIPIENT } from '../constants'
import { useProvider } from '../hooks'
import { useWeb3 } from '../context/Web3Context'
import { sendPrivateTx } from '../utils/flashbots'
import useTransactionHistory from '../hooks/useTransactionHistory'
import NetworkStatus from './shared/NetworkStatus'
import StatsBar from './shared/StatsBar'
import ConfigPanel from './shared/ConfigPanel'
import LogPanel from './shared/LogPanel'
import PrivateKeyInput from './shared/PrivateKeyInput'
import LoadingButton from './shared/LoadingButton'
import ErrorBox from './shared/ErrorBox'

const DEFAULT_ENDPOINTS = [
  { name: 'Flashbots Protect', url: ETH_PROTECT_RPC, priority: 10, active: true },
  { name: 'Flashbots Relay', url: 'https://relay.flashbots.net', priority: 9, active: true },
  { name: 'MEV Blocker', url: 'https://rpc.mevblocker.io', priority: 8, active: true },
  { name: 'BloXroute (US East)', url: 'https://eth-us-east.blxrbdn.com', priority: 7, active: true },
  { name: 'BloXroute (Virginia)', url: 'https://virginia.rpc.blxrbdn.com', priority: 7, active: true },
  { name: 'Titan Relay', url: 'https://rpc.titanrelay.xyz', priority: 6, active: false },
  { name: 'Eden Network', url: 'https://eth.edennetwork.io', priority: 6, active: false },
  { name: 'beaverbuild', url: 'https://rpc.beaverbuild.org', priority: 5, active: false },
  { name: 'rsync builder', url: 'https://rpc.rsyncbuilder.xyz', priority: 5, active: false },
  { name: 'Manifold', url: 'https://rpc.manifoldlabs.com', priority: 4, active: false },
  { name: 'Payload', url: 'https://rpc.payload.de', priority: 4, active: false },
  { name: 'Builder0x69', url: 'https://builder0x69.io', priority: 3, active: false },
  { name: 'ETH Singapore', url: 'https://eth-builder.gateway.eth.si', priority: 3, active: false },
]

const SUPPORTED_CHAINS = [
  { id: 'ethereum', name: 'Ethereum', rpcs: ETH_RPCS, chainId: 1, explorer: 'https://etherscan.io' },
  { id: 'bsc', name: 'BNB Chain', rpcs: BSC_RPCS, chainId: 56, explorer: 'https://bscscan.com' },
]

function EndpointRow({ ep, index, toggleEndpoint, updateEndpointUrl, updatePriority }) {
  return (
    <div className={`endpoint-row ${ep.active ? 'active' : ''}`}>
      <div className="endpoint-toggle">
        <label className="sm-toggle">
          <input type="checkbox" checked={ep.active} onChange={() => toggleEndpoint(index)} />
          <span className="sm-toggle-slider" />
        </label>
      </div>
      <div className="endpoint-info">
        <div className="endpoint-name">{ep.name}</div>
        <input type="text" className="input mono" value={ep.url}
          onChange={e => updateEndpointUrl(index, e.target.value)}
          placeholder="https://rpc.url..." style={{ fontSize: 11, padding: '4px 8px', marginTop: 4 }} />
      </div>
      <div className="endpoint-priority">
        <label style={{ fontSize: 10, color: '#888' }}>Priority</label>
        <input type="number" className="input" value={ep.priority}
          onChange={e => updatePriority(index, e.target.value)}
          min={1} max={10} style={{ width: 60, fontSize: 11, padding: '4px 8px' }} />
      </div>
      <div className={`endpoint-badge ${ep.active && ep.url ? 'online' : 'offline'}`}>
        {ep.active && ep.url ? '🟢 Active' : '⚪ Off'}
      </div>
    </div>
  )
}

export default function PropagationNetwork() {
  const { signer: walletSigner, walletAddress, isConnected } = useWeb3()
  const ethW3 = useProvider(ETH_RPCS)
  const bscW3 = useProvider(BSC_RPCS)
  const { addTx, updateTxStatus } = useTransactionHistory()

  const [selectedChain, setSelectedChain] = useState('ethereum')
  const [endpoints, setEndpoints] = useState(DEFAULT_ENDPOINTS)
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState({ totalSubmissions: 0, successfulSubmissions: 0 })
  const [customEndpoint, setCustomEndpoint] = useState({ name: '', url: '' })
  const [connectionInfo, setConnectionInfo] = useState({ blockNumber: 0, gasPrice: '0', networkName: '' })
  const [recipient, setRecipient] = useState(DEFAULT_RECIPIENT)
  const [amount, setAmount] = useState('')
  const [gasLimit, setGasLimit] = useState('21000')
  const [privateKey, setPrivateKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [useWalletSign, setUseWalletSign] = useState(false)
  const [signedTxHex, setSignedTxHex] = useState('')
  const [signedTxResult, setSignedTxResult] = useState(null)

  const addLog = useCallback((msg, type = 'info') => {
    setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg, type }, ...prev].slice(0, 100))
  }, [])

  const w3 = selectedChain === 'ethereum' ? ethW3 : bscW3
  const chainMeta = SUPPORTED_CHAINS.find(c => c.id === selectedChain)

  useEffect(() => { if (isConnected) setUseWalletSign(true) }, [isConnected])

  useEffect(() => {
    if (!w3) return
    w3.getBlockNumber().then(b => setConnectionInfo(p => ({ ...p, blockNumber: b }))).catch(() => {})
    w3.getNetwork().then(n => setConnectionInfo(p => ({ ...p, networkName: n.name || `Chain ${n.chainId}` }))).catch(() => {})
    w3.getFeeData().then(f => setConnectionInfo(p => ({ ...p, gasPrice: ethers.formatUnits(f.gasPrice || f.maxFeePerGas || 0n, 'gwei') }))).catch(() => {})
  }, [w3])

  const toggleEndpoint = useCallback((i) => setEndpoints(p => p.map((ep, idx) => idx === i ? { ...ep, active: !ep.active } : ep)), [])
  const updateEndpointUrl = useCallback((i, url) => setEndpoints(p => p.map((ep, idx) => idx === i ? { ...ep, url } : ep)), [])
  const updatePriority = useCallback((i, priority) => setEndpoints(p => p.map((ep, idx) => idx === i ? { ...ep, priority: Math.max(1, Math.min(10, Number(priority))) } : ep)), [])

  const addCustomEndpoint = useCallback(() => {
    if (!customEndpoint.name || !customEndpoint.url) return
    setEndpoints(p => [...p, { ...customEndpoint, priority: 5, active: true }])
    setCustomEndpoint({ name: '', url: '' })
    addLog(`➕ Added custom endpoint: ${customEndpoint.name}`, 'success')
  }, [customEndpoint, addLog])

  const testEndpoint = useCallback(async (url) => {
    try { const tw3 = new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true }); await tw3.getBlockNumber(); return true } catch { return false }
  }, [])

  const testAllEndpoints = useCallback(async () => {
    addLog('🔍 Testing all endpoint connections...', 'info')
    let online = 0
    for (const ep of endpoints) {
      if (!ep.active || !ep.url) continue
      if (await testEndpoint(ep.url)) { addLog(`  ✅ ${ep.name}: reachable`, 'success'); online++ }
      else { addLog(`  ❌ ${ep.name}: unreachable`, 'error') }
    }
    addLog(`📊 ${online}/${endpoints.filter(e => e.active && e.url).length} endpoints online`, online > 0 ? 'success' : 'info')
  }, [endpoints, testEndpoint, addLog])

  const buildTransaction = useCallback(async () => {
    if (!w3) { addLog('❌ No RPC connection for selected chain', 'error'); return null }
    if (!recipient || !ethers.isAddress(recipient)) { addLog('❌ Valid recipient address required', 'error'); return null }
    if (!amount || parseFloat(amount) <= 0) { addLog('❌ Valid amount required', 'error'); return null }
    if (!useWalletSign && !privateKey) { addLog('❌ Private key or wallet needed', 'error'); return null }

    try {
      const sender = (useWalletSign && isConnected) ? walletAddress : new ethers.Wallet(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey).address
      const nonce = await w3.getTransactionCount(sender)
      const feeData = await w3.getFeeData()
      const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('10', 'gwei')
      const tx = { to: ethers.getAddress(recipient), value: ethers.parseEther(amount), gasLimit: BigInt(gasLimit), nonce, chainId: chainMeta?.chainId || 1, gasPrice, data: '0x' }

      addLog(`🔨 Built tx: ${amount} ETH → ${recipient.slice(0, 10)}... (nonce: ${nonce})`, 'info')

      let signedHex
      if (useWalletSign && walletSigner) {
        signedHex = await walletSigner.signTransaction(tx)
        addLog(`🦊 Signed with wallet (${sender.slice(0, 8)}...)`, 'success')
      } else {
        signedHex = await new ethers.Wallet(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey).signTransaction(tx)
        addLog(`🔑 Signed with key (${sender.slice(0, 8)}...)`, 'success')
      }

      setSignedTxHex(signedHex)
      setSignedTxResult({ hex: signedHex, tx })
      addLog(`✅ Transaction signed (${signedHex.length} hex chars)`, 'success')
      return signedHex
    } catch (err) { addLog(`❌ Build/sign failed: ${err.message}`, 'error'); return null }
  }, [w3, recipient, amount, gasLimit, useWalletSign, isConnected, walletAddress, walletSigner, privateKey, chainMeta, addLog])

  const broadcastToEndpoint = useCallback(async (ep, hex) => {
    try {
      if (ep.url === ETH_PROTECT_RPC) {
        const result = await sendPrivateTx(hex)
        if (result.ok) return { ok: true, txHash: result.txHash, endpoint: ep.name }
        return { ok: false, error: result.error, endpoint: ep.name }
      }
      const resp = await fetch(ep.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: [hex] }),
      })
      const data = await resp.json()
      if (data.result && data.result !== '0x' + '0'.repeat(64)) return { ok: true, txHash: data.result, endpoint: ep.name }
      return { ok: false, error: data.error?.message || 'rejected', endpoint: ep.name }
    } catch (err) { return { ok: false, error: err.message, endpoint: ep.name } }
  }, [])

  const handleBroadcast = useCallback(async () => {
    let hex = signedTxHex
    if (!hex) { hex = await buildTransaction(); if (!hex) return }

    setLoading(true)
    const activeEndpoints = endpoints.filter(ep => ep.active && ep.url)
    if (activeEndpoints.length === 0) { addLog('❌ No active endpoints configured.', 'error'); setLoading(false); return }

    addLog(`🚀 Broadcasting to ${activeEndpoints.length} endpoints...`, 'info')
    let successCount = 0
    const results = []

    for (const ep of activeEndpoints) {
      const r = await broadcastToEndpoint(ep, hex)
      if (r.ok) {
        results.push(r)
        addLog(`  ✅ ${ep.name}: ${r.txHash.slice(0, 14)}...`, 'success')
        successCount++
        setStats(p => ({ totalSubmissions: p.totalSubmissions + 1, successfulSubmissions: p.successfulSubmissions + 1 }))
      } else {
        addLog(`  ❌ ${ep.name}: ${r.error}`, 'error')
        setStats(p => ({ ...p, totalSubmissions: p.totalSubmissions + 1 }))
      }
    }

    if (results.length > 0) {
      const first = results[0]
      const explorerUrl = chainMeta ? `${chainMeta.explorer}/tx/${first.txHash}` : `https://etherscan.io/tx/${first.txHash}`
      addLog(`🔗 ${explorerUrl}`, 'link')
      const txId = addTx({ chain: `${selectedChain} (Propagation)`, status: 'broadcast', tokenSymbol: 'ETH', amount, recipient, sender: walletAddress || 'key-signed', txHash: first.txHash, explorerUrl, method: useWalletSign ? 'wallet' : 'key' })
      if (w3) {
        setTimeout(async () => {
          try { const receipt = await w3.getTransactionReceipt(first.txHash); if (receipt?.blockNumber) { updateTxStatus(txId, 'confirmed', { blockNumber: receipt.blockNumber }); addLog(`✅ Tx confirmed in block ${receipt.blockNumber}`, 'profit') } } catch {}
        }, 15000)
      }
    }
    addLog(`📊 Broadcast complete: ${successCount}/${activeEndpoints.length} endpoints succeeded`, successCount > 0 ? 'profit' : 'info')
    setLoading(false)
  }, [signedTxHex, buildTransaction, broadcastToEndpoint, endpoints, selectedChain, recipient, amount, useWalletSign, walletAddress, w3, chainMeta, addTx, updateTxStatus, addLog])

  const handleFastBroadcast = useCallback(async () => {
    if (!signedTxHex) { addLog('❌ No signed transaction.', 'error'); return }
    setLoading(true)
    const activeEndpoints = endpoints.filter(ep => ep.active && ep.url)
    addLog(`🚀 Fast-broadcasting to ${activeEndpoints.length} endpoints...`, 'info')
    let successCount = 0
    for (const ep of activeEndpoints) {
      const r = await broadcastToEndpoint(ep, signedTxHex)
      if (r.ok) { addLog(`  ✅ ${ep.name}: ${r.txHash.slice(0, 14)}...`, 'success'); successCount++; setStats(p => ({ totalSubmissions: p.totalSubmissions + 1, successfulSubmissions: p.successfulSubmissions + 1 })) }
      else { addLog(`  ❌ ${ep.name}: ${r.error}`, 'error'); setStats(p => ({ ...p, totalSubmissions: p.totalSubmissions + 1 })) }
    }
    addLog(`📊 Fast-broadcast: ${successCount}/${activeEndpoints.length} succeeded`, successCount > 0 ? 'profit' : 'info')
    setLoading(false)
  }, [signedTxHex, endpoints, broadcastToEndpoint, addLog])

  const handleConfirm = useCallback(async () => {
    if (!w3) { addLog('❌ No RPC connection', 'error'); return }
    let txHash = ''
    if (signedTxResult?.tx) { try { txHash = ethers.Transaction.from(signedTxResult.tx).hash } catch { txHash = signedTxHex?.slice(0, 66) || '' } }
    else { txHash = signedTxHex?.slice(0, 66) || '' }
    if (!txHash || txHash.length < 66) { addLog('❌ Need a signed transaction first', 'error'); return }

    setLoading(true)
    addLog(`⏳ Checking confirmation for ${txHash.slice(0, 18)}...`, 'info')
    try {
      const receipt = await w3.getTransactionReceipt(txHash)
      if (receipt?.blockNumber) { addLog(`✅ Confirmed in block ${receipt.blockNumber}! Status: ${receipt.status === 1 ? '✅ Success' : '❌ Failed'}`, 'profit') }
      else {
        addLog(`⏳ Still pending (not yet mined)`, 'info')
        const tx = await w3.getTransaction(txHash)
        if (tx) addLog(`  Position — nonce: ${tx.nonce}, gasPrice: ${ethers.formatUnits(tx.gasPrice || 0n, 'gwei')} gwei`, 'info')
        else addLog(`  Transaction not found in mempool or chain`, 'warning')
      }
    } catch (err) { addLog(`❌ Failed to check: ${err.message}`, 'error') }
    setLoading(false)
  }, [signedTxHex, signedTxResult, w3, addLog])

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">📡</span>
        <div>
          <h2>Propagation Network</h2>
          <p>Multi-endpoint private transaction broadcast engine — real blockchain connections</p>
        </div>
      </div>

      <NetworkStatus
        networkName={connectionInfo.networkName}
        blockNumber={connectionInfo.blockNumber}
        connected={!!w3}
        error={!w3 ? `No RPC connection for ${selectedChain}.` : null}
        extra={`⛽ ${parseFloat(connectionInfo.gasPrice).toFixed(2)} gwei`}
      />

      <StatsBar stats={[
        { label: 'Chain', value: <select value={selectedChain} onChange={e => { setSelectedChain(e.target.value); setSignedTxHex(''); setSignedTxResult(null) }} className="input" style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}>{SUPPORTED_CHAINS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select> },
        { label: 'Active Endpoints', value: endpoints.filter(ep => ep.active && ep.url).length, color: '#22c55e' },
        { label: 'Submissions', value: stats.totalSubmissions, color: '#60a5fa' },
        { label: 'Success Rate', value: stats.totalSubmissions > 0 ? ((stats.successfulSubmissions / stats.totalSubmissions) * 100).toFixed(0) + '%' : '0%', color: '#a78bfa' },
        { label: '', value: <button className="btn btn-secondary" onClick={testAllEndpoints} style={{ fontSize: 11, padding: '6px 12px' }}>🔍 Test Endpoints</button> },
      ]} />

      <ConfigPanel title="🔑 Signing Method">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className={`btn ${useWalletSign && isConnected ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setUseWalletSign(true)} disabled={!isConnected} style={{ fontSize: 12, padding: '6px 14px' }}>🦊 Wallet {isConnected ? `(${walletAddress.slice(0, 8)}...)` : '(disconnected)'}</button>
          <button className={`btn ${!useWalletSign ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setUseWalletSign(false)} style={{ fontSize: 12, padding: '6px 14px' }}>🔑 Private Key</button>
        </div>
        {!useWalletSign && <PrivateKeyInput privateKey={privateKey} setPrivateKey={setPrivateKey} showKey={showKey} setShowKey={setShowKey} />}
      </ConfigPanel>

      <ConfigPanel title="📝 Build & Sign Transaction">
        <div className="form-grid">
          <div className="form-group"><label>Amount ({chainMeta?.name === 'Ethereum' ? 'ETH' : 'BNB'})</label><input type="text" className="input" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.01" style={{ fontSize: 12 }} /></div>
          <div className="form-group"><label>Gas Limit</label><input type="number" className="input" value={gasLimit} onChange={e => setGasLimit(e.target.value)} min={21000} max={1000000} style={{ fontSize: 12 }} /></div>
          <div className="form-group"><label>Nonce</label><div style={{ fontSize: 12, color: '#888', padding: '10px 14px', background: 'var(--bg-input)', borderRadius: 6, border: '1px solid var(--border)' }}>Auto (from chain)</div></div>
        </div>
        <div className="form-actions">
          <LoadingButton loading={loading} loadingText="⏳ Building..." onClick={buildTransaction} disabled={!w3}>🔨 Build & Sign</LoadingButton>
          <LoadingButton loading={loading} loadingText="⏳ Broadcasting..." onClick={handleBroadcast} disabled={!w3} variant="btn-success">📡 Sign & Broadcast</LoadingButton>
          <button className="btn btn-secondary" onClick={handleConfirm} disabled={loading || !w3} style={{ fontSize: 12, padding: '10px 20px' }}>⏳ Check Confirmation</button>
        </div>
        {signedTxHex && <div style={{ marginTop: 12 }}><div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Signed Transaction Hex:</div><div className="result-hash" style={{ fontSize: 10, wordBreak: 'break-all', maxHeight: 80, overflow: 'auto' }}>{signedTxHex.slice(0, 100)}...{signedTxHex.slice(-20)}</div></div>}
      </ConfigPanel>

      <ConfigPanel title="📦 Fast Broadcast (paste raw hex)">
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <textarea className="input mono" value={signedTxHex} onChange={e => { setSignedTxHex(e.target.value); setSignedTxResult(null) }} placeholder="0x... (raw signed transaction hex)" rows={2} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, resize: 'vertical', width: '100%' }} />
        </div>
        <div className="form-actions">
          <LoadingButton loading={loading} loadingText="⏳ Fast Broadcasting..." onClick={handleFastBroadcast} disabled={!signedTxHex}>⚡ Fast Broadcast to All</LoadingButton>
        </div>
      </ConfigPanel>

      <ConfigPanel title="🔌 Private Mempool Endpoints" headerRight={
        <button className="btn btn-secondary" onClick={() => setEndpoints(DEFAULT_ENDPOINTS.map(ep => ({ ...ep })))} style={{ fontSize: 11, padding: '6px 12px' }}>🔄 Reset</button>
      }>
        <div className="endpoint-list">
          {endpoints.map((ep, i) => <EndpointRow key={i} ep={ep} index={i} toggleEndpoint={toggleEndpoint} updateEndpointUrl={updateEndpointUrl} updatePriority={updatePriority} />)}
        </div>
      </ConfigPanel>

      <ConfigPanel title="➕ Custom Endpoint">
        <div className="form-grid" style={{ gridTemplateColumns: '1fr 2fr auto' }}>
          <div className="form-group"><label>Name</label><input type="text" className="input" value={customEndpoint.name} onChange={e => setCustomEndpoint(p => ({ ...p, name: e.target.value }))} placeholder="My RPC" style={{ fontSize: 12 }} /></div>
          <div className="form-group"><label>URL</label><input type="text" className="input mono" value={customEndpoint.url} onChange={e => setCustomEndpoint(p => ({ ...p, url: e.target.value }))} placeholder="https://..." style={{ fontSize: 12 }} /></div>
          <div className="form-group" style={{ justifyContent: 'flex-end' }}><button className="btn btn-success" onClick={addCustomEndpoint} style={{ fontSize: 11, padding: '8px 16px', marginTop: 22 }}>➕ Add</button></div>
        </div>
      </ConfigPanel>

      <LogPanel logs={logs} title="📋 Broadcast Log" />

      <ErrorBox type="info" title="Private Transaction Propagation" style={{ marginTop: 20 }}>
        <p style={{ color: '#a3a3a3', marginTop: 4, fontSize: 11, lineHeight: 1.5 }}>
          Builds and signs real transactions using ethers.js, then submits them via eth_sendRawTransaction to multiple private mempool endpoints simultaneously — Flashbots Protect, BloXroute, Eden Network, and custom RPCs. Each endpoint is tested for connectivity. Transaction confirmation is verified on-chain.
        </p>
      </ErrorBox>
    </div>
  )
}
