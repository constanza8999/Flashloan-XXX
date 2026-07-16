import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ethers } from 'ethers'
import { useProvider } from '../hooks'
import { useWeb3 } from '../context/Web3Context'
import { ETH_RPCS } from '../constants'
import LoadingButton from './shared/LoadingButton'
import ErrorBox from './shared/ErrorBox'
import StatsBar from './shared/StatsBar'
import CopyButton from './shared/CopyButton'
import PrivateKeyInput from './shared/PrivateKeyInput'

const BACKEND_URL = 'http://localhost:8000'
const FAUCET_AMOUNT_ETH = 0.01  // ETH rewarded per solved block
const DAILY_CLAIM_BONUS_ETH = 0.002  // bonus ETH for daily claim
const DAILY_SOLVES_LIMIT = 10
const DEFAULT_THREADS = 4
const MAX_THREADS = 9999 // UNLIMITED — remove all caps
const POWA_MODES = [
  { id: 'normal', label: '🔋 Normal', threadMult: 0.5, yieldEvery: 500, desc: 'Balanced power' },
  { id: 'turbo', label: '⚡ Turbo', threadMult: 1.0, yieldEvery: 2000, desc: 'Boosted CPU' },
  { id: 'overclock', label: '🔥 Overclock', threadMult: 2.0, yieldEvery: 5000, desc: 'Max CPU usage' },
  { id: 'unlimited', label: '♾️ UNLIMITED', threadMult: 4.0, yieldEvery: 999999, desc: 'NO LIMITS — 9999 THREADS' },
]

// ─── TRUE Multi-Threaded PoW Miner (Web Workers) ─────────────────
// Spawns N dedicated Web Workers, each in a real OS thread.
// Communication via postMessage/onmessage — no shared memory, maximum parallelism.
// The worker script (powWorker.js) must be co-located in src/components/.
function createWebWorkerMiner(threadCount = 4, powerMode = 'normal') {
  let workers = []
  let running = false
  let startTime = 0
  let onProgress = null
  let onSolved = null
  let resolved = false

  // Per-worker stats (plain numbers for serialization)
  const workerStats = Array.from({ length: threadCount }, (_, i) => ({
    id: i,
    hashCount: 0,
    bestZeros: 0,
    bestHash: '',
    active: false,
  }))

  // Create all workers
  for (let i = 0; i < threadCount; i++) {
    const worker = new Worker(
      new URL('./powWorker.js', import.meta.url),
      { type: 'module' }
    )

    worker.onmessage = (e) => {
      const msg = e.data

      if (msg.type === 'progress') {
        workerStats[msg.workerId].hashCount = msg.hashCount
        workerStats[msg.workerId].bestZeros = msg.bestZeros
        workerStats[msg.workerId].bestHash = msg.bestHash
        workerStats[msg.workerId].active = true

        const elapsed = (Date.now() - startTime) / 1000
        const totalHashes = workerStats.reduce((s, w) => s + w.hashCount, 0)
        const hashrate = elapsed > 0 ? totalHashes / elapsed : 0
        const globalBest = Math.max(...workerStats.map(w => w.bestZeros))

        if (onProgress) onProgress({
          hashCount: BigInt(totalHashes),
          hashrate,
          elapsed,
          bestZeros: globalBest,
          workers: workerStats.map(w => ({ ...w })),
        })
      }

      if (msg.type === 'solved' && !resolved) {
        resolved = true
        running = false
        const elapsed = (Date.now() - startTime) / 1000
        const totalHashes = workerStats.reduce((s, w) => s + w.hashCount, 0)

        // Stop all other workers
        workers.forEach(w => w.postMessage({ type: 'stop' }))

        if (onSolved) onSolved({
          nonce: msg.nonce,
          hash: msg.hash,
          leading: msg.leadingZeros,
          workerId: msg.workerId,
          hashCount: totalHashes,
          elapsed,
        })
      }

      if (msg.type === 'idle') {
        workerStats[msg.workerId].active = false
      }
    }

    worker.onerror = (err) => {
      console.error('Web Worker error:', err.message)
      workerStats[i].active = false
    }

    workers.push(worker)
  }

  return {
    setCallbacks(progressCb, solvedCb) {
      onProgress = progressCb
      onSolved = solvedCb
    },
    async start(seed, targetZeros, baseNonce) {
      running = true
      resolved = false
      startTime = Date.now()

      workerStats.forEach(w => {
        w.hashCount = 0
        w.bestZeros = 0
        w.bestHash = ''
        w.active = true
      })

      workers.forEach((worker, i) => {
        worker.postMessage({
          type: 'start',
          seed,
          targetZeros,
          startNonce: (baseNonce || 0) + i * 1000000,
          stepSize: 9973,
          workerId: i,
        })
      })

      // Poll until resolved or stopped (yields to event loop for worker messages)
      while (running && !resolved) {
        await new Promise(r => setTimeout(r, 100))
      }
    },
    stop() {
      running = false
      resolved = true
      workers.forEach(w => {
        try { w.postMessage({ type: 'stop' }) } catch {}
      })
    },
    terminate() {
      running = false
      resolved = true
      workers.forEach(w => {
        try { w.terminate() } catch {}
      })
    },
    isRunning() { return running },
    getTotalHashCount() {
      return BigInt(workerStats.reduce((s, w) => s + w.hashCount, 0))
    },
    getWorkerCount() { return threadCount },
    getWorkers() { return workerStats },
  }
}
// ─── Helper to derive sender from private key ─────────────────────────
function deriveAddressFromPk(pk) {
  try {
    const clean = pk.startsWith('0x') ? pk : '0x' + pk
    return clean.length === 66 ? new ethers.Wallet(clean).address : ''
  } catch { return '' }
}

// ─── Main Component ───────────────────────────────────────────────────
export default function PowFaucet() {
  const ethProvider = useProvider(ETH_RPCS)
  const { walletAddress, signer: walletSigner, isConnected, connectMetaMask, connectWalletConnect, disconnect, isConnecting, walletType } = useWeb3()

  // ─── Connection State ───────────────────────────────────────────────
  const [useWalletSign, setUseWalletSign] = useState(false)
  const [privateKey, setPrivateKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [derivedSender, setDerivedSender] = useState('')

  // Derive address from private key
  useEffect(() => {
    setDerivedSender(deriveAddressFromPk(privateKey))
  }, [privateKey])
  useEffect(() => { if (isConnected) setUseWalletSign(true) }, [isConnected])

  // Resolve active sender address
  const activeSender = useMemo(() => {
    if (useWalletSign && walletAddress) return walletAddress
    if (derivedSender) return derivedSender
    return ''
  }, [useWalletSign, walletAddress, derivedSender])

  const activeSigner = useMemo(() => {
    if (useWalletSign && walletSigner) return walletSigner
    if (privateKey && derivedSender) {
      const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
      try { return new ethers.Wallet(pk, ethProvider) } catch { return null }
    }
    return null
  }, [useWalletSign, walletSigner, privateKey, derivedSender, ethProvider])

  // ─── Mining State ──────────────────────────────────────────────────
  const [challenge, setChallenge] = useState(null)
  const [mining, setMining] = useState(false)
  const [minedHash, setMinedHash] = useState(null)
  const [minerProgress, setMinerProgress] = useState(null)
  const [faucetBalanceWei, setFaucetBalanceWei] = useState(0n)
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(null)
  const [error, setError] = useState('')
  const [difficulty, setDifficulty] = useState(5)
  const [payoutTx, setPayoutTx] = useState(null)
  const [nodeStatus, setNodeStatus] = useState({ online: 0, total: 0, bestLatency: 0 })

  // ─── Multi-Threaded Mining State ────────────────────────────────────
  const [threadCount, setThreadCount] = useState(DEFAULT_THREADS)
  const [powerMode, setPowerMode] = useState('turbo') // default to turbo
  const [autoThreads, setAutoThreads] = useState(true)
  const [workerStats, setWorkerStats] = useState([]) // per-worker stats during mining

  // Auto-detect CPU cores
  const cpuCores = useMemo(() => navigator.hardwareConcurrency || 8, [])

  // Auto-scale threads based on CPU cores and power mode
  useEffect(() => {
    if (autoThreads) {
      const modeCfg = POWA_MODES.find(m => m.id === powerMode) || POWA_MODES[1]
      const scaled = Math.max(1, Math.min(MAX_THREADS, Math.round(cpuCores * modeCfg.threadMult * 2)))
      setThreadCount(scaled)
    }
  }, [autoThreads, powerMode, cpuCores])

  // ─── Daily Rewards State ───────────────────────────────────────────
  const [dailySolves, setDailySolves] = useState(0)
  const [dailyRewardsWei, setDailyRewardsWei] = useState(0n)
  const [rewardClaiming, setRewardClaiming] = useState(false)
  const [claimTx, setClaimTx] = useState(null)
  const [claimError, setClaimError] = useState('')

  // ─── Distributed Mining Pool State ─────────────────────────────────
  const [discoveredNodes, setDiscoveredNodes] = useState([])  // all nodes from Relay + P2P
  const [poolStatus, setPoolStatus] = useState(null)  // { collective_hashrate, active_miners, leaderboard, ... }
  const [poolDeploying, setPoolDeploying] = useState(false)
  const [poolResult, setPoolResult] = useState(null)
  const [poolRegistered, setPoolRegistered] = useState(false)
  const [poolHashrate, setPoolHashrate] = useState(0)
  const [poolSolves, setPoolSolves] = useState(0)

  const minerRef = useRef(null)
  const progressInterval = useRef(null)

  // ─── Logging ─────────────────────────────────────────────────────────
  const addLog = useCallback((msg, type = 'info') => {
    setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg, type }, ...prev.slice(0, 80)])
  }, [])

  // ─── Fetch Daily Rewards Status ─────────────────────────────────────
  const fetchDailyRewards = useCallback(async () => {
    if (!activeSender) return
    try {
      const res = await fetch(`${BACKEND_URL}/api/faucet/rewards?address=${activeSender}`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const data = await res.json()
        setDailySolves(data.solves_today || 0)
        setDailyRewardsWei(BigInt(data.accumulated_wei || 0))
      }
    } catch {}
  }, [activeSender])

  useEffect(() => {
    fetchDailyRewards()
  }, [fetchDailyRewards])

  // ─── Fetch challenge from backend ────────────────────────────────────
  const fetchChallenge = useCallback(async () => {
    setLoading('challenge')
    setError('')
    setMinedHash(null)
    setMinerProgress(null)
    setPayoutTx(null)
    addLog('⛏️ Requesting new PoW challenge from Quantum Engine...', 'info')
    try {
      const res = await fetch(`${BACKEND_URL}/api/faucet/challenge?difficulty=${difficulty}`, {
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.status === 'ok') {
          setChallenge(data)
          setFaucetBalanceWei(BigInt(data.faucet_balance_wei || 0))
          addLog(`📜 Challenge received: seed="${data.seed.slice(0, 16)}..." target=${data.target} zeros`, 'success')
          addLog(`💰 Faucet balance: ${ethers.formatEther(data.faucet_balance_wei || 0)} ETH`, 'info')
          if (data.node_count) {
            setNodeStatus(prev => ({ ...prev, online: data.node_count, total: data.node_total || data.node_count }))
          }
        } else {
          addLog(`❌ Challenge failed: ${data.error}`, 'error')
        }
      } else {
        addLog('❌ Backend offline — start server.py for the faucet', 'error')
      }
    } catch (err) {
      addLog(`❌ ${err.message}`, 'error')
    }
    setLoading(null)
  }, [difficulty, addLog])

  // ─── Start Mining (Multi-Threaded) ─────────────────────────────────
  const startMining = useCallback(() => {
    if (!challenge) {
      addLog('❌ Fetch a challenge first!', 'error')
      return
    }
    if (!activeSender) {
      addLog('❌ Connect a wallet or enter a private key to receive rewards!', 'error')
      return
    }
    setMining(true)
    setMinedHash(null)
    setMinerProgress(null)
    setPayoutTx(null)

    const actualThreads = Math.max(1, Math.min(MAX_THREADS, threadCount))
    addLog(`⚡ Mining started with ${actualThreads} threads! Target: ${challenge.target} leading zeros`, 'info')
    addLog(`  Recipient: ${activeSender.slice(0, 10)}...${activeSender.slice(-6)}`, 'info')
    const modeCfg = POWA_MODES.find(m => m.id === powerMode) || POWA_MODES[1]
    addLog(`  Power mode: ${modeCfg.label} — ${actualThreads} parallel SHA-256 workers`, 'info')
    addLog(`  ${actualThreads >= 9999 ? '♾️' : actualThreads >= 100 ? '🔥' : '⚡'} ${actualThreads} THREADS — UNLIMITED POWER`, 'info')

    const miner = createWebWorkerMiner(actualThreads, powerMode)
    minerRef.current = miner

    miner.setCallbacks(
      (progress) => {
        setMinerProgress(progress)
        // Update per-worker stats for the UI
        if (progress.workers) {
          setWorkerStats(progress.workers.map(w => ({
            id: w.id,
            hashCount: w.hashCount,
            bestZeros: w.bestZeros,
            active: w.active,
          })))
        }
      },
      (solution) => {
        setMinedHash(solution)
        setMining(false)
        setWorkerStats([])
        addLog(`🎯 Worker #${solution.workerId + 1} SOLVED! Nonce: ${solution.nonce} | Hash: ${solution.hash.slice(0, 16)}... | Zeros: ${solution.leading}`, 'profit')
        addLog(`  Total attempts: ${solution.hashCount.toLocaleString()} | Time: ${solution.elapsed.toFixed(1)}s`, 'info')
        addLog(`  Combined hashrate: ${(solution.hashCount / solution.elapsed / 1000).toFixed(1)} KH/s`, 'info')
        submitSolution(solution)
      }
    )

    const seed = challenge.seed
    const targetZeros = challenge.target
    const startNonce = Math.floor(Math.random() * 10000000)

    // Start mining (all workers launch in parallel internally)
    miner.start(seed, targetZeros, startNonce).catch(err => {
      addLog(`❌ Mining error: ${err.message}`, 'error')
      stopMining()
    })

    // Update progress display every 600ms (debounced — per-worker callbacks handle real-time)
    progressInterval.current = setInterval(() => {
      if (miner.isRunning()) {
        const totalHashes = miner.getTotalHashCount()
        setMinerProgress(prev => prev ? { ...prev, hashCount: totalHashes } : null)
        // Also sync worker stats from the multi-thread miner
        if (miner.getWorkers) {
          setWorkerStats(miner.getWorkers().map((w, i) => ({
            id: i,
            hashCount: Number(w.hashCount),
            bestZeros: w.bestZeros,
            active: miner.isRunning(),
          })))
        }
      }
    }, 600)
  }, [challenge, activeSender, threadCount, addLog])

  // ─── Stop Mining (stops all workers) ───────────────────────────────
  const stopMining = useCallback(() => {
    if (minerRef.current) minerRef.current.terminate()
    if (progressInterval.current) clearInterval(progressInterval.current)
    setMining(false)
    setWorkerStats([])
    addLog('⏹ Mining stopped — all workers terminated', 'warn')
  }, [addLog])

  // ─── Submit Solution to Backend ─────────────────────────────────────
  const submitSolution = useCallback(async (solution) => {
    if (!challenge || !activeSender) return
    addLog(`📤 Submitting solution to Quantum Engine for verification...`, 'info')
    setLoading('submit')
    try {
      const res = await fetch(`${BACKEND_URL}/api/faucet/solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: challenge.id,
          seed: challenge.seed,
          target: challenge.target,
          nonce: solution.nonce,
          hash: solution.hash,
          recipient: activeSender,
        }),
        signal: AbortSignal.timeout(30000),
      })
      const data = await res.json()
      if (data.status === 'ok') {
        addLog(`✅ VERIFIED by Quantum Engine!`, 'profit')
        if (data.tx_hash) {
          setPayoutTx({ tx_hash: data.tx_hash, explorer_url: data.explorer_url || '' })
          addLog(`💸 Payout tx: ${data.tx_hash.slice(0, 18)}... ${data.explorer_url ? '🔗' : ''}`, 'profit')
        }
        if (data.amount_eth) addLog(`  Reward: ${data.amount_eth} ETH`, 'profit')
        if (data.verified_by) addLog(`  Verified by: ${data.verified_by}`, 'info')
        if (data.solves_remaining !== undefined) {
          setDailySolves(DAILY_SOLVES_LIMIT - data.solves_remaining)
          setDailyRewardsWei(prev => prev + BigInt(data.amount_wei || 0))
        }
      } else {
        addLog(`❌ Verification failed: ${data.error}`, 'error')
      }
    } catch (err) {
      addLog(`❌ Submit failed: ${err.message}`, 'error')
    }
    setLoading(null)
  }, [challenge, activeSender, addLog])

  // ─── Claim Daily Rewards ───────────────────────────────────────────
  const claimDailyRewards = useCallback(async () => {
    if (!activeSender) {
      addLog('❌ Connect wallet or enter private key to claim', 'error')
      return
    }
    if (dailyRewardsWei <= 0n) {
      addLog('❌ No rewards to claim. Solve PoW challenges first!', 'error')
      return
    }
    setRewardClaiming(true)
    setClaimTx(null)
    setClaimError('')
    addLog(`📤 Claiming daily rewards...`, 'info')

    // Try backend claim first
    try {
      const res = await fetch(`${BACKEND_URL}/api/faucet/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: activeSender, use_wallet: useWalletSign }),
        signal: AbortSignal.timeout(30000),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.status === 'ok' && data.tx_hash) {
          setClaimTx(data)
          addLog(`✅ Daily rewards claimed! TX: ${data.tx_hash.slice(0, 18)}...`, 'profit')
          addLog(`  Amount: ${ethers.formatEther(data.amount_wei || '0')} ETH`, 'profit')
          setDailyRewardsWei(0n)
          return
        }
        if (data.error) throw new Error(data.error)
      }
    } catch (err) {
      addLog(`❌ Claim failed: ${err.message}`, 'error')
      setClaimError(err.message)
    }
    setRewardClaiming(false)
  }, [activeSender, activeSigner, useWalletSign, dailyRewardsWei, ethProvider, addLog])

  // ─── Discover Nodes from localStorage (Relay Nodes + P2P Peers) ───
  const discoverNodes = useCallback(() => {
    const allNodes = []

    // 1. Relay Nodes
    try {
      const relayData = localStorage.getItem('flashloan_relay_discovered_nodes')
      if (relayData) {
        const relayNodes = JSON.parse(relayData)
        relayNodes.forEach(n => {
          allNodes.push({
            id: `relay-${n.id}`,
            name: n.name || `relay-${n.id}`,
            type: n.type || 'slave',
            region: n.region || 'unknown',
            latencyMs: n.latencyMs || n.latency_ms || 50,
            uptime: n.uptime || '99%',
            status: n.status || 'active',
            ip: n.ip || '',
            port: n.port || 8545,
            source: 'Relay Nodes',
          })
        })
      }
    } catch {}

    // 2. P2P Peers
    try {
      const p2pData = localStorage.getItem('flashloan_p2p_peers')
      if (p2pData) {
        const p2pPeers = JSON.parse(p2pData)
        ;(Array.isArray(p2pPeers) ? p2pPeers : []).forEach((p, i) => {
          allNodes.push({
            id: `p2p-${p.id || i}`,
            name: p.name || `peer-${p.id || i}`,
            type: 'follower',
            region: p.region || 'unknown',
            latencyMs: p.latencyMs || p.latency || 100,
            uptime: p.uptime || '95%',
            status: p.status || 'active',
            ip: p.ip || '',
            port: p.port || 0,
            source: 'P2P Network',
          })
        })
      }
    } catch {}

    // 3. Propagation endpoints
    try {
      const propData = localStorage.getItem('flashloan_propagation_endpoints')
      if (propData) {
        const endpoints = JSON.parse(propData)
        ;(Array.isArray(endpoints) ? endpoints : []).forEach((e, i) => {
          allNodes.push({
            id: `prop-${e.name || i}`,
            name: e.name || `endpoint-${i}`,
            type: 'slave',
            region: 'propagation',
            latencyMs: e.latency_ms || 80,
            uptime: '97%',
            status: 'active',
            ip: e.rpc_url || '',
            port: 0,
            source: 'Propagation',
          })
        })
      }
    } catch {}

    setDiscoveredNodes(allNodes)
    if (allNodes.length > 0) {
      addLog(`🔍 Discovered ${allNodes.length} mining nodes from network: ${allNodes.filter(n => n.status === 'active').length} active`, 'info')
    }
    return allNodes
  }, [addLog])

  // ─── Register Miners with Backend ──────────────────────────────────
  const registerMiners = useCallback(async (nodes) => {
    if (!nodes || nodes.length === 0) {
      addLog('❌ No nodes discovered to register', 'error')
      return null
    }

    addLog(`📡 Registering ${nodes.length} miners with Quantum Engine pool...`, 'info')
    try {
      const res = await fetch(`${BACKEND_URL}/api/faucet/register-miners`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes }),
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.status === 'ok') {
          setPoolRegistered(true)
          setPoolHashrate(data.collective_hashrate || 0)
          addLog(`✅ ${data.registered_count} miners registered! Pool hashrate: ${data.collective_hashrate_display}`, 'success')
          return data
        }
      }
    } catch (err) {
      addLog(`❌ Registration failed: ${err.message}`, 'error')
    }
    return null
  }, [addLog])

  // ─── Deploy Mining to All Nodes ────────────────────────────────────
  const deployNetworkMining = useCallback(async () => {
    if (!challenge) {
      addLog('❌ Fetch a challenge first!', 'error')
      return
    }
    if (!activeSender) {
      addLog('❌ Connect a wallet or enter a private key!', 'error')
      return
    }

    setPoolDeploying(true)
    setPoolResult(null)

    // Discover & register in one flow
    const nodes = discoverNodes()
    if (nodes.length === 0) {
      addLog('❌ No nodes found in network. Add Relay Nodes or P2P peers first.', 'error')
      setPoolDeploying(false)
      return
    }

    const reg = await registerMiners(nodes)
    if (!reg) {
      setPoolDeploying(false)
      return
    }

    addLog(`🚀 Deploying PoW challenge to ${reg.registered_count} nodes across the network...`, 'info')
    addLog(`  Pool hashrate: ${reg.collective_hashrate_display} | Target: ${challenge.target} zeros`, 'info')

    try {
      const res = await fetch(`${BACKEND_URL}/api/faucet/deploy-mining`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: challenge.id,
          seed: challenge.seed,
          target: challenge.target,
          recipient: activeSender,
        }),
        signal: AbortSignal.timeout(60000),
      })
      if (res.ok) {
        const data = await res.json()
        setPoolResult(data)

        if (data.solved) {
          setPoolSolves(prev => prev + 1)
          addLog(`🎉 NETWORK SOLVED by ${data.solved_by_name || data.solved_by}! Nonce: ${data.solved_nonce}`, 'profit')
          addLog(`  ⚡ Collective hashrate: ${data.collective_hashrate_display} | Time: ${data.elapsed_seconds}s`, 'profit')
          addLog(`  ${data.active_miners} nodes contributed`, 'info')
          if (data.solve_result?.status === 'ok') {
            addLog(`💰 ${data.pool_reward_eth} ETH reward accumulated!`, 'profit')
            setDailyRewardsWei(prev => prev + BigInt(data.solve_result.amount_wei || 0))
            setDailySolves(prev => Math.min(prev + 1, DAILY_SOLVES_LIMIT))
          }
        } else {
          addLog(`⚠️ Network mining in progress — ${data.total_hashes_checked} hashes checked across ${data.active_miners} nodes`, 'info')
        }

        // Update pool status
        setPoolHashrate(data.collective_hashrate || 0)
        if (data.per_node_results) {
          setPoolStatus(data)
        }
      }
    } catch (err) {
      addLog(`❌ Network mining failed: ${err.message}`, 'error')
    }
    setPoolDeploying(false)
  }, [challenge, activeSender, discoverNodes, registerMiners, addLog])

  // ─── Fetch pool status from backend ────────────────────────────────
  const fetchPoolStatus = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/faucet/pool-status`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const data = await res.json()
        if (data.status === 'ok') {
          setPoolStatus(data)
          setPoolHashrate(data.collective_hashrate || 0)
          if (!poolRegistered && data.active_miners > 0) {
            setPoolRegistered(true)
          }
        }
      }
    } catch {}
  }, [])

  // ─── Initial discovery on mount ────────────────────────────────────
  useEffect(() => {
    const nodes = discoverNodes()
    if (nodes.length > 0) {
      registerMiners(nodes)
    }
    // Also fetch pool status periodically
    const interval = setInterval(fetchPoolStatus, 15000)
    return () => clearInterval(interval)
  }, [discoverNodes, registerMiners, fetchPoolStatus])

  // ─── Fetch node status ──────────────────────────────────────────────
  const fetchNodeStatus = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/relay/status`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        const data = await res.json()
        setNodeStatus({
          online: data.active_nodes || 0,
          total: data.total_nodes || 0,
          bestLatency: data.nodes?.[0]?.latency_ms || 0,
        })
      }
    } catch {}
  }, [])

  useEffect(() => { fetchNodeStatus() }, [fetchNodeStatus])

  // Cleanup miner on unmount
  useEffect(() => {
    return () => {
      if (minerRef.current) minerRef.current.terminate()
      if (progressInterval.current) clearInterval(progressInterval.current)
    }
  }, [])

  // ─── Derived ────────────────────────────────────────────────────────
  const hashrateDisplay = useMemo(() => {
    if (!minerProgress) return '0 H/s'
    const hr = minerProgress.hashrate || 0
    if (hr > 1_000_000_000) return `${(hr / 1_000_000_000).toFixed(3)} TH/s`
    if (hr > 1_000_000) return `${(hr / 1_000_000).toFixed(2)} MH/s`
    if (hr > 1_000) return `${(hr / 1_000).toFixed(2)} KH/s`
    return `${hr.toFixed(0)} H/s`
  }, [minerProgress])

  const bestZerosDisplay = minerProgress?.bestZeros || 0

  // Pool hashrate display
  const poolHashrateDisplay = useMemo(() => {
    if (!poolHashrate) return '—'
    if (poolHashrate > 1_000_000) return `${(poolHashrate / 1_000_000).toFixed(2)} MH/s`
    if (poolHashrate > 1_000) return `${(poolHashrate / 1_000).toFixed(1)} KH/s`
    return `${poolHashrate.toFixed(0)} H/s`
  }, [poolHashrate])

  const statsCards = [
    { label: 'Faucet Balance', value: ethers.formatEther(faucetBalanceWei || '0') + ' ETH', color: '#22c55e' },
    { label: 'Pool Hashrate', value: poolHashrateDisplay, color: poolRegistered ? '#a78bfa' : '#888' },
    { label: 'Pool Nodes', value: discoveredNodes.length > 0 ? `${poolStatus?.active_miners || '?'}/${discoveredNodes.length}` : `${nodeStatus.online}/${nodeStatus.total}`, color: discoveredNodes.length > 0 ? '#22c55e' : '#ef4444' },
    { label: 'Daily Solves', value: `${dailySolves}/${DAILY_SOLVES_LIMIT}`, color: dailySolves >= DAILY_SOLVES_LIMIT ? '#fbbf24' : '#60a5fa' },
    { label: 'Accumulated', value: ethers.formatEther(dailyRewardsWei || '0') + ' ETH', color: dailyRewardsWei > 0n ? '#22c55e' : '#888' },
    { label: 'Difficulty', value: `${difficulty} zeros`, color: '#fbbf24' },
    { label: 'Threads', value: mining ? `${threadCount}⚡` : `${threadCount} 💤`, color: mining ? '#22c55e' : '#888' },
    { label: 'Best Solution', value: `${bestZerosDisplay}/${difficulty}`, color: bestZerosDisplay >= difficulty ? '#22c55e' : '#60a5fa' },
    { label: 'Hashrate', value: hashrateDisplay, color: '#a78bfa' },
    ...(minerProgress ? [
      { label: 'Attempts', value: minerProgress.hashCount.toLocaleString(), color: '#f472b6' },
      { label: 'Elapsed', value: `${minerProgress.elapsed.toFixed(1)}s`, color: '#22d3ee' },
    ] : []),
  ]

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">⛏️</span>
        <div>
          <h2>PoW ETH Faucet — Daily Rewards</h2>
          <p>Mine ETH with Proof-of-Work, connect wallet or private key to receive daily rewards on mainnet</p>
        </div>
      </div>

      {/* Stats */}
      <StatsBar stats={statsCards} />

      {/* ═══ CONNECTION PANEL ════════════════════════════════════════════ */}
      <div className="config-panel" style={{ borderColor: activeSender ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>🔑 Connection — {activeSender ? '✅ Connected' : '⚠️ Not Connected'}</h3>
          {activeSender && (
            <span style={{ fontSize: 10, color: '#888', fontFamily: 'monospace' }}>
              {activeSender.slice(0, 10)}...{activeSender.slice(-6)}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Wallet connect */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              onClick={connectMetaMask}
              disabled={isConnecting || isConnected}
              style={{
                fontSize: 11, padding: '6px 12px', borderRadius: 6,
                background: isConnected && walletType === 'metamask' ? 'rgba(34,197,94,0.15)' : 'rgba(246,133,27,0.1)',
                border: `1px solid ${isConnected && walletType === 'metamask' ? 'rgba(34,197,94,0.3)' : 'rgba(246,133,27,0.3)'}`,
                color: isConnected && walletType === 'metamask' ? '#22c55e' : '#f6851b',
                cursor: isConnecting ? 'wait' : 'pointer',
                fontWeight: 600,
              }}
            >
              🦊 {isConnected && walletType === 'metamask' ? 'MetaMask ✓' : 'MetaMask'}
            </button>
            <button
              onClick={connectWalletConnect}
              disabled={isConnecting || isConnected}
              style={{
                fontSize: 11, padding: '6px 12px', borderRadius: 6,
                background: isConnected && walletType === 'walletconnect' ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.1)',
                border: `1px solid ${isConnected && walletType === 'walletconnect' ? 'rgba(34,197,94,0.3)' : 'rgba(59,130,246,0.3)'}`,
                color: isConnected && walletType === 'walletconnect' ? '#22c55e' : '#60a5fa',
                cursor: isConnecting ? 'wait' : 'pointer',
                fontWeight: 600,
              }}
            >
              🔗 {isConnected && walletType === 'walletconnect' ? 'WC ✓' : 'WalletConnect'}
            </button>
            {isConnected && (
              <button onClick={disconnect} style={{ fontSize: 10, padding: '4px 8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 4, color: '#ef4444', cursor: 'pointer' }}>
                Disconnect
              </button>
            )}
          </div>

          <div style={{ color: '#555', fontSize: 11 }}>or</div>

          {/* Private key toggle + input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => { setUseWalletSign(false); if (isConnected) disconnect() }}
              style={{
                fontSize: 11, padding: '6px 12px', borderRadius: 6,
                background: !useWalletSign && derivedSender ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${!useWalletSign && derivedSender ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.1)'}`,
                color: !useWalletSign && derivedSender ? '#22c55e' : '#888',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              🔑 Private Key
            </button>
          </div>
        </div>

        {/* Private key input (when wallet not connected or user chooses key) */}
        {!useWalletSign && (
          <div style={{ marginTop: 8, maxWidth: 500 }}>
            <PrivateKeyInput
              privateKey={privateKey}
              setPrivateKey={setPrivateKey}
              showKey={showKey}
              setShowKey={setShowKey}
              senderAddress={derivedSender}
              placeholder="0x private key for receiving rewards..."
            />
            {derivedSender && (
              <div style={{ fontSize: 10, color: '#22c55e', marginTop: 2 }}>
                ✅ Key valid — rewards will go to this address on mainnet
              </div>
            )}
          </div>
        )}

        {activeSender && (
          <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
            <span>📬 Rewards address: <code className="mono" style={{ color: '#22c55e', fontSize: 11 }}>{activeSender.slice(0, 14)}...{activeSender.slice(-6)}</code></span>
            <CopyButton text={activeSender} />
          </div>
        )}
      </div>

      {/* ═══ DAILY REWARDS PANEL ═════════════════════════════════════════ */}
      {activeSender && (
        <div className="config-panel" style={{ borderColor: dailyRewardsWei > 0n ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>🎁 Daily Rewards</h3>
            <span style={{ fontSize: 11, color: '#888' }}>
              {dailySolves}/{DAILY_SOLVES_LIMIT} solves today
            </span>
          </div>

          <div className="form-grid" style={{ gridTemplateColumns: '1fr auto', gap: 16 }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 2 }}>ACCUMULATED REWARDS</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: dailyRewardsWei > 0n ? '#22c55e' : '#888', fontFamily: 'monospace' }}>
                {ethers.formatEther(dailyRewardsWei || '0')} ETH
              </div>
              <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                {DAILY_CLAIM_BONUS_ETH} ETH bonus on each claim · Mainnet only
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
              <LoadingButton
                loading={rewardClaiming}
                loadingText="⏳ Claiming..."
                onClick={claimDailyRewards}
                disabled={dailyRewardsWei <= 0n || !activeSender}
                style={{
                  fontSize: 13, fontWeight: 700, padding: '10px 24px',
                  background: dailyRewardsWei > 0n ? 'linear-gradient(135deg, #fbbf24, #f59e0b)' : 'var(--accent-blue-dim)',
                  border: 'none', borderRadius: 8, color: dailyRewardsWei > 0n ? '#1a1a2e' : '#888',
                  cursor: dailyRewardsWei > 0n ? 'pointer' : 'not-allowed',
                  opacity: dailyRewardsWei > 0n ? 1 : 0.5,
                }}
              >
                🎁 Claim {ethers.formatEther(dailyRewardsWei || '0')} ETH
              </LoadingButton>
              <button
                onClick={fetchDailyRewards}
                style={{ fontSize: 10, padding: '4px 10px', background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, color: '#888', cursor: 'pointer' }}
              >
                🔄 Refresh
              </button>
            </div>
          </div>

          {/* Claim result */}
          {claimTx && (
            <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)' }}>
              <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>✅ Claim Successful!</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                TX: <code className="mono">{claimTx.tx_hash?.slice(0, 22)}...{claimTx.tx_hash?.slice(-8)}</code>
              </div>
              {claimTx.explorer_url && (
                <a href={claimTx.explorer_url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: '#60a5fa' }}>View on Etherscan →</a>
              )}
            </div>
          )}

          {claimError && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#ef4444' }}>❌ {claimError}</div>
          )}
        </div>
      )}

      {/* ═══ Node Network Status ═════════════════════════════════════════ */}
      <div className="config-panel" style={{ borderColor: 'rgba(59,130,246,0.2)' }}>
        <h3>🌐 Connected Node Network</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.1)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>RELAY NODES</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: nodeStatus.online > 0 ? '#22c55e' : '#ef4444' }}>
              {nodeStatus.online} / {nodeStatus.total}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>active nodes</div>
          </div>
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(251,191,36,0.04)', border: '1px solid rgba(251,191,36,0.1)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>BEST LATENCY</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fbbf24' }}>
              {nodeStatus.bestLatency || '—'} ms
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>fastest node</div>
          </div>
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(34,197,94,0.04)', border: '1px solid rgba(34,197,94,0.1)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>REWARD PER BLOCK</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#22c55e' }}>
              {FAUCET_AMOUNT_ETH} ETH
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>per solved PoW</div>
          </div>
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.1)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>DAILY BONUS</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#a78bfa' }}>
              +{DAILY_CLAIM_BONUS_ETH} ETH
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>per claim bonus</div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 10, color: '#555' }}>
          💡 Connect wallet or enter private key above to start earning daily rewards
        </div>
      </div>

      {/* ═══ DISTRIBUTED MINING POOL ═════════════════════════════════════ */}
      <div className="config-panel" style={{ borderColor: poolRegistered ? 'rgba(167,139,250,0.3)' : 'rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>🌐 Distributed Mining Pool — {discoveredNodes.length} Nodes</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: poolRegistered ? '#22c55e' : '#888', padding: '2px 8px', borderRadius: 10, background: poolRegistered ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.04)' }}>
              {poolRegistered ? '🟢 Pool Active' : '⚪ Discovering...'}
            </span>
            <button
              onClick={() => { discoverNodes(); fetchPoolStatus() }}
              style={{ fontSize: 10, padding: '4px 10px', background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, color: '#888', cursor: 'pointer' }}
            >
              🔄 Refresh
            </button>
          </div>
        </div>

        {/* Pool summary */}
        <div className="stats-bar" style={{ marginBottom: 12 }}>
          <div className="stat">
            <span className="stat-label">🏊 Pool Hashrate</span>
            <span className="stat-value" style={{ color: '#a78bfa' }}>{poolHashrateDisplay}</span>
          </div>
          <div className="stat">
            <span className="stat-label">👥 Miners</span>
            <span className="stat-value" style={{ color: poolStatus?.active_miners > 0 ? '#22c55e' : '#888' }}>
              {poolStatus?.active_miners || '0'} / {poolStatus?.total_nodes || discoveredNodes.length}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">🏆 Pool Solves</span>
            <span className="stat-value" style={{ color: '#fbbf24' }}>{poolSolves}</span>
          </div>
          <div className="stat">
            <span className="stat-label">📡 Sources</span>
            <span className="stat-value" style={{ color: '#60a5fa' }}>
              {new Set(discoveredNodes.map(n => n.source)).size > 0 ? [...new Set(discoveredNodes.map(n => n.source))].join(' | ') : '—'}
            </span>
          </div>
        </div>

        {/* Leaderboard (top miners by hashrate) */}
        {poolStatus?.leaderboard && poolStatus.leaderboard.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              ⚡ Miner Leaderboard (by hashrate)
            </div>
            <div style={{
              borderRadius: 8, overflow: 'hidden',
              border: '1px solid var(--border)',
            }}>
              {/* Header */}
              <div style={{
                display: 'grid', gridTemplateColumns: '28px 2fr 1.2fr 1fr 1fr 60px',
                padding: '6px 10px', fontSize: 9,
                background: 'rgba(255,255,255,0.03)',
                color: 'var(--text-dim)', fontWeight: 600,
                borderBottom: '1px solid var(--border)',
              }}>
                <span>#</span>
                <span>Miner</span>
                <span>Type</span>
                <span>Region</span>
                <span>Hashrate</span>
                <span>Solves</span>
              </div>
              {/* Rows */}
              {poolStatus.leaderboard.slice(0, 10).map((node, i) => (
                <div
                  key={node.id}
                  style={{
                    display: 'grid', gridTemplateColumns: '28px 2fr 1.2fr 1fr 1fr 60px',
                    padding: '6px 10px',
                    fontSize: 11,
                    borderBottom: i < Math.min(poolStatus.leaderboard.length, 10) - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    background: node.solvesFound > 0 ? 'rgba(34,197,94,0.04)' : 'transparent',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = node.solvesFound > 0 ? 'rgba(34,197,94,0.04)' : 'transparent'}
                >
                  <span style={{ color: i < 3 ? '#fbbf24' : '#555', fontWeight: 700 }}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                  </span>
                  <span style={{ color: '#e0e0e0', fontWeight: 600 }}>{node.name || node.id?.slice(0, 10)}</span>
                  <span style={{
                    color: node.type === 'master' ? '#fbbf24' : node.type === 'slave' ? '#60a5fa' : '#888',
                    fontSize: 10,
                  }}>
                    {node.type === 'master' ? '👑' : node.type === 'slave' ? '🔹' : '🔸'} {node.type}
                  </span>
                  <span style={{ color: '#888', fontSize: 10 }}>{node.region || '—'}</span>
                  <span style={{ color: '#a78bfa', fontFamily: 'monospace', fontWeight: 600 }}>
                    {(node.hashrate || 0) > 1000 ? `${(node.hashrate / 1000).toFixed(1)}K` : `${(node.hashrate || 0).toFixed(0)}`} H/s
                  </span>
                  <span style={{ color: node.solvesFound > 0 ? '#22c55e' : '#555', fontWeight: 600 }}>
                    {node.solvesFound || 0}
                  </span>
                </div>
              ))}
            </div>
            {poolStatus.leaderboard.length > 10 && (
              <div style={{ marginTop: 4, fontSize: 9, color: '#555', textAlign: 'center' }}>
                +{poolStatus.leaderboard.length - 10} more miners
              </div>
            )}
          </div>
        )}

        {/* Per-node results from last deployment */}
        {poolResult?.per_node_results && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4, fontWeight: 600 }}>
              📊 Last Deployment Results
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 4 }}>
              {Object.entries(poolResult.per_node_results).map(([nid, nodeRes]) => (
                <div key={nid} style={{
                  padding: '6px 8px', borderRadius: 6,
                  background: nodeRes.found ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${nodeRes.found ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.06)'}`,
                  fontSize: 10,
                }}>
                  <div style={{ color: nodeRes.found ? '#22c55e' : '#888', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    {nodeRes.found ? '🎯' : '⚙️'} {nodeRes.name}
                  </div>
                  <div style={{ color: '#888', marginTop: 2 }}>
                    {nodeRes.hashCount?.toLocaleString()} hashes
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 1 }}>
                    <span style={{ color: '#fbbf24' }}>best: {nodeRes.bestZeros}</span>
                    <span style={{ color: '#a78bfa' }}>{(nodeRes.hashrate || 0).toFixed(0)} H/s</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Deploy button */}
        <div className="form-actions">
          <LoadingButton
            loading={poolDeploying}
            loadingText="🚀 Deploying to network..."
            onClick={deployNetworkMining}
            disabled={!challenge || !activeSender || discoveredNodes.length === 0 || mining}
            style={{
              fontSize: 13, fontWeight: 700, padding: '12px 28px',
              background: !challenge || !activeSender || discoveredNodes.length === 0
                ? 'var(--accent-blue-dim)'
                : 'linear-gradient(135deg, #a78bfa, #7c3aed)',
              border: 'none', borderRadius: 8,
              color: !challenge || !activeSender || discoveredNodes.length === 0 ? '#888' : '#fff',
              cursor: !challenge || !activeSender || discoveredNodes.length === 0 ? 'not-allowed' : 'pointer',
              opacity: !challenge || !activeSender || discoveredNodes.length === 0 ? 0.5 : 1,
            }}
          >
            🚀 Deploy Mining to ALL {discoveredNodes.filter(n => n.status === 'active').length || discoveredNodes.length} Nodes
          </LoadingButton>

          {poolResult?.solved && (
            <div style={{ fontSize: 11, color: '#22c55e', padding: '8px 14px', background: 'rgba(34,197,94,0.06)', borderRadius: 6 }}>
              ✅ Solved by {poolResult.solved_by_name}! {poolResult.elapsed_seconds}s — {poolResult.pool_reward_eth || 0.01} ETH accumulated
            </div>
          )}
        </div>

        {/* Node source breakdown */}
        {discoveredNodes.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', gap: 10, fontSize: 10, color: '#555', flexWrap: 'wrap' }}>
            {['Relay Nodes', 'P2P Network', 'Propagation'].map(src => {
              const count = discoveredNodes.filter(n => n.source === src).length
              if (count === 0) return null
              return (
                <span key={src} style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(255,255,255,0.04)' }}>
                  {src === 'Relay Nodes' ? '🗼' : src === 'P2P Network' ? '🔗' : '📡'} {src}: {count}
                </span>
              )
            })}<span>| Hashrate: {poolHashrateDisplay}</span>
            <span>| Registered: {poolRegistered ? '✅' : '❌'}</span>
          </div>
        )}
      </div>

      {/* ═══ Challenge & Mining ════════════════════════════════════════════ */}
      <div className={`config-panel ${powerMode === 'unlimited' && mining ? 'panel-unlimited' : ''}`} style={{
        borderColor: challenge ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            ⛏️ PoW Mining Console
            {powerMode === 'unlimited' && mining && (
              <span style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 10,
                background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                fontWeight: 700, letterSpacing: '0.08em',
                animation: 'pulse 1s ease-in-out infinite',
              }}>
                ♾️ UNLIMITED
              </span>
            )}
            {threadCount >= 100 && mining && (
              <span style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 10,
                background: 'rgba(167,139,250,0.15)', color: '#a78bfa',
                fontWeight: 700,
              }}>
                🔥 {threadCount}t
              </span>
            )}
          </h3>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Auto-thread toggle */}
            <label style={{ fontSize: 10, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoThreads}
                onChange={e => setAutoThreads(e.target.checked)}
                disabled={mining}
                style={{ accentColor: '#a78bfa' }}
              />
              Auto ({cpuCores} cores)
            </label>

            {/* Power mode selector */}
            <select
              value={powerMode}
              onChange={e => { setPowerMode(e.target.value); if (autoThreads) { const modeCfg = POWA_MODES.find(m => m.id === e.target.value) || POWA_MODES[1]; setThreadCount(Math.max(1, Math.min(MAX_THREADS, Math.round(cpuCores * modeCfg.threadMult * 2)))); } }}
              disabled={mining}
              style={{
                fontSize: 11, padding: '4px 8px', borderRadius: 6,
                background: powerMode === 'unlimited' ? 'rgba(239,68,68,0.1)' :
                           powerMode === 'overclock' ? 'rgba(251,191,36,0.1)' :
                           powerMode === 'turbo' ? 'rgba(34,197,94,0.1)' : 'var(--bg-input)',
                border: `1px solid ${
                  powerMode === 'unlimited' ? 'rgba(239,68,68,0.3)' :
                  powerMode === 'overclock' ? 'rgba(251,191,36,0.3)' :
                  powerMode === 'turbo' ? 'rgba(34,197,94,0.3)' : 'var(--border)'
                }`,
                color: powerMode === 'unlimited' ? '#ef4444' :
                       powerMode === 'overclock' ? '#fbbf24' :
                       powerMode === 'turbo' ? '#22c55e' : 'var(--text-primary)',
                fontWeight: 700,
              }}
            >
              {POWA_MODES.map(m => (
                <option key={m.id} value={m.id} title={m.desc}>{m.label}</option>
              ))}
            </select>

            {/* Thread count slider (only when auto is off) */}
            {!autoThreads && (
              <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
                🧵 Threads:
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="range"
                    min={1}
                    max={MAX_THREADS}
                    value={threadCount}
                    onChange={e => setThreadCount(Number(e.target.value))}
                    disabled={mining}
                    style={{ width: 100, accentColor: threadCount >= 100 ? '#ef4444' : threadCount >= 16 ? '#a78bfa' : '#22c55e' }}
                  />
                  <span style={{
                    fontSize: 13, fontWeight: 700, fontFamily: 'monospace', minWidth: 40,
                    color: mining ? '#22c55e' : threadCount >= 100 ? '#ef4444' : threadCount >= 16 ? '#a78bfa' : '#888',
                  }}>
                    {threadCount >= 1000 ? `${(threadCount/1000).toFixed(1)}K` : threadCount}
                  </span>
                  {threadCount >= 9999 && <span style={{ fontSize: 9, color: '#ef4444', fontWeight: 700 }}>♾️ MAX</span>}
                </div>
              </label>
            )}

            {/* Show thread count stat when auto is on */}
            {autoThreads && (
              <span style={{
                fontSize: 12, fontWeight: 700, fontFamily: 'monospace',
                color: threadCount >= 100 ? '#ef4444' : threadCount >= 16 ? '#a78bfa' : '#22c55e',
                padding: '2px 10px', borderRadius: 6,
                background: threadCount >= 100 ? 'rgba(239,68,68,0.1)' : threadCount >= 16 ? 'rgba(167,139,250,0.1)' : 'rgba(34,197,94,0.1)',
              }}>
                {threadCount >= 1000 ? `${(threadCount/1000).toFixed(1)}K` : threadCount}t
              </span>
            )}

            {/* Difficulty selector */}
            <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
              Difficulty:
              <select value={difficulty} onChange={e => setDifficulty(Number(e.target.value))} disabled={mining} style={{ fontSize: 11, padding: '2px 6px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)' }}>
                {[3, 4, 5, 6, 7, 8].map(d => <option key={d} value={d}>{d} zeros {d <= 4 ? '(easy)' : d >= 7 ? '(hard)' : ''}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div>
            {!challenge ? (
              <div style={{ padding: '20px', textAlign: 'center', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
                <div style={{ fontSize: 13, color: '#888' }}>Fetch a PoW challenge to start mining</div>
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 2 }}>CHALLENGE SEED</div>
                  <code className="mono" style={{ fontSize: 11, color: '#60a5fa', wordBreak: 'break-all' }}>{challenge.seed}</code>
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>TARGET</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#fbbf24', fontFamily: 'monospace' }}>{challenge.target} zeros</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>FAUCET</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#22c55e', fontFamily: 'monospace' }}>
                      {ethers.formatEther(challenge.faucet_balance_wei || 0)} ETH
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>RECIPIENT</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: activeSender ? '#a78bfa' : '#ef4444', fontFamily: 'monospace' }}>
                      {activeSender ? `${activeSender.slice(0, 6)}...` : '⚠️ NONE'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Hashrate visualization — Multi-threaded */}
          <div style={{
            padding: '12px 16px', borderRadius: 8,
            background: mining && powerMode === 'unlimited' ? 'rgba(239,68,68,0.05)' :
                        mining ? 'rgba(34,197,94,0.05)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${
              mining && powerMode === 'unlimited' ? 'rgba(239,68,68,0.3)' :
              mining ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.06)'
            }`,
          }}>
            {mining && minerProgress ? (
              <div>
                <div style={{
                  fontSize: 10, color: 'var(--text-dim)', marginBottom: 4,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span>⚡ {threadCount} THREADS — {powerMode === 'unlimited' ? '♾️ UNLIMITED POWER' : powerMode === 'overclock' ? '🔥 OVERCLOCK' : powerMode === 'turbo' ? '⚡ TURBO' : '🔋 NORMAL'}</span>
                  <span style={{ color: '#555' }}>{POWA_MODES.find(m => m.id === powerMode)?.desc || ''}</span>
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: powerMode === 'unlimited' ? '#ef4444' : '#22c55e', fontFamily: 'monospace' }}>{hashrateDisplay}</div>
                <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 11, color: 'var(--text-dim)', flexWrap: 'wrap' }}>
                  <span>⚡ {minerProgress.hashCount.toLocaleString()} hashes</span>
                  <span>🎯 best: {minerProgress.bestZeros}/{difficulty}</span>
                  <span>⏱️ {minerProgress.elapsed.toFixed(1)}s</span>
                  <span>🧵 {workerStats.length}/{threadCount} active</span>
                  <span>🖥️ {cpuCores} cores</span>
                </div>
                {/* Progress bar — animated for unlimited power */}
                <div style={{ marginTop: 8, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    width: `${Math.min(100, (minerProgress.bestZeros / difficulty) * 100)}%`,
                    background: powerMode === 'unlimited'
                      ? 'linear-gradient(90deg, #ef4444, #a78bfa, #22c55e, #fbbf24)'
                      : 'linear-gradient(90deg, #22c55e, #a78bfa)',
                    backgroundSize: powerMode === 'unlimited' ? '200% 100%' : undefined,
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-dim)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>0</span>
                  <span style={{ color: '#22c55e' }}>{minerProgress.bestZeros} / {difficulty}</span>
                  <span style={{ color: powerMode === 'unlimited' ? '#ef4444' : '#a78bfa' }}>
                    {powerMode === 'unlimited' ? '♾️' : powerMode === 'overclock' ? '🔥' : '⚡'}
                  </span>
                </div>
                {/* Per-worker stats mini grid (only show first 8 in compact mode) */}
                {workerStats.length > 0 && (
                  <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: `repeat(${Math.min(workerStats.length, 4)}, 1fr)`, gap: 4 }}>
                    {workerStats.slice(0, 8).map(w => (
                      <div key={w.id} style={{
                        padding: '4px 6px', borderRadius: 4, fontSize: 9,
                        background: w.active ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${w.active ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)'}`,
                      }}>
                        <div style={{ color: w.active ? '#22c55e' : '#555', fontWeight: 600 }}>W#{w.id + 1}</div>
                        <div style={{ color: '#888' }}>{w.hashCount.toLocaleString()}h</div>
                        <div style={{ color: '#fbbf24' }}>best: {w.bestZeros}</div>
                      </div>
                    ))}
                    {workerStats.length > 8 && (
                      <div style={{
                        padding: '4px 6px', borderRadius: 4, fontSize: 9,
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#555',
                      }}>
                        +{workerStats.length - 8} more
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : minedHash ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 28 }}>🎉</div>
                <div style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>SOLUTION FOUND!</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                  Worker #{minedHash.workerId + 1} | Nonce: {minedHash.nonce.toLocaleString()} | {minedHash.hashCount.toLocaleString()} total attempts
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{ fontSize: 28 }}>⚡</div>
                <div style={{ fontSize: 12, color: '#888' }}>Fetch a challenge and start mining</div>
                <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>{threadCount} parallel SHA-256 workers ready</div>
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="form-actions" style={{ marginTop: 14 }}>
          <LoadingButton
            loading={loading === 'challenge'}
            loadingText="🎯..."
            onClick={fetchChallenge}
            disabled={mining}
            style={{ fontSize: 12, padding: '10px 20px' }}
          >
            🎯 New Challenge
          </LoadingButton>

          {!mining ? (
            <button
              onClick={startMining}
              disabled={!challenge || minedHash !== null || !activeSender}
              style={{
                fontSize: 13, fontWeight: 700, padding: '10px 24px',
                background: !challenge || !activeSender ? 'var(--accent-blue-dim)' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                border: 'none', borderRadius: 8, color: '#fff',
                cursor: !challenge || !activeSender ? 'not-allowed' : 'pointer',
                opacity: !challenge || !activeSender ? 0.5 : 1,
              }}
            >
              ⚡ Start Mining
            </button>
          ) : (
            <button
              onClick={stopMining}
              style={{
                fontSize: 13, fontWeight: 700, padding: '10px 24px',
                background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer',
              }}
            >
              ⏹ Stop Mining
            </button>
          )}

          {minedHash && !payoutTx && (
            <LoadingButton
              loading={loading === 'submit'}
              loadingText="📤..."
              onClick={() => submitSolution(minedHash)}
              style={{ fontSize: 12, padding: '10px 20px' }}
            >
              📤 Submit Solution
            </LoadingButton>
          )}
        </div>
      </div>

      {/* ─── Payout Result ────────────────────────────────────────────── */}
      {payoutTx && (
        <div className="result-panel success" style={{ marginBottom: 20 }}>
          <h3>✅ Payout Sent!</h3>
          <div className="result-grid">
            <div className="result-item">
              <span className="ri-label">TX Hash</span>
              <span className="ri-value mono">{payoutTx.tx_hash.slice(0, 18)}...{payoutTx.tx_hash.slice(-6)}</span>
            </div>
            <div className="result-item">
              <span className="ri-label">Amount</span>
              <span className="ri-value success">{FAUCET_AMOUNT_ETH} ETH</span>
            </div>
            {payoutTx.explorer_url && (
              <div className="result-item">
                <span className="ri-label">Explorer</span>
                <a href={payoutTx.explorer_url} target="_blank" rel="noreferrer" className="ri-value" style={{ fontSize: 12, color: '#60a5fa' }}>View on Etherscan →</a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Error ────────────────────────────────────────────────────── */}
      {error && <ErrorBox>{error}</ErrorBox>}

      {/* ─── Activity Log ─────────────────────────────────────────────── */}
      {logs.length > 0 && (
        <div className="log-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>📋 Mining Log</h3>
            <button className="btn btn-secondary" onClick={() => setLogs([])} style={{ fontSize: 9, padding: '4px 10px' }}>Clear</button>
          </div>
          <div className="log-container" style={{ maxHeight: 250 }}>
            {logs.map((log, i) => (
              <div key={i} className={`log-entry ${log.type}`}>
                <span className="log-time">{log.time}</span>
                <span className="log-msg">{log.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Info ─────────────────────────────────────────────────────── */}
      <div style={{
        padding: '14px 18px', borderRadius: 8, marginTop: 12,
        background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.12)',
        fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6,
      }}>
        <strong style={{ color: '#a78bfa' }}>⛏️ PoW ETH Faucet — Daily Rewards</strong> — connect wallet or private key to receive mainnet rewards.
        <ul style={{ margin: '6px 0 0 16px', color: '#888' }}>
          <li><strong>🔑 Connection:</strong> Use MetaMask, WalletConnect, or a private key to set your reward address</li>
          <li><strong>🎯 Mining:</strong> SHA-256 PoW challenges with configurable difficulty (3–8 zeros)</li>
          <li><strong>💰 Daily Rewards:</strong> {FAUCET_AMOUNT_ETH} ETH per solve, up to {DAILY_SOLVES_LIMIT} solves/day</li>
          <li><strong>🎁 Claim Bonus:</strong> +{DAILY_CLAIM_BONUS_ETH} ETH bonus on each daily claim</li>
          <li><strong>🌐 Mainnet:</strong> All payouts sent directly to your connected address on Ethereum mainnet</li>
        </ul>
      </div>
    </div>
  )
}
