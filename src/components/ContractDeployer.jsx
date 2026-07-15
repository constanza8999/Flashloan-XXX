import React, { useState, useCallback } from 'react'
import { ethers } from 'ethers'
import { ETH_RPCS, BSC_RPCS, ETH_CHAIN_ID, BSC_CHAIN_ID } from '../constants'
import { useProvider } from '../hooks'
import { useWeb3 } from '../context/Web3Context'
import CopyButton from './shared/CopyButton'
import LoadingButton from './shared/LoadingButton'
import ErrorBox from './shared/ErrorBox'

const FLASH_ARBITRAGE_BYTECODE = '0x' // In production, load from compiled artifact

const CONSTRUCTOR_PARAMS = [
  { name: 'addressProvider (Aave Pool)', key: 'addressProvider', placeholder: '0x... (Aave PoolAddressesProvider)' },
  { name: 'trustedForwarder (EIP-2771)', key: 'trustedForwarder', placeholder: '0x... (TrustedForwarder contract)' },
  { name: 'WETH / WBNB', key: 'weth', placeholder: '0x... (Wrapped native token)' },
  { name: 'USDT', key: 'usdt', placeholder: '0x... (USDT token address)' },
  { name: 'SwapRouter V3', key: 'swapRouter03', placeholder: '0x... (Uniswap/PancakeSwap V3 router)' },
  { name: 'SwapRouter V2', key: 'swapRouter02', placeholder: '0x... (Uniswap/PancakeSwap V2 router)' },
  { name: 'DEX Aggregator', key: 'dexAggregator', placeholder: '0x... (0x / ParaSwap / Li.Fi)' },
]

const DEFAULT_ADDRESSES = {
  ethereum: {
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    swapRouter03: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    swapRouter02: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    dexAggregator: '0xdef1c0ded9bec7f1a1670819833240f027b25eff',
    addressProvider: '0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e',
    trustedForwarder: '',
  },
  bsc: {
    weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    usdt: '0x55d398326f99059fF775485246999027B3197955',
    swapRouter03: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
    swapRouter02: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    dexAggregator: '0xdef1c0ded9bec7f1a1670819833240f027b25eff',
    addressProvider: '0x0180085d4546857dfF58223c6c97C3A000A85501',
    trustedForwarder: '',
  },
}

export default function ContractDeployer() {
  const ethProvider = useProvider(ETH_RPCS)
  const bscProvider = useProvider(BSC_RPCS)
  const { signer, walletAddress, isConnected, connectWallet, chainId } = useWeb3()

  const [chain, setChain] = useState('ethereum')
  const [contractName, setContractName] = useState('FlashArbitrage')
  const [params, setParams] = useState({
    addressProvider: '',
    trustedForwarder: '',
    weth: '',
    usdt: '',
    swapRouter03: '',
    swapRouter02: '',
    dexAggregator: '',
  })
  const [logs, setLogs] = useState([])
  const [deploying, setDeploying] = useState(false)
  const [deployedAddress, setDeployedAddress] = useState('')
  const [txHash, setTxHash] = useState('')
  const [error, setError] = useState('')

  const addLog = useCallback((msg, type = 'info') => {
    setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg, type }, ...prev].slice(0, 100))
  }, [])

  const fillDefaults = useCallback((selectedChain) => {
    const defaults = DEFAULT_ADDRESSES[selectedChain]
    if (!defaults) return
    setParams(prev => ({ ...prev, ...defaults }))
    addLog(`Filled default addresses for ${selectedChain}`, 'info')
  }, [addLog])

  const handleParamChange = (key, value) => {
    setParams(prev => ({ ...prev, [key]: value }))
  }

  const validateParams = () => {
    const required = CONSTRUCTOR_PARAMS.map(p => p.key)
    for (const key of required) {
      if (!params[key] || !ethers.isAddress(params[key])) {
        addLog(`❌ Invalid or missing: ${CONSTRUCTOR_PARAMS.find(p => p.key === key)?.name}`, 'error')
        return false
      }
    }
    return true
  }

  const handleDeploy = async () => {
    setError('')
    setDeployedAddress('')
    setTxHash('')

    if (!signer) {
      setError('Connect a wallet to deploy')
      return
    }
    if (!validateParams()) {
      setError('Fix the invalid parameters before deploying')
      return
    }

    setDeploying(true)
    addLog(`🚀 Deploying ${contractName} on ${chain}...`, 'info')
    addLog('  Building constructor arguments...', 'info')

    try {
      const provider = chain === 'ethereum' ? ethProvider : bscProvider
      if (!provider) {
        throw new Error(`No provider for ${chain}`)
      }

      // Encode constructor arguments
      const abiCoder = ethers.AbiCoder.defaultAbiCoder()
      const constructorArgs = abiCoder.encode(
        ['address', 'address', 'address', 'address', 'address', 'address', 'address'],
        [
          ethers.getAddress(params.addressProvider),
          ethers.getAddress(params.trustedForwarder),
          ethers.getAddress(params.weth),
          ethers.getAddress(params.usdt),
          ethers.getAddress(params.swapRouter03),
          ethers.getAddress(params.swapRouter02),
          ethers.getAddress(params.dexAggregator),
        ]
      )

      addLog('  Constructor args encoded ✅', 'success')

      // Deploy the contract
      const factory = new ethers.ContractFactory(
        [],  // ABI not needed for deploy
        FLASH_ARBITRAGE_BYTECODE,
        signer
      )

      addLog('  Sending deploy transaction...', 'info')

      // Estimate gas first
      const deployTx = await signer.sendTransaction({
        data: FLASH_ARBITRAGE_BYTECODE + constructorArgs.slice(2),
        gasLimit: 4000000n,
      })

      setTxHash(deployTx.hash)
      addLog(`  Deploy tx sent: ${deployTx.hash.slice(0, 18)}...`, 'success')

      // Wait for confirmation
      addLog('  Waiting for confirmation...', 'info')
      const receipt = await deployTx.wait()

      const contractAddress = receipt.contractAddress
      setDeployedAddress(contractAddress)
      addLog(`  ✅ Deployed at: ${contractAddress}`, 'profit')
      addLog(`  Block: ${receipt.blockNumber} | Gas: ${receipt.gasUsed.toString()}`, 'info')

      // Save to localStorage
      try {
        const key = `flashloan_deployed_${chain}`
        const existing = JSON.parse(localStorage.getItem(key) || '[]')
        existing.unshift({
          address: contractAddress,
          name: contractName,
          chain,
          txHash: deployTx.hash,
          blockNumber: receipt.blockNumber,
          timestamp: Date.now(),
          params: { ...params },
        })
        localStorage.setItem(key, JSON.stringify(existing.slice(0, 10)))
        addLog('  💾 Saved to localStorage', 'success')
      } catch { /* ignore */ }

      addLog(`(done) ✅ ${contractName} deployed successfully on ${chain}!`, 'profit')

    } catch (err) {
      const msg = err.reason || err.message || 'Unknown deploy error'
      setError(msg)
      addLog(`❌ Deploy failed: ${msg}`, 'error')
    }

    setDeploying(false)
  }

  const isAllFilled = CONSTRUCTOR_PARAMS.every(p => params[p.key] && ethers.isAddress(params[p.key]))

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">📦</span>
        <div>
          <h2>Contract Deployer</h2>
          <p>Deploy FlashArbitrage smart contracts to Ethereum or BSC</p>
        </div>
      </div>

      {/* Status bar */}
      <div className="stats-bar">
        <div className="stat">
          <span className="stat-label">Chain</span>
          <span className="stat-value" style={{ fontSize: 16, color: '#60a5fa' }}>
            {chain === 'ethereum' ? '🔵 Ethereum' : '🟡 BSC'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Wallet</span>
          <span className="stat-value" style={{
            fontSize: 14, color: isConnected ? '#22c55e' : '#ef4444',
          }}>
            {isConnected ? `✅ ${walletAddress?.slice(0, 8)}...` : '❌ Not connected'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Deployments</span>
          <span className="stat-value" style={{ fontSize: 14, color: '#a78bfa' }}>
            {deployedAddress ? '✅ 1 deployed' : '—'}
          </span>
        </div>
      </div>

      {/* Connection */}
      {!isConnected && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className="btn btn-primary" onClick={() => connectWallet('metamask')} style={{ fontSize: 12, padding: '10px 18px' }}>
            🦊 Connect MetaMask
          </button>
          <button className="btn btn-secondary" onClick={() => connectWallet('walletconnect')} style={{ fontSize: 12, padding: '10px 18px' }}>
            🔗 WalletConnect
          </button>
        </div>
      )}

      {/* Config */}
      <div className="config-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>⚙️ Deploy Configuration</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-secondary" onClick={() => fillDefaults('ethereum')} style={{ fontSize: 10, padding: '4px 10px' }}>
              🔵 ETH Defaults
            </button>
            <button className="btn btn-secondary" onClick={() => fillDefaults('bsc')} style={{ fontSize: 10, padding: '4px 10px' }}>
              🟡 BSC Defaults
            </button>
          </div>
        </div>

        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="form-group">
            <label>Chain</label>
            <select className="input" value={chain} onChange={e => setChain(e.target.value)} style={{ fontSize: 12 }}>
              <option value="ethereum">🔵 Ethereum</option>
              <option value="bsc">🟡 BSC (BNB Chain)</option>
            </select>
          </div>
          <div className="form-group">
            <label>Contract Name</label>
            <input type="text" className="input mono" value={contractName} onChange={e => setContractName(e.target.value)} style={{ fontSize: 12, fontFamily: 'monospace' }} />
          </div>
        </div>

        <div style={{ marginTop: 12, fontSize: 11, color: '#888', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Constructor Parameters
        </div>

        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {CONSTRUCTOR_PARAMS.map(p => (
            <div key={p.key} className="form-group">
              <label>{p.name}</label>
              <input
                type="text"
                className="input mono"
                value={params[p.key]}
                onChange={e => handleParamChange(p.key, e.target.value)}
                placeholder={p.placeholder}
                style={{
                  fontSize: 11,
                  borderColor: params[p.key] && !ethers.isAddress(params[p.key])
                    ? 'rgba(239,68,68,0.4)' : 'var(--border)',
                }}
              />
            </div>
          ))}
        </div>

        {/* Gas estimate */}
        <div style={{
          marginTop: 12, padding: '8px 12px', borderRadius: 6,
          background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.12)',
          fontSize: 11, color: '#a3a3a3',
        }}>
          <strong style={{ color: '#818cf8' }}>Estimated Gas: ~4,000,000</strong>
          <span style={{ marginLeft: 8 }}>
            (deploy cost varies by chain — typically $5-20 USD)
          </span>
        </div>

        {/* Deploy button */}
        <div className="form-actions" style={{ marginTop: 16 }}>
          <LoadingButton
            loading={deploying}
            loadingText="⏳ Deploying..."
            onClick={handleDeploy}
            disabled={!isConnected || !signer || !isAllFilled}
            style={{
              fontSize: 14, padding: '12px 28px',
              background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
              border: 'none',
            }}
          >
            📦 Deploy {contractName} to {chain === 'ethereum' ? 'Ethereum' : 'BSC'}
          </LoadingButton>
        </div>
      </div>

      {/* Deployed result */}
      {deployedAddress && (
        <div className="result-panel success" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>✅ Contract Deployed</h3>
            <span style={{ fontSize: 10, color: '#22c55e', background: 'rgba(34,197,94,0.1)', padding: '3px 8px', borderRadius: 4 }}>
              {chain === 'ethereum' ? '🔵 Ethereum' : '🟡 BSC'}
            </span>
          </div>

          <div className="result-grid" style={{ marginTop: 12 }}>
            <div className="result-item">
              <span className="ri-label">Contract Address</span>
              <span className="ri-value mono" style={{ fontSize: 13, wordBreak: 'break-all' }}>{deployedAddress}</span>
            </div>
            {txHash && (
              <div className="result-item">
                <span className="ri-label">Deploy Tx</span>
                <span className="ri-value mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{txHash}</span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <CopyButton text={deployedAddress} />
            {deployedAddress && (
              <a
                href={`${chain === 'ethereum' ? 'https://etherscan.io' : 'https://bscscan.com'}/address/${deployedAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="explorer-link"
                style={{ fontSize: 12 }}
              >
                ↗ View on {chain === 'ethereum' ? 'Etherscan' : 'BscScan'}
              </a>
            )}
            {txHash && (
              <a
                href={`${chain === 'ethereum' ? 'https://etherscan.io' : 'https://bscscan.com'}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="explorer-link"
                style={{ fontSize: 12 }}
              >
                ↗ Deploy Tx on Explorer
              </a>
            )}
          </div>

          {/* Save to Relay Nodes */}
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 6,
            background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)',
            fontSize: 11,
          }}>
            <strong style={{ color: '#fbbf24' }}>💡 Next steps</strong>
            <ul style={{ margin: '4px 0 0 16px', color: '#a3a3a3', lineHeight: 1.6 }}>
              <li>Go to <strong>Relay Nodes</strong> → enter this contract address in the withdraw panel</li>
              <li>Go to <strong>Arbitrage Dashboard</strong> → configure validator bribes on this contract</li>
              <li>Go to <strong>Withdraw</strong> page to manage funds on the deployed contract</li>
            </ul>
          </div>
        </div>
      )}

      {/* Error */}
      {error && <ErrorBox style={{ marginTop: 16 }}>{error}</ErrorBox>}

      {/* Logs */}
      {logs.length > 0 && (
        <div className="log-panel" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>📋 Deploy Log</h3>
            <button className="btn btn-secondary" onClick={() => setLogs([])} style={{ fontSize: 10, padding: '4px 10px' }}>Clear</button>
          </div>
          <div className="log-container" style={{ maxHeight: 200 }}>
            {logs.map((log, i) => (
              <div key={i} className={'log-entry ' + log.type}>
                <span className="log-time">{log.time}</span>
                <span className="log-msg">{log.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="error-box" style={{
        borderColor: 'rgba(99,102,241,0.2)', background: 'rgba(99,102,241,0.04)', marginTop: 20,
      }}>
        <span className="error-icon" style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>ℹ️</span>
        <div>
          <strong style={{ color: '#818cf8', fontSize: 13 }}>About the FlashArbitrage Contract</strong>
          <p style={{ color: '#a3a3a3', marginTop: 4, fontSize: 11, lineHeight: 1.5 }}>
            The FlashArbitrage contract executes flash loan arbitrage across DEXes on Ethereum and BSC.
            It supports Aave V3 flash loans, Uniswap V2/V3 and PancakeSwap swaps, MEV bundles via Flashbots,
            cross-chain swaps, and EIP-2771 meta-transactions. Constructor parameters specify the Aave
            PoolAddressesProvider, TrustedForwarder, token addresses, and router addresses for the target chain.
          </p>
        </div>
      </div>
    </div>
  )
}
