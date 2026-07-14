import React, { useState } from 'react'
import { ethers } from 'ethers'
import { POPULAR_BEP20, POPULAR_ERC20, BSC_RPCS, ETH_RPCS } from '../constants'
import { useProvider } from '../hooks'

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]

export default function TokenInfo() {
  const [chain, setChain] = useState('bsc')
  const [token, setToken] = useState('USDT')
  const [customAddress, setCustomAddress] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const catalog = chain === 'bsc' ? POPULAR_BEP20 : POPULAR_ERC20
  const rpcs = chain === 'bsc' ? BSC_RPCS : ETH_RPCS
  const explorer = chain === 'bsc' ? 'https://bscscan.com/token/' : 'https://etherscan.io/token/'
  const w3 = useProvider(rpcs)

  const getAddress = () => {
    if (token === 'CUSTOM') return customAddress.trim()
    return catalog[token]
  }

  const handleLookup = async () => {
    setError('')
    setResult(null)
    const addr = getAddress()
    if (!addr || !ethers.isAddress(addr)) { setError('Invalid token address'); return }
    if (!w3) { setError('Not connected to RPC'); return }

    setLoading(true)
    try {
      const contract = new ethers.Contract(addr, ERC20_ABI, w3)
      const [symbol, name, decimals, totalSupply, balance] = await Promise.all([
        contract.symbol().catch(() => '?'),
        contract.name().catch(() => '?'),
        contract.decimals().catch(() => '?'),
        contract.totalSupply().catch(() => null),
        walletAddress && ethers.isAddress(walletAddress)
          ? contract.balanceOf(ethers.getAddress(walletAddress)).catch(() => null)
          : null,
      ])

      const data = {
        address: ethers.getAddress(addr),
        symbol,
        name,
        decimals: Number(decimals),
        totalSupply: totalSupply ? ethers.formatUnits(totalSupply, decimals) : null,
        walletBalance: balance ? ethers.formatUnits(balance, decimals) : null,
        walletAddress: walletAddress && ethers.isAddress(walletAddress) ? ethers.getAddress(walletAddress) : null,
      }
      setResult(data)
    } catch (err) {
      setError(err.message || 'Failed to fetch token info')
    }
    setLoading(false)
  }

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">◎</span>
        <div>
          <h2>Token Info Lookup</h2>
          <p>Query token decimals, symbol, supply, and wallet balance from any contract</p>
        </div>
      </div>

      <div className="form-grid">
        <div className="form-group">
          <label>Chain</label>
          <div className="chain-toggle">
            <button className={`chain-btn ${chain === 'bsc' ? 'active' : ''}`} onClick={() => setChain('bsc')}>
              ⛓ BSC
            </button>
            <button className={`chain-btn ${chain === 'eth' ? 'active' : ''}`} onClick={() => setChain('eth')}>
              🛡 ETH
            </button>
          </div>
        </div>

        <div className="form-group">
          <label>Token</label>
          <select value={token} onChange={e => setToken(e.target.value)} className="input">
            {Object.entries(catalog).map(([sym, addr]) => (
              <option key={sym} value={sym}>{sym} — {addr.slice(0, 8)}...</option>
            ))}
            <option value="CUSTOM">Custom Address</option>
          </select>
          {token === 'CUSTOM' && (
            <input
              type="text"
              value={customAddress}
              onChange={e => setCustomAddress(e.target.value)}
              placeholder="0x token contract address"
              className="input mono"
              style={{ marginTop: 8 }}
            />
          )}
        </div>

        <div className="form-group">
          <label>Wallet Address (optional, for balance)</label>
          <input
            type="text"
            value={walletAddress}
            onChange={e => setWalletAddress(e.target.value)}
            placeholder="0x... (leave empty to skip balance)"
            className="input mono"
          />
        </div>
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" onClick={handleLookup} disabled={loading || !w3}>
          {loading ? '🔍 Fetching...' : '🔍 Lookup Token'}
        </button>
      </div>

      {error && <div className="error-box"><span className="error-icon">✕</span> {error}</div>}

      {result && (
        <div className="result-card">
          <h3>{result.name} <span className="highlight">({result.symbol})</span></h3>
          <div className="result-grid">
            <div className="result-item">
              <span className="ri-label">Contract</span>
              <span className="ri-value mono">{result.address}</span>
              <a href={explorer + result.address} target="_blank" rel="noopener noreferrer" className="explorer-sm">View on Explorer →</a>
            </div>
            <div className="result-item">
              <span className="ri-label">Symbol</span>
              <span className="ri-value">{result.symbol}</span>
            </div>
            <div className="result-item">
              <span className="ri-label">Name</span>
              <span className="ri-value">{result.name}</span>
            </div>
            <div className="result-item">
              <span className="ri-label">Decimals</span>
              <span className="ri-value">{result.decimals}</span>
            </div>
            {result.totalSupply !== null && (
              <div className="result-item">
                <span className="ri-label">Total Supply</span>
                <span className="ri-value">{parseFloat(result.totalSupply).toLocaleString(undefined, { maximumFractionDigits: 2 })} {result.symbol}</span>
              </div>
            )}
            {result.walletBalance !== null && (
              <div className="result-item">
                <span className="ri-label">Wallet Balance</span>
                <span className="ri-value">{parseFloat(result.walletBalance).toLocaleString(undefined, { maximumFractionDigits: 6 })} {result.symbol}</span>
              </div>
            )}
            {result.walletAddress && (
              <div className="result-item">
                <span className="ri-label">Wallet</span>
                <span className="ri-value mono">{result.walletAddress.slice(0, 10)}...{result.walletAddress.slice(-6)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
