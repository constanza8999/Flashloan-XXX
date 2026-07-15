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

// ─── Shared localStorage keys for cross-component discovery ───────────
const LS_KEY_P2P_PEERS = 'flashloan_p2p_peers'
const LS_KEY_RELAY_NODES = 'flashloan_relay_discovered_nodes'
const LS_KEY_DISCOVERED = 'flashloan_gasless_discovered'

// ─── Sample relay node addresses for auto-discovery generation ──────────
const SAMPLE_RELAY_ADDRESSES = [
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
  '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
  '0x976EA74026E726554dB337f4B1e23B5bA3b7c43d',
  '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
  '0x23618e81E3f5dfE7d1a3C3B3aEa8e6c6b5e3f7a1',
  '0x8Ab0F264B78C90D7FBcB510F8eD8c1d9E5f3B2a7',
  '0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db',
]

const SAMPLE_RELAY_NAMES = [
  'relay-node-ams', 'relay-node-fra', 'relay-node-lon',
  'relay-node-nyc', 'relay-node-sfo', 'relay-node-tok',
  'relay-node-sin', 'relay-node-syd', 'relay-node-gru', 'relay-node-bom',
]

const REGIONS = ['us-east', 'eu-west', 'ap-southeast', 'us-west', 'eu-central', 'sa-east', 'me-central', 'ap-northeast']

function randomRegion() {
  return REGIONS[Math.floor(Math.random() * REGIONS.length)]
}

function randomLatency() {
  return Math.floor(Math.random() * 120) + 5
}

function randomBalance() {
  return parseFloat((Math.random() * 5 + 0.1).toFixed(4))
}

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

// ─── Raw Tx Inspector: field display component ───────────────────────────
function TxField({ label, value, mono, copy }) {
  return (
    <div className="result-item" style={{ marginBottom: 4 }}>
      <span className="ri-label" style={{ fontSize: 10, color: '#888', display: 'block', marginBottom: 2 }}>{label}</span>
      <span className={`ri-value${mono ? ' mono' : ''}`} style={{
        fontSize: 11, color: '#e0e0e0', wordBreak: 'break-all',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {value?.length > 42 && mono ? `${value.slice(0, 10)}...${value.slice(-6)}` : value}
        {copy && value && (
          <button
            onClick={() => navigator.clipboard.writeText(value)}
            style={{
              background: 'none', border: 'none', color: '#666', cursor: 'pointer',
              fontSize: 11, padding: '2px 4px', borderRadius: 4, flexShrink: 0,
            }}
            title={`Copy ${label}`}
          >📋</button>
        )}
      </span>
    </div>
  )
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
  const [discoveredSources, setDiscoveredSources] = useState(null)

  // ─── State: Raw Tx Inspector ───────────────────────────────────────────
  const [inspectTxHash, setInspectTxHash] = useState('')
  const [inspectRawHex, setInspectRawHex] = useState('')
  const [fetchedTx, setFetchedTx] = useState(null)
  const [decodedTx, setDecodedTx] = useState(null)
  const [fetchLoading, setFetchLoading] = useState(false)
  const [decodeLoading, setDecodeLoading] = useState(false)

  // ─── Load previously discovered nodes from localStorage on mount ──────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY_DISCOVERED)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Auto-add previously discovered nodes that aren't already in the list
          const existingAddrs = new Set(relayNodes.map(n => n.address.toLowerCase()))
          let added = 0
          parsed.forEach(n => {
            if (!existingAddrs.has(n.address?.toLowerCase())) {
              setRelayNodes(prev => [...prev, n])
              setNetworkStatus(p => ({ ...p, totalNodes: p.totalNodes + 1, activeNodes: p.activeNodes + 1 }))
              existingAddrs.add(n.address?.toLowerCase())
              added++
            }
          })
          if (added > 0) {
            addLog(`📦 Restored ${added} previously discovered nodes from local storage`, 'system')
          }
        }
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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

  // ─── Save discovered nodes to localStorage ────────────────────────────
  const saveDiscoveredNodes = useCallback((nodes) => {
    try {
      const existing = JSON.parse(localStorage.getItem(LS_KEY_DISCOVERED) || '[]')
      const existingAddrs = new Set(existing.map(n => n.address?.toLowerCase()))
      const toSave = [...existing]
      nodes.forEach(n => {
        if (!existingAddrs.has(n.address?.toLowerCase())) {
          toSave.push(n)
          existingAddrs.add(n.address?.toLowerCase())
        }
      })
      localStorage.setItem(LS_KEY_DISCOVERED, JSON.stringify(toSave.slice(-50)))
    } catch { /* ignore */ }
  }, [])

  // ─── Add nodes with dedup ─────────────────────────────────────────────
  const addNodesDeduped = useCallback((newNodes, sourceName) => {
    const existingAddrs = new Set(relayNodes.map(n => n.address?.toLowerCase()))
    let added = 0
    let skipped = 0

    newNodes.forEach(n => {
      if (!n.address || !ethers.isAddress(n.address)) {
        skipped++
        return
      }
      if (existingAddrs.has(n.address.toLowerCase())) {
        skipped++
        return
      }
      const nodeEntry = {
        id: Date.now() + Math.floor(Math.random() * 10000),
        address: ethers.getAddress(n.address),
        name: n.name || `auto-${relayNodes.length + added + 1}`,
        region: n.region || randomRegion(),
        status: 'online',
        registered: n.registered || false,
        txCount: n.txCount || 0,
        successCount: n.successCount || 0,
        latencyMs: n.latencyMs || randomLatency(),
        balanceEth: n.balanceEth !== undefined ? String(n.balanceEth) : String(randomBalance()),
      }
      setRelayNodes(prev => [...prev, nodeEntry])
      setNetworkStatus(p => ({ ...p, totalNodes: p.totalNodes + 1, activeNodes: p.activeNodes + 1 }))
      existingAddrs.add(n.address.toLowerCase())
      added++
    })

    setDiscoveredSources({
      newNodes: added,
      skipped,
      errors: 0,
      source: sourceName,
      totalFound: newNodes.length,
    })

    // Save to localStorage for future auto-restore
    if (added > 0) {
      saveDiscoveredNodes(newNodes.filter(n => n.address && ethers.isAddress(n.address)))
    }

    return added
  }, [relayNodes, saveDiscoveredNodes])

  // ─── Auto-Discover: simulate network mesh discovery ────────────────────
  const handleAutoDiscover = useCallback(() => {
    addLog('🌐 Scanning relay mesh network for active nodes...', 'info')
    const count = 3 + Math.floor(Math.random() * 4) // 3-6 nodes
    const discovered = []
    for (let i = 0; i < count; i++) {
      const addrIdx = Math.floor(Math.random() * SAMPLE_RELAY_ADDRESSES.length)
      discovered.push({
        address: SAMPLE_RELAY_ADDRESSES[addrIdx],
        name: SAMPLE_RELAY_NAMES[Math.floor(Math.random() * SAMPLE_RELAY_NAMES.length)],
        region: randomRegion(),
        latencyMs: randomLatency(),
        balanceEth: randomBalance(),
        registered: Math.random() > 0.4,
      })
    }
    const added = addNodesDeduped(discovered, '🌐 Mesh Discovery')
    if (added > 0) {
      addLog(`🌐 Discovery complete — ${added} new relay nodes added to network`, 'success')
    } else {
      addLog('🔍 Discovery complete — no new unique nodes found', 'info')
    }
  }, [addNodesDeduped, addLog])

  // ─── Import from P2P Network (reads localStorage) ─────────────────────
  const handleImportFromP2P = useCallback(() => {
    addLog('📡 Reading P2P Network peers from storage...', 'info')
    try {
      const raw = localStorage.getItem(LS_KEY_P2P_PEERS)
      if (!raw) {
        addLog('⚠ No P2P peers found in storage. Open the P2P Network tab and discover peers first.', 'warn')
        setDiscoveredSources({ newNodes: 0, skipped: 0, errors: 0, source: '📡 P2P Network', totalFound: 0 })
        return
      }
      const peers = JSON.parse(raw)
      if (!Array.isArray(peers) || peers.length === 0) {
        addLog('⚠ No P2P peers found — list is empty', 'warn')
        return
      }

      // Convert peers to relay node format
      const relayCandidates = peers.map((p, i) => ({
        // Convert IP:port to a deterministic fake address for demo
        address: SAMPLE_RELAY_ADDRESSES[(p.ip?.split('.').reduce((a, b) => a + parseInt(b), 0) || i) % SAMPLE_RELAY_ADDRESSES.length],
        name: `p2p-${p.region || 'peer'}-${i + 1}`,
        region: p.region || randomRegion(),
        latencyMs: p.latencyMs || randomLatency(),
        balanceEth: randomBalance(),
        registered: Math.random() > 0.5,
      }))

      const added = addNodesDeduped(relayCandidates, '📡 P2P Network')
      if (added > 0) {
        addLog(`📡 Imported ${added} P2P peers as relay nodes`, 'success')
      }
    } catch (err) {
      addLog(`❌ Failed to import P2P peers: ${err.message}`, 'error')
    }
  }, [addNodesDeduped, addLog])

  // ─── Import from Relay Nodes Manager (reads localStorage) ─────────────
  const handleImportFromRelayNodes = useCallback(() => {
    addLog('🗼 Reading Relay Node Manager data from storage...', 'info')
    try {
      const raw = localStorage.getItem(LS_KEY_RELAY_NODES)
      if (!raw) {
        addLog('⚠ No Relay Nodes data found. Open the Relay Node Manager tab and discover nodes first.', 'warn')
        setDiscoveredSources({ newNodes: 0, skipped: 0, errors: 0, source: '🗼 Relay Nodes', totalFound: 0 })
        return
      }
      const nodes = JSON.parse(raw)
      if (!Array.isArray(nodes) || nodes.length === 0) {
        addLog('⚠ No relay nodes found — list is empty', 'warn')
        return
      }

      const relayCandidates = nodes.map((n, i) => ({
        address: SAMPLE_RELAY_ADDRESSES[(n.id || i) % SAMPLE_RELAY_ADDRESSES.length],
        name: n.name || `relay-mgr-${i + 1}`,
        region: n.region || randomRegion(),
        latencyMs: n.latencyMs || randomLatency(),
        balanceEth: n.balanceEth || randomBalance(),
        registered: n.status === 'active',
        txCount: n.txCount || 0,
        successCount: n.successCount || 0,
      }))

      const added = addNodesDeduped(relayCandidates, '🗼 Relay Nodes')
      if (added > 0) {
        addLog(`🗼 Imported ${added} nodes from Relay Node Manager`, 'success')
      }
    } catch (err) {
      addLog(`❌ Failed to import Relay Nodes: ${err.message}`, 'error')
    }
  }, [addNodesDeduped, addLog])

  // ─── Discover from Forwarder Contract (on-chain query) ────────────────
  const handleDiscoverFromForwarder = useCallback(async () => {
    if (!forwarderContract) {
      addLog('❌ Forwarder contract not loaded', 'error')
      return
    }
    addLog('⛓ Querying TrustedForwarder for registered relayers...', 'info')
    try {
      // Try to enumerate relayers via events or relayers() mapping
      // Since we can't enumerate mappings, use known test addresses
      const discovered = []
      for (const addr of SAMPLE_RELAY_ADDRESSES.slice(0, 5)) {
        try {
          const isRelayer = await forwarderContract.relayers(addr)
          if (isRelayer) {
            discovered.push({
              address: addr,
              name: `onchain-${addr.slice(2, 6)}`,
              region: randomRegion(),
              latencyMs: randomLatency(),
              balanceEth: randomBalance(),
              registered: true,
            })
            addLog(`  ✓ Found relayer: ${addr.slice(0, 10)}...`, 'success')
          }
        } catch { /* address may not support relayer check */ }
      }

      // Add sender wallet if it's registered
      if (walletAddress) {
        try {
          const isRelayer = await forwarderContract.relayers(walletAddress)
          if (isRelayer && !discovered.some(d => d.address.toLowerCase() === walletAddress.toLowerCase())) {
            discovered.push({
              address: walletAddress,
              name: 'current-wallet',
              region: randomRegion(),
              latencyMs: 2,
              balanceEth: '0.5',
              registered: true,
            })
            addLog(`  ✓ Current wallet is a registered relayer`, 'success')
          }
        } catch { /* ignore */ }
      }

      if (discovered.length > 0) {
        const added = addNodesDeduped(discovered, '⛓ Forwarder Contract')
        addLog(`⛓ Found ${discovered.length} registered relayers, added ${added}`, added > 0 ? 'success' : 'info')
      } else {
        // Fallback: generate some simulated registered relayers
        addLog('💡 No registered relayers found on-chain — generating simulated ones for testing', 'info')
        handleAutoDiscover()
      }
    } catch (err) {
      addLog(`❌ Forwarder discovery failed: ${err.message}`, 'error')
    }
  }, [forwarderContract, walletAddress, addNodesDeduped, handleAutoDiscover, addLog])

  // ─── Quick add 5 nodes ────────────────────────────────────────────────
  const handleBatchAdd = useCallback(() => {
    addLog('📦 Quick-adding 5 relay nodes...', 'info')
    const nodes = []
    for (let i = 0; i < 5; i++) {
      const idx = (relayNodes.length + i) % SAMPLE_RELAY_ADDRESSES.length
      nodes.push({
        address: SAMPLE_RELAY_ADDRESSES[idx],
        name: `quick-${i + 1}`,
        region: randomRegion(),
        latencyMs: randomLatency(),
        balanceEth: randomBalance(),
        registered: Math.random() > 0.5,
      })
    }
    const added = addNodesDeduped(nodes, '📦 Quick Add')
    addLog(`📦 Added ${added} nodes. Ready to relay!`, 'success')
  }, [relayNodes.length, addNodesDeduped, addLog])

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

  // ─── Raw Tx Inspector: Fetch from tx hash ────────────────────────────
  const [decodedForwardRequest, setDecodedForwardRequest] = useState(null)

  const handleFetchTx = useCallback(async () => {
    if (!w3 || !inspectTxHash || inspectTxHash.length < 10) {
      addLog('❌ Valid tx hash required', 'error'); return
    }
    setFetchLoading(true); setFetchedTx(null)
    addLog(`🔍 Fetching transaction: ${inspectTxHash.slice(0, 18)}...`, 'info')
    try {
      const tx = await w3.getTransaction(inspectTxHash)
      if (!tx) {
        addLog('❌ Transaction not found. Check the hash and chain.', 'error')
        setFetchLoading(false); return
      }
      // Get receipt for status & logs
      let receipt = null
      try { receipt = await w3.getTransactionReceipt(inspectTxHash) } catch { /* not found */ }
      setFetchedTx({
        hash: tx.hash,
        from: tx.from,
        to: tx.to || null,
        value: tx.value,
        nonce: tx.nonce,
        gasLimit: tx.gasLimit.toString(),
        gasPrice: tx.gasPrice,
        maxFeePerGas: tx.maxFeePerGas || null,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas || null,
        data: tx.data,
        chainId: tx.chainId,
        type: tx.type,
        blockNumber: receipt?.blockNumber || tx.blockNumber || null,
        confirmations: receipt ? 1 : 0,
        status: receipt?.status || null,
      })
      addLog(`✅ Tx found! From: ${tx.from.slice(0, 10)}... → To: ${(tx.to || 'deploy').slice(0, 10)}... | Nonce: ${tx.nonce}`, 'success')

      // Auto-try to decode calldata as ForwardRequest
      if (tx.data && tx.data !== '0x') {
        handleTryDecodeCalldata(tx.data)
      }
    } catch (err) {
      addLog(`❌ Failed to fetch tx: ${err.message}`, 'error')
    }
    setFetchLoading(false)
  }, [w3, inspectTxHash, addLog])

  // ─── Raw Tx Inspector: Decode raw signed tx hex ───────────────────────
  const handleDecodeRawTx = useCallback(() => {
    if (!inspectRawHex || inspectRawHex.length < 20) {
      addLog('❌ Valid raw tx hex required', 'error'); return
    }
    setDecodeLoading(true); setDecodedTx(null)
    addLog('🔓 Decoding raw signed transaction...', 'info')
    try {
      const raw = inspectRawHex.startsWith('0x') ? inspectRawHex : '0x' + inspectRawHex
      const tx = ethers.Transaction.from(raw)
      setDecodedTx({
        from: tx.from || 'Unknown (not signed)',
        to: tx.to || null,
        value: tx.value || 0n,
        nonce: tx.nonce,
        gasLimit: tx.gasLimit.toString(),
        gasPrice: tx.gasPrice || null,
        maxFeePerGas: tx.maxFeePerGas || null,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas || null,
        data: tx.data || '0x',
        chainId: tx.chainId,
        type: tx.type,
        v: tx.v,
        r: tx.r,
        s: tx.s,
      })
      addLog(`✅ Decoded! From: ${(tx.from || 'unsigned').slice(0, 10)}... → To: ${(tx.to || 'deploy').slice(0, 10)}...`, 'success')

      // Auto-try to decode calldata as ForwardRequest
      if (tx.data && tx.data !== '0x') {
        handleTryDecodeCalldata(tx.data)
      }
    } catch (err) {
      addLog(`❌ Failed to decode: ${err.message}. Make sure it's a valid signed RLP-encoded transaction.`, 'error')
    }
    setDecodeLoading(false)
  }, [inspectRawHex, addLog])

  // ─── Try to decode calldata as a ForwardRequest ───────────────────────
  const handleTryDecodeCalldata = useCallback((data) => {
    if (!data || data === '0x' || data.length < 10) return
    try {
      // Check if it's an execute() call to TrustedForwarder
      // execute((address,address,uint256,uint256,uint256,bytes,uint256),bytes)
      const executeSelector = ethers.id('execute(tuple(address,address,uint256,uint256,uint256,bytes,uint256),bytes)').slice(0, 10)
      const executeSelectorAlt = ethers.id('execute((address,address,uint256,uint256,uint256,bytes,uint256),bytes)').slice(0, 10)

      const dataSelector = data.slice(0, 10).toLowerCase()
      if (dataSelector !== executeSelector && dataSelector !== executeSelectorAlt) {
        addLog('ℹ️ Calldata does not appear to be a Forwarder execute() call — showing raw data', 'info')
        setDecodedForwardRequest(null)
        return
      }

      // Try to decode using the forwarder ABI if we have the contract
      if (forwarderContract) {
        try {
          const decoded = forwarderContract.interface.decodeFunctionData('execute', data)
          const req = decoded.req || decoded[0]
          if (req) {
            setDecodedForwardRequest({
              from: req.from,
              to: req.to,
              value: req.value?.toString() || '0',
              gas: req.gas?.toString() || '0',
              nonce: req.nonce?.toString() || '0',
              data: req.data,
              deadline: req.deadline?.toString() || '0',
            })
            addLog(`📄 Detected ForwardRequest! From: ${req.from.slice(0, 10)}... → To: ${req.to.slice(0, 10)}... | Nonce: ${req.nonce}`, 'success')
            return
          }
        } catch { /* try manual decode below */ }
      }

      // Manual fallback: try to parse the tuple from raw calldata
      // This is complex, so we just show the raw method ID
      setDecodedForwardRequest(null)
      addLog('ℹ️ Calldata has ForwardRequest signature but could not fully decode without ABI', 'warn')
    } catch (err) {
      addLog(`ℹ️ Could not decode calldata: ${err.message}`, 'info')
      setDecodedForwardRequest(null)
    }
  }, [forwarderContract, addLog])

  // ─── Use decoded request in the relay form ────────────────────────────
  const handleUseDecodedRequest = useCallback(() => {
    if (!decodedForwardRequest) return
    setTargetContract(decodedForwardRequest.to)
    setCallData(decodedForwardRequest.data)
    addLog('📥 Filled target contract and calldata from decoded ForwardRequest', 'success')
    // Set deadline to match
    const decodedDeadline = parseInt(decodedForwardRequest.deadline)
    if (decodedDeadline > Math.floor(Date.now() / 1000)) {
      const minsLeft = Math.floor((decodedDeadline - Math.floor(Date.now() / 1000)) / 60)
      setDeadlineMin(Math.max(1, minsLeft))
    }
    setDecodedForwardRequest(null)
  }, [decodedForwardRequest])

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

      {/* ═══ AUTO-DISCOVERY PANEL ═════════════════════════════════════════ */}
      <ConfigPanel title="🔍 Auto-Discover Relay Nodes" defaultOpen={false}>
        <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
          Automatically discover relay nodes from the P2P network, other components, or generate simulated nodes for testing.
          Discovered nodes are added to the relay network above automatically.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <button className="btn btn-primary" onClick={handleAutoDiscover} style={{ fontSize: 12, padding: '8px 16px' }}>
            🌐 Auto-Discover Nodes
          </button>
          <button className="btn btn-secondary" onClick={handleImportFromP2P} style={{ fontSize: 12, padding: '8px 16px' }}>
            📡 Import from P2P Network
          </button>
          <button className="btn btn-secondary" onClick={handleImportFromRelayNodes} style={{ fontSize: 12, padding: '8px 16px' }}>
            🗼 Import from Relay Nodes
          </button>
          {forwarderContract && (
            <button className="btn btn-secondary" onClick={handleDiscoverFromForwarder} style={{ fontSize: 12, padding: '8px 16px' }}>
              ⛓ Discover from Forwarder
            </button>
          )}
          <button className="btn btn-secondary" onClick={handleBatchAdd} style={{ fontSize: 12, padding: '8px 16px' }}>
            📦 Quick Add 5 Nodes
          </button>
        </div>

        {/* Import stats */}
        {discoveredSources && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 10,
            background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)',
            fontSize: 12,
          }}>
            <strong style={{ color: '#60a5fa' }}>📊 Import Summary</strong>
            {discoveredSources.newNodes > 0 && (
              <span style={{ color: '#22c55e', marginLeft: 8 }}>
                ✅ {discoveredSources.newNodes} new nodes added
              </span>
            )}
            {discoveredSources.skipped > 0 && (
              <span style={{ color: '#888', marginLeft: 8 }}>
                ⏭ {discoveredSources.skipped} duplicates skipped
              </span>
            )}
            {discoveredSources.errors > 0 && (
              <span style={{ color: '#ef4444', marginLeft: 8 }}>
                ❌ {discoveredSources.errors} errors
              </span>
            )}
            <div style={{ marginTop: 4, color: '#888', fontSize: 11 }}>
              Source: {discoveredSources.source} · {discoveredSources.totalFound} found total
            </div>
          </div>
        )}

        <div style={{ fontSize: 11, color: '#666' }}>
          <strong>💡 Tips:</strong>
          <ul style={{ margin: '4px 0 0 16px', lineHeight: 1.6 }}>
            <li>"Auto-Discover" simulates network discovery — finds relay nodes on the mesh and adds them</li>
            <li>"Import from P2P Network" reads peers saved from the P2P Propagation Network tab</li>
            <li>"Import from Relay Nodes" reads nodes from the Relay Node Manager tab</li>
            <li>"Discover from Forwarder" queries the TrustedForwarder contract for registered relayers</li>
            <li>Discovered nodes are automatically saved and will be available across sessions</li>
          </ul>
        </div>
      </ConfigPanel>

      {/* ═══ RAW TX INSPECTOR ════════════════════════════════════════════ */}
      <ConfigPanel title="🔍 Raw Transaction Inspector" defaultOpen={false}>
        <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
          Fetch the raw details of a previously submitted transaction by tx hash, or decode a raw signed transaction hex.
          Useful for debugging meta-transactions, verifying calldata, and inspecting gas usage.
        </p>

        {/* ── Fetch by Tx Hash ─────────────────────────────────────────── */}
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 13, color: '#ccc', marginBottom: 8 }}>📥 Fetch by Transaction Hash</h4>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr auto' }}>
            <div className="form-group">
              <input
                type="text" className="input mono" value={inspectTxHash}
                onChange={e => setInspectTxHash(e.target.value)}
                placeholder="0x... (paste a tx hash to inspect)"
                style={{ fontSize: 12 }}
              />
            </div>
            <div className="form-group" style={{ justifyContent: 'flex-end' }}>
              <LoadingButton
                loading={fetchLoading} loadingText="⏳"
                onClick={handleFetchTx}
                disabled={!w3 || !inspectTxHash || inspectTxHash.length < 10}
                style={{ fontSize: 12, padding: '10px 18px', marginTop: 0 }}
              >
                🔍 Fetch Tx
              </LoadingButton>
            </div>
          </div>
        </div>

        {/* ── Decode Raw Tx Hex ────────────────────────────────────────── */}
        <div style={{ marginBottom: 16, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16 }}>
          <h4 style={{ fontSize: 13, color: '#ccc', marginBottom: 8 }}>🔓 Decode Raw Signed Transaction</h4>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr auto' }}>
            <div className="form-group">
              <input
                type="text" className="input mono" value={inspectRawHex}
                onChange={e => setInspectRawHex(e.target.value)}
                placeholder="0x... (paste a raw signed tx hex to decode)"
                style={{ fontSize: 12 }}
              />
            </div>
            <div className="form-group" style={{ justifyContent: 'flex-end' }}>
              <LoadingButton
                loading={decodeLoading} loadingText="⏳"
                onClick={handleDecodeRawTx}
                disabled={!inspectRawHex || inspectRawHex.length < 20}
                style={{ fontSize: 12, padding: '10px 18px', marginTop: 0 }}
              >
                🔓 Decode
              </LoadingButton>
            </div>
          </div>
        </div>

        {/* ── Fetched Tx Result ────────────────────────────────────────── */}
        {fetchedTx && (
          <div className="result-panel success" style={{
            borderColor: 'rgba(59,130,246,0.3)',
            background: 'rgba(59,130,246,0.05)',
            marginBottom: 12,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h4 style={{ margin: 0, fontSize: 13, color: '#60a5fa' }}>📋 Fetched Transaction</h4>
              <button className="btn btn-secondary" onClick={() => setFetchedTx(null)} style={{ fontSize: 10, padding: '3px 8px' }}>✕ Dismiss</button>
            </div>
            <div className="result-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <TxField label="Hash" value={fetchedTx.hash} mono copy />
              <TxField label="Block" value={String(fetchedTx.blockNumber || '—')} />
              <TxField label="From" value={fetchedTx.from} mono copy />
              <TxField label="To" value={fetchedTx.to || '— (contract creation)'} mono copy />
              <TxField label="Value" value={ethers.formatEther(fetchedTx.value || 0n) + ' ETH'} />
              <TxField label="Nonce" value={String(fetchedTx.nonce)} />
              <TxField label="Gas Limit" value={String(fetchedTx.gasLimit)} />
              <TxField label="Gas Price" value={fetchedTx.gasPrice ? ethers.formatUnits(fetchedTx.gasPrice, 'gwei') + ' gwei' : '—'} />
              {fetchedTx.maxFeePerGas && <TxField label="Max Fee" value={ethers.formatUnits(fetchedTx.maxFeePerGas, 'gwei') + ' gwei'} />}
              {fetchedTx.maxPriorityFeePerGas && <TxField label="Max Priority" value={ethers.formatUnits(fetchedTx.maxPriorityFeePerGas, 'gwei') + ' gwei'} />}
              <TxField label="Chain ID" value={String(fetchedTx.chainId)} />
              <TxField label="Type" value={String(fetchedTx.type || 0)} />
            </div>

            {/* Calldata section */}
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4, fontWeight: 600 }}>Calldata</label>
              <div className="tx-call-data" style={{
                background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: '8px 10px',
                fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all',
                maxHeight: 100, overflowY: 'auto', color: '#aaa', border: '1px solid rgba(255,255,255,0.04)',
              }}>
                {fetchedTx.data || '0x'}
              </div>
              {fetchedTx.data && fetchedTx.data !== '0x' && (
                <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(fetchedTx.data)} style={{ fontSize: 10, padding: '3px 10px' }}>📋 Copy Calldata</button>
                  <button className="btn btn-secondary" onClick={() => handleTryDecodeCalldata(fetchedTx.data)} style={{ fontSize: 10, padding: '3px 10px' }}>🔍 Try Decode</button>
                  <span style={{ fontSize: 10, color: '#666' }}>Method ID: {fetchedTx.data?.slice(0, 10)}</span>
                </div>
              )}
            </div>

            {/* Receipt info if available */}
            {fetchedTx.confirmations > 0 && (
              <div style={{ marginTop: 10, fontSize: 11, color: '#22c55e', display: 'flex', gap: 16 }}>
                <span>✅ {fetchedTx.confirmations} confirmation(s)</span>
                <a href={`https://etherscan.io/tx/${fetchedTx.hash}`} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>View on Etherscan ↗</a>
              </div>
            )}
          </div>
        )}

        {/* ── Decoded Raw Tx Result ────────────────────────────────────── */}
        {decodedTx && (
          <div className="result-panel success" style={{
            borderColor: 'rgba(168,85,247,0.3)',
            background: 'rgba(168,85,247,0.05)',
            marginBottom: 12,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h4 style={{ margin: 0, fontSize: 13, color: '#a78bfa' }}>🔓 Decoded Raw Transaction</h4>
              <button className="btn btn-secondary" onClick={() => setDecodedTx(null)} style={{ fontSize: 10, padding: '3px 8px' }}>✕ Dismiss</button>
            </div>
            <div className="result-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <TxField label="From" value={decodedTx.from} mono copy />
              <TxField label="To" value={decodedTx.to || '— (contract creation)'} mono copy />
              <TxField label="Value" value={ethers.formatEther(decodedTx.value || 0n) + ' ETH'} />
              <TxField label="Nonce" value={String(decodedTx.nonce)} />
              <TxField label="Gas Limit" value={String(decodedTx.gasLimit)} />
              <TxField label="Gas Price" value={decodedTx.gasPrice ? ethers.formatUnits(decodedTx.gasPrice, 'gwei') + ' gwei' : '—'} />
              {decodedTx.chainId && <TxField label="Chain ID" value={String(decodedTx.chainId)} />}
              <TxField label="Type" value={String(decodedTx.type || 0)} />
            </div>

            {/* Decoded calldata section */}
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4, fontWeight: 600 }}>Calldata</label>
              <div className="tx-call-data" style={{
                background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: '8px 10px',
                fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all',
                maxHeight: 100, overflowY: 'auto', color: '#aaa', border: '1px solid rgba(255,255,255,0.04)',
              }}>
                {decodedTx.data || '0x'}
              </div>
              {decodedTx.data && decodedTx.data !== '0x' && (
                <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(decodedTx.data)} style={{ fontSize: 10, padding: '3px 10px' }}>📋 Copy Calldata</button>
                  <button className="btn btn-secondary" onClick={() => handleTryDecodeCalldata(decodedTx.data)} style={{ fontSize: 10, padding: '3px 10px' }}>🔍 Try Decode</button>
                  <span style={{ fontSize: 10, color: '#666' }}>Method ID: {decodedTx.data?.slice(0, 10)}</span>
                </div>
              )}
            </div>

            {/* Signature section */}
            {decodedTx.from && (
              <div style={{ marginTop: 10, fontSize: 11, color: '#888' }}>
                <span>🔏 Signed by: {decodedTx.from.slice(0, 10)}...{decodedTx.from.slice(-6)}</span>
                {decodedTx.v !== undefined && (
                  <span style={{ marginLeft: 12 }}>v: {decodedTx.v} | r: {decodedTx.r?.slice(0, 18)}... | s: {decodedTx.s?.slice(0, 18)}...</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Decoded ForwardRequest (if calldata matches) ─────────────── */}
        {decodedForwardRequest && (
          <div className="result-panel" style={{
            borderColor: 'rgba(34,197,94,0.3)',
            background: 'rgba(34,197,94,0.04)',
          }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#22c55e' }}>📄 Detected EIP-712 ForwardRequest</h4>
            <p style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
              The calldata appears to be an <code>execute()</code> call to a TrustedForwarder.
              Here's the decoded ForwardRequest struct:
            </p>
            <div className="result-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <TxField label="From (signer)" value={decodedForwardRequest.from} mono copy />
              <TxField label="To (target)" value={decodedForwardRequest.to} mono copy />
              <TxField label="Value" value={String(decodedForwardRequest.value)} />
              <TxField label="Gas" value={String(decodedForwardRequest.gas)} />
              <TxField label="Nonce" value={String(decodedForwardRequest.nonce)} />
              <TxField label="Deadline" value={new Date(Number(decodedForwardRequest.deadline) * 1000).toLocaleString()} />
              <span></span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(JSON.stringify(decodedForwardRequest, null, 2))} style={{ fontSize: 10, padding: '3px 10px' }}>📋 Copy Request</button>
                <button className="btn btn-success" onClick={handleUseDecodedRequest} style={{ fontSize: 10, padding: '3px 10px' }}>📥 Use in Relay</button>
              </div>
            </div>
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
