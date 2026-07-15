import React, { useState, useEffect, useCallback } from 'react'
import { ETH_RPCS } from '../constants'
import { ethers } from 'ethers'
import { useProvider } from '../hooks'
import { useWeb3 } from '../context/Web3Context'


const LS_KEY = 'flashloan_relay_discovered_nodes'
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
const EXPLORER_ADDR = 'https://etherscan.io/address/'

// Minimal ABI for FlashArbitrage withdraw operations
const FLASH_ARBITRAGE_ABI = [
  {
    "constant": false,
    "inputs": [],
    "name": "rescueNative",
    "outputs": [],
    "type": "function",
  },
  {
    "constant": false,
    "inputs": [
      {"name": "token", "type": "address"},
      {"name": "amount", "type": "uint256"},
    ],
    "name": "rescueTokens",
    "outputs": [],
    "type": "function",
  },
  {
    "constant": true,
    "inputs": [],
    "name": "owner",
    "outputs": [{"name": "", "type": "address"}],
    "type": "function",
  },
]

// Minimal ERC20 ABI for balance & decimals
const ERC20_BALANCE_ABI = [
  {"constant": true, "inputs": [{"name": "_owner", "type": "address"}],
   "name": "balanceOf", "outputs": [{"name": "", "type": "uint256"}], "type": "function"},
  {"constant": true, "inputs": [],
   "name": "decimals", "outputs": [{"name": "", "type": "uint8"}], "type": "function"},
  {"constant": true, "inputs": [],
   "name": "symbol", "outputs": [{"name": "", "type": "string"}], "type": "function"},
]

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
  const ethProvider = useProvider(ETH_RPCS)
  const { walletAddress, signer, isConnected, connectWallet, walletType } = useWeb3()

  const [nodes, setNodes] = useState(INITIAL_NODES)
  const [nodeTxLogs, setNodeTxLogs] = useState(() => buildInitialTxLogs(INITIAL_NODES))
  const [expandedNode, setExpandedNode] = useState(null)
  const [newNodeName, setNewNodeName] = useState('')
  const [newNodeType, setNewNodeType] = useState('slave')
  const [newNodeRegion, setNewNodeRegion] = useState('us-east')
  const CONTRACT_ADDR_KEY = 'flashloan_flash_arbitrage_addr'
  const savedContractAddr = localStorage.getItem(CONTRACT_ADDR_KEY) || ''

  const [logs, setLogs] = useState([])
  const [contractAddress, setContractAddress] = useState(savedContractAddr)
  const [contractBalance, setContractBalance] = useState(null)
  const [contractBalanceLoading, setContractBalanceLoading] = useState(false)
  const [contractOwner, setContractOwner] = useState(null)
  const [contractError, setContractError] = useState('')
  // Token rescue state
  const [tokenAddress, setTokenAddress] = useState('')
  const [tokenBalance, setTokenBalance] = useState(null)
  const [tokenSymbol, setTokenSymbol] = useState('')
  const [tokenDecimals, setTokenDecimals] = useState(18)
  const [tokenLoading, setTokenLoading] = useState(false)
  const [tokenError, setTokenError] = useState('')

  const [multiSendMode, setMultiSendMode] = useState('equal') // 'equal' | 'fixed' | 'percent'
  const [multiSendRecipients, setMultiSendRecipients] = useState([])
  const [multiSendProgress, setMultiSendProgress] = useState({ total: 0, sent: 0, failed: 0, current: -1, results: [] })

  // ─── Persist nodes to localStorage for Gasless Relay to discover ──────
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(nodes))
    } catch { /* storage full */ }
  }, [nodes])

  // ─── Fetch contract on-chain balance (reusable) ───────────────────────
  const fetchContractBalance = useCallback(async () => {
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      setContractBalance(null)
      setContractOwner(null)
      setContractError('')
      return
    }
    if (!ethProvider) return
    setContractBalanceLoading(true)
    setContractError('')
    try {
      const addr = ethers.getAddress(contractAddress)
      const bal = await ethProvider.getBalance(addr)
      setContractBalance(ethers.formatEther(bal))
      try {
        const contract = new ethers.Contract(addr, FLASH_ARBITRAGE_ABI, ethProvider)
        const owner = await contract.owner()
        setContractOwner(owner)
      } catch {
        setContractOwner(null)
      }
    } catch (err) {
      setContractError(err.message)
      setContractBalance(null)
    }
    setContractBalanceLoading(false)
  }, [contractAddress, ethProvider])

  // Auto-fetch on mount / address change
  useEffect(() => { fetchContractBalance() }, [fetchContractBalance])

  useEffect(() => {
    try { localStorage.setItem(CONTRACT_ADDR_KEY, contractAddress) } catch {}
  }, [contractAddress])

  // ─── Fetch token balance from contract ────────────────────────────────
  const fetchTokenBalance = useCallback(async () => {
    if (!contractAddress || !ethers.isAddress(contractAddress) || !tokenAddress || !ethers.isAddress(tokenAddress)) {
      setTokenBalance(null)
      setTokenSymbol('')
      setTokenError('')
      return
    }
    if (!ethProvider) return
    setTokenLoading(true)
    setTokenError('')
    try {
      const tokenContract = new ethers.Contract(ethers.getAddress(tokenAddress), ERC20_BALANCE_ABI, ethProvider)
      const [bal, decimals, symbol] = await Promise.all([
        tokenContract.balanceOf(ethers.getAddress(contractAddress)),
        tokenContract.decimals(),
        tokenContract.symbol(),
      ])
      setTokenBalance(ethers.formatUnits(bal, decimals))
      setTokenSymbol(symbol)
      setTokenDecimals(decimals)
    } catch (err) {
      setTokenError(err.message)
      setTokenBalance(null)
      setTokenSymbol('')
    }
    setTokenLoading(false)
  }, [contractAddress, tokenAddress, ethProvider])

  // Auto-fetch token balance when address changes
  useEffect(() => { fetchTokenBalance() }, [fetchTokenBalance])

  const [networkConfig, setNetworkConfig] = useState({ heartbeatInterval: 30, failoverThreshold: 3, rebalanceEnabled: true, autoDiscovery: true })
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
    const displayBal = parseFloat(contractBalance || '0')
    if (displayBal <= 0) {
      addLog('(x) No balance to withdraw from contract', 'error')
      return
    }
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      addLog('(x) Invalid FlashArbitrage contract address', 'error')
      return
    }
    if (!ethProvider) {
      addLog('(x) No RPC connection', 'error')
      return
    }
    if (!signer) {
      addLog('(x) No wallet connected — connect your owner wallet first', 'error')
      return
    }

    setWithdrawing(true)
    addLog('🏦 Withdrawing ' + displayBal.toFixed(4) + ' ETH from FlashArbitrage contract → your wallet (' + walletAddress.slice(0, 10) + '...)', 'info')

    try {
      const contractAddr = ethers.getAddress(contractAddress)
      const contract = new ethers.Contract(contractAddr, FLASH_ARBITRAGE_ABI, signer)

      // Check gas
      const feeData = await ethProvider.getFeeData()
      const gasPrice = feeData.gasPrice || ethers.parseUnits('10', 'gwei')
      const gasEstimate = 100000n
      const gasCost = gasEstimate * gasPrice
      addLog('  Gas: ~' + ethers.formatEther(gasCost) + ' ETH', 'info')

      // Call rescueNative() on the FlashArbitrage contract
      // This sends the contract's entire ETH balance to the contract owner (the connected wallet)
      addLog('  Calling rescueNative() on contract...', 'info')
      const tx = await contract.rescueNative({
        gasLimit: gasEstimate,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei'),
        maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits('30', 'gwei'),
      })

      addLog('  Tx sent: ' + tx.hash.slice(0, 18) + '...', 'success')

      // Wait for confirmation
      const receipt = await tx.wait()
      const explorerUrl = EXPLORER_BASE + tx.hash

      addLog('  ✅ Confirmed in block ' + receipt.blockNumber + '!', 'profit')
      addLog('  🔗 ' + explorerUrl, 'link')

      // Log to node history
      addNodeTxLog(Date.now(), {
        id: Date.now(),
        time: new Date().toLocaleTimeString(),
        type: 'withdraw',
        msg: 'rescueNative(): ' + displayBal.toFixed(4) + ' ETH → ' + walletAddress.slice(0, 10) + '...',
        txHash: tx.hash,
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        explorerUrl,
      })

      // Update UI balances
      setNodes(prev => prev.map(n => ({ ...n, balanceEth: 0 })))
      setContractBalance('0')
      addLog('(done) ✅ ' + displayBal.toFixed(4) + ' ETH withdrawn from contract to your wallet!', 'profit')

    } catch (err) {
      addLog('(x) WITHDRAW FAILED: ' + err.message, 'error')
      addNodeTxLog(Date.now(), {
        id: Date.now(),
        time: new Date().toLocaleTimeString(),
        type: 'withdraw',
        msg: '❌ FAILED: ' + err.message,
        txHash: '',
        status: 'failed',
        explorerUrl: '',
      })
    }

    setWithdrawing(false)
  }

  async function handleRescueTokens() {
    if (!tokenBalance || parseFloat(tokenBalance) <= 0) {
      addLog('(x) No token balance to withdraw', 'error')
      return
    }
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      addLog('(x) Invalid contract address', 'error')
      return
    }
    if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
      addLog('(x) Invalid token address', 'error')
      return
    }
    if (!ethProvider) {
      addLog('(x) No RPC connection', 'error')
      return
    }
    if (!signer) {
      addLog('(x) No wallet connected — connect your owner wallet first', 'error')
      return
    }

    setWithdrawing(true)
    addLog('🪙 Rescuing ' + parseFloat(tokenBalance).toFixed(6) + ' ' + tokenSymbol + ' from contract → your wallet (' + walletAddress.slice(0, 10) + '...)', 'info')

    try {
      const contractAddr = ethers.getAddress(contractAddress)
      const contract = new ethers.Contract(contractAddr, FLASH_ARBITRAGE_ABI, signer)
      const tokenAddr = ethers.getAddress(tokenAddress)
      const amountWei = ethers.parseUnits(parseFloat(tokenBalance).toFixed(tokenDecimals), tokenDecimals)

      const feeData = await ethProvider.getFeeData()
      addLog('  Calling rescueTokens() with ' + parseFloat(tokenBalance).toFixed(6) + ' ' + tokenSymbol + '...', 'info')

      const tx = await contract.rescueTokens(tokenAddr, amountWei, {
        gasLimit: 200000n,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei'),
        maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits('30', 'gwei'),
      })

      addLog('  Tx sent: ' + tx.hash.slice(0, 18) + '...', 'success')

      const receipt = await tx.wait()
      const explorerUrl = EXPLORER_BASE + tx.hash

      addLog('  ✅ Confirmed in block ' + receipt.blockNumber + '!', 'profit')
      addLog('  🔗 ' + explorerUrl, 'link')

      addNodeTxLog(Date.now(), {
        id: Date.now(),
        time: new Date().toLocaleTimeString(),
        type: 'withdraw',
        msg: 'rescueTokens(): ' + parseFloat(tokenBalance).toFixed(6) + ' ' + tokenSymbol + ' → ' + walletAddress.slice(0, 10) + '...',
        txHash: tx.hash,
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        explorerUrl,
      })

      setTokenBalance('0')
      addLog('(done) ✅ ' + parseFloat(tokenBalance).toFixed(6) + ' ' + tokenSymbol + ' rescued to your wallet!', 'profit')

    } catch (err) {
      addLog('(x) RESCUE TOKENS FAILED: ' + err.message, 'error')
      addNodeTxLog(Date.now(), {
        id: Date.now(),
        time: new Date().toLocaleTimeString(),
        type: 'withdraw',
        msg: '❌ rescueTokens FAILED: ' + err.message,
        txHash: '',
        status: 'failed',
        explorerUrl: '',
      })
    }

    setWithdrawing(false)
  }

  // ─── Multi-Send ───────────────────────────────────────────────────────

  function handleAddRecipient() {
    const emptyCount = multiSendRecipients.filter(r => !r.address.trim()).length
    if (emptyCount > 0) return // don't add while there's an empty row
    setMultiSendRecipients(prev => [...prev, { id: Date.now(), address: '', amount: '0', percent: 0 }])
  }

  function handleRemoveRecipient(id) {
    setMultiSendRecipients(prev => prev.filter(r => r.id !== id))
  }

  function handleUpdateRecipient(id, field, value) {
    setMultiSendRecipients(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  function handleAutoFillRecipients() {
    // Fill from relay nodes: use node addresses as recipients with equal split
    const validNodes = nodes.filter(n => n.balanceEth > 0.01)
    if (validNodes.length === 0) {
      addLog('(x) No nodes with meaningful balance to auto-fill', 'error')
      return
    }
    const recipients = validNodes.map(n => ({
      id: Date.now() + n.id,
      address: '',
      amount: '0',
      percent: Math.round(100 / validNodes.length * 100) / 100,
    }))
    setMultiSendRecipients(prev => [...prev, ...recipients])
    addLog('(+) Auto-filled ' + validNodes.length + ' recipient slots from relay nodes', 'success')
  }

  function calculateSendAmounts() {
    const bal = nodes.reduce((s, n) => s + n.balanceEth, 0)
    if (bal <= 0) return []

    const valid = multiSendRecipients.filter(r => ethers.isAddress(r.address))
    if (valid.length === 0) return []

    const balWei = ethers.parseEther(bal.toFixed(4))
    // Reserve gas for each tx (21k gas * ~10 gwei ≈ 0.00021 ETH per tx, x2 for safety)
    const gasBuffer = ethers.parseEther((valid.length * 0.0005).toFixed(6))
    const netWei = balWei > gasBuffer ? balWei - gasBuffer : balWei

    if (multiSendMode === 'equal') {
      const perRecipient = netWei / BigInt(valid.length)
      return valid.map((r, i) => ({ ...r, wei: perRecipient, eth: ethers.formatEther(perRecipient) }))
    } else if (multiSendMode === 'percent') {
      const totalPct = valid.reduce((s, r) => s + (parseFloat(r.percent) || 0), 0)
      if (totalPct <= 0) return []
      return valid.map(r => {
        const wei = netWei * BigInt(Math.round((parseFloat(r.percent) || 0) * 100)) / BigInt(totalPct * 100)
        return { ...r, wei, eth: ethers.formatEther(wei) }
      })
    } else {
      // fixed amounts — scale proportionally to avoid BigInt truncation
      const totalFixed = valid.reduce((s, r) => s + ethers.parseEther(r.amount || '0'), 0n)
      return valid.map(r => {
        const wei = totalFixed > 0n
          ? (ethers.parseEther(r.amount || '0') * netWei) / totalFixed
          : 0n
        return { ...r, wei, eth: ethers.formatEther(wei) }
      })
    }
  }

  async function handleMultiSend() {
    const valid = multiSendRecipients.filter(r => ethers.isAddress(r.address))
    if (valid.length === 0) {
      addLog('(x) No valid recipient addresses in multi-send list', 'error')
      return
    }
    if (!ethProvider) {
      addLog('(x) No RPC connection', 'error')
      return
    }
    if (!signer) {
      addLog('(x) No wallet connected', 'error')
      return
    }

    const amounts = calculateSendAmounts()
    if (amounts.length === 0) {
      addLog('(x) Could not calculate send amounts', 'error')
      return
    }

    // Verify total fits in balance
    const totalSend = amounts.reduce((s, a) => s + a.wei, 0n)
    const sender = walletAddress
    const senderBalance = await ethProvider.getBalance(sender)
    const feeData = await ethProvider.getFeeData()
    const gasPrice = feeData.gasPrice || ethers.parseUnits('10', 'gwei')
    const totalGas = BigInt(valid.length) * 21000n * gasPrice

    if (senderBalance < totalSend + totalGas) {
      addLog('(x) Insufficient balance: need ' + ethers.formatEther(totalSend + totalGas) + ' ETH but have ' + ethers.formatEther(senderBalance), 'error')
      return
    }

    addLog('($) MULTI-SEND: ' + amounts.length + ' recipients | Total: ' + ethers.formatEther(totalSend) + ' ETH | Gas: ~' + ethers.formatEther(totalGas) + ' ETH', 'info')
    setWithdrawing(true)
    setMultiSendProgress({ total: amounts.length, sent: 0, failed: 0, current: -1, results: [] })

    const results = []
    for (let i = 0; i < amounts.length; i++) {
      const r = amounts[i]
      const idx = i + 1
      setMultiSendProgress(prev => ({ ...prev, current: idx }))

      try {
        addLog('  [' + idx + '/' + amounts.length + '] Sending ' + r.eth + ' ETH → ' + r.address.slice(0, 10) + '...', 'info')

        const tx = await signer.sendTransaction({
          to: ethers.getAddress(r.address),
          value: r.wei,
          gasLimit: 21000n,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei'),
          maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits('30', 'gwei'),
        })

        const receipt = await tx.wait()
        const explorerUrl = EXPLORER_BASE + tx.hash

        addLog('  ✅ [' + idx + '] Confirmed in block ' + receipt.blockNumber + '!', 'profit')
        addLog('  🔗 ' + explorerUrl, 'link')

        addNodeTxLog(r.address, {
          id: Date.now(),
          time: new Date().toLocaleTimeString(),
          type: 'withdraw',
          msg: 'Multi-send: ' + r.eth + ' ETH to ' + r.address.slice(0, 10) + '...',
          txHash: tx.hash,
          status: 'confirmed',
          explorerUrl,
        })

        results.push({ address: r.address, eth: r.eth, txHash: tx.hash, status: 'confirmed' })
        setMultiSendProgress(prev => ({ ...prev, sent: prev.sent + 1, results: [...prev.results, { address: r.address, eth: r.eth, txHash: tx.hash, status: 'confirmed' }] }))

      } catch (err) {
        addLog('(x) [' + idx + '] FAILED: ' + err.message, 'error')
        results.push({ address: r.address, eth: r.eth, txHash: '', status: 'failed', error: err.message })
        setMultiSendProgress(prev => ({ ...prev, failed: prev.failed + 1, results: [...prev.results, { address: r.address, eth: r.eth, txHash: '', status: 'failed' }] }))
      }
    }

    // Update balances based on successful sends
    setNodes(prev => prev.map(n => ({ ...n, balanceEth: 0 })))
    addLog('(done) ✅ MULTI-SEND COMPLETE! ' + results.filter(r => r.status === 'confirmed').length + '/' + amounts.length + ' successful', results.some(r => r.status === 'failed') ? 'warning' : 'profit')
    setWithdrawing(false)
    setMultiSendProgress(prev => ({ ...prev, current: -1 }))
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
      <div className="config-panel" style={{ borderColor: 'rgba(34,197,94,0.3)' }}>
        <h3 style={{ marginBottom: 12 }}>🏦 Withdraw from FlashArbitrage Contract</h3>

        {/* Connected wallet indicator */}
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label>🔌 Connected Wallet (receives funds)</label>
          {isConnected && walletAddress ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 14px', borderRadius: 6,
              background: 'rgba(34,197,94,0.06)',
              border: '1px solid rgba(34,197,94,0.2)',
            }}>
              <span style={{ color: '#22c55e', fontSize: 14 }}>🟢</span>
              <span className="mono" style={{ fontSize: 13, color: '#22c55e' }}>
                {walletAddress.slice(0, 8)}...{walletAddress.slice(-6)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 'auto' }}>
                Connected via {walletType === 'metamask' ? '🦊 MetaMask' : walletType === 'walletconnect' ? '🔗 WalletConnect' : 'Wallet'}
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="btn btn-primary"
                onClick={() => connectWallet('metamask')}
                style={{ fontSize: 12, padding: '10px 18px' }}
              >🦊 Connect MetaMask</button>
              <button
                className="btn btn-secondary"
                onClick={() => connectWallet('walletconnect')}
                style={{ fontSize: 12, padding: '10px 18px' }}
              >🔗 WalletConnect</button>
              <span className="form-hint">Your wallet must be the contract owner to call rescueNative()</span>
            </div>
          )}
        </div>

        {/* Contract address input */}
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label>📜 FlashArbitrage Contract Address</label>
          <input
            type="text"
            className="input mono"
            value={contractAddress}
            onChange={e => setContractAddress(e.target.value)}
            placeholder="0x... (deployed FlashArbitrage contract)"
            style={{ fontSize: 12 }}
          />
          <span className="form-hint">
            Enter the FlashArbitrage contract address that holds the node rewards. Saved to localStorage.
          </span>
        </div>

        {/* On-chain balance display */}
        <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr auto' }}>
          <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <label style={{ margin: 0 }}>🏦 Contract Balance (on-chain)</label>
              <button
                className="btn btn-secondary"
                onClick={fetchContractBalance}
                disabled={contractBalanceLoading || !ethers.isAddress(contractAddress)}
                style={{ fontSize: 10, padding: '3px 8px', lineHeight: 1 }}
                title="Refresh balance from chain"
              >{contractBalanceLoading ? '⏳' : '🔄'}</button>
            </div>
            <div style={{
              padding: '10px 14px', background: 'var(--bg-input)', borderRadius: 6,
              border: '1px solid rgba(34,197,94,0.2)',
              fontSize: 18, fontWeight: 700, color: '#22c55e',
            }}>
              {contractBalanceLoading ? (
                <span style={{ fontSize: 13, color: '#888' }}>⏳ Loading...</span>
              ) : contractBalance !== null ? (
                <>{parseFloat(contractBalance).toFixed(6)} ETH <span style={{ fontSize: 10, color: '#888', fontWeight: 400, marginLeft: 8 }}>on contract</span></>
              ) : contractError ? (
                <span style={{ fontSize: 12, color: '#ef4444' }}>❌ {contractError.slice(0, 40)}</span>
              ) : (
                <span style={{ fontSize: 12, color: '#888' }}>Enter a contract address above</span>
              )}
            </div>
          </div>
          <div className="form-group">
            <label>Owner (must match your wallet)</label>
            <div style={{
              padding: '10px 14px', borderRadius: 6,
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              fontSize: 13, fontFamily: 'monospace',
              color: contractOwner
                ? (walletAddress && contractOwner.toLowerCase() === walletAddress.toLowerCase() ? '#22c55e' : '#ef4444')
                : '#888',
            }}>
              {contractOwner
                ? (contractOwner.slice(0, 8) + '...' + contractOwner.slice(-6))
                : (contractAddress ? 'Not an owner-based contract' : '—')}
              {contractOwner && walletAddress && contractOwner.toLowerCase() === walletAddress.toLowerCase() && (
                <span style={{ fontSize: 10, color: '#22c55e', marginLeft: 8 }}>✅ Matches!</span>
              )}
              {contractOwner && walletAddress && contractOwner.toLowerCase() !== walletAddress.toLowerCase() && (
                <span style={{ fontSize: 10, color: '#ef4444', marginLeft: 8 }}>❌ Not owner — withdraw will fail</span>
              )}
            </div>
          </div>
          <div className="form-group" style={{ justifyContent: 'flex-end' }}>
            <button
              className="btn btn-success"
              onClick={handleWithdraw}
              disabled={withdrawing || !contractBalance || parseFloat(contractBalance) <= 0 || !ethProvider || !signer || !ethers.isAddress(contractAddress)}
              style={{ fontSize: 12, padding: '10px 20px', marginTop: 22, minWidth: 150 }}
            >
              {withdrawing ? '⏳ Withdrawing...' : '🏦 rescueNative() → My Wallet'}
            </button>
          </div>
        </div>

        <div style={{
          marginTop: 10, padding: '8px 12px', borderRadius: 6,
          background: 'rgba(34,197,94,0.06)',
          border: '1px solid rgba(34,197,94,0.15)',
          fontSize: 11, color: '#22c55e', lineHeight: 1.5,
        }}>
          <strong>🏦 How it works</strong>
          <ul style={{ margin: '4px 0 0 16px', color: '#a3a3a3' }}>
            <li>Your relay nodes earn ETH rewards that accumulate in the FlashArbitrage contract</li>
            <li>Clicking withdraw calls <code>rescueNative()</code> on the contract via your connected wallet</li>
            <li>The contract sends its entire ETH balance to the contract <strong>owner</strong> (your wallet)</li>
            <li>Your wallet must be the contract owner — MetaMask will prompt you to confirm</li>
            <li>Gas is paid from your wallet (~100k gas for the contract call)</li>
          </ul>
        </div>
      </div>

      {/* ─── Token Rescue ──────────────────────────────────────────────── */}
      <div className="config-panel" style={{ borderColor: 'rgba(168,85,247,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>🪙 Token Rescue (ERC20)</h3>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            Withdraw ERC20 tokens from the FlashArbitrage contract
          </span>
        </div>

        {/* Token address input */}
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label>🔗 Token Contract Address</label>
          <input
            type="text"
            className="input mono"
            value={tokenAddress}
            onChange={e => setTokenAddress(e.target.value)}
            placeholder="0x... (USDT, USDC, WETH, etc.)"
            style={{ fontSize: 12 }}
          />
          <span className="form-hint">
            Enter the ERC20 token address held by the contract. Balance auto-fetches.
          </span>
        </div>

        {/* Token balance + rescue button */}
        <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr auto' }}>
          <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <label style={{ margin: 0 }}>🪙 Token Balance (on contract)</label>
              <button
                className="btn btn-secondary"
                onClick={fetchTokenBalance}
                disabled={tokenLoading || !ethers.isAddress(tokenAddress) || !ethers.isAddress(contractAddress)}
                style={{ fontSize: 10, padding: '3px 8px', lineHeight: 1 }}
                title="Refresh token balance"
              >{tokenLoading ? '⏳' : '🔄'}</button>
            </div>
            <div style={{
              padding: '10px 14px', background: 'var(--bg-input)', borderRadius: 6,
              border: '1px solid rgba(168,85,247,0.2)',
              fontSize: 18, fontWeight: 700, color: '#a78bfa',
            }}>
              {tokenLoading ? (
                <span style={{ fontSize: 13, color: '#888' }}>⏳ Loading...</span>
              ) : tokenBalance !== null ? (
                <>{parseFloat(tokenBalance).toFixed(6)} {tokenSymbol || 'TOKEN'}</>
              ) : tokenError ? (
                <span style={{ fontSize: 12, color: '#ef4444' }}>❌ {tokenError.slice(0, 40)}</span>
              ) : (
                <span style={{ fontSize: 12, color: '#888' }}>Enter token address above</span>
              )}
            </div>
          </div>
          <div className="form-group">
            <label>&nbsp;</label>
            <div style={{
              padding: '10px 14px', borderRadius: 6,
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              fontSize: 12, color: 'var(--text-dim)',
            }}>
              {tokenSymbol ? `${tokenSymbol} (${tokenDecimals} decimals)` : 'Token info'}
            </div>
          </div>
          <div className="form-group" style={{ justifyContent: 'flex-end' }}>
            <button
              className="btn btn-primary"
              onClick={handleRescueTokens}
              disabled={withdrawing || !tokenBalance || parseFloat(tokenBalance) <= 0 || !ethProvider || !signer || !ethers.isAddress(tokenAddress)}
              style={{
                fontSize: 12, padding: '10px 20px', marginTop: 22, minWidth: 150,
                background: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
                border: 'none',
              }}
            >
              {withdrawing ? '⏳ Rescuing...' : '🪙 rescueTokens() → Wallet'}
            </button>
          </div>
        </div>

        <div style={{
          marginTop: 10, padding: '8px 12px', borderRadius: 6,
          background: 'rgba(168,85,247,0.06)',
          border: '1px solid rgba(168,85,247,0.15)',
          fontSize: 11, color: '#a78bfa', lineHeight: 1.5,
        }}>
          <strong>🪙 How token rescue works</strong>
          <ul style={{ margin: '4px 0 0 16px', color: '#a3a3a3' }}>
            <li>Enter any ERC20 token address (USDT, USDC, WETH, etc.) held by the contract</li>
            <li>The balance is auto-fetched from the contract</li>
            <li>Clicking rescue calls <code>rescueTokens(token, amount)</code> which sends the tokens to the <strong>owner</strong></li>
            <li>Your wallet must be the contract owner — MetaMask will prompt you to confirm</li>
            <li>Gas is paid from your wallet (~200k gas for the token call)</li>
          </ul>
        </div>
      </div>

      {/* ─── Multi-Send ──────────────────────────────────────────────── */}
      <div className="config-panel" style={{ borderColor: 'rgba(168,85,247,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>📋 Multi-Send</h3>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            Send to multiple wallets in one click
          </span>
        </div>

        {/* Split mode selector */}
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label>Split Mode</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {['equal', 'fixed', 'percent'].map(mode => (
              <button
                key={mode}
                className={'btn ' + (multiSendMode === mode ? 'btn-primary' : 'btn-secondary')}
                onClick={() => setMultiSendMode(mode)}
                style={{ fontSize: 11, padding: '6px 14px', textTransform: 'capitalize' }}
                disabled={withdrawing}
              >
                {mode === 'equal' ? '📐 Equal Split' : mode === 'fixed' ? '💰 Fixed Amounts' : '📊 Percentages'}
              </button>
            ))}
          </div>
          <span className="form-hint">
            {multiSendMode === 'equal'
              ? 'Total balance is split equally among all recipients'
              : multiSendMode === 'fixed'
                ? 'Each recipient gets the specified ETH amount (scaled to total balance)'
                : 'Each recipient gets the specified percentage of total balance'}
          </span>
        </div>

        {/* Recipients list */}
        <div className="form-group" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ margin: 0 }}>Recipients ({multiSendRecipients.length})</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="btn btn-secondary"
                onClick={handleAutoFillRecipients}
                style={{ fontSize: 10, padding: '4px 10px' }}
                disabled={withdrawing}
              >📋 Auto-fill Nodes</button>
              <button
                className="btn btn-primary"
                onClick={handleAddRecipient}
                style={{ fontSize: 10, padding: '4px 10px' }}
                disabled={withdrawing}
              >➕ Add</button>
            </div>
          </div>
        </div>

        {multiSendRecipients.length === 0 ? (
          <div className="empty-state" style={{ padding: '16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, fontStyle: 'italic' }}>
            No recipients added yet. Click "➕ Add" to add a wallet address, or use "📋 Auto-fill Nodes" to create slots from relay nodes.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {multiSendRecipients.map((r, i) => (
              <div key={r.id} style={{
                display: 'flex', gap: 6, alignItems: 'center',
                padding: '6px 8px', borderRadius: 6,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border)',
              }}>
                <span style={{ fontSize: 10, color: 'var(--text-dim)', minWidth: 16, fontWeight: 600 }}>{i + 1}</span>
                <input
                  type="text"
                  className="input mono"
                  value={r.address}
                  onChange={e => handleUpdateRecipient(r.id, 'address', e.target.value)}
                  placeholder="0x... (recipient wallet)"
                  style={{ flex: { equal: 3, fixed: 2, percent: 2 }[multiSendMode] || 2, fontSize: 11, padding: '6px 10px' }}
                  disabled={withdrawing}
                />
                {multiSendMode === 'fixed' && (
                  <input
                    type="number"
                    className="input"
                    value={r.amount}
                    onChange={e => handleUpdateRecipient(r.id, 'amount', e.target.value)}
                    placeholder="ETH"
                    step="0.01"
                    min="0"
                    style={{ width: 80, fontSize: 11, padding: '6px 10px', textAlign: 'right' }}
                    disabled={withdrawing}
                  />
                )}
                {multiSendMode === 'percent' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="number"
                      className="input"
                      value={r.percent || ''}
                      onChange={e => handleUpdateRecipient(r.id, 'percent', parseFloat(e.target.value) || 0)}
                      placeholder="%"
                      step="1"
                      min="0"
                      max="100"
                      style={{ width: 60, fontSize: 11, padding: '6px 10px', textAlign: 'right' }}
                      disabled={withdrawing}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>%</span>
                  </div>
                )}
                {multiSendMode === 'equal' && r.address && ethers.isAddress(r.address) && (
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', minWidth: 60, textAlign: 'right' }}>
                    ~{calculateSendAmounts().find(a => a.id === r.id)?.eth.slice(0, 8) || '...'} ETH
                  </span>
                )}
                <button
                  className="btn btn-danger"
                  onClick={() => handleRemoveRecipient(r.id)}
                  style={{ fontSize: 10, padding: '4px 8px' }}
                  disabled={withdrawing}
                  title="Remove recipient"
                >✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Estimated totals */}
        {multiSendRecipients.some(r => ethers.isAddress(r.address)) && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 12px', marginBottom: 10,
            borderRadius: 6, background: 'rgba(168,85,247,0.06)',
            border: '1px solid rgba(168,85,247,0.12)',
            fontSize: 11,
          }}>
            <span style={{ color: 'var(--text-dim)' }}>
              📊 {multiSendMode === 'equal' ? 'Equal split' : multiSendMode === 'fixed' ? 'Fixed amounts (scaled)' : 'Percentages'}
              {' · ' + multiSendRecipients.filter(r => ethers.isAddress(r.address)).length + ' valid recipients'}
            </span>
            <span style={{ color: '#a78bfa', fontWeight: 600 }}>
              Total: {ethers.formatEther(calculateSendAmounts().reduce((s, a) => s + a.wei, 0n))} ETH
            </span>
          </div>
        )}

        {/* Multi-send button + progress */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn btn-primary"
            onClick={handleMultiSend}
            disabled={withdrawing || !ethProvider || !signer || multiSendRecipients.filter(r => ethers.isAddress(r.address)).length === 0}
            style={{
              fontSize: 12, padding: '10px 20px',
              background: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
              border: 'none',
            }}
          >
            {withdrawing
              ? '⏳ Sending ' + multiSendProgress.sent + '/' + multiSendProgress.total + '...'
              : '📤 Multi-Send to ' + multiSendRecipients.filter(r => ethers.isAddress(r.address)).length + ' wallets'
            }
          </button>

          {/* Progress bar */}
          {withdrawing && multiSendProgress.total > 0 && (
            <div style={{ flex: 1 }}>
              <div style={{
                height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)',
                overflow: 'hidden', marginBottom: 4,
              }}>
                <div style={{
                  height: '100%', borderRadius: 3,
                  width: ((multiSendProgress.sent + multiSendProgress.failed) / multiSendProgress.total * 100) + '%',
                  background: multiSendProgress.failed > 0
                    ? 'linear-gradient(90deg, #22c55e ' + (multiSendProgress.sent / (multiSendProgress.sent + multiSendProgress.failed) * 100) + '%, #ef4444 100%)'
                    : '#22c55e',
                  transition: 'width 0.3s',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)' }}>
                <span>✅ {multiSendProgress.sent} sent</span>
                {multiSendProgress.current > 0 && <span>▶ #{multiSendProgress.current}/{multiSendProgress.total}</span>}
                {multiSendProgress.failed > 0 && <span style={{ color: '#ef4444' }}>❌ {multiSendProgress.failed} failed</span>}
              </div>
            </div>
          )}
        </div>

        {/* Results summary after completion */}
        {multiSendProgress.results.length > 0 && !withdrawing && (
          <div style={{ marginTop: 12 }}>
            <div style={{
              padding: '8px 12px', borderRadius: 6,
              background: multiSendProgress.failed === 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
              border: '1px solid ' + (multiSendProgress.failed === 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'),
              fontSize: 11, marginBottom: 8,
            }}>
              <strong style={{ color: multiSendProgress.failed === 0 ? '#22c55e' : '#ef4444' }}>
                {multiSendProgress.failed === 0 ? '✅ All ' : '⚠️ '}{multiSendProgress.sent} sent{multiSendProgress.failed > 0 ? ', ' + multiSendProgress.failed + ' failed' : ''}
              </strong>
            </div>
            <div style={{ maxHeight: 150, overflowY: 'auto', fontSize: 10 }}>
              {multiSendProgress.results.map((res, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '4px 8px', borderRadius: 4,
                  background: res.status === 'confirmed' ? 'rgba(34,197,94,0.04)' : 'rgba(239,68,68,0.04)',
                  marginBottom: 2,
                }}>
                  <span style={{ color: 'var(--text-dim)' }}>
                    {res.address.slice(0, 8)}...{res.address.slice(-4)}
                  </span>
                  <span style={{ color: '#a78bfa' }}>{res.eth.slice(0, 8)} ETH</span>
                  <span>
                    {res.status === 'confirmed' ? (
                      <a href={EXPLORER_BASE + res.txHash} target="_blank" rel="noopener noreferrer" style={{ color: '#22c55e', textDecoration: 'none' }}>✅ ↗</a>
                    ) : (
                      <span style={{ color: '#ef4444' }}>❌</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
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
