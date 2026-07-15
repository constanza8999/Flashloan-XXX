import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import { BSC_RPCS, ETH_RPCS, POLYGON_RPCS, ARBITRUM_RPCS, POPULAR_BEP20, POPULAR_ERC20, POPULAR_POLYGON, POPULAR_ARBITRUM, KNOWN_TOKEN_DECIMALS } from '../constants'
import { useWeb3 } from '../context/Web3Context'
import CopyButton from './shared/CopyButton'

const ERC20_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)']

// Token metadata for display
const TOKEN_META = {}
Object.entries(POPULAR_BEP20).forEach(([sym, addr]) => {
  TOKEN_META[addr.toLowerCase()] = { symbol: sym, chain: 'bsc', decimals: KNOWN_TOKEN_DECIMALS[addr.toLowerCase()] || 18 }
})
Object.entries(POPULAR_ERC20).forEach(([sym, addr]) => {
  TOKEN_META[addr.toLowerCase()] = { symbol: sym, chain: 'eth', decimals: KNOWN_TOKEN_DECIMALS[addr.toLowerCase()] || 18 }
})
Object.entries(POPULAR_POLYGON).forEach(([sym, addr]) => {
  TOKEN_META[addr.toLowerCase()] = { symbol: sym, chain: 'polygon', decimals: KNOWN_TOKEN_DECIMALS[addr.toLowerCase()] || 18 }
})
Object.entries(POPULAR_ARBITRUM).forEach(([sym, addr]) => {
  TOKEN_META[addr.toLowerCase()] = { symbol: sym, chain: 'arbitrum', decimals: KNOWN_TOKEN_DECIMALS[addr.toLowerCase()] || 18 }
})

const CHAIN_META = {
  bsc: { symbol: 'BNB', icon: '⛓', color: '#F0B90B', explorer: 'BscScan', explorerUrl: 'https://bscscan.com', name: 'BNB Smart Chain', chainId: '56' },
  eth: { symbol: 'ETH', icon: '🛡', color: '#627EEA', explorer: 'Etherscan', explorerUrl: 'https://etherscan.io', name: 'Ethereum', chainId: '1' },
  polygon: { symbol: 'MATIC', icon: '🔶', color: '#8247E5', explorer: 'PolygonScan', explorerUrl: 'https://polygonscan.com', name: 'Polygon', chainId: '137' },
  arbitrum: { symbol: 'ETH', icon: '🌀', color: '#2D374B', explorer: 'Arbiscan', explorerUrl: 'https://arbiscan.io', name: 'Arbitrum One', chainId: '42161' },
}

function NativeCoinCard({ chain, balance, loading }) {
  const meta = CHAIN_META[chain]
  if (!meta) return null

  return (
    <div className="bc-native-card" style={{ '--coin-color': meta.color }}>
      <div className="bc-native-header">
        <span className="bc-native-icon">{meta.icon}</span>
        <div>
          <span className="bc-native-symbol">{meta.symbol}</span>
          <span className="bc-native-chain">{meta.name}</span>
        </div>
        <span className="bc-native-chain-id">Chain {meta.chainId}</span>
      </div>
      <div className="bc-native-balance">
        {loading ? (
          <span className="bc-loading-placeholder">Loading...</span>
        ) : balance !== null ? (
          <>
            <span className="bc-balance-value">{parseFloat(balance).toLocaleString(undefined, { maximumFractionDigits: 6, minimumFractionDigits: 2 })}</span>
            <span className="bc-balance-symbol">{meta.symbol}</span>
          </>
        ) : (
          <span className="bc-balance-error">Failed to load</span>
        )}
      </div>
      <div className="bc-native-links">
        <a href={meta.explorerUrl} target="_blank" rel="noopener noreferrer" className="explorer-sm">
          View on {meta.explorer} ↗
        </a>
      </div>
    </div>
  )
}

const CHAIN_CATALOGS = {
  bsc: { catalog: POPULAR_BEP20, title: 'BEP20 Tokens (BSC)', explorer: 'https://bscscan.com/token/' },
  eth: { catalog: POPULAR_ERC20, title: 'ERC20 Tokens (Ethereum)', explorer: 'https://etherscan.io/token/' },
  polygon: { catalog: POPULAR_POLYGON, title: 'Polygon Tokens', explorer: 'https://polygonscan.com/token/' },
  arbitrum: { catalog: POPULAR_ARBITRUM, title: 'Arbitrum Tokens', explorer: 'https://arbiscan.io/token/' },
}

function TokenBalancesCard({ chain, balances, loading, address }) {
  const cfg = CHAIN_CATALOGS[chain]
  if (!cfg) return null

  return (
    <div className="bc-tokens-card">
      <div className="bc-tokens-header">
        <h3>{cfg.title}</h3>
        {address && (
          <span className="bc-tokens-count">{Object.keys(balances).filter(k => balances[k] !== null).length} tokens</span>
        )}
      </div>
      {loading ? (
        <div className="bc-tokens-loading">
          {Object.entries(cfg.catalog).map(([sym, addr]) => (
            <div key={sym} className="bc-token-row">
              <span className="bc-token-symbol">{sym}</span>
              <span className="bc-token-bal-skel">•••••</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="bc-token-list">
          {Object.entries(cfg.catalog).map(([sym, addr]) => {
            const bal = balances[addr.toLowerCase()]
            const meta = TOKEN_META[addr.toLowerCase()]
            const decimals = meta?.decimals || 18
            return (
              <div key={sym} className="bc-token-row" title={`${addr}`}>
                <div className="bc-token-info">
                  <span className="bc-token-symbol">{sym}</span>
                  <CopyButton text={addr} />
                  <a
                    href={cfg.explorer + addr}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bc-token-addr"
                    onClick={e => e.stopPropagation()}
                  >
                    {addr.slice(0, 8)}...
                  </a>
                </div>
                <span className={`bc-token-balance ${bal === null ? 'error' : ''}`}>
                  {bal !== null
                    ? parseFloat(bal).toLocaleString(undefined, { maximumFractionDigits: decimals > 6 ? 4 : decimals, minimumFractionDigits: 2 })
                    : '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function BalanceChecker() {
  const { walletAddress, isConnected } = useWeb3()
  const [address, setAddress] = useState('')
  const [bscProvider, setBscProvider] = useState(null)
  const [ethProvider, setEthProvider] = useState(null)
  const [polygonProvider, setPolygonProvider] = useState(null)
  const [arbitrumProvider, setArbitrumProvider] = useState(null)
  const [nativeBalances, setNativeBalances] = useState({ bsc: null, eth: null, polygon: null, arbitrum: null })
  const [tokenBalances, setTokenBalances] = useState({})
  const [loading, setLoading] = useState({ bscNative: false, ethNative: false, polygonNative: false, arbitrumNative: false, tokens: false })
  const [error, setError] = useState('')
  const [lastRefreshed, setLastRefreshed] = useState(null)

  const isFetching = useRef(false)

  // Init providers
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      for (const rpc of BSC_RPCS) {
        try {
          const p = new ethers.JsonRpcProvider(rpc)
          await p.getNetwork()
          await p.getBlockNumber()
          if (!cancelled) { setBscProvider(p); break }
        } catch { /* try next */ }
      }
      for (const rpc of ETH_RPCS) {
        try {
          const p = new ethers.JsonRpcProvider(rpc)
          await p.getNetwork()
          await p.getBlockNumber()
          if (!cancelled) { setEthProvider(p); break }
        } catch { /* try next */ }
      }
      for (const rpc of POLYGON_RPCS) {
        try {
          const p = new ethers.JsonRpcProvider(rpc)
          await p.getNetwork()
          await p.getBlockNumber()
          if (!cancelled) { setPolygonProvider(p); break }
        } catch { /* try next */ }
      }
      for (const rpc of ARBITRUM_RPCS) {
        try {
          const p = new ethers.JsonRpcProvider(rpc)
          await p.getNetwork()
          await p.getBlockNumber()
          if (!cancelled) { setArbitrumProvider(p); break }
        } catch { /* try next */ }
      }
    }
    init()
    return () => { cancelled = true }
  }, [])

  // Auto-fill connected wallet address
  useEffect(() => {
    if (isConnected && walletAddress && !address) {
      setAddress(walletAddress)
    }
  }, [isConnected, walletAddress, address])

  const fetchBalances = useCallback(async () => {
    const addr = address.trim()
    if (!addr || !ethers.isAddress(addr)) {
      setError('Please enter a valid wallet address')
      return
    }
    setError('')
    if (isFetching.current) return
    isFetching.current = true

    const checksumAddr = ethers.getAddress(addr)
    setLoading({ bscNative: true, ethNative: true, polygonNative: true, arbitrumNative: true, tokens: true })
    setNativeBalances({ bsc: null, eth: null, polygon: null, arbitrum: null })
    setTokenBalances({})

    // Native balances in parallel
    const nativePromises = []
    if (bscProvider) {
      nativePromises.push(
        bscProvider.getBalance(checksumAddr)
          .then(b => ethers.formatEther(b))
          .catch(() => null)
          .then(val => { setNativeBalances(prev => ({ ...prev, bsc: val })); setLoading(prev => ({ ...prev, bscNative: false })) })
      )
    } else {
      setLoading(prev => ({ ...prev, bscNative: false }))
    }

    if (ethProvider) {
      nativePromises.push(
        ethProvider.getBalance(checksumAddr)
          .then(b => ethers.formatEther(b))
          .catch(() => null)
          .then(val => { setNativeBalances(prev => ({ ...prev, eth: val })); setLoading(prev => ({ ...prev, ethNative: false })) })
      )
    } else {
      setLoading(prev => ({ ...prev, ethNative: false }))
    }

    if (polygonProvider) {
      nativePromises.push(
        polygonProvider.getBalance(checksumAddr)
          .then(b => ethers.formatEther(b))
          .catch(() => null)
          .then(val => { setNativeBalances(prev => ({ ...prev, polygon: val })); setLoading(prev => ({ ...prev, polygonNative: false })) })
      )
    } else {
      setLoading(prev => ({ ...prev, polygonNative: false }))
    }

    if (arbitrumProvider) {
      nativePromises.push(
        arbitrumProvider.getBalance(checksumAddr)
          .then(b => ethers.formatEther(b))
          .catch(() => null)
          .then(val => { setNativeBalances(prev => ({ ...prev, arbitrum: val })); setLoading(prev => ({ ...prev, arbitrumNative: false })) })
      )
    } else {
      setLoading(prev => ({ ...prev, arbitrumNative: false }))
    }

    // Token balances - fetch all in parallel
    const allTokenEntries = [
      ...Object.entries(POPULAR_BEP20).map(([sym, addr]) => ({ sym, addr, provider: bscProvider, chain: 'bsc' })),
      ...Object.entries(POPULAR_ERC20).map(([sym, addr]) => ({ sym, addr, provider: ethProvider, chain: 'eth' })),
      ...Object.entries(POPULAR_POLYGON).map(([sym, addr]) => ({ sym, addr, provider: polygonProvider, chain: 'polygon' })),
      ...Object.entries(POPULAR_ARBITRUM).map(([sym, addr]) => ({ sym, addr, provider: arbitrumProvider, chain: 'arbitrum' })),
    ]

    const newTokenBalances = {}
    const tokenPromises = allTokenEntries
      .filter(t => t.provider)
      .map(async (token) => {
        try {
          const contract = new ethers.Contract(token.addr, ERC20_BALANCE_ABI, token.provider)
          const balWei = await contract.balanceOf(checksumAddr)
          const meta = TOKEN_META[token.addr.toLowerCase()]
          const decimals = meta?.decimals || 18
          newTokenBalances[token.addr.toLowerCase()] = ethers.formatUnits(balWei, decimals)
        } catch {
          newTokenBalances[token.addr.toLowerCase()] = null
        }
      })

    await Promise.all(nativePromises)
    await Promise.all(tokenPromises)
    setTokenBalances(newTokenBalances)
    setLoading(prev => ({ ...prev, tokens: false }))
    setLastRefreshed(new Date().toLocaleTimeString())
    isFetching.current = false
  }, [address, bscProvider, ethProvider, polygonProvider, arbitrumProvider])

  // Auto-fetch on address change (debounced)
  useEffect(() => {
    if (!address || !ethers.isAddress(address)) return
    if (!bscProvider && !ethProvider && !polygonProvider && !arbitrumProvider) return
    const timer = setTimeout(() => fetchBalances(), 500)
    return () => clearTimeout(timer)
  }, [address, bscProvider, ethProvider, polygonProvider, arbitrumProvider, fetchBalances])

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">💰</span>
        <div>
          <h2>Wallet Balance Checker</h2>
          <p>View native coin and token balances for any address across BSC, Ethereum, Polygon, and Arbitrum</p>
        </div>
      </div>

      <div className="bc-input-area">
        <div className="bc-input-row">
          <input
            type="text"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="Enter wallet address (0x...)"
            className="input mono bc-address-input"
          />
          {isConnected && walletAddress && (
            <button
              className="btn btn-primary bc-my-wallet-btn"
              onClick={() => setAddress(walletAddress)}
            >
              My Wallet
            </button>
          )}
          <button
            className="btn btn-success"
            onClick={fetchBalances}
            disabled={loading.bscNative || loading.ethNative || loading.polygonNative || loading.arbitrumNative || loading.tokens}
          >
            {loading.bscNative || loading.ethNative || loading.polygonNative || loading.arbitrumNative || loading.tokens ? '⏳ Loading...' : '🔄 Refresh'}
          </button>
        </div>
        {error && <div className="error-box" style={{ marginTop: 12, marginBottom: 0 }}><span className="error-icon">✕</span> {error}</div>}
      </div>

      <div className="bc-summary-bar">
        <div className="bc-summary-item">
          <span className="bc-summary-label">Address</span>
          <span className="bc-summary-value mono">
            {address && ethers.isAddress(address)
              ? `${address.slice(0, 8)}...${address.slice(-6)}`
              : '—'}
          </span>
        </div>
        {lastRefreshed && (
          <div className="bc-summary-item">
            <span className="bc-summary-label">Last Refreshed</span>
            <span className="bc-summary-value">{lastRefreshed}</span>
          </div>
        )}
        {(nativeBalances.bsc !== null || nativeBalances.eth !== null) && (
          <div className="bc-summary-item">
            <span className="bc-summary-label">Total Native</span>
            <span className="bc-summary-value">
              {[nativeBalances.bsc, nativeBalances.eth]
                .filter(b => b !== null)
                .map((b, i) => `${parseFloat(b).toFixed(4)} ${i === 0 ? 'BNB' : 'ETH'}`)
                .join(' + ')}
            </span>
          </div>
        )}
      </div>

      {/* Native Coin Cards */}
      <div className="bc-native-grid">
        <NativeCoinCard chain="bsc" balance={nativeBalances.bsc} loading={loading.bscNative} />
        <NativeCoinCard chain="eth" balance={nativeBalances.eth} loading={loading.ethNative} />
        <NativeCoinCard chain="polygon" balance={nativeBalances.polygon} loading={loading.polygonNative} />
        <NativeCoinCard chain="arbitrum" balance={nativeBalances.arbitrum} loading={loading.arbitrumNative} />
      </div>

      {/* Token Balances */}
      <div className="bc-tokens-grid">
        <TokenBalancesCard
          chain="bsc"
          balances={tokenBalances}
          loading={loading.tokens}
          address={address}
        />
        <TokenBalancesCard
          chain="eth"
          balances={tokenBalances}
          loading={loading.tokens}
          address={address}
        />
        <TokenBalancesCard
          chain="polygon"
          balances={tokenBalances}
          loading={loading.tokens}
          address={address}
        />
        <TokenBalancesCard
          chain="arbitrum"
          balances={tokenBalances}
          loading={loading.tokens}
          address={address}
        />
      </div>

      <p className="bc-note">
        💡 Balances fetched from public RPCs. Rates may be delayed. Token balances shown for popular tokens only.
      </p>
    </div>
  )
}
