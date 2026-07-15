import React, { useState, useCallback, useEffect, useRef } from 'react'
import { ethers } from 'ethers'
import { ETH_RPCS, BSC_RPCS, POLYGON_RPCS, ARBITRUM_RPCS, DEFAULT_RECIPIENT } from '../constants'
import { useProvider } from '../hooks'
import CopyButton from './shared/CopyButton'
import LoadingButton from './shared/LoadingButton'

const BACKEND_URL = 'http://localhost:8000'
const ERC20_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function name() view returns (string)']

const CHAINS = {
  ethereum: { label: 'Ethereum', rpcs: ETH_RPCS, icon: '🔵', explorer: 'https://etherscan.io', nativeSymbol: 'ETH', chainId: 1 },
  bsc: { label: 'BNB Smart Chain', rpcs: BSC_RPCS, icon: '🟡', explorer: 'https://bscscan.com', nativeSymbol: 'BNB', chainId: 56 },
  polygon: { label: 'Polygon', rpcs: POLYGON_RPCS, icon: '🟣', explorer: 'https://polygonscan.com', nativeSymbol: 'MATIC', chainId: 137 },
  arbitrum: { label: 'Arbitrum', rpcs: ARBITRUM_RPCS, icon: '🔷', explorer: 'https://arbiscan.io', nativeSymbol: 'ETH', chainId: 42161 },
}

// Token name → address mapping for backend withdraw requests
const TOKEN_ADDRESSES = {
  ethereum: {
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  },
  bsc: {
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    USDC: '0x8ac76a51cc950d9922a3688cd78fa7a438cc87e7',
    DAI: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
  },
  polygon: {
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    DAI: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
    WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  },
  arbitrum: {
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    ARB: '0x912CE59144291C1204dE78fC2D2A8EaFB0C6e5c1',
  },
}

const DEFAULT_CONTRACT = '0xc5453C4db4F86B0772787809c162ec5B3DEA815D'

// ─── Backend API helpers ───────────────────────────────────────────────

async function checkBackendHealth() {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return false
    const data = await res.json()
    return data.status === 'ok'
  } catch {
    return false
  }
}

async function fetchBalancesFromBackend(chain, contractAddress) {
  const res = await fetch(`${BACKEND_URL}/api/balances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chain, contract: contractAddress }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Backend error')
  }
  return res.json()
}

async function withdrawFromBackend({ chain, contract, token, amount, destination, privateKey }) {
  const res = await fetch(`${BACKEND_URL}/api/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chain, contract, token, amount, destination, private_key: privateKey }),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Backend error')
  }
  return res.json()
}

async function sweepFromBackend({ chain, contract, destination, privateKey }) {
  const res = await fetch(`${BACKEND_URL}/api/sweep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chain, contract, destination, private_key: privateKey }),
    signal: AbortSignal.timeout(90000),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Backend error')
  }
  return res.json()
}

// ─── Direct ethers.js fallback helpers ─────────────────────────────────

async function fetchNativeBalance(provider, address) {
  const bal = await provider.getBalance(address)
  return ethers.formatEther(bal)
}

async function fetchTokenBalance(provider, tokenAddr, walletAddr) {
  try {
    const contract = new ethers.Contract(tokenAddr, ERC20_BALANCE_ABI, provider)
    const [bal, symbol] = await Promise.all([
      contract.balanceOf(walletAddr).catch(() => 0n),
      contract.symbol().catch(() => '?'),
    ])
    const decimals = await contract.decimals().catch(() => 18)
    return { balance: ethers.formatUnits(bal, decimals), symbol, raw: bal }
  } catch {
    return null
  }
}

// ─── Component ─────────────────────────────────────────────────────────

export default function ProfitWithdraw() {
  const ethProvider = useProvider(ETH_RPCS)
  const bscProvider = useProvider(BSC_RPCS)
  const polygonProvider = useProvider(POLYGON_RPCS)
  const arbitrumProvider = useProvider(ARBITRUM_RPCS)

  const [chain, setChain] = useState('ethereum')
  const [contractAddress, setContractAddress] = useState(DEFAULT_CONTRACT)
  const [token, setToken] = useState('')
  const [destination, setDestination] = useState(DEFAULT_RECIPIENT)
  const [amount, setAmount] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [balancesLoading, setBalancesLoading] = useState(false)
  const [balances, setBalances] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [backendAvailable, setBackendAvailable] = useState(null) // null = unknown, true/false
  const [backendChecking, setBackendChecking] = useState(true)
  const healthChecked = useRef(false)

  const chainCfg = CHAINS[chain]
  const providerMap = { ethereum: ethProvider, bsc: bscProvider, polygon: polygonProvider, arbitrum: arbitrumProvider }
  const provider = providerMap[chain]
  const tokenAddressMap = TOKEN_ADDRESSES[chain] || {}

  // ─── Check backend health on mount ───────────────────────────────
  useEffect(() => {
    if (healthChecked.current) return
    healthChecked.current = true
    setBackendChecking(true)
    checkBackendHealth().then(available => {
      setBackendAvailable(available)
      setBackendChecking(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Auto-fetch balances on chain/contract change ────────────────
  useEffect(() => {
    if (provider && contractAddress && ethers.isAddress(contractAddress)) {
      const timer = setTimeout(() => handleFetchBalances(), 300)
      return () => clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, contractAddress])

  // ─── Re-fetch when backend becomes available ─────────────────────
  const prevBackend = useRef(backendAvailable)
  useEffect(() => {
    if (prevBackend.current === null && backendAvailable === true) {
      if (contractAddress && ethers.isAddress(contractAddress)) {
        handleFetchBalances()
      }
    }
    prevBackend.current = backendAvailable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendAvailable])

  // ─── Fetch balances ──────────────────────────────────────────────
  const handleFetchBalances = useCallback(async () => {
    if (!provider) { setError('No RPC connection available'); return }
    if (!contractAddress || !ethers.isAddress(contractAddress)) { setError('Invalid contract address'); return }

    setBalancesLoading(true)
    setError('')
    setBalances(null)

    try {
      const checksumAddr = ethers.getAddress(contractAddress)

      // Try backend first
      if (backendAvailable) {
        try {
          const data = await fetchBalancesFromBackend(chain, checksumAddr)
          const chainData = data[chain]
          if (chainData) {
            setBalances(data)
            setBalancesLoading(false)
            return
          }
        } catch (beErr) {
          console.warn('Backend balance fetch failed, falling back to ethers.js:', beErr.message)
        }
      }

      // Fallback: direct ethers.js queries
      const nativeBal = await fetchNativeBalance(provider, checksumAddr)

      const KNOWN_TOKENS_MAP = {
        ethereum: [
          { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', label: 'USDT' },
          { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', label: 'USDC' },
          { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', label: 'DAI' },
          { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', label: 'WETH' },
          { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', label: 'WBTC' },
        ],
        bsc: [
          { address: '0x55d398326f99059fF775485246999027B3197955', label: 'USDT' },
          { address: '0x8ac76a51cc950d9922a3688cd78fa7a438cc87e7', label: 'USDC' },
          { address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', label: 'DAI' },
          { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', label: 'WBNB' },
          { address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', label: 'BTCB' },
        ],
        polygon: [
          { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', label: 'USDT' },
          { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', label: 'USDC' },
          { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', label: 'DAI' },
          { address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', label: 'WETH' },
          { address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', label: 'WMATIC' },
        ],
        arbitrum: [
          { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', label: 'USDT' },
          { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', label: 'USDC' },
          { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', label: 'DAI' },
          { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', label: 'WETH' },
          { address: '0x912CE59144291C1204dE78fC2D2A8EaFB0C6e5c1', label: 'ARB' },
        ],
      }

      const knownTokens = KNOWN_TOKENS_MAP[chain] || KNOWN_TOKENS_MAP.ethereum

      const tokenResults = {}
      for (const tk of knownTokens) {
        const result = await fetchTokenBalance(provider, tk.address, checksumAddr)
        if (result && result.raw > 0n) {
          tokenResults[tk.label] = result
        }
      }

      setBalances({
        [chain]: {
          native: { balance_formatted: parseFloat(nativeBal), symbol: chainCfg.nativeSymbol },
          tokens: tokenResults,
          contract_address: checksumAddr,
        }
      })
    } catch (err) {
      setError(`Failed to fetch balances: ${err.message}`)
    } finally {
      setBalancesLoading(false)
    }
  }, [chain, contractAddress, provider, chainCfg, backendAvailable])

  // ─── Withdraw / Sweep ────────────────────────────────────────────
  const handleWithdraw = useCallback(async (isSweep = false) => {
    setError('')
    setResult(null)

    if (!destination || !ethers.isAddress(destination)) {
      setError('Please enter a valid destination address')
      return
    }
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      setError('Please enter a valid contract address')
      return
    }
    if (!provider) {
      setError('No RPC connection available')
      return
    }

    setLoading(true)
    try {
      // Try backend first
      if (backendAvailable) {
        try {
          const checksumAddr = ethers.getAddress(contractAddress)
          const checksumDest = ethers.getAddress(destination)

          if (isSweep) {
            const data = await sweepFromBackend({
              chain,
              contract: checksumAddr,
              destination: checksumDest,
              privateKey: privateKey || undefined,
            })
            setResult({
              type: 'backend-sweep',
              transactions: data.transactions,
              chain: chainCfg.label,
              destination: checksumDest,
            })
          } else {
            const data = await withdrawFromBackend({
              chain,
              contract: checksumAddr,
              token: token ? (tokenAddressMap[token] || token) : undefined,
              amount: amount || undefined,
              destination: checksumDest,
              privateKey: privateKey || undefined,
            })
            setResult({
              type: 'backend-withdraw',
              status: data.status,
              tx_hash: data.tx_hash,
              block_number: data.block_number,
              explorer_url: data.explorer_url,
              amount: amount || 'all',
              token: token || chainCfg.nativeSymbol,
              chain: chainCfg.label,
              destination: checksumDest,
            })
          }
          setLoading(false)
          return
        } catch (beErr) {
          console.warn('Backend withdraw failed, falling back to simulated:', beErr.message)
          setError(`Backend error: ${beErr.message}. Falling back to simulation.`)
        }
      }

      // Fallback: simulated transaction
      await new Promise(r => setTimeout(r, 1200))
      const txHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
      const blockNumber = Math.floor(Math.random() * 1000000) + 18000000

      if (isSweep) {
        setResult({
          type: 'simulated',
          transactions: [
            { type: 'native', tx_hash: txHash, status: 'sent' },
            { type: 'token', name: 'ERC20', tx_hash: '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''), status: 'sent' },
          ],
          chain: chainCfg.label,
          destination,
          status: 'sweep',
        })
      } else {
        setResult({
          type: 'simulated',
          status: 'success',
          tx_hash: txHash,
          block_number: blockNumber,
          explorer_url: `${chainCfg.explorer}/tx/${txHash}`,
          amount: amount || 'all',
          token: token || chainCfg.nativeSymbol,
          chain: chainCfg.label,
          destination,
        })
      }
    } catch (err) {
      setError(`Transaction failed: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [chain, token, amount, destination, contractAddress, provider, chainCfg, backendAvailable, privateKey])

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">💸</span>
        <div>
          <h2>Profit Withdraw</h2>
          <p>Withdraw funds from FlashArbitrage contracts via backend or ethers.js</p>
        </div>
      </div>

      {/* Status Bar */}
      <div className="stats-bar">
        <div className="stat">
          <span className="stat-label">Chain</span>
          <span className="stat-value" style={{ fontSize: 16, color: '#60a5fa' }}>
            {CHAINS[chain].icon} {CHAINS[chain].label}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Backend</span>
          <span className="stat-value" style={{ fontSize: 16, color: backendAvailable ? '#22c55e' : backendChecking ? '#a855f7' : '#ef4444' }}>
            {backendChecking ? '🟣 Checking...' : backendAvailable ? '🟢 Online' : '🔴 Offline'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">RPC</span>
          <span className="stat-value" style={{ fontSize: 16, color: provider ? '#22c55e' : '#ef4444' }}>
            {provider ? '🟢 Connected' : '🔴 Disconnected'}
          </span>
        </div>
        <div className="stat" style={{ flex: 1 }} />
        <div className="stat" style={{ justifyContent: 'center' }}>
          <LoadingButton
            loading={balancesLoading}
            loadingText="⏳ Loading..."
            onClick={handleFetchBalances}
            disabled={!provider || !ethers.isAddress(contractAddress)}
            style={{ fontSize: 11, padding: '6px 12px' }}
            variant="btn-secondary"
          >
            🔄 Refresh
          </LoadingButton>
        </div>
      </div>

      {/* Contract & Destination */}
      <div className="config-panel">
        <h3>🔗 Contract & Destination</h3>
        <div className="form-grid">
          <div className="form-group">
            <label>Chain</label>
            <select value={chain} onChange={e => { setChain(e.target.value); setBalances(null) }} className="input">
              {Object.entries(CHAINS).map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {v.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Contract Address</label>
            <input
              type="text"
              className="input mono"
              value={contractAddress}
              onChange={e => { setContractAddress(e.target.value); setBalances(null) }}
              placeholder="0x..."
              style={{ fontSize: 12 }}
            />
            <span className="form-hint">FlashArbitrage contract to inspect / withdraw from</span>
          </div>
          <div className="form-group">
            <label>Destination Address</label>
            <input
              type="text"
              className="input mono"
              value={destination}
              onChange={e => setDestination(e.target.value)}
              placeholder="0x..."
              style={{ fontSize: 12 }}
            />
            <span className="form-hint">Where withdrawn funds will be sent</span>
          </div>
        </div>
      </div>

      {/* Private Key (optional, only used if backend requires it) */}
      <details style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: '#888', padding: '6px 0' }}>
          🔑 Backend Private Key (optional — set via env vars on server)
        </summary>
        <div className="config-panel" style={{ marginTop: 8 }}>
          <div className="form-group">
            <div className="input-row">
              <input
                type={showKey ? 'text' : 'password'}
                className="input mono"
                value={privateKey}
                onChange={e => setPrivateKey(e.target.value)}
                placeholder="0x... (optional, overrides server env vars)"
                style={{ flex: 1, fontSize: 12 }}
              />
              <button className="btn btn-secondary" onClick={() => setShowKey(!showKey)} style={{ padding: '10px 14px' }}>
                {showKey ? '🙈' : '👁'}
              </button>
              <button className="btn btn-secondary" onClick={() => setPrivateKey('')} style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700 }}>
                Clear
              </button>
            </div>
            <span className="form-hint">Only used when backend is online and requires a relayer key</span>
          </div>
        </div>
      </details>

      {/* Balances */}
      <div className="config-panel">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>💰 Contract Balances</h3>
          {backendAvailable && (
            <span style={{ fontSize: 10, color: '#22c55e', background: 'rgba(34,197,94,0.1)', padding: '3px 8px', borderRadius: 4 }}>
              via backend
            </span>
          )}
          {backendAvailable === false && (
            <span style={{ fontSize: 10, color: '#a855f7', background: 'rgba(168,85,247,0.1)', padding: '3px 8px', borderRadius: 4 }}>
              via ethers.js (direct)
            </span>
          )}
        </div>

        {balancesLoading && (
          <div style={{ textAlign: 'center', padding: 20, color: '#888' }}>
            <span className="spinner" style={{ marginRight: 8 }} />
            Fetching on-chain balances...
          </div>
        )}

        {!balancesLoading && balances ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            {Object.entries(balances).map(([c, data]) => {
              const cfg = CHAINS[c]
              if (!cfg) return null
              return (
                <div key={c} style={{
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: 10, padding: 16,
                  border: '1px solid rgba(255,255,255,0.08)',
                }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
                    {cfg.icon} {cfg.label}
                  </div>
                  {data.error ? (
                    <div style={{ color: '#ef4444', fontSize: 12 }}>{data.error}</div>
                  ) : (
                    <>
                      {/* Native balance */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 14px', background: 'rgba(34,197,94,0.05)',
                        borderRadius: 8, border: '1px solid rgba(34,197,94,0.15)',
                        marginBottom: 10,
                      }}>
                        <span style={{ fontSize: 22 }}>{cfg.icon}</span>
                        <div>
                          <div style={{ fontSize: 22, fontWeight: 700, color: '#22c55e' }}>
                            {data.native?.balance_formatted?.toFixed(6) || '0.000000'}
                          </div>
                          <div style={{ fontSize: 12, color: '#888' }}>
                            {data.native?.symbol || cfg.nativeSymbol} (Native)
                          </div>
                        </div>
                      </div>

                      {/* Token balances */}
                      {data.tokens && Object.keys(data.tokens).length > 0 ? (
                        <div>
                          <div style={{
                            fontSize: 11, color: '#888', marginBottom: 6,
                            fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                          }}>
                            Token Balances
                          </div>
                          {Object.entries(data.tokens).map(([name, t]) => (
                            <div key={name} style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)',
                              fontSize: 13,
                            }}>
                              <span style={{ color: '#ccc' }}>{name}</span>
                              <span style={{ color: '#60a5fa', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                                {parseFloat(t.balance).toFixed(4)} {t.symbol}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: '#666', fontStyle: 'italic', padding: '8px 0' }}>
                          No token balances found
                        </div>
                      )}

                      {data.contract_address && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          fontSize: 10, color: '#555', marginTop: 8, fontFamily: 'monospace',
                        }}>
                          <CopyButton text={data.contract_address} />
                          Contract: {data.contract_address.slice(0, 12)}...{data.contract_address.slice(-6)}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ) : !balancesLoading && (
          <div style={{ textAlign: 'center', padding: 20, color: '#666', fontStyle: 'italic' }}>
            {provider && ethers.isAddress(contractAddress)
              ? 'Click "Refresh" to fetch on-chain data'
              : 'Enter a valid contract address'}
          </div>
        )}
      </div>

      {/* Withdraw Form */}
      <div className="config-panel">
        <h3>💸 Withdraw Funds</h3>

        <div className="form-grid">
          <div className="form-group">
            <label>Asset</label>
            <select value={token} onChange={e => setToken(e.target.value)} className="input">
              <option value="">Native ({chainCfg.nativeSymbol})</option>
              <option value="USDT">💵 USDT</option>
              <option value="USDC">💵 USDC</option>
              <option value="DAI">💵 DAI</option>
              {chain === 'polygon' && <option value="WMATIC">🟣 WMATIC</option>}
              {chain === 'arbitrum' && <option value="ARB">🔷 ARB</option>}
              {(chain === 'polygon' || chain === 'arbitrum' || chain === 'ethereum') && <option value="WETH">🔵 WETH</option>}
            </select>
          </div>

          <div className="form-group">
            <label>Amount</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                className="input"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="Leave empty for max"
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-secondary"
                style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700 }}
                onClick={() => setAmount('')}
              >
                MAX
              </button>
            </div>
            <span className="form-hint">Leave empty to withdraw entire balance</span>
          </div>

          <div className="form-group" style={{
            background: 'rgba(0,0,0,0.15)',
            borderRadius: 6, padding: '8px 12px',
          }}>
            <div style={{ fontSize: 11, color: '#888' }}>
              Explorer: {chainCfg.explorer}
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
              Destination: {destination.slice(0, 10)}...{destination.slice(-4)}
            </div>
            {backendAvailable && (
              <div style={{ fontSize: 11, color: '#22c55e', marginTop: 4 }}>
                • Withdraws will be executed via backend
              </div>
            )}
            {backendAvailable === false && !backendChecking && (
              <div style={{ fontSize: 11, color: '#a855f7', marginTop: 4 }}>
                • Withdraws will be simulated (no backend)
              </div>
            )}
          </div>
        </div>

        <div className="form-actions">
          <LoadingButton
            loading={loading}
            loadingText="⏳ Processing..."
            onClick={() => handleWithdraw(false)}
            disabled={!provider}
          >
            {backendAvailable ? '💸 Withdraw (Backend)' : '💸 Withdraw (Simulated)'}
          </LoadingButton>
          <LoadingButton
            loading={loading}
            loadingText="⏳ Sweeping..."
            onClick={() => handleWithdraw(true)}
            disabled={!provider}
            variant="btn-danger"
          >
            {backendAvailable ? '🧹 Sweep All (Backend)' : '🧹 Sweep All (Simulated)'}
          </LoadingButton>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="error-box">
          <span className="error-icon">⚠</span> {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="result-panel success">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3>✅ {result.type === 'backend-withdraw' ? 'Withdraw Complete' : result.type === 'backend-sweep' ? 'Sweep Complete' : result.status === 'sweep' ? 'Sweep (Simulated)' : 'Transaction Sent'}</h3>
            {result.type === 'backend-withdraw' || result.type === 'backend-sweep' ? (
              <span style={{ fontSize: 10, color: '#22c55e', background: 'rgba(34,197,94,0.1)', padding: '3px 8px', borderRadius: 4 }}>
                backend
              </span>
            ) : (
              <span style={{ fontSize: 10, color: '#a855f7', background: 'rgba(168,85,247,0.1)', padding: '3px 8px', borderRadius: 4 }}>
                simulated
              </span>
            )}
          </div>

          {/* Backend sweep result */}
          {result.type === 'backend-sweep' && result.transactions && (
            <div>
              <p>Sweep sent — {result.transactions.length} transaction(s)</p>
              {result.transactions.map((tx, i) => (
                <div key={i} className="result-hash" style={{
                  marginTop: i > 0 ? 8 : 0, display: 'flex',
                  alignItems: 'center', gap: 8, flexWrap: 'wrap',
                }}>
                  <span>{tx.type === 'native' ? '💰 Native' : `🔸 ${tx.name || 'Token'}`}:</span>
                  {tx.tx_hash ? (
                    <>
                      <CopyButton text={tx.tx_hash} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{tx.tx_hash.slice(0, 18)}...</span>
                      <a href={`${chainCfg.explorer}/tx/${tx.tx_hash}`} target="_blank" rel="noopener noreferrer" className="explorer-link">
                        ↗ {chainCfg.label === 'Ethereum' ? 'Etherscan' : 'BscScan'}
                      </a>
                    </>
                  ) : (
                    <span style={{ color: '#ef4444' }}>❌ {tx.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Backend single withdraw result */}
          {result.type === 'backend-withdraw' && (
            <div>
              <p>
                {result.amount === 'all' ? 'All' : result.amount || 'All'} {result.token || chainCfg.nativeSymbol}
                {' '}→ {result.destination.slice(0, 10)}...
              </p>
              <div className="result-hash" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <CopyButton text={result.tx_hash} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>Tx: {result.tx_hash.slice(0, 18)}...</span>
                <span style={{ color: '#888', fontSize: 11 }}>Status: {result.status}</span>
                {result.block_number && (
                  <span style={{ color: '#888', fontSize: 11 }}>Block: {result.block_number}</span>
                )}
                <a href={result.explorer_url} target="_blank" rel="noopener noreferrer" className="explorer-link">
                  ↗ {chainCfg.label === 'Ethereum' ? 'Etherscan' : 'BscScan'}
                </a>
              </div>
            </div>
          )}

          {/* Simulated result — single withdraw */}
          {result.type === 'simulated' && result.status !== 'sweep' && (
            <div>
              <p style={{ color: '#a855f7' }}>
                {result.amount === 'all' ? 'All' : result.amount || 'All'} {result.token || chainCfg.nativeSymbol}
                {' '}→ {result.destination.slice(0, 10)}...
                {' '}(simulated)
              </p>
              <div className="result-hash" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <CopyButton text={result.tx_hash} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>Tx: {result.tx_hash.slice(0, 18)}...</span>
                <span style={{ color: '#888', fontSize: 11 }}>Block: {result.block_number}</span>
                <a href={result.explorer_url} target="_blank" rel="noopener noreferrer" className="explorer-link">↗ Explorer</a>
              </div>
            </div>
          )}

          {/* Simulated result — sweep */}
          {result.type === 'simulated' && result.status === 'sweep' && result.transactions && (
            <div>
              <p style={{ color: '#a855f7' }}>Sweep simulated — {result.transactions.length} transaction(s)</p>
              {result.transactions.map((tx, i) => (
                <div key={i} className="result-hash" style={{
                  marginTop: i > 0 ? 8 : 0, display: 'flex',
                  alignItems: 'center', gap: 8, flexWrap: 'wrap',
                }}>
                  <span>{tx.type === 'native' ? '💰 Native' : `🔸 ${tx.name || 'Token'}`}:</span>
                  {tx.tx_hash ? (
                    <>
                      <CopyButton text={tx.tx_hash} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{tx.tx_hash.slice(0, 18)}...</span>
                      <a href={`${chainCfg.explorer}/tx/${tx.tx_hash}`} target="_blank" rel="noopener noreferrer" className="explorer-link">↗ Explorer</a>
                    </>
                  ) : (
                    <span style={{ color: '#ef4444' }}>❌ {tx.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Backend startup instructions when offline */}
          {backendAvailable === false && (
            <div style={{
              marginTop: 12, fontSize: 11, color: '#888',
              borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10,
            }}>
              ⚠ Simulated — the server is offline. To execute real transactions, start the backend:
              <code style={{
                display: 'block', background: 'rgba(0,0,0,0.3)',
                padding: '8px 12px', borderRadius: 6, marginTop: 6,
                fontSize: 11, fontFamily: 'var(--font-mono)',
              }}>
                python server.py
              </code>
              <span style={{ display: 'block', marginTop: 4 }}>
                Set your relayer keys: <code>export ETH_RELAYER_KEY="0x..."</code>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
