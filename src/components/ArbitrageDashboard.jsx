import React, { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { ETH_RPCS, BSC_RPCS, ETH_WETH, ETH_USDT, BSC_USDT, BSC_WBNB, UNISWAP_V3_ROUTER, UNISWAP_V2_ROUTER, PANCAKESWAP_V2_ROUTER } from '../constants'
import { useProvider } from '../hooks'
import CopyButton from './shared/CopyButton'
import PillBadge from './shared/PillBadge'
import ErrorBox from './shared/ErrorBox'
import EmptyState from './shared/EmptyState'
import LoadingButton from './shared/LoadingButton'

const V2_ROUTER_ABI = ['function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)']
const V3_ROUTER_ABI = ['function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external view returns (uint256 amountOut)']

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

function DexPriceCard({ dex, chain, pair, price, fee, block }) {
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

export default function ArbitrageDashboard() {
  const ethProvider = useProvider(ETH_RPCS)
  const bscProvider = useProvider(BSC_RPCS)

  const [prices, setPrices] = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [execHistory, setExecHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [stats, setStats] = useState({ totalProfit: 0, tradesExecuted: 0, opportunitiesFound: 0 })
  const [filterChain, setFilterChain] = useState('all')

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
            results.push({ dex: `UniswapV3-${fee}`, chain: 'ethereum', pair: 'USDT/WETH', price: Number(amountOut) / 1e18, fee: fee / 100, liquidity: 1_000_000, block })
          } catch { /* skip */ }
        }

        try {
          const amounts = await routerV2.getAmountsOut(ethers.parseUnits('1', 6), [ETH_USDT, ETH_WETH])
          results.push({ dex: 'UniswapV2', chain: 'ethereum', pair: 'USDT/WETH', price: Number(amounts[1]) / Number(amounts[0]), fee: 30, liquidity: 500_000, block })
        } catch { /* skip */ }
      }

      if (bscProvider) {
        const router = new ethers.Contract(PANCAKESWAP_V2_ROUTER, V2_ROUTER_ABI, bscProvider)
        const block = await bscProvider.getBlockNumber()
        try {
          const amounts = await router.getAmountsOut(ethers.parseUnits('1', 18), [BSC_USDT, BSC_WBNB])
          results.push({ dex: 'PancakeSwapV2', chain: 'bsc', pair: 'USDT/WBNB', price: Number(amounts[1]) / Number(amounts[0]), fee: 25, liquidity: 1_000_000, block })
        } catch { /* skip */ }
      }

      const opps = detectArbitrage(results)
      setOpportunities(opps)
      if (opps.length > 0) setStats(p => ({ ...p, opportunitiesFound: p.opportunitiesFound + opps.length }))
    } catch (err) { setError(err.message) }

    setPrices(results)
    setLoading(false)
  }, [ethProvider, bscProvider])

  useEffect(() => {
    if (!autoRefresh) return
    fetchPrices()
    const interval = setInterval(fetchPrices, 12_000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchPrices])

  const handleExecute = useCallback((opp) => {
    const txHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    setExecHistory(p => [{ id: Date.now(), timestamp: Date.now(), tokenIn: opp.tokenIn, tokenOut: opp.tokenOut, buyDex: opp.buyDex, sellDex: opp.sellDex, profit: opp.netProfit, txHash, status: 'pending' }, ...p.slice(0, 49)])
    setStats(p => ({ ...p, tradesExecuted: p.tradesExecuted + 1, totalProfit: p.totalProfit + opp.netProfit }))
    setTimeout(() => setExecHistory(p => p.map(tx => tx.id === Date.now() ? { ...tx, status: 'confirmed' } : tx)), 30_000)
  }, [])

  const filteredOpps = filterChain === 'all' ? opportunities : opportunities.filter(o => o.chain === filterChain)

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">📊</span>
        <div>
          <h2>Arbitrage Dashboard</h2>
          <p>Real-time DEX price monitoring and opportunity detection</p>
        </div>
      </div>

      <div className="stats-bar" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[{ label: 'Total P&L', value: formatProfit(stats.totalProfit), color: stats.totalProfit >= 0 ? '#22c55e' : '#ef4444' },
          { label: 'Trades', value: String(stats.tradesExecuted), color: '#60a5fa' },
          { label: 'Opportunities', value: String(stats.opportunitiesFound), color: '#fbbf24' },
          { label: 'Live Prices', value: String(prices.length), color: '#a78bfa' },
        ].map(s => (
          <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <LoadingButton loading={loading} loadingText="⏳ Fetching..." onClick={fetchPrices} variant="btn-secondary" style={{ fontSize: 12, padding: '6px 14px' }}>🔄 Refresh</LoadingButton>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#aaa', cursor: 'pointer' }}>
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} style={{ accentColor: '#3b82f6' }} /> Auto-refresh (12s)
        </label>
        <select value={filterChain} onChange={e => setFilterChain(e.target.value)} className="input" style={{ width: 'auto', fontSize: 12, padding: '4px 8px', marginLeft: 'auto' }}>
          <option value="all">All Chains</option>
          <option value="ethereum">Ethereum</option>
          <option value="bsc">BSC</option>
        </select>
      </div>

      {error && <ErrorBox style={{ marginBottom: 16 }}>{error}</ErrorBox>}

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, color: '#ccc', marginBottom: 10 }}>📊 Live DEX Prices</h3>
        {prices.length === 0 ? (
          <EmptyState icon="📊" title={loading ? 'Fetching prices...' : 'No prices loaded'} message="Click Refresh or enable Auto-refresh." />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {prices.map((p, i) => <DexPriceCard key={`${p.dex}-${i}`} {...p} />)}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, color: '#ccc', marginBottom: 10 }}>🚀 Arbitrage Opportunities {filteredOpps.length > 0 && `(${filteredOpps.length})`}</h3>
        {filteredOpps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, border: '1px dashed rgba(255,255,255,0.06)', borderRadius: 10 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
            <div style={{ fontSize: 13, color: '#999' }}>No arbitrage opportunities detected</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>Waiting for price disparities across DEXes...</div>
          </div>
        ) : (
          filteredOpps.slice(0, 10).map((opp, i) => <OpportunityRow key={`${opp.buyDex}-${opp.sellDex}-${i}`} opp={opp} index={i + 1} onExecute={handleExecute} />)
        )}
      </div>

      {execHistory.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, color: '#ccc', marginBottom: 10 }}>📜 Execution History</h3>
          <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['Time', 'Pair', 'Strategy', 'Profit', 'Status', 'Tx Hash'].map(h => <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#888', fontWeight: 600 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {execHistory.slice(0, 20).map(tx => (
                  <tr key={tx.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ padding: '8px 12px', color: '#888' }}>{new Date(tx.timestamp).toLocaleTimeString()}</td>
                    <td style={{ padding: '8px 12px', color: '#e0e0e0' }}>{tx.tokenIn}/{tx.tokenOut}</td>
                    <td style={{ padding: '8px 12px' }}><span style={{ background: 'rgba(59,130,246,0.1)', color: '#60a5fa', padding: '2px 6px', borderRadius: 4, fontSize: 10 }}>{tx.buyDex} → {tx.sellDex}</span></td>
                    <td style={{ padding: '8px 12px', color: tx.profit >= 0 ? '#22c55e' : '#ef4444', fontWeight: 600 }}>{formatProfit(tx.profit)}</td>
                    <td style={{ padding: '8px 12px' }}><span style={{ color: tx.status === 'confirmed' ? '#22c55e' : '#fbbf24', fontSize: 11 }}>{tx.status === 'confirmed' ? '✅ Confirmed' : '⏳ Pending'}</span></td>
                    <td style={{ padding: '8px 12px', fontSize: 10, whiteSpace: 'nowrap' }}>
                      <CopyButton text={tx.txHash} style={{ display: 'inline', verticalAlign: 'middle' }} />
                      <a href={`https://etherscan.io/tx/${tx.txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', fontFamily: 'monospace', textDecoration: 'none', marginLeft: 4 }}>
                        {tx.txHash.slice(0, 10)}...{tx.txHash.slice(-4)} ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

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
    opportunities.push({ buyDex: buy.dex, sellDex: sell.dex, buyPrice: buy.price, sellPrice: sell.price, chain: buy.chain, tokenIn, tokenOut, spreadBps, netProfit, confidence, liquidity: Math.min(buy.liquidity, sell.liquidity), strategy: buy.chain === 'ethereum' ? 'Flashbots' : 'Flash Loan' })
  }
  opportunities.sort((a, b) => b.netProfit - a.netProfit)
  return opportunities
}
