import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import {
  ETH_RPCS, BSC_RPCS, ETH_CHAIN_ID, BSC_CHAIN_ID,
  ETH_WETH, ETH_USDT, BSC_USDT, BSC_WBNB,
  UNISWAP_V3_ROUTER, UNISWAP_V2_ROUTER, PANCAKESWAP_V2_ROUTER,
} from '../constants'
import { useProvider } from '../hooks'
import { useWeb3 } from '../context/Web3Context'
import { encodeTransfer } from '../utils'
import { signTxForBundle, sendPrivateTx, getGasPrice } from '../utils/flashbots'
import ConfigPanel from './shared/ConfigPanel'
import ResultPanel from './shared/ResultPanel'
import PrivateKeyInput from './shared/PrivateKeyInput'
import LoadingButton from './shared/LoadingButton'
import PillBadge from './shared/PillBadge'
import ErrorBox from './shared/ErrorBox'
import EmptyState from './shared/EmptyState'
import CopyButton from './shared/CopyButton'

const V2_ROUTER_ABI = ['function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)']
const V3_ROUTER_ABI = ['function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external view returns (uint256 amountOut)']

const BACKEND_URL = 'http://localhost:8000'

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatPrice(p) {
  if (p === null || p === undefined) return '—'
  if (p < 0.001) return p.toExponential(4)
  if (p < 1) return p.toFixed(6)
  if (p < 100) return p.toFixed(4)
  return p.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatProfit(p) {
  if (p === null || p === undefined) return '—'
  const abs = Math.abs(p)
  const str = abs < 0.01 ? '$0.00' : `$${abs.toFixed(2)}`
  return p >= 0 ? `+${str}` : `-${str}`
}

// ─── DexPriceCard ────────────────────────────────────────────────────────

function DexPriceCard({ dex, chain, pair, price, fee, block, timestamp }) {
  const chainColor = chain === 'ethereum' ? '#3b82f6' : '#22c55e'
  const chainName = chain === 'ethereum' ? 'ETH' : 'BSC'
  return (
    <div className="dex-card" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 16px', transition: 'all 0.2s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: chainColor, display: 'inline-block', boxShadow: `0 0 8px ${chainColor}66` }} />
          <strong style={{ fontSize: 13, color: '#e0e0e0' }}>{dex}</strong>
        </div>
        <span style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>#{block}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{formatPrice(price)}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888' }}><span>{pair}</span><span>{chainName} · {fee}bps</span></div>
    </div>
  )
}

// ─── OpportunityRow ──────────────────────────────────────────────────────

function OpportunityRow({ opp, index, onExecute }) {
  const profitColor = opp.netProfit >= 0 ? '#22c55e' : '#ef4444'
  const confidencePct = Math.round((opp.confidence || 0) * 100)
  return (
    <div style={{
      background: confidencePct > 70 ? 'rgba(34,197,94,0.06)' : confidencePct > 40 ? 'rgba(234,179,8,0.06)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${confidencePct > 70 ? 'rgba(34,197,94,0.2)' : confidencePct > 40 ? 'rgba(234,179,8,0.2)' : 'rgba(255,255,255,0.06)'}`,
      borderRadius: 10, padding: '12px 16px', marginBottom: 8, transition: 'all 0.2s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: confidencePct > 70 ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: confidencePct > 70 ? '#22c55e' : '#eab308' }}>{index}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#e0e0e0' }}>{opp.tokenIn} → {opp.tokenOut}</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{opp.buyDex} @ {formatPrice(opp.buyPrice)} → {opp.sellDex} @ {formatPrice(opp.sellPrice)}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: profitColor }}>{formatProfit(opp.netProfit)}</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{opp.spreadBps}bps spread · {confidencePct}% conf</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <PillBadge variant="purple">{opp.chain}</PillBadge>
        <PillBadge variant="blue">{opp.strategy}</PillBadge>
        {onExecute && (
          <button onClick={() => onExecute(opp)} style={{ marginLeft: 'auto', background: 'linear-gradient(135deg, #3b82f6, #6366f1)', border: 'none', color: '#fff', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600, transition: 'all 0.2s' }}>
            ⚡ Execute
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Log entry component ─────────────────────────────────────────────────

function LogEntry({ entry }) {
  const colorMap = {
    info: '#60a5fa',
    success: '#22c55e',
    error: '#ef4444',
    warn: '#fbbf24',
    connect: '#a78bfa',
    trade: '#f472b6',
    system: '#888',
  }
  const iconMap = {
    info: 'ℹ️',
    success: '✅',
    error: '❌',
    warn: '⚠️',
    connect: '🔗',
    trade: '💹',
    system: '⚙️',
  }
  const c = colorMap[entry.type] || '#888'
  const icon = iconMap[entry.type] || '•'

  return (
    <div style={{
      display: 'flex', gap: 8, padding: '4px 8px', fontSize: 11, fontFamily: 'monospace',
      borderBottom: '1px solid rgba(255,255,255,0.03)',
      color: c, lineHeight: 1.6, alignItems: 'flex-start',
    }}>
      <span style={{ flexShrink: 0, opacity: 0.7 }}>{icon}</span>
      <span style={{ flexShrink: 0, color: '#555', width: 60, fontSize: 10 }}>{new Date(entry.ts).toLocaleTimeString()}</span>
      <span style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{entry.msg}</span>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────

export default function ArbitrageDashboard() {
  // ─── Providers ─────────────────────────────────────────────────────────
  const ethProvider = useProvider(ETH_RPCS)
  const bscProvider = useProvider(BSC_RPCS)
  const { signer: walletSigner, walletAddress, isConnected, chainId } = useWeb3()

  // ─── State: Prices & Opportunities ─────────────────────────────────────
  const [prices, setPrices] = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [execHistory, setExecHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [filterChain, setFilterChain] = useState('all')

  // ─── State: Stats ──────────────────────────────────────────────────────
  const [stats, setStats] = useState({ totalProfit: 0, tradesExecuted: 0, opportunitiesFound: 0, successfulTrades: 0 })

  // ─── State: Auto Bot ──────────────────────────────────────────────────
  const [botRunning, setBotRunning] = useState(false)
  const [minProfitUsdt, setMinProfitUsdt] = useState(5)
  const [maxPositionSize, setMaxPositionSize] = useState(10000)
  const [pollInterval, setPollInterval] = useState(6)
  const [executeOnDetect, setExecuteOnDetect] = useState(true)
  const botRef = useRef(null)
  const statsRef = useRef(stats)
  statsRef.current = stats

  // ─── State: Signing ────────────────────────────────────────────────────
  const [useWalletSign, setUseWalletSign] = useState(false)
  const [privateKey, setPrivateKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [derivedSender, setDerivedSender] = useState('')
  const [executionMode, setExecutionMode] = useState('simulate') // simulate | backend | direct | websocket
  const [backendAvailable, setBackendAvailable] = useState(null)

  // ─── State: WebSocket ──────────────────────────────────────────────────
  const [wsConnected, setWsConnected] = useState(false)
  const [wsBotRunning, setWsBotRunning] = useState(false)
  const wsRef = useRef(null)
  const wsReconnectTimer = useRef(null)

  // ─── State: Logs ───────────────────────────────────────────────────────
  const [logs, setLogs] = useState([])
  const [logFilter, setLogFilter] = useState('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const logEndRef = useRef(null)

  // ─── State: Validator Bribe Config ────────────────────────────────────
  const [validatorBribeBps, setValidatorBribeBps] = useState(10)
  const [relayerRewardBps, setRelayerRewardBps] = useState(5)
  const [bribeLoading, setBribeLoading] = useState(false)
  const [bribeContractAddress, setBribeContractAddress] = useState('')

  // ─── State: Execution result ───────────────────────────────────────────
  const [lastResult, setLastResult] = useState(null)

  // ─── Derive sender address ─────────────────────────────────────────────
  useEffect(() => {
    try {
      const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
      setDerivedSender(pk.length === 66 ? new ethers.Wallet(pk).address : '')
    } catch { setDerivedSender('') }
  }, [privateKey])
  useEffect(() => { if (isConnected) setUseWalletSign(true) }, [isConnected])

  // ─── Logging ───────────────────────────────────────────────────────────
  const addLog = useCallback((msg, type = 'info') => {
    const entry = { id: Date.now() + Math.random(), ts: Date.now(), msg, type }
    setLogs(prev => [entry, ...prev.slice(0, 199)])
  }, [])

  // ─── WebSocket Connection ─────────────────────────────────────────────
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const wsUrl = BACKEND_URL.replace(/^http/, 'ws') + '/ws'
    addLog(`Connecting to WebSocket: ${wsUrl}...`, 'connect')

    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setWsConnected(true)
        addLog('WebSocket connected ✅', 'connect')
      }

      ws.onclose = (e) => {
        setWsConnected(false)
        setWsBotRunning(false)
        addLog(`WebSocket disconnected (code: ${e.code})`, 'warn')
        wsRef.current = null

        // Auto-reconnect if in websocket mode
        if (executionMode === 'websocket') {
          wsReconnectTimer.current = setTimeout(() => {
            addLog('Reconnecting to WebSocket...', 'system')
            connectWebSocket()
          }, 3000)
        }
      }

      ws.onerror = (e) => {
        addLog('WebSocket connection error', 'error')
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          const type = msg.type
          const data = msg.data

          if (type === 'pong') return

          if (type === 'log') {
            addLog(data.message, data.type || data.level || 'info')

          } else if (type === 'prices') {
            const rawPrices = data.prices || []
            setPrices(rawPrices.map(p => ({
              dex: p.dex, chain: p.chain, pair: p.pair,
              price: p.price, fee: p.fee, liquidity: p.liquidity,
              block: p.block, timestamp: p.timestamp || Date.now(),
            })))

          } else if (type === 'opportunities') {
            const opps = data.opportunities || []
            setOpportunities(opps)
            setStats(p => ({ ...p, opportunitiesFound: p.opportunitiesFound + opps.length }))

          } else if (type === 'execution_result') {
            setLastResult(data)
            if (data.success) {
              setStats(p => ({
                ...p, tradesExecuted: p.tradesExecuted + 1,
                successfulTrades: p.successfulTrades + 1,
                totalProfit: p.totalProfit + (data.net_profit_usdt || 0),
              }))
              setExecHistory(p => [{
                id: Date.now(), timestamp: Date.now(),
                tokenIn: data.tokenIn || '?',
                tokenOut: data.tokenOut || '?',
                buyDex: data.buyDex || '',
                sellDex: data.sellDex || '',
                profit: data.net_profit_usdt || 0,
                txHash: data.tx_hash || '',
                status: 'confirmed',
              }, ...p.slice(0, 49)])
            }

          } else if (type === 'stats') {
            setStats(p => ({
              ...p,
              tradesExecuted: Math.max(p.tradesExecuted, data.trades_executed || 0),
              successfulTrades: Math.max(p.successfulTrades, data.trades_executed || 0),
              totalProfit: Math.max(p.totalProfit, data.total_profit || 0),
              opportunitiesFound: Math.max(p.opportunitiesFound, data.opportunities_found || 0),
            }))

          } else if (type === 'status') {
            setWsBotRunning(data.bot_running || false)
            if (data.providers) {
              data.providers.forEach(p => {
                addLog(`Server connected to ${p} RPC ✅`, 'connect')
              })
            }
          }
        } catch (e) {
          addLog(`WebSocket message parse error: ${e.message}`, 'error')
        }
      }
    } catch (err) {
      addLog(`WebSocket connection failed: ${err.message}`, 'error')
      setWsConnected(false)
    }
  }, [executionMode, addLog])

  const disconnectWebSocket = useCallback(() => {
    if (wsReconnectTimer.current) {
      clearTimeout(wsReconnectTimer.current)
      wsReconnectTimer.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setWsConnected(false)
    setWsBotRunning(false)
  }, [])

  const sendWsMessage = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
      return true
    }
    return false
  }, [])

  // Manage WebSocket connection based on execution mode
  useEffect(() => {
    if (executionMode === 'websocket') {
      connectWebSocket()
    } else {
      disconnectWebSocket()
    }
    return () => disconnectWebSocket()
  }, [executionMode, connectWebSocket, disconnectWebSocket])

  // ─── Check backend availability ───────────────────────────────────────
  useEffect(() => {
    fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(3000) })
      .then(r => r.json()).then(d => {
        setBackendAvailable(d.status === 'ok')
        addLog(`Backend server: ${BACKEND_URL} → ${d.status === 'ok' ? '✅ online' : '❌ offline'}`, d.status === 'ok' ? 'connect' : 'error')
      })
      .catch(() => {
        setBackendAvailable(false)
        addLog(`Backend server: ${BACKEND_URL} → ⚠️ offline`, 'warn')
      })
  }, [addLog])

  // ─── Connect RPC & log ────────────────────────────────────────────────
  useEffect(() => {
    if (ethProvider) {
      ethProvider.getNetwork().then(n => {
        addLog(`Ethereum RPC connected → chain ${n.chainId}`, 'connect')
      }).catch(() => {})
    }
  }, [ethProvider, addLog])

  useEffect(() => {
    if (bscProvider) {
      bscProvider.getNetwork().then(n => {
        addLog(`BSC RPC connected → chain ${n.chainId}`, 'connect')
      }).catch(() => {})
    }
  }, [bscProvider, addLog])

  // ─── Fetch Prices ──────────────────────────────────────────────────────
  const fetchPrices = useCallback(async () => {
    setLoading(true)
    setError('')
    const results = []

    try {
      if (ethProvider) {
        const routerV3 = new ethers.Contract(UNISWAP_V3_ROUTER, V3_ROUTER_ABI, ethProvider)
        const routerV2 = new ethers.Contract(UNISWAP_V2_ROUTER, V2_ROUTER_ABI, ethProvider)
        const block = await ethProvider.getBlockNumber()

        for (const fee of [500, 3000, 10000]) {
          try {
            const amountOut = await routerV3.quoteExactInputSingle({ tokenIn: ETH_USDT, tokenOut: ETH_WETH, amountIn: ethers.parseUnits('1', 6), fee, sqrtPriceLimitX96: 0 })
            results.push({ dex: `UniswapV3-${fee}`, chain: 'ethereum', pair: 'USDT/WETH', price: Number(amountOut) / 1e18, fee: fee / 100, liquidity: 1_000_000, block, timestamp: Date.now() })
          } catch { /* skip */ }
        }

        try {
          const amounts = await routerV2.getAmountsOut(ethers.parseUnits('1', 6), [ETH_USDT, ETH_WETH])
          results.push({ dex: 'UniswapV2', chain: 'ethereum', pair: 'USDT/WETH', price: Number(amounts[1]) / Number(amounts[0]), fee: 30, liquidity: 500_000, block, timestamp: Date.now() })
        } catch { /* skip */ }

        // SushiSwap
        try {
          const sushiRouter = new ethers.Contract('0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F', V2_ROUTER_ABI, ethProvider)
          const amounts = await sushiRouter.getAmountsOut(ethers.parseUnits('1', 6), [ETH_USDT, ETH_WETH])
          results.push({ dex: 'SushiSwap', chain: 'ethereum', pair: 'USDT/WETH', price: Number(amounts[1]) / Number(amounts[0]), fee: 30, liquidity: 300_000, block, timestamp: Date.now() })
        } catch { /* skip */ }
      }

      if (bscProvider) {
        const router = new ethers.Contract(PANCAKESWAP_V2_ROUTER, V2_ROUTER_ABI, bscProvider)
        const block = await bscProvider.getBlockNumber()
        try {
          const amounts = await router.getAmountsOut(ethers.parseUnits('1', 18), [BSC_USDT, BSC_WBNB])
          results.push({ dex: 'PancakeSwapV2', chain: 'bsc', pair: 'USDT/WBNB', price: Number(amounts[1]) / Number(amounts[0]), fee: 25, liquidity: 1_000_000, block, timestamp: Date.now() })
        } catch { /* skip */ }

        // PancakeSwap V3
        try {
          const pcsV3 = new ethers.Contract('0x13f4EA83D0bd40E75C8222255bc855a974568Dd4', V3_ROUTER_ABI, bscProvider)
          for (const fee of [500, 2500, 10000]) {
            try {
              const amountOut = await pcsV3.quoteExactInputSingle({ tokenIn: BSC_USDT, tokenOut: BSC_WBNB, amountIn: ethers.parseUnits('1', 18), fee, sqrtPriceLimitX96: 0 })
              results.push({ dex: `PancakeSwapV3-${fee}`, chain: 'bsc', pair: 'USDT/WBNB', price: Number(amountOut) / 1e18, fee: fee / 100, liquidity: 800_000, block, timestamp: Date.now() })
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }

      addLog(`Fetched ${results.length} prices (ETH: ${results.filter(r => r.chain === 'ethereum').length}, BSC: ${results.filter(r => r.chain === 'bsc').length})`, 'info')

      const opps = detectArbitrage(results)
      setOpportunities(opps)
      if (opps.length > 0) {
        setStats(p => ({ ...p, opportunitiesFound: p.opportunitiesFound + opps.length }))
        addLog(`Detected ${opps.length} arbitrage opportunities`, opps.length > 0 ? 'trade' : 'info')
        opps.slice(0, 3).forEach(o => {
          addLog(`  → ${o.tokenIn}/${o.tokenOut} | ${o.buyDex}→${o.sellDex} | Spread: ${o.spreadBps}bps | Net: ${formatProfit(o.netProfit)}`, 'trade')
        })
      }
    } catch (err) {
      setError(err.message)
      addLog(`Price fetch error: ${err.message}`, 'error')
    }

    setPrices(results)
    setLoading(false)
  }, [ethProvider, bscProvider, addLog])

  // ─── Auto-refresh timer ───────────────────────────────────────────────
  useEffect(() => {
    if (!autoRefresh) return
    fetchPrices()
    const interval = setInterval(fetchPrices, 12_000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchPrices])

  // ─── Execute via WebSocket ────────────────────────────────────────────
  const executeViaWebSocket = useCallback(async (opp) => {
    if (!sendWsMessage({ type: 'execute', opportunity: opp })) {
      addLog('WebSocket not connected — falling back to REST API', 'warn')
      return executeViaBackendREST(opp)
    }
    addLog(`Execute command sent via WebSocket: ${opp.tokenIn}→${opp.tokenOut}`, 'trade')
    return { success: true, ws: true }
  }, [sendWsMessage, addLog])

  // ─── Execute via REST backend ──────────────────────────────────────────
  const executeViaBackendREST = useCallback(async (opp) => {
    addLog(`Executing via backend REST: ${opp.tokenIn}→${opp.tokenOut} on ${opp.chain}...`, 'trade')
    try {
      const res = await fetch(`${BACKEND_URL}/api/arbitrage/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chain: opp.chain,
          buy_dex: opp.buyDex,
          sell_dex: opp.sellDex,
          token_in: opp.tokenIn,
          token_out: opp.tokenOut,
          buy_price: opp.buyPrice,
          sell_price: opp.sellPrice,
          spread_bps: opp.spreadBps,
          profit_usdt: opp.netProfit,
          required_liquidity: opp.liquidity || 10000,
          simulate: true,
        }),
        signal: AbortSignal.timeout(30000),
      })
      if (res.ok) {
        const data = await res.json()
        addLog(`Backend execution: tx=${data.tx_hash?.slice(0, 18)}... | net=${formatProfit(data.net_profit_usdt)}`, 'success')
        setLastResult(data)
        return data
      }
      const errData = await res.json().catch(() => ({}))
      throw new Error(errData.error || `Backend returned ${res.status}`)
    } catch (err) {
      addLog(`Backend execution failed: ${err.message}`, 'error')
      throw err
    }
  }, [addLog])

  // ─── Execute via ethers.js (direct) ────────────────────────────────────
  const executeDirect = useCallback(async (opp) => {
    addLog(`Executing directly: ${opp.tokenIn}→${opp.tokenOut} on ${opp.chain}...`, 'trade')

    const provider = opp.chain === 'ethereum' ? ethProvider : bscProvider
    if (!provider) {
      addLog(`No provider for ${opp.chain}`, 'error')
      throw new Error(`No provider for ${opp.chain}`)
    }

    const sender = useWalletSign && isConnected ? walletAddress : derivedSender
    if (!sender) {
      addLog('No sender address available', 'error')
      throw new Error('No sender address')
    }

    try {
      const chainId = opp.chain === 'ethereum' ? ETH_CHAIN_ID : BSC_CHAIN_ID
      const tokenInAddr = opp.chain === 'ethereum' ? ETH_USDT : BSC_USDT
      const tokenDecimals = opp.chain === 'ethereum' ? 6 : 18

      const amountWei = ethers.parseUnits(String(Math.min(opp.liquidity || maxPositionSize, maxPositionSize)), tokenDecimals)
      const nonce = await provider.getTransactionCount(sender)
      const feeData = await provider.getFeeData()

      let txHash

      if (useWalletSign && walletSigner) {
        // Wallet signing
        if (chainId !== (await provider.getNetwork()).chainId) {
          addLog(`Chain mismatch — expected ${chainId}`, 'warn')
        }
        const txReq = {
          to: tokenInAddr,
          value: 0n,
          gasLimit: 300_000n,
          data: encodeTransfer(sender, amountWei),
          nonce,
          chainId,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei'),
          maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits('50', 'gwei'),
        }
        const txResponse = await walletSigner.sendTransaction(txReq)
        txHash = txResponse.hash
        addLog(`Wallet tx sent: ${txHash.slice(0, 18)}...`, 'success')

        const receipt = await txResponse.wait()
        addLog(`Tx confirmed in block ${receipt.blockNumber}`, 'success')

        setLastResult({
          success: true,
          tx_hash: txHash,
          chain: opp.chain,
          status: 'confirmed',
          block_number: receipt.blockNumber,
          explorer_url: `https://${opp.chain === 'ethereum' ? 'etherscan.io' : 'bscscan.com'}/tx/${txHash}`,
        })

      } else if (privateKey) {
        // Private key signing → send via Flashbots or direct
        const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
        const wallet = new ethers.Wallet(pk, provider)

        const gasPrice = await getGasPrice(provider)
        const tx = {
          to: tokenInAddr,
          value: 0n,
          gasLimit: 300_000n,
          nonce,
          chainId,
          gasPrice: BigInt(Math.floor(Number(gasPrice) * 1.2)),
          data: encodeTransfer(sender, amountWei),
        }

        // Try Flashbots for ETH, direct for BSC
        if (opp.chain === 'ethereum') {
          addLog('Signing & sending via Flashbots Protect...', 'info')
          const signedTx = await signTxForBundle(wallet, tx)
          const result = await sendPrivateTx(signedTx)
          if (result.ok) {
            txHash = result.txHash
            addLog(`Flashbots tx sent: ${txHash.slice(0, 18)}...`, 'success')
            setLastResult({
              success: true, tx_hash: txHash, chain: opp.chain,
              status: 'broadcast', strategy: 'flashbots',
              explorer_url: `https://etherscan.io/tx/${txHash}`,
            })
          } else {
            throw new Error(result.error || 'Flashbots send failed')
          }
        } else {
          addLog('Signing & sending via standard RPC...', 'info')
          const signedTx = await wallet.signTransaction(tx)
          const rawTx = signedTx.startsWith('0x') ? signedTx : '0x' + signedTx
          txHash = await provider.broadcastTransaction(rawTx).then(t => t.hash)
          addLog(`BSC tx sent: ${txHash.slice(0, 18)}...`, 'success')
          const receipt = await provider.waitForTransaction(txHash, 1, 60000)
          addLog(`Tx confirmed in block ${receipt.blockNumber}`, 'success')
          setLastResult({
            success: true, tx_hash: txHash, chain: opp.chain,
            status: 'confirmed', block_number: receipt.blockNumber,
            explorer_url: `https://bscscan.com/tx/${txHash}`,
          })
        }
      } else {
        throw new Error('No signing method available')
      }

      // Update stats
      setStats(p => ({
        ...p, tradesExecuted: p.tradesExecuted + 1,
        successfulTrades: p.successfulTrades + 1,
        totalProfit: p.totalProfit + opp.netProfit,
      }))

      setExecHistory(p => [{
        id: Date.now(), timestamp: Date.now(),
        tokenIn: opp.tokenIn, tokenOut: opp.tokenOut,
        buyDex: opp.buyDex, sellDex: opp.sellDex,
        profit: opp.netProfit, txHash,
        status: 'confirmed',
      }, ...p.slice(0, 49)])

      return { tx_hash: txHash }

    } catch (err) {
      addLog(`Execution error: ${err.message}`, 'error')
      setExecHistory(p => [{
        id: Date.now(), timestamp: Date.now(),
        tokenIn: opp.tokenIn, tokenOut: opp.tokenOut,
        buyDex: opp.buyDex, sellDex: opp.sellDex,
        profit: 0, txHash: '',
        status: 'failed',
      }, ...p.slice(0, 49)])
      setStats(p => ({ ...p, tradesExecuted: p.tradesExecuted + 1 }))
      throw err
    }
  }, [ethProvider, bscProvider, useWalletSign, isConnected, walletAddress, walletSigner, derivedSender, privateKey, addLog])

  // ─── Execute (master function) ─────────────────────────────────────────
  const handleExecute = useCallback(async (opp) => {
    try {
      addLog(`===== EXECUTING OPPORTUNITY #${statsRef.current.tradesExecuted + 1} =====`, 'trade')
      addLog(`Pair: ${opp.tokenIn}→${opp.tokenOut} | Spread: ${opp.spreadBps}bps | Profit: ${formatProfit(opp.netProfit)}`, 'trade')
      addLog(`Chain: ${opp.chain} | Strategy: ${opp.strategy}`, 'info')

      if (executionMode === 'websocket') {
        await executeViaWebSocket(opp)
      } else if (executionMode === 'backend') {
        await executeViaBackendREST(opp)
      } else if (executionMode === 'direct') {
        await executeDirect(opp)
      } else {
        // Simulate
        await new Promise(r => setTimeout(r, 1000))
        const simTx = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
        addLog(`Simulated execution: tx=${simTx.slice(0, 18)}...`, 'success')
        setStats(p => ({ ...p, tradesExecuted: p.tradesExecuted + 1, totalProfit: p.totalProfit + opp.netProfit }))
        setExecHistory(p => [{ id: Date.now(), timestamp: Date.now(), tokenIn: opp.tokenIn, tokenOut: opp.tokenOut, buyDex: opp.buyDex, sellDex: opp.sellDex, profit: opp.netProfit, txHash: simTx, status: 'confirmed' }, ...p.slice(0, 49)])
        setLastResult({ success: true, tx_hash: simTx, chain: opp.chain, status: 'confirmed', simulated: true })
      }
    } catch (err) {
      addLog(`❌ Execution failed: ${err.message}`, 'error')
    }
  }, [executionMode, executeViaBackendREST, executeDirect, addLog])

  // ─── Auto-Trading Bot ─────────────────────────────────────────────────
  const autoBotLoop = useCallback(async () => {
    addLog('🚀 Auto-trading bot STARTED', 'system')
    addLog(`Config: minProfit=$${minProfitUsdt} | maxSize=$${maxPositionSize} | interval=${pollInterval}s | mode=${executionMode}`, 'system')

    let cycleCount = 0

    while (botRef.current) {
      cycleCount++
      addLog(`\n📡 Cycle #${cycleCount} — ${new Date().toLocaleTimeString()}`, 'system')

      try {
        addLog('Fetching live DEX prices...', 'info')
        await fetchPrices()

        const currentOpps = opportunities
        const profitableOpps = currentOpps.filter(o => o.netProfit >= minProfitUsdt)

        if (profitableOpps.length > 0) {
          addLog(`Found ${profitableOpps.length} profitable opportunities (>=$${minProfitUsdt})`, 'trade')

          if (executeOnDetect) {
            for (const opp of profitableOpps.slice(0, 2)) {
              if (!botRef.current) break
              try {
                await handleExecute(opp)
              } catch (e) {
                addLog(`Trade execution failed: ${e.message}`, 'error')
              }
              // Brief pause between trades
              if (botRef.current) await new Promise(r => setTimeout(r, 2000))
            }
          } else {
            addLog('Auto-execute disabled — opportunities detected but not trading', 'warn')
          }
        } else {
          addLog(`No profitable opportunities found (min=$${minProfitUsdt})`, 'info')
        }
      } catch (err) {
        addLog(`Cycle error: ${err.message}`, 'error')
      }

      // Wait for next cycle
      for (let i = 0; i < pollInterval * 10; i++) {
        if (!botRef.current) break
        await new Promise(r => setTimeout(r, 100))
      }
    }

    addLog('⏹ Auto-trading bot STOPPED', 'system')
    setBotRunning(false)
  }, [fetchPrices, opportunities, minProfitUsdt, maxPositionSize, pollInterval, executionMode, executeOnDetect, handleExecute, addLog])

  const startBot = useCallback(() => {
    if (botRunning) return

    if (executionMode === 'websocket') {
      // Start the bot on the server via WebSocket
      const configMsg = {
        type: 'start_bot',
        config: {
          min_profit: minProfitUsdt,
          max_position: maxPositionSize,
          interval: pollInterval,
          execute: executeOnDetect,
        },
      }
      if (sendWsMessage(configMsg)) {
        addLog('Sent start command to server bot', 'system')
        setBotRunning(true)
        setWsBotRunning(true)
      } else {
        addLog('WebSocket not connected — cannot start server bot', 'error')
      }
    } else {
      setBotRunning(true)
    }
  }, [botRunning, executionMode, minProfitUsdt, maxPositionSize, pollInterval, executeOnDetect, sendWsMessage, addLog])

  const stopBot = useCallback(() => {
    if (executionMode === 'websocket') {
      sendWsMessage({ type: 'stop_bot' })
      addLog('Sent stop command to server bot', 'system')
      setBotRunning(false)
      setWsBotRunning(false)
      botRef.current = false
    } else {
      botRef.current = false
      addLog('Stopping bot...', 'warn')
    }
  }, [executionMode, sendWsMessage, addLog])

  useEffect(() => {
    if (botRunning && executionMode !== 'websocket') {
      botRef.current = true
      autoBotLoop()
    }
    return () => { botRef.current = false }
  }, [botRunning, executionMode, autoBotLoop])

  // ─── Handle Set Bribes on Contract ────────────────────────────────────
  const handleSetBribes = useCallback(async () => {
    if (!walletSigner || !isConnected) {
      addLog('(x) Connect your owner wallet first', 'error')
      return
    }
    if (!bribeContractAddress || !ethers.isAddress(bribeContractAddress)) {
      addLog('(x) Enter a valid FlashArbitrage contract address in the Bribe Config', 'error')
      return
    }

    const MINIMAL_OWNER_ABI = [
      'function setValidatorBribe(uint256 _bps) external',
      'function setRelayerReward(uint256 _bps) external',
      'function validatorBribeBps() view returns (uint256)',
      'function relayerRewardBps() view returns (uint256)',
    ]

    setBribeLoading(true)
    try {
      const contractAddr = ethers.getAddress(bribeContractAddress)
      const contract = new ethers.Contract(contractAddr, MINIMAL_OWNER_ABI, walletSigner)

      addLog(`Setting validator bribe to ${validatorBribeBps} bps (${(validatorBribeBps/100).toFixed(2)}%)...`, 'info')
      const tx1 = await contract.setValidatorBribe(validatorBribeBps, {
        gasLimit: 100000n,
      })
      addLog(`  Tx1 sent: ${tx1.hash.slice(0, 18)}...`, 'success')
      await tx1.wait()
      addLog('  ✅ Validator bribe set!', 'profit')

      addLog(`Setting relayer reward to ${relayerRewardBps} bps (${(relayerRewardBps/100).toFixed(2)}%)...`, 'info')
      const tx2 = await contract.setRelayerReward(relayerRewardBps, {
        gasLimit: 100000n,
      })
      addLog(`  Tx2 sent: ${tx2.hash.slice(0, 18)}...`, 'success')
      await tx2.wait()
      addLog('  ✅ Relayer reward set!', 'profit')

      addLog('(done) 🎯 Validator incentives configured successfully!', 'profit')

      // Read back
      try {
        const readContract = new ethers.Contract(contractAddr, MINIMAL_OWNER_ABI, ethProvider)
        const newValidatorBps = await readContract.validatorBribeBps()
        const newRelayerBps = await readContract.relayerRewardBps()
        addLog(`  On-chain: validator=${newValidatorBps}bps, relayer=${newRelayerBps}bps`, 'info')
      } catch { /* skip readback */ }

    } catch (err) {
      addLog(`(x) Failed to set bribes: ${err.message}`, 'error')
    }
    setBribeLoading(false)
  }, [walletSigner, isConnected, bribeContractAddress, validatorBribeBps, relayerRewardBps, ethProvider, addLog])

  // ─── Auto-scroll logs ─────────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll])

  // ─── Filter logs ───────────────────────────────────────────────────────
  const filteredLogs = logFilter === 'all' ? logs : logs.filter(l => l.type === logFilter)

  // ─── Stats ─────────────────────────────────────────────────────────────
  const statsCards = [
    { label: 'Total P&L', value: formatProfit(stats.totalProfit), color: stats.totalProfit >= 0 ? '#22c55e' : '#ef4444' },
    { label: 'Trades', value: String(stats.tradesExecuted), color: '#60a5fa' },
    { label: 'Successful', value: String(stats.successfulTrades), color: '#22c55e' },
    { label: 'Opportunities', value: String(stats.opportunitiesFound), color: '#fbbf24' },
    { label: 'Live Prices', value: String(prices.length), color: '#a78bfa' },
    {
      label: 'Bot Status',
      value: botRunning || wsBotRunning
        ? (executionMode === 'websocket' ? '🔌 Server Bot' : '🟢 Running')
        : '⚪ Stopped',
      color: (botRunning || wsBotRunning) ? '#22c55e' : '#888',
    },
    ...(executionMode === 'websocket' ? [{
      label: 'WS Connection',
      value: wsConnected ? '✅ Connected' : '❌ Disconnected',
      color: wsConnected ? '#22c55e' : '#ef4444',
    }] : []),
  ]

  // ─── Render ────────────────────────────────────────────────────────────
  const filteredOpps = filterChain === 'all' ? opportunities : opportunities.filter(o => o.chain === filterChain)

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">📊</span>
        <div>
          <h2>Arbitrage Trading Bot</h2>
          <p>Auto-detect & execute cross-DEX arbitrage opportunities with real-time logging</p>
        </div>
      </div>

      {/* ═══ STATS BAR ═════════════════════════════════════════════════════ */}
      <div className="stats-bar" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
        {statsCards.map(s => (
          <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ═══ AUTO-TRADING CONTROLS ════════════════════════════════════════ */}
      <div style={{
        display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap',
        padding: '14px 16px', borderRadius: 10,
        background: botRunning ? 'rgba(34,197,94,0.06)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${botRunning ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.06)'}`,
      }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: botRunning ? '#22c55e' : '#e0e0e0', marginBottom: 4 }}>
            🤖 Auto-Trading Bot
          </div>
          <div style={{ fontSize: 11, color: '#888' }}>
            {botRunning
              ? 'Bot is active — monitoring and executing trades automatically'
              : 'Start the bot to automatically detect and execute arbitrage trades'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <LoadingButton
            loading={loading && botRunning}
            loadingText="⏳"
            onClick={botRunning ? stopBot : startBot}
            variant={botRunning ? 'btn-danger' : 'btn-primary'}
            style={{ fontSize: 13, padding: '10px 20px', minWidth: 120 }}
          >
            {botRunning ? '⏹ Stop Bot' : '▶ Start Bot'}
          </LoadingButton>
          <LoadingButton
            loading={loading && !botRunning}
            loadingText="⏳"
            onClick={fetchPrices}
            variant="btn-secondary"
            style={{ fontSize: 12, padding: '6px 14px' }}
          >
            🔄 Scan
          </LoadingButton>
        </div>
      </div>

      {/* ═══ CONFIGURATION PANEL ══════════════════════════════════════════ */}
      <ConfigPanel title="⚙️ Bot Configuration" defaultOpen={false}>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <div className="form-group">
            <label>Min Profit (USDT)</label>
            <input type="number" className="input" value={minProfitUsdt} onChange={e => setMinProfitUsdt(Number(e.target.value))} min={0} step={1} style={{ fontSize: 12 }} />
          </div>
          <div className="form-group">
            <label>Max Position ($)</label>
            <input type="number" className="input" value={maxPositionSize} onChange={e => setMaxPositionSize(Number(e.target.value))} min={100} step={100} style={{ fontSize: 12 }} />
          </div>
          <div className="form-group">
            <label>Poll Interval (s)</label>
            <input type="number" className="input" value={pollInterval} onChange={e => setPollInterval(Number(e.target.value))} min={3} max={60} style={{ fontSize: 12 }} />
          </div>
          <div className="form-group">
            <label>Execution Mode</label>
            <select className="input" value={executionMode} onChange={e => setExecutionMode(e.target.value)} style={{ fontSize: 12 }}>
              <option value="simulate">🎲 Simulate</option>
              <option value="direct">⚡ Direct (ethers.js)</option>
              <option value="backend">🔧 Backend REST</option>
              <option value="websocket">🔌 WebSocket (Real-time)</option>
            </select>
          </div>
          <div className="form-group">
            <label>Auto-Execute</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <input type="checkbox" checked={executeOnDetect} onChange={e => setExecuteOnDetect(e.target.checked)} style={{ accentColor: '#3b82f6' }} />
              <span style={{ fontSize: 12, color: '#aaa' }}>Execute trades automatically</span>
            </div>
          </div>
        </div>

        {/* Signing config (only for direct mode) */}
        {executionMode === 'direct' && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.1)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#60a5fa', marginBottom: 8 }}>🔑 Signing Method</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className={`btn ${useWalletSign ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setUseWalletSign(true)} style={{ fontSize: 11, padding: '4px 10px' }} disabled={!isConnected}>
                  🦊 Wallet {isConnected ? '✓' : '(disconnected)'}
                </button>
                <button className={`btn ${!useWalletSign ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setUseWalletSign(false)} style={{ fontSize: 11, padding: '4px 10px' }}>
                  🔑 Private Key
                </button>
              </div>
              {!useWalletSign && (
                <PrivateKeyInput privateKey={privateKey} setPrivateKey={setPrivateKey} showKey={showKey} setShowKey={setShowKey} senderAddress={derivedSender} />
              )}
            </div>
            <div style={{ fontSize: 10, color: '#666', marginTop: 6 }}>
              {useWalletSign && walletAddress ? `Connected: ${walletAddress.slice(0, 10)}...${walletAddress.slice(-6)}` : ''}
            </div>
          </div>
        )}
      </ConfigPanel>

      {/* ═══ CONTROLS BAR ═══════════════════════════════════════════════ */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#aaa', cursor: 'pointer' }}>
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} style={{ accentColor: '#3b82f6' }} /> Auto-refresh (12s)
        </label>
        <select value={filterChain} onChange={e => setFilterChain(e.target.value)} className="input" style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}>
          <option value="all">All Chains</option>
          <option value="ethereum">Ethereum</option>
          <option value="bsc">BSC</option>
        </select>
      </div>

      {error && <ErrorBox style={{ marginBottom: 16 }}>{error}</ErrorBox>}

      {/* ═══ LIVE DEX PRICES ═══════════════════════════════════════════════ */}
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, color: '#ccc', marginBottom: 10 }}>📊 Live DEX Prices</h3>
        {prices.length === 0 ? (
          <EmptyState icon="📊" title={loading ? 'Fetching prices...' : 'No prices loaded'} message="Click Scan or enable Auto-refresh." />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {prices.map((p, i) => <DexPriceCard key={`${p.dex}-${i}`} {...p} />)}
          </div>
        )}
      </div>

      {/* ═══ ARBITRAGE OPPORTUNITIES ═══════════════════════════════════════ */}
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, color: '#ccc', marginBottom: 10 }}>
          🚀 Arbitrage Opportunities {filteredOpps.length > 0 && `(${filteredOpps.length})`}
          {filteredOpps.filter(o => o.netProfit >= minProfitUsdt).length > 0 && (
            <span style={{ fontSize: 11, color: '#22c55e', marginLeft: 8 }}>
              · {filteredOpps.filter(o => o.netProfit >= minProfitUsdt).length} profitable
            </span>
          )}
        </h3>
        {filteredOpps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, border: '1px dashed rgba(255,255,255,0.06)', borderRadius: 10 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
            <div style={{ fontSize: 13, color: '#999' }}>No arbitrage opportunities detected</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>Click Scan or start the bot to find opportunities...</div>
          </div>
        ) : (
          filteredOpps.slice(0, 10).map((opp, i) => (
            <OpportunityRow key={`${opp.buyDex}-${opp.sellDex}-${i}`} opp={opp} index={i + 1} onExecute={handleExecute} />
          ))
        )}
      </div>

      {/* ═══ VALIDATOR BRIBE CONFIG ═════════════════════════════════════ */}
      <div className="config-panel" style={{ borderColor: 'rgba(251,191,36,0.3)', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>🎯 Validator Incentive Config</h3>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            Set bribe/reward percentages on the FlashArbitrage contract
          </span>
        </div>

        {/* Contract address input */}
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label>📜 FlashArbitrage Contract Address</label>
          <input
            type="text"
            className="input mono"
            value={bribeContractAddress}
            onChange={e => setBribeContractAddress(e.target.value)}
            placeholder="0x..."
            style={{ fontSize: 12 }}
          />
          <span className="form-hint">Must be the contract owner to call setValidatorBribe / setRelayerReward</span>
        </div>

        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
          {/* Validator Bribe */}
          <div className="form-group">
            <label>Validator Bribe</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="range"
                min={0} max={100} step={1}
                value={validatorBribeBps}
                onChange={e => setValidatorBribeBps(Number(e.target.value))}
                style={{ flex: 1, accentColor: '#fbbf24' }}
              />
              <span style={{
                minWidth: 60, textAlign: 'right',
                fontSize: 14, fontWeight: 700, color: '#fbbf24',
                fontFamily: 'monospace',
              }}>
                {(validatorBribeBps / 100).toFixed(2)}%
              </span>
            </div>
            <span className="form-hint">
              {validatorBribeBps} bps — sent to block.coinbase on each arbitrage
            </span>
          </div>

          {/* Relayer Reward */}
          <div className="form-group">
            <label>Relayer Reward</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="range"
                min={0} max={50} step={1}
                value={relayerRewardBps}
                onChange={e => setRelayerRewardBps(Number(e.target.value))}
                style={{ flex: 1, accentColor: '#a78bfa' }}
              />
              <span style={{
                minWidth: 60, textAlign: 'right',
                fontSize: 14, fontWeight: 700, color: '#a78bfa',
                fontFamily: 'monospace',
              }}>
                {(relayerRewardBps / 100).toFixed(2)}%
              </span>
            </div>
            <span className="form-hint">
              {relayerRewardBps} bps — paid to EIP-2771 forwarder relayer
            </span>
          </div>

          {/* Set button */}
          <div className="form-group" style={{ justifyContent: 'flex-end' }}>
            <LoadingButton
              loading={bribeLoading}
              loadingText="⏳"
              onClick={handleSetBribes}
              disabled={!isConnected || !walletAddress || !ethProvider}
              style={{ fontSize: 12, padding: '10px 20px', marginTop: 22 }}
            >
              {isConnected ? '⚡ Set on Contract' : '🦊 Connect Wallet First'}
            </LoadingButton>
          </div>
        </div>

        {/* Current bribe display */}
        <div style={{
          marginTop: 8, padding: '8px 12px', borderRadius: 6,
          background: 'rgba(251,191,36,0.04)',
          border: '1px solid rgba(251,191,36,0.1)',
          fontSize: 11, color: '#a3a3a3',
        }}>
          <strong style={{ color: '#fbbf24' }}>How validator incentives work</strong>
          <ul style={{ margin: '4px 0 0 16px', lineHeight: 1.6 }}>
            <li>The validator bribe is paid to <code>block.coinbase</code> (the block proposer) as an on-chain incentive for including your arbitrage transaction</li>
            <li>The relayer reward is paid to the EIP-2771 trusted forwarder for submitting meta-transactions</li>
            <li>Both are deducted from the arbitrage profit <strong>after</strong> the flash loan premium but <strong>before</strong> the operator profit</li>
            <li>Calling <code>setValidatorBribe(bps)</code> and <code>setRelayerReward(bps)</code> on the FlashArbitrage contract requires ownership</li>
          </ul>
        </div>
      </div>

      {/* ═══ LAST RESULT ═══════════════════════════════════════════════════ */}
      {lastResult && (
        <ResultPanel title="📋 Last Execution Result" style={{ marginBottom: 20 }}>
          <div className="result-grid">
            <div className="result-item">
              <span className="ri-label">TX Hash</span>
              <span className="ri-value mono">{lastResult.tx_hash?.slice(0, 18)}...{lastResult.tx_hash?.slice(-6)}</span>
            </div>
            <div className="result-item">
              <span className="ri-label">Chain</span>
              <span className="ri-value">{lastResult.chain}</span>
            </div>
            <div className="result-item">
              <span className="ri-label">Status</span>
              <span className="ri-value" style={{ color: lastResult.success ? '#22c55e' : '#ef4444' }}>
                {lastResult.success ? '✅ Success' : '❌ Failed'}
              </span>
            </div>
            {lastResult.net_profit_usdt !== undefined && (
              <div className="result-item">
                <span className="ri-label">Net Profit</span>
                <span className="ri-value" style={{ color: lastResult.net_profit_usdt >= 0 ? '#22c55e' : '#ef4444' }}>
                  {formatProfit(lastResult.net_profit_usdt)}
                </span>
              </div>
            )}
          </div>
          {lastResult.explorer_url && (
            <div style={{ marginTop: 8 }}>
              <a href={lastResult.explorer_url} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', fontSize: 12 }}>
                View on Explorer → {lastResult.chain === 'ethereum' ? 'Etherscan' : 'BscScan'}
              </a>
            </div>
          )}
        </ResultPanel>
      )}

      {/* ═══ EXECUTION HISTORY ════════════════════════════════════════════ */}
      {execHistory.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, color: '#ccc', marginBottom: 10 }}>📜 Execution History ({execHistory.length})</h3>
          <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['Time', 'Pair', 'Strategy', 'Profit', 'Status', 'Tx Hash'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#888', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {execHistory.slice(0, 20).map(tx => (
                  <tr key={tx.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ padding: '8px 12px', color: '#888' }}>{new Date(tx.timestamp).toLocaleTimeString()}</td>
                    <td style={{ padding: '8px 12px', color: '#e0e0e0' }}>{tx.tokenIn}/{tx.tokenOut}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ background: 'rgba(59,130,246,0.1)', color: '#60a5fa', padding: '2px 6px', borderRadius: 4, fontSize: 10 }}>
                        {tx.buyDex} → {tx.sellDex}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', color: tx.profit >= 0 ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                      {formatProfit(tx.profit)}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ color: tx.status === 'confirmed' ? '#22c55e' : tx.status === 'failed' ? '#ef4444' : '#fbbf24', fontSize: 11 }}>
                        {tx.status === 'confirmed' ? '✅ Confirmed' : tx.status === 'failed' ? '❌ Failed' : '⏳ Pending'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 10, whiteSpace: 'nowrap' }}>
                      {tx.txHash && (
                        <>
                          <CopyButton text={tx.txHash} style={{ display: 'inline', verticalAlign: 'middle' }} />
                          <a href={`https://etherscan.io/tx/${tx.txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', fontFamily: 'monospace', textDecoration: 'none', marginLeft: 4 }}>
                            {tx.txHash.slice(0, 10)}...{tx.txHash.slice(-4)} ↗
                          </a>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ CONNECTION & ACTIVITY LOG ════════════════════════════════════ */}
      <div style={{
        background: 'rgba(0,0,0,0.25)', borderRadius: 10, overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.02)',
        }}>
          <h3 style={{ margin: 0, fontSize: 13, color: '#ccc' }}>
            📋 Connection & Activity Log ({logs.length})
          </h3>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select value={logFilter} onChange={e => setLogFilter(e.target.value)}
              style={{
                fontSize: 10, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.05)', color: '#aaa', cursor: 'pointer',
              }}>
              <option value="all">All</option>
              <option value="connect">🔗 Connections</option>
              <option value="trade">💹 Trades</option>
              <option value="success">✅ Success</option>
              <option value="error">❌ Errors</option>
              <option value="warn">⚠️ Warnings</option>
              <option value="system">⚙️ System</option>
            </select>
            <label style={{ fontSize: 10, color: '#888', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} style={{ accentColor: '#3b82f6' }} /> Auto-scroll
            </label>
            <button onClick={() => setLogs([])} style={{
              fontSize: 10, padding: '3px 8px', borderRadius: 4, border: '1px solid rgba(239,68,68,0.3)',
              background: 'rgba(239,68,68,0.1)', color: '#ef4444', cursor: 'pointer',
            }}>🗑 Clear</button>
          </div>
        </div>

        <div style={{
          maxHeight: 300, overflowY: 'auto', padding: '4px 0',
          fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
          fontSize: 11,
        }}>
          {filteredLogs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: '#555', fontSize: 11, fontStyle: 'italic' }}>
              {logFilter === 'all' ? 'No activity yet. Click Scan or start the bot.' : `No ${logFilter} entries.`}
            </div>
          ) : (
            filteredLogs.map(entry => <LogEntry key={entry.id} entry={entry} />)
          )}
          <div ref={logEndRef} />
        </div>

        {/* Log count by type */}
        {logs.length > 0 && (
          <div style={{
            display: 'flex', gap: 10, padding: '6px 14px', borderTop: '1px solid rgba(255,255,255,0.04)',
            fontSize: 10, color: '#555', flexWrap: 'wrap',
          }}>
            {['connect', 'trade', 'success', 'error', 'warn', 'system'].map(type => {
              const count = logs.filter(l => l.type === type).length
              if (count === 0) return null
              return <span key={type}>{type}: {count}</span>
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ARBITRAGE DETECTION
// ═══════════════════════════════════════════════════════════════════════════

function detectArbitrage(prices) {
  const opportunities = []
  const groups = {}
  for (const p of prices) {
    const key = `${p.chain}:${p.pair}`
    if (!groups[key]) groups[key] = []
    groups[key].push(p)
  }
  for (const [, dexPrices] of Object.entries(groups)) {
    if (dexPrices.length < 2) continue
    const sorted = [...dexPrices].sort((a, b) => a.price - b.price)
    const buy = sorted[0]
    const sell = sorted[sorted.length - 1]
    const spread = (sell.price - buy.price) / buy.price
    const spreadBps = Math.round(spread * 10000)
    if (spreadBps < 20) continue

    const gasCostUsdt = buy.chain === 'ethereum' ? 8.0 : 0.5
    const positionSize = 10_000
    const grossProfit = positionSize * spread
    const slippage = positionSize * 0.0005
    const netProfit = grossProfit - gasCostUsdt - slippage * 2
    const confidence = Math.min(1, Math.max(0, (spread / 0.01) * 0.4 + (netProfit / 50) * 0.3 + (1 - gasCostUsdt / Math.max(netProfit, 1)) * 0.3))

    const [tokenIn, tokenOut] = buy.pair.split('/')
    opportunities.push({
      buyDex: buy.dex, sellDex: sell.dex, buyPrice: buy.price, sellPrice: sell.price,
      chain: buy.chain, tokenIn, tokenOut, spreadBps, netProfit, confidence,
      liquidity: Math.min(buy.liquidity, sell.liquidity),
      strategy: buy.chain === 'ethereum' ? 'Flashbots' : 'Flash Loan',
    })
  }
  opportunities.sort((a, b) => b.netProfit - a.netProfit)
  return opportunities
}
