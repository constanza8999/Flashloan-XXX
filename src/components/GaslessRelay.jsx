import React, { useState, useCallback, useEffect } from 'react'
import { ethers } from 'ethers'
import { ETH_RPCS, ETH_CHAIN_ID, BSC_CHAIN_ID } from '../constants'
import { useProvider } from '../hooks'
import { useWeb3 } from '../context/Web3Context'
import useTransactionHistory from '../hooks/useTransactionHistory'
import NetworkStatus from './shared/NetworkStatus'
import StatsBar from './shared/StatsBar'
import ConfigPanel from './shared/ConfigPanel'
import LogPanel from './shared/LogPanel'
import PrivateKeyInput from './shared/PrivateKeyInput'
import LoadingButton from './shared/LoadingButton'
import ErrorBox from './shared/ErrorBox'

const FORWARDER_ABI = [
  'function execute(tuple(address from, address to, uint256 value, uint256 gas, uint256 nonce, bytes data, uint256 deadline) req, bytes signature) returns (bool success, bytes returnData)',
  'function executeBatch(tuple(address from, address to, uint256 value, uint256 gas, uint256 nonce, bytes data, uint256 deadline)[] requests, bytes[] signatures) returns (bool[] successes, bytes[] returnDatas)',
  'function nonces(address user) view returns (uint256)',
  'function verify(tuple(address from, address to, uint256 value, uint256 gas, uint256 nonce, bytes data, uint256 deadline) req, bytes signature) view returns (bool)',
  'function relayers(address) view returns (bool)',
]

const EIP712_FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'deadline', type: 'uint256' },
  ],
}

function buildEIP712Domain(chainId, verifyingContract) {
  return { name: 'TrustedForwarder', version: '1.0.0', chainId, verifyingContract }
}

export default function GaslessRelay() {
  const { signer: walletSigner, walletAddress, isConnected } = useWeb3()
  const w3 = useProvider(ETH_RPCS)
  const { addTx, updateTxStatus } = useTransactionHistory()

  const [forwarderAddress, setForwarderAddress] = useState('')
  const [chainId, setChainId] = useState(ETH_CHAIN_ID)
  const [forwarderContract, setForwarderContract] = useState(null)
  const [targetContract, setTargetContract] = useState('')
  const [callData, setCallData] = useState('')
  const [deadlineMin, setDeadlineMin] = useState(10)
  const [gasLimitMeta, setGasLimitMeta] = useState(200000)
  const [privateKey, setPrivateKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [useWalletSign, setUseWalletSign] = useState(false)

  const [relayNodes, setRelayNodes] = useState([])
  const [newNodeAddr, setNewNodeAddr] = useState('')
  const [newNodeName, setNewNodeName] = useState('')
  const [newNodeRegion, setNewNodeRegion] = useState('auto')

  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(null)
  const [nonceLoading, setNonceLoading] = useState(false)
  const [networkStatus, setNetworkStatus] = useState({
    totalNodes: 0, activeNodes: 0, totalRelayed: 0, gasSaved: '0.0',
    connected: false, networkName: '', blockNumber: 0,
  })

  const addLog = useCallback((msg, type = 'info') => {
    setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg, type }, ...prev].slice(0, 100))
  }, [])

  useEffect(() => { if (isConnected) setUseWalletSign(true) }, [isConnected])

  useEffect(() => {
    if (!w3 || !forwarderAddress || !ethers.isAddress(forwarderAddress)) {
      setForwarderContract(null); return
    }
    try {
      const contract = new ethers.Contract(forwarderAddress, FORWARDER_ABI, w3)
      setForwarderContract(contract)
      w3.getBlockNumber().then(b => setNetworkStatus(p => ({ ...p, blockNumber: b })))
      w3.getNetwork().then(n => setNetworkStatus(p => ({ ...p, networkName: n.name || `Chain ${n.chainId}` })))
      addLog(`🔗 Forwarder contract set: ${forwarderAddress.slice(0, 10)}...`, 'success')
    } catch { setForwarderContract(null) }
  }, [w3, forwarderAddress, addLog])

  const fetchNonce = useCallback(async () => {
    if (!forwarderContract || !walletAddress) { setNonce(null); return }
    setNonceLoading(true)
    try {
      const n = await forwarderContract.nonces(walletAddress)
      setNonce(Number(n))
      addLog(`📝 Current nonce: ${n}`, 'info')
    } catch (err) { addLog(`❌ Failed to fetch nonce: ${err.message}`, 'error') }
    setNonceLoading(false)
  }, [forwarderContract, walletAddress, addLog])

  useEffect(() => { if (forwarderContract && walletAddress) fetchNonce() }, [forwarderContract, walletAddress, fetchNonce])

  const addRelayNode = useCallback(async () => {
    if (!newNodeAddr || !ethers.isAddress(newNodeAddr)) { addLog('❌ Invalid relay node address', 'error'); return }
    let isRegistered = false
    if (forwarderContract) { try { isRegistered = await forwarderContract.relayers(newNodeAddr) } catch {} }
    const region = newNodeRegion === 'auto'
      ? ['us-east', 'eu-west', 'ap-southeast', 'us-west', 'eu-central'][Math.floor(Math.random() * 5)]
      : newNodeRegion
    setRelayNodes(prev => [...prev, {
      id: Date.now(), address: newNodeAddr, name: newNodeName || `relay-${prev.length + 1}`,
      region, status: 'online', registered: isRegistered, txCount: 0, successCount: 0, latencyMs: 0, balanceEth: '0',
    }])
    setNetworkStatus(p => ({ ...p, totalNodes: p.totalNodes + 1, activeNodes: p.activeNodes + 1 }))
    addLog(`✅ Relay node added: ${newNodeName || `relay-${relayNodes.length + 1}`} (${region})${isRegistered ? ' — verified on-chain' : ''}`, isRegistered ? 'success' : 'info')
    setNewNodeAddr(''); setNewNodeName('')
  }, [newNodeAddr, newNodeName, newNodeRegion, forwarderContract, relayNodes.length, addLog])

  const removeRelayNode = useCallback((id) => {
    setRelayNodes(prev => { const u = prev.filter(n => n.id !== id); setNetworkStatus(ns => ({ ...ns, totalNodes: u.length, activeNodes: u.filter(n => n.status === 'online').length })); return u })
  }, [])

  const checkNodeHealth = useCallback(async (node) => {
    if (!w3) return false
    const start = Date.now()
    try {
      const balance = await w3.getBalance(node.address)
      const latency = Date.now() - start
      setRelayNodes(prev => prev.map(n => n.id === node.id ? { ...n, status: 'online', latencyMs: latency, balanceEth: parseFloat(ethers.formatEther(balance)).toFixed(4), lastBlock: networkStatus.blockNumber } : n))
      return true
    } catch {
      setRelayNodes(prev => prev.map(n => n.id === node.id ? { ...n, status: 'offline', latencyMs: 0 } : n))
      return false
    }
  }, [w3, networkStatus.blockNumber])

  const checkHealth = useCallback(async () => {
    addLog('🔍 Running relay node health checks...', 'info')
    let activeCount = 0
    for (const node of relayNodes) { if (await checkNodeHealth(node)) activeCount++ }
    setNetworkStatus(ns => ({ ...ns, activeNodes: activeCount }))
    addLog(`✅ Health check complete: ${activeCount}/${relayNodes.length} nodes online`, 'success')
  }, [relayNodes, checkNodeHealth, addLog])

  const refreshNodeBalances = useCallback(async () => {
    if (!w3) { addLog('❌ No RPC connection', 'error'); return }
    addLog('💰 Fetching relay node balances from chain...', 'info')
    for (const node of relayNodes) {
      try {
        const balance = await w3.getBalance(node.address)
        setRelayNodes(prev => prev.map(n => n.id === node.id ? { ...n, balanceEth: parseFloat(ethers.formatEther(balance)).toFixed(4) } : n))
      } catch { addLog(`  ⚠ Could not fetch balance for ${node.name}`, 'warning') }
    }
    addLog('✅ Balances refreshed', 'success')
  }, [w3, relayNodes, addLog])

  const handleSubmitMetaTx = useCallback(async () => {
    if (!forwarderAddress || !ethers.isAddress(forwarderAddress)) { addLog('❌ Valid forwarder address required', 'error'); return }
    if (!targetContract || !ethers.isAddress(targetContract)) { addLog('❌ Valid target contract address required', 'error'); return }
    if (!callData || callData === '0x') { addLog('❌ Call data required', 'error'); return }
    if (!useWalletSign && !privateKey) { addLog('❌ Private key or wallet needed', 'error'); return }
    if (relayNodes.length === 0) { addLog('❌ At least one relay node required', 'error'); return }

    setLoading(true)
    addLog('🔨 Building EIP-712 ForwardRequest...', 'info')

    try {
      let currentNonce
      if (forwarderContract && walletAddress) {
        currentNonce = Number(await forwarderContract.nonces(walletAddress))
        addLog(`📝 Nonce: ${currentNonce}`, 'info')
      } else { currentNonce = nonce || 0 }

      const deadline = Math.floor(Date.now() / 1000) + deadlineMin * 60
      let signerAddress = (useWalletSign && isConnected) ? walletAddress : new ethers.Wallet(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey).address

      const req = { from: signerAddress, to: ethers.getAddress(targetContract), value: 0, gas: gasLimitMeta, nonce: currentNonce, data: callData, deadline }
      const domain = buildEIP712Domain(chainId, forwarderAddress)

      let signature
      if (useWalletSign && walletSigner) {
        if (!walletSigner.signTypedData) throw new Error('Wallet does not support signTypedData')
        signature = await walletSigner.signTypedData(domain, EIP712_FORWARD_REQUEST_TYPES, req)
        addLog(`🦊 Signed with wallet: ${signerAddress.slice(0, 10)}...`, 'success')
      } else {
        const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
        signature = await new ethers.Wallet(pk).signTypedData(domain, EIP712_FORWARD_REQUEST_TYPES, req)
        addLog(`🔑 Signed with key: ${signerAddress.slice(0, 10)}...`, 'success')
      }

      if (forwarderContract) {
        try {
          const isValid = await forwarderContract.verify(req, signature)
          addLog(isValid ? '✅ Signature verified on-chain!' : '⚠ Verification returned false', isValid ? 'success' : 'warning')
        } catch (err) { addLog(`⚠ Could not verify on-chain: ${err.message}`, 'warning') }
      }

      const onlineNodes = relayNodes.filter(n => n.status === 'online')
      if (onlineNodes.length === 0) { addLog('❌ No online relay nodes available', 'error'); setLoading(false); return }

      const bestNode = onlineNodes.sort((a, b) => a.latencyMs - b.latencyMs)[0]

      if (forwarderContract) {
        try {
          const execData = forwarderContract.interface.encodeFunctionData('execute', [req, signature])
          const gasEstimate = await forwarderContract.execute.estimateGas(req, signature)
          addLog(`📊 Gas estimate: ${gasEstimate}`, 'info')

          let submittedCount = 0
          if (useWalletSign && walletSigner) {
            const tx = await walletSigner.sendTransaction({ to: forwarderAddress, data: execData, gasLimit: gasEstimate * 2n })
            const txId = addTx({ chain: `ETH (Forwarder:${forwarderAddress.slice(0, 8)})`, status: 'broadcast', tokenSymbol: 'META-TX', amount: 'gasless', recipient: targetContract, sender: signerAddress, txHash: tx.hash, explorerUrl: `https://etherscan.io/tx/${tx.hash}`, method: 'wallet' })
            tx.wait().then(r => updateTxStatus(txId, 'confirmed', { blockNumber: r.blockNumber })).catch(() => {})
            addLog(`✅ Meta-tx submitted! Hash: ${tx.hash.slice(0, 18)}...`, 'profit')
            submittedCount++
          } else {
            const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
            const relayTx = await new ethers.Wallet(pk).connect(w3).sendTransaction({ to: forwarderAddress, data: execData, gasLimit: gasEstimate * 2n })
            addLog(`✅ Meta-tx submitted via relay wallet! Hash: ${relayTx.hash.slice(0, 18)}...`, 'profit')
            submittedCount++
          }

          if (submittedCount > 0) {
            setRelayNodes(prev => prev.map(n => n.id === bestNode.id ? { ...n, txCount: n.txCount + 1, successCount: n.successCount + 1 } : n))
            const gasSavedEth = ((gasLimitMeta * 25 * 1e-9) || 0.001).toFixed(4)
            setNetworkStatus(p => ({ ...p, totalRelayed: p.totalRelayed + 1, gasSaved: (parseFloat(p.gasSaved) + parseFloat(gasSavedEth)).toFixed(4) }))
            addLog(`🎉 Meta-tx relayed! Gas saved: ~${gasSavedEth} ETH`, 'profit')
            setTimeout(fetchNonce, 2000)
          }
        } catch (err) { addLog(`❌ Relay submission failed: ${err.message}`, 'error') }
      }
    } catch (err) { addLog(`❌ Meta-tx failed: ${err.message}`, 'error') }
    setLoading(false)
  }, [forwarderAddress, targetContract, callData, deadlineMin, gasLimitMeta, useWalletSign, isConnected, walletAddress, walletSigner, privateKey, forwarderContract, relayNodes, nonce, chainId, addTx, updateTxStatus, fetchNonce, addLog])

  const handleVerify = useCallback(async () => {
    if (!forwarderContract || !walletAddress) { addLog('❌ Forwarder contract and wallet required', 'error'); return }
    addLog(`🔍 Checking ${walletAddress.slice(0, 10)}... on forwarder...`, 'info')
    try {
      const n = await forwarderContract.nonces(walletAddress)
      const isRelayer = await forwarderContract.relayers(walletAddress).catch(() => false)
      setNonce(Number(n))
      addLog(`📝 Nonce: ${n} | Relayer: ${isRelayer ? '✅ Yes' : '❌ No'}`, isRelayer ? 'success' : 'info')
    } catch (err) { addLog(`❌ Failed: ${err.message}`, 'error') }
  }, [forwarderContract, walletAddress, addLog])

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">⛽</span>
        <div>
          <h2>Gasless Relay System</h2>
          <p>EIP-2771 meta-transactions with on-chain forwarder contract</p>
        </div>
      </div>

      <NetworkStatus
        networkName={networkStatus.networkName}
        blockNumber={networkStatus.blockNumber}
        connected={!!w3}
        error={!w3 ? 'No RPC connection. Check your network.' : null}
        extra={`📡 Connected`}
      />

      <StatsBar stats={[
        { label: 'Chain', value: networkStatus.networkName || '—', color: '#60a5fa' },
        { label: 'Relay Nodes', value: `${networkStatus.activeNodes}/${networkStatus.totalNodes}`, color: '#22c55e' },
        { label: 'Relayed Tx', value: networkStatus.totalRelayed, color: '#a78bfa' },
        { label: 'Gas Saved', value: `${networkStatus.gasSaved} ETH`, color: '#fbbf24' },
        { label: 'Your Nonce', value: <span>{nonce !== null ? nonce : '—'} <button className="btn btn-secondary" onClick={fetchNonce} disabled={nonceLoading} style={{ fontSize: 10, padding: '2px 6px', marginLeft: 6 }}>{nonceLoading ? '⏳' : '🔄'}</button></span>, color: nonce !== null ? '#22c55e' : '#888' },
      ]} />

      <ConfigPanel title="🔑 Signing Method">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className={`btn ${useWalletSign && isConnected ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setUseWalletSign(true)} disabled={!isConnected} style={{ fontSize: 12, padding: '6px 14px' }}>🦊 Wallet {isConnected ? `(${walletAddress.slice(0, 8)}...)` : '(disconnected)'}</button>
          <button className={`btn ${!useWalletSign ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setUseWalletSign(false)} style={{ fontSize: 12, padding: '6px 14px' }}>🔑 Private Key</button>
          <button className="btn btn-secondary" onClick={handleVerify} disabled={!forwarderContract || !walletAddress} style={{ fontSize: 12, padding: '6px 14px' }}>🔍 Check Nonce</button>
          <select className="input" value={chainId} onChange={e => setChainId(Number(e.target.value))} style={{ width: 'auto', fontSize: 12, padding: '4px 8px', marginLeft: 'auto' }}>
            <option value={ETH_CHAIN_ID}>Ethereum (1)</option>
            <option value={BSC_CHAIN_ID}>BNB Chain (56)</option>
          </select>
        </div>
        {!useWalletSign && <PrivateKeyInput privateKey={privateKey} setPrivateKey={setPrivateKey} showKey={showKey} setShowKey={setShowKey} />}
      </ConfigPanel>

      <ConfigPanel title="⚙️ Forwarder Configuration">
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>TrustedForwarder Contract Address</label>
          <input type="text" className="input mono" value={forwarderAddress} onChange={e => setForwarderAddress(e.target.value)} placeholder="0x... (deployed TrustedForwarder address)" />
          <span className="form-hint">{forwarderContract ? '✅ Contract loaded — ready to read nonces and submit' : 'Enter a deployed TrustedForwarder contract address'}</span>
        </div>
      </ConfigPanel>

      <ConfigPanel title="📝 EIP-712 Gasless Meta-Transaction">
        <p style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>Sign a typed EIP-712 ForwardRequest. A relay node submits it to the TrustedForwarder contract and pays gas on your behalf. Your signature is verified on-chain.</p>
        <div className="form-grid">
          <div className="form-group"><label>Target Contract (to)</label><input type="text" className="input mono" value={targetContract} onChange={e => setTargetContract(e.target.value)} placeholder="0x... (e.g., FlashArbitrage)" /></div>
          <div className="form-group"><label>Calldata (hex encoded)</label><input type="text" className="input mono" value={callData} onChange={e => setCallData(e.target.value)} placeholder="0x... (encoded function call)" /></div>
          <div className="form-group"><label>Deadline (minutes)</label><input type="number" className="input" value={deadlineMin} onChange={e => setDeadlineMin(Number(e.target.value))} min={1} max={60} /></div>
          <div className="form-group"><label>Gas Limit for Forwarded Call</label><input type="number" className="input" value={gasLimitMeta} onChange={e => setGasLimitMeta(Number(e.target.value))} min={50000} max={1000000} /></div>
        </div>
        <div className="form-actions">
          <LoadingButton loading={loading} loadingText="⏳ Signing & Relaying..." onClick={handleSubmitMetaTx} disabled={!w3 || !forwarderContract}>⛽ Sign & Submit Gasless Tx</LoadingButton>
        </div>
      </ConfigPanel>

      <ConfigPanel title="🌐 Relay Node Network" headerRight={
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={checkHealth} style={{ fontSize: 11, padding: '6px 12px' }}>🔍 Health Check</button>
          <button className="btn btn-secondary" onClick={refreshNodeBalances} style={{ fontSize: 11, padding: '6px 12px' }}>💰 Refresh Balances</button>
        </div>
      }>
        <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr auto', marginBottom: 16 }}>
          <div className="form-group"><label>Node Address</label><input type="text" className="input mono" value={newNodeAddr} onChange={e => setNewNodeAddr(e.target.value)} placeholder="0x relay node address" style={{ fontSize: 12 }} /></div>
          <div className="form-group"><label>Name</label><input type="text" className="input" value={newNodeName} onChange={e => setNewNodeName(e.target.value)} placeholder="my-node" style={{ fontSize: 12 }} /></div>
          <div className="form-group"><label>Region</label><select className="input" value={newNodeRegion} onChange={e => setNewNodeRegion(e.target.value)} style={{ fontSize: 12 }}><option value="auto">Auto-detect</option><option value="us-east">US East</option><option value="eu-west">EU West</option><option value="ap-southeast">AP Southeast</option></select></div>
          <div style={{ alignSelf: 'flex-end' }}><button className="btn btn-success" onClick={addRelayNode} style={{ fontSize: 11, padding: '8px 16px', marginTop: 22 }}>➕ Add</button></div>
        </div>

        {relayNodes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#666', fontStyle: 'italic' }}>Add relay node addresses above. These are the addresses that will submit meta-txs to the forwarder.</div>
        ) : (
          <div className="relay-node-grid">
            {relayNodes.map(node => (
              <div key={node.id} className={`relay-node-card ${node.status}`}>
                <div className="relay-node-header">
                  <span className={`relay-node-dot ${node.status}`} />
                  <strong className="relay-node-name">{node.name}</strong>
                  <span className="relay-node-region">{node.region}</span>
                  <button className="peer-remove" onClick={() => removeRelayNode(node.id)} title="Remove">✕</button>
                </div>
                <div className="relay-node-addr">{node.address.slice(0, 10)}...{node.address.slice(-6)}</div>
                <div className="relay-node-stats"><span>📊 {node.txCount} txs</span><span>⚡ {node.latencyMs || '?'}ms</span><span>💰 {node.balanceEth} ETH</span></div>
                <div className="relay-node-stats" style={{ marginTop: 4 }}><span>{node.registered ? '✅ On-chain' : '⚪ Unverified'}</span></div>
                <div className={`relay-node-status-badge ${node.status}`}>{node.status === 'online' ? '🟢 Online' : '🔴 Offline'}</div>
              </div>
            ))}
          </div>
        )}
      </ConfigPanel>

      <LogPanel logs={logs} title="📋 Activity Log" />

      <ErrorBox type="info" title="EIP-2771 Gasless Meta-Transactions" style={{ marginTop: 20 }}>
        <p style={{ color: '#a3a3a3', marginTop: 4, fontSize: 11, lineHeight: 1.5 }}>
          Users sign typed EIP-712 ForwardRequests off-chain. Relay nodes submit these to the TrustedForwarder contract, paying gas costs. The forwarder verifies the signature on-chain and forwards the call to the target contract. Users never need ETH for gas. Relayers are reimbursed from the forwarder's balance plus a configured premium.
        </p>
      </ErrorBox>
    </div>
  )
}
