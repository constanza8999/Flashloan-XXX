import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { ethers } from 'ethers'
import {
  ETH_RPCS, BSC_RPCS, POLYGON_RPCS, ARBITRUM_RPCS,
  ETH_CHAIN_ID, BSC_CHAIN_ID, POLYGON_CHAIN_ID, ARBITRUM_CHAIN_ID,
  POPULAR_ERC20, POPULAR_BEP20, POPULAR_POLYGON, POPULAR_ARBITRUM,
  TRANSFER_SELECTOR, NATIVE_SEND_GAS, DEFAULT_RECIPIENT,
  KNOWN_TOKEN_DECIMALS,
} from '../constants'
import { useProvider } from '../hooks'
import { useWeb3 } from '../context/Web3Context'
import { encodeTransfer } from '../utils'
import useTransactionHistory from '../hooks/useTransactionHistory'
import useTelegram from '../hooks/useTelegram'
import SigningMethod from './SigningMethod'
import CopyButton from './shared/CopyButton'
import LoadingButton from './shared/LoadingButton'

// ─── Chain config ──────────────────────────────────────────────────────
const CHAINS = {
  ethereum: {
    id: 'ethereum', label: 'Ethereum', icon: '🔵', chainId: ETH_CHAIN_ID,
    rpcs: ETH_RPCS, nativeSymbol: 'ETH', explorer: 'https://etherscan.io/tx/',
    decimals: 18, tokens: POPULAR_ERC20, color: '#3b82f6',
  },
  bsc: {
    id: 'bsc', label: 'BNB Chain', icon: '🟡', chainId: BSC_CHAIN_ID,
    rpcs: BSC_RPCS, nativeSymbol: 'BNB', explorer: 'https://bscscan.com/tx/',
    decimals: 18, tokens: POPULAR_BEP20, color: '#22c55e',
  },
  polygon: {
    id: 'polygon', label: 'Polygon', icon: '🔶', chainId: POLYGON_CHAIN_ID,
    rpcs: POLYGON_RPCS, nativeSymbol: 'MATIC', explorer: 'https://polygonscan.com/tx/',
    decimals: 18, tokens: POPULAR_POLYGON, color: '#a855f7',
  },
  arbitrum: {
    id: 'arbitrum', label: 'Arbitrum', icon: '🌀', chainId: ARBITRUM_CHAIN_ID,
    rpcs: ARBITRUM_RPCS, nativeSymbol: 'ETH', explorer: 'https://arbiscan.io/tx/',
    decimals: 18, tokens: POPULAR_ARBITRUM, color: '#06b6d4',
  },
}

// ─── FlashArbitrage ABI for rescueNative ───────────────────────────────
const FLASH_ARBITRAGE_ABI = [
  { "constant": false, "inputs": [], "name": "rescueNative", "outputs": [], "type": "function" },
  { "constant": true, "inputs": [], "name": "owner", "outputs": [{ "name": "", "type": "address" }], "type": "function" },
]

// ─── ERC20 balance ABI ────────────────────────────────────────────────
const ERC20_ABI = [
  { "constant": true, "inputs": [{ "name": "_owner", "type": "address" }], "name": "balanceOf", "outputs": [{ "name": "", "type": "uint256" }], "type": "function" },
  { "constant": true, "inputs": [], "name": "decimals", "outputs": [{ "name": "", "type": "uint8" }], "type": "function" },
  { "constant": true, "inputs": [], "name": "symbol", "outputs": [{ "name": "", "type": "string" }], "type": "function" },
]

const LS_KEY_RELAY_NODES = 'flashloan_relay_discovered_nodes'
const LS_KEY_CONTRACT_ADDR = 'flashloan_flash_arbitrage_addr'

// Source types
const SOURCES = {
  wallet: { id: 'wallet', label: '🔌 Connected Wallet', desc: 'Send from your connected wallet balance' },
  relay: { id: 'relay', label: '🗼 Relay Nodes', desc: 'Send from aggregated relay node balances' },
  contract: { id: 'contract', label: '📜 FlashArbitrage Contract', desc: 'Rescue native tokens from the deployed contract' },
}

export default function UniversalSend() {
  const { signer: walletSigner, walletAddress, isConnected, connectWallet, walletType } = useWeb3()
  const { addTx, updateTxStatus } = useTransactionHistory()
  const { notifyTx } = useTelegram()

  // ─── Providers ──────────────────────────────────────────────────────
  const ethProvider = useProvider(ETH_RPCS)
  const bscProvider = useProvider(BSC_RPCS)
  const polygonProvider = useProvider(POLYGON_RPCS)
  const arbitrumProvider = useProvider(ARBITRUM_RPCS)

  const providerMap = {
    ethereum: ethProvider, bsc: bscProvider,
    polygon: polygonProvider, arbitrum: arbitrumProvider,
  }

  // ─── State ──────────────────────────────────────────────────────────
  const [source, setSource] = useState('wallet')
  const [privateKey, setPrivateKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [useWalletSign, setUseWalletSign] = useState(false)
  const [derivedSender, setDerivedSender] = useState('')
  const [destChain, setDestChain] = useState('ethereum')
  const [destAddress, setDestAddress] = useState(DEFAULT_RECIPIENT)
  const [tokenType, setTokenType] = useState('native') // 'native' | 'erc20'
  const [selectedToken, setSelectedToken] = useState('USDT')
  const [customTokenAddr, setCustomTokenAddr] = useState('')
  const [amount, setAmount] = useState('')
  const [gasPriceGwei, setGasPriceGwei] = useState('')
  const [gasLimit, setGasLimit] = useState(String(NATIVE_SEND_GAS))

  // Auto-enable wallet when connected; derive sender from private key
  useEffect(() => { if (isConnected) setUseWalletSign(true) }, [isConnected])

  useEffect(() => {
    try {
      const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
      if (pk.length === 66) {
        setDerivedSender(new ethers.Wallet(pk).address)
      } else {
        setDerivedSender('')
      }
    } catch { setDerivedSender('') }
  }, [privateKey])

  // ─── Balances ───────────────────────────────────────────────────────
  const [walletBalance, setWalletBalance] = useState(null)
  const [walletBalanceLoading, setWalletBalanceLoading] = useState(false)
  const [relayNodes, setRelayNodes] = useState([])
  const [contractBalance, setContractBalance] = useState(null)
  const [tokenBalances, setTokenBalances] = useState({})
  const [balancesLoading, setBalancesLoading] = useState(false)

  // ─── Send state ─────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false)
  const [logs, setLogs] = useState([])
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [sendProgress, setSendProgress] = useState(null)

  const destChainCfg = CHAINS[destChain]
  const provider = providerMap[destChain]
  const isNative = tokenType === 'native'
  const addLog = useCallback((msg, type = 'info') => {
    setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg: String(msg), type }, ...prev].slice(0, 50))
  }, [])

  // ─── Load relay nodes from localStorage ─────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY_RELAY_NODES)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) setRelayNodes(parsed)
      }
    } catch { /* ignore */ }
  }, [])

  // ─── Compute total relay balance ────────────────────────────────────
  const totalRelayBalance = useMemo(() =>
    relayNodes.reduce((s, n) => s + (parseFloat(n.balanceEth) || 0), 0), [relayNodes]
  )

  // ─── Fetch wallet balance ───────────────────────────────────────────
  const fetchWalletBalance = useCallback(async () => {
    if (!walletAddress || !provider) return
    setWalletBalanceLoading(true)
    try {
      const bal = await provider.getBalance(walletAddress)
      setWalletBalance(ethers.formatEther(bal))
    } catch { setWalletBalance(null) }
    setWalletBalanceLoading(false)
  }, [walletAddress, provider])

  useEffect(() => { if (source === 'wallet') fetchWalletBalance() }, [source, fetchWalletBalance])

  // ─── Fetch contract balance ─────────────────────────────────────────
  const fetchContractBalance = useCallback(async () => {
    const addr = localStorage.getItem(LS_KEY_CONTRACT_ADDR)
    if (!addr || !ethers.isAddress(addr) || !provider) {
      setContractBalance(null); return
    }
    setBalancesLoading(true)
    try {
      const bal = await provider.getBalance(ethers.getAddress(addr))
      setContractBalance(ethers.formatEther(bal))
    } catch { setContractBalance(null) }
    setBalancesLoading(false)
  }, [provider])

  useEffect(() => { if (source === 'contract') fetchContractBalance() }, [source, fetchContractBalance])

  // ─── Auto-update gas price ──────────────────────────────────────────
  useEffect(() => {
    if (!provider) return
    provider.getFeeData().then(data => {
      const gp = data.gasPrice || data.maxFeePerGas || ethers.parseUnits('10', 'gwei')
      setGasPriceGwei(parseFloat(ethers.formatUnits(gp, 'gwei')).toFixed(2))
    }).catch(() => setGasPriceGwei('10.00'))
  }, [provider])

  // ─── Get token address ──────────────────────────────────────────────
  const getTokenAddress = useCallback(() => {
    if (isNative) return ''
    const tokens = destChainCfg.tokens
    if (selectedToken === 'CUSTOM') return customTokenAddr.trim()
    return tokens[selectedToken] || ''
  }, [isNative, destChainCfg, selectedToken, customTokenAddr])

  // ─── Available balance display ──────────────────────────────────────
  const availableBalance = useMemo(() => {
    if (source === 'wallet') return walletBalance
    if (source === 'relay') return String(totalRelayBalance)
    if (source === 'contract') return contractBalance
    return null
  }, [source, walletBalance, totalRelayBalance, contractBalance])

  const sourceLabel = useMemo(() => {
    if (source === 'wallet') return isConnected ? `Wallet: ${walletAddress?.slice(0, 8)}...` : 'Wallet'
    if (source === 'relay') return `${relayNodes.length} relay nodes`
    if (source === 'contract') return 'FlashArbitrage Contract'
    return 'Unknown'
  }, [source, isConnected, walletAddress, relayNodes.length])

  const balanceSymbol = isNative ? destChainCfg.nativeSymbol : selectedToken

  // ─── Send handler ───────────────────────────────────────────────────
  const handleSend = async () => {
    setError('')
    setResult(null)

    // Validate
    const dest = destAddress.trim()
    if (!dest || !ethers.isAddress(dest)) { setError('❌ Invalid destination address'); return }
    if (!amount || parseFloat(amount) <= 0) { setError('❌ Invalid amount'); return }

    // Determine signer
    let activeSigner = null
    if (useWalletSign && isConnected && walletSigner) {
      activeSigner = walletSigner
    } else if (!useWalletSign && privateKey) {
      const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
      if (pk.length === 66) {
        activeSigner = new ethers.Wallet(pk).connect(chainProvider)
      }
    }

    if (!activeSigner) {
      setError(useWalletSign ? '❌ Connect a wallet first' : '❌ Valid private key required')
      setLoading(false)
      return
    }

    if (!isNative && !getTokenAddress()) { setError('❌ Invalid token address'); return }

    if (!provider) { setError('❌ No RPC connection for selected chain'); return }

    const available = parseFloat(availableBalance || '0')
    if (available <= 0) { setError('❌ No balance available from this source'); return }
    if (parseFloat(amount) > available) {
      setError(`❌ Amount (${amount}) exceeds available balance (${available.toFixed(6)} ${balanceSymbol})`)
      return
    }

    setLoading(true)
    setSendProgress({ status: 'preparing', msg: 'Preparing transaction...' })

    try {
      const destAddr = ethers.getAddress(dest)
      const chainCfg = destChainCfg
      const chainProvider = provider
      const feeData = await chainProvider.getFeeData()
      const gp = ethers.parseUnits(gasPriceGwei || '10', 'gwei')

      let tokenAddr = ''
      let decimals = chainCfg.decimals
      let amountWei

      if (isNative) {
        amountWei = ethers.parseEther(amount)
      } else {
        tokenAddr = getTokenAddress()
        decimals = KNOWN_TOKEN_DECIMALS[tokenAddr.toLowerCase()] || 18
        try {
          const tc = new ethers.Contract(ethers.getAddress(tokenAddr), ERC20_ABI, chainProvider)
          decimals = await tc.decimals().catch(() => decimals)
        } catch { /* use default */ }
        amountWei = ethers.parseUnits(amount, decimals)
      }

      const senderAddr = useWalletSign ? walletAddress : derivedSender

      // ── WALLET SOURCE ─────────────────────────────────────────────────
      if (source === 'wallet') {
        setSendProgress({ status: 'sending', msg: `Sending ${amount} ${balanceSymbol} via ${useWalletSign ? 'wallet' : 'private key'}...` })
        addLog(`🔌 Sending ${amount} ${balanceSymbol} from ${useWalletSign ? 'wallet' : 'key'} → ${destAddr.slice(0, 10)}...`, 'info')

        // Build tx differently for wallet (EIP-1559) vs private key (legacy gas + nonce)
        let finalTx
        if (useWalletSign) {
          finalTx = isNative
            ? { to: destAddr, value: amountWei, gasLimit: BigInt(NATIVE_SEND_GAS), maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei'), maxFeePerGas: feeData.maxFeePerGas || gp }
            : {
                to: ethers.getAddress(tokenAddr),
                value: 0n,
                gasLimit: BigInt(gasLimit),
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei'),
                maxFeePerGas: feeData.maxFeePerGas || gp,
                data: encodeTransfer(destAddr, amountWei, TRANSFER_SELECTOR),
              }
        } else {
          const nonce = await chainProvider.getTransactionCount(senderAddr)
          finalTx = isNative
            ? { to: destAddr, value: amountWei, gasLimit: BigInt(NATIVE_SEND_GAS), gasPrice: gp, nonce, chainId: chainCfg.chainId }
            : {
                to: ethers.getAddress(tokenAddr),
                value: 0n,
                gasLimit: BigInt(gasLimit),
                gasPrice: gp,
                nonce,
                chainId: chainCfg.chainId,
                data: encodeTransfer(destAddr, amountWei, TRANSFER_SELECTOR),
              }
        }

        const sentTx = await activeSigner.sendTransaction(finalTx)

        setSendProgress({ status: 'confirming', msg: '⏳ Waiting for confirmation...' })
        addLog(`  Tx sent: ${sentTx.hash.slice(0, 18)}...`, 'success')

        const receipt = await sentTx.wait()
        const explorerUrl = chainCfg.explorer + sentTx.hash
        addLog(`  ✅ Confirmed in block ${receipt.blockNumber}!`, 'profit')
        addLog(`  🔗 ${explorerUrl}`, 'link')

        const txId = addTx({
          chain: `${chainCfg.label} (Universal)`,
          status: 'confirmed',
          tokenSymbol: balanceSymbol,
          tokenAddress: tokenAddr,
          amount,
          recipient: destAddr,
          sender: senderAddr,
          txHash: sentTx.hash,
          explorerUrl,
          method: useWalletSign ? 'wallet' : 'key',
        })
        updateTxStatus(txId, 'confirmed', { blockNumber: receipt.blockNumber })
        notifyTx({
          chain: chainCfg.label,
          tokenSymbol: balanceSymbol,
          amount,
          txHash: sentTx.hash,
          explorerUrl,
          sender: senderAddr,
          recipient: destAddr,
          status: 'confirmed',
        })

        setResult({ txHash: sentTx.hash, explorerUrl, amount, symbol: balanceSymbol, chain: chainCfg.label, destination: destAddr })
        addLog(`✅ ${amount} ${balanceSymbol} sent to ${destAddr.slice(0, 10)}...`, 'profit')

        if (useWalletSign) fetchWalletBalance()
      }

      // ── RELAY NODES SOURCE ────────────────────────────────────────────
      else if (source === 'relay') {
        const sendWei = ethers.parseEther(amount)
        setSendProgress({ status: 'sending', msg: `Sending ${amount} ${balanceSymbol} from relay nodes → ${destAddr.slice(0, 10)}...` })
        addLog(`🗼 Sending ${amount} ${balanceSymbol} from relay nodes via ${useWalletSign ? 'wallet' : 'key'}...`, 'info')

        const tx = useWalletSign
          ? {
              to: destAddr,
              value: sendWei,
              gasLimit: BigInt(NATIVE_SEND_GAS),
              maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei'),
              maxFeePerGas: feeData.maxFeePerGas || gp,
            }
          : {
              to: destAddr,
              value: sendWei,
              gasLimit: BigInt(NATIVE_SEND_GAS),
              gasPrice: gp,
              nonce: await chainProvider.getTransactionCount(senderAddr),
              chainId: chainCfg.chainId,
            }

        const sentTx = await activeSigner.sendTransaction(tx)
        setSendProgress({ status: 'confirming', msg: '⏳ Waiting for confirmation...' })
        addLog(`  Tx sent: ${sentTx.hash.slice(0, 18)}...`, 'success')

        const receipt = await sentTx.wait()
        const explorerUrl = chainCfg.explorer + sentTx.hash
        addLog(`  ✅ Confirmed in block ${receipt.blockNumber}!`, 'profit')
        addLog(`  🔗 ${explorerUrl}`, 'link')

        // Deduct from relay nodes proportionally
        const totalAvail = relayNodes.reduce((s, n) => s + (parseFloat(n.balanceEth) || 0), 0)
        const updatedNodes = relayNodes.map(n => ({
          ...n,
          balanceEth: totalAvail > 0
            ? Math.max(0, (parseFloat(n.balanceEth) || 0) - (sendWei > 0n ? (parseFloat(n.balanceEth) / totalAvail * parseFloat(amount)) : 0))
            : 0,
        }))
        setRelayNodes(updatedNodes)
        try { localStorage.setItem(LS_KEY_RELAY_NODES, JSON.stringify(updatedNodes)) } catch {}

        addTx({
          chain: `${chainCfg.label} (Relay)`,
          status: 'confirmed',
          tokenSymbol: balanceSymbol,
          tokenAddress: '',
          amount,
          recipient: destAddr,
          sender: senderAddr,
          txHash: sentTx.hash,
          explorerUrl,
          method: useWalletSign ? 'wallet' : 'key',
        })
        notifyTx({
          chain: chainCfg.label,
          tokenSymbol: balanceSymbol,
          amount,
          txHash: sentTx.hash,
          explorerUrl,
          sender: senderAddr,
          recipient: destAddr,
          status: 'confirmed',
        })

        setResult({ txHash: sentTx.hash, explorerUrl, amount, symbol: balanceSymbol, chain: chainCfg.label, destination: destAddr })
        addLog(`✅ ${amount} ${balanceSymbol} sent from relay nodes to ${destAddr.slice(0, 10)}...`, 'profit')
      }

      // ── CONTRACT SOURCE ───────────────────────────────────────────────
      else if (source === 'contract') {
        const contractAddr = localStorage.getItem(LS_KEY_CONTRACT_ADDR)
        if (!contractAddr || !ethers.isAddress(contractAddr)) {
          setError('❌ No FlashArbitrage contract address configured')
          setLoading(false)
          return
        }

        setSendProgress({ status: 'sending', msg: `Rescuing ${amount} ${balanceSymbol} from contract...` })
        addLog(`📜 Rescuing ${amount} ${balanceSymbol} from FlashArbitrage contract...`, 'info')

        const contract = new ethers.Contract(ethers.getAddress(contractAddr), FLASH_ARBITRAGE_ABI, activeSigner)

        if (isNative) {
          const tx = await contract.rescueNative({
            gasLimit: 100000n,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei'),
            maxFeePerGas: feeData.maxFeePerGas || gp,
          })
          setSendProgress({ status: 'confirming', msg: '⏳ Waiting for confirmation...' })
          addLog(`  Tx sent: ${tx.hash.slice(0, 18)}...`, 'success')

          const receipt = await tx.wait()
          const explorerUrl = chainCfg.explorer + tx.hash
          addLog(`  ✅ Confirmed in block ${receipt.blockNumber}!`, 'profit')
          addLog(`  🔗 ${explorerUrl}`, 'link')

          setResult({ txHash: tx.hash, explorerUrl, amount, symbol: balanceSymbol, chain: chainCfg.label, destination: destAddr })
          addLog(`✅ ${amount} ${balanceSymbol} rescued to ${destAddr.slice(0, 10)}...`, 'profit')
          setContractBalance('0')
        } else {
          const tokenAddr = getTokenAddress()
          const rescueAmount = ethers.parseUnits(amount, decimals)
          const tx = await contract.rescueTokens(ethers.getAddress(tokenAddr), rescueAmount, {
            gasLimit: 200000n,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei'),
            maxFeePerGas: feeData.maxFeePerGas || gp,
          })
          setSendProgress({ status: 'confirming', msg: '⏳ Waiting for confirmation...' })
          addLog(`  Tx sent: ${tx.hash.slice(0, 18)}...`, 'success')

          const receipt = await tx.wait()
          const explorerUrl = chainCfg.explorer + tx.hash
          addLog(`  ✅ Confirmed in block ${receipt.blockNumber}!`, 'profit')
          addLog(`  🔗 ${explorerUrl}`, 'link')

          setResult({ txHash: tx.hash, explorerUrl, amount, symbol: balanceSymbol, chain: chainCfg.label, destination: destAddr })
          addLog(`✅ ${amount} ${balanceSymbol} rescued to ${destAddr.slice(0, 10)}...`, 'profit')
        }
      }

    } catch (err) {
      setError(`❌ ${err.message || 'Transaction failed'}`)
      addLog(`❌ Failed: ${err.message}`, 'error')
    }

    setLoading(false)
    setSendProgress(null)
    setTimeout(() => setResult(null), 15000)
  }

  // ─── Quick-fill amount ──────────────────────────────────────────────
  const handleMaxAmount = () => {
    if (availableBalance) setAmount(parseFloat(availableBalance).toFixed(6))
  }

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">📤</span>
        <div>
          <h2>Universal Send</h2>
          <p>Send from any source (wallet, relay nodes, contract) to any address on any chain</p>
        </div>
      </div>

      {/* ─── Stats / Source Overview ──────────────────────────────────── */}
      <div className="stats-bar">
        <div className="stat">
          <span className="stat-label">Source</span>
          <span className="stat-value" style={{ fontSize: 14, color: '#60a5fa' }}>
            {source === 'wallet' && '🔌 Wallet'}
            {source === 'relay' && '🗼 Relay Nodes'}
            {source === 'contract' && '📜 Contract'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Available</span>
          <span className="stat-value" style={{ fontSize: 15, color: '#22c55e', fontFamily: 'var(--font-mono)' }}>
            {balancesLoading ? '⏳...' : availableBalance !== null ? `${parseFloat(availableBalance).toFixed(6)} ${balanceSymbol}` : '—'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Chain</span>
          <span className="stat-value" style={{ fontSize: 15, color: destChainCfg.color }}>
            {destChainCfg.icon} {destChainCfg.label}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">RPC</span>
          <span className="stat-value" style={{ fontSize: 14, color: provider ? '#22c55e' : '#ef4444' }}>
            {provider ? '🟢' : '🔴'}
          </span>
        </div>
      </div>

      {/* ─── Source Selector ──────────────────────────────────────────── */}
      <div className="config-panel" style={{ borderColor: 'rgba(59,130,246,0.2)' }}>
        <h3>📦 1. Select Source</h3>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {Object.values(SOURCES).map(s => (
            <button
              key={s.id}
              className={'btn ' + (source === s.id ? 'btn-primary' : 'btn-secondary')}
              onClick={() => setSource(s.id)}
              style={{
                fontSize: 12, padding: '14px 16px', height: '100%',
                flexDirection: 'column', gap: 4, textAlign: 'center',
                whiteSpace: 'normal', lineHeight: 1.4,
                background: source === s.id
                  ? 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(99,102,241,0.08))'
                  : undefined,
                border: source === s.id ? '1px solid rgba(59,130,246,0.3)' : undefined,
              }}
            >
              <span style={{ fontSize: 20 }}>{s.label.split(' ')[0]}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 400 }}>{s.desc}</span>
            </button>
          ))}
        </div>

        {/* Source-specific info */}
        {source === 'wallet' && !isConnected && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={() => connectWallet('metamask')} style={{ fontSize: 11, padding: '8px 14px' }}>
              🦊 Connect MetaMask
            </button>
            <button className="btn btn-secondary" onClick={() => connectWallet('walletconnect')} style={{ fontSize: 11, padding: '8px 14px' }}>
              🔗 WalletConnect
            </button>
            <span className="form-hint">Connect to send from your wallet balance</span>
          </div>
        )}
        {source === 'wallet' && isConnected && walletAddress && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)', fontSize: 12 }}>
            🟢 Connected: <span className="mono">{walletAddress.slice(0, 10)}...{walletAddress.slice(-6)}</span>
            <span style={{ marginLeft: 12, color: '#22c55e', fontFamily: 'var(--font-mono)' }}>
              Balance: {walletBalanceLoading ? '⏳' : walletBalance !== null ? `${parseFloat(walletBalance).toFixed(6)} ${destChainCfg.nativeSymbol}` : '—'}
            </span>
          </div>
        )}

        {source === 'relay' && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: 'rgba(52,211,153,0.04)', border: '1px solid rgba(52,211,153,0.1)', fontSize: 12 }}>
            🗼 <strong>{relayNodes.length}</strong> relay nodes · Total balance: <strong style={{ color: '#34d399', fontFamily: 'var(--font-mono)' }}>{totalRelayBalance.toFixed(4)} ETH</strong>
            <span className="form-hint" style={{ display: 'block', marginTop: 4 }}>
              Funds are sent from your wallet; relay balances are deducted proportionally
            </span>
            {!isConnected && (
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn btn-primary" onClick={() => connectWallet('metamask')} style={{ fontSize: 11, padding: '8px 14px' }}>
                  🦊 Connect MetaMask (pays gas)
                </button>
                <button className="btn btn-secondary" onClick={() => connectWallet('walletconnect')} style={{ fontSize: 11, padding: '8px 14px' }}>
                  🔗 WalletConnect
                </button>
              </div>
            )}
          </div>
        )}

        {source === 'contract' && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: 'rgba(168,85,247,0.04)', border: '1px solid rgba(168,85,247,0.1)', fontSize: 12 }}>
            📜 Contract:{' '}
            {(() => {
              const addr = localStorage.getItem(LS_KEY_CONTRACT_ADDR)
              return addr ? <span className="mono">{addr.slice(0, 10)}...{addr.slice(-6)}</span> : 'Not configured'
            })()}
            <span style={{ marginLeft: 12, color: '#a78bfa', fontFamily: 'var(--font-mono)' }}>
              Balance: {contractBalance !== null ? `${parseFloat(contractBalance).toFixed(6)} ETH` : '—'}
            </span>
            {!isConnected && (
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn btn-primary" onClick={() => connectWallet('metamask')} style={{ fontSize: 11, padding: '8px 14px' }}>
                  🦊 Connect MetaMask (owner wallet)
                </button>
                <button className="btn btn-secondary" onClick={() => connectWallet('walletconnect')} style={{ fontSize: 11, padding: '8px 14px' }}>
                  🔗 WalletConnect
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Signing Method ──────────────────────────────────────────── */}
      <SigningMethod
        useWalletSign={useWalletSign}
        setUseWalletSign={setUseWalletSign}
        privateKey={privateKey}
        setPrivateKey={setPrivateKey}
        showKey={showKey}
        setShowKey={setShowKey}
        senderAddress={derivedSender}
        label="🔑 Signing Method"
      />

      {/* ─── Configure Send ───────────────────────────────────────────── */}
      <div className="config-panel">
        <h3>🎯 2. Configure Send</h3>
        <div className="form-grid">
          {/* Destination chain */}
          <div className="form-group">
            <label>🌐 Destination Chain</label>
            <select className="input" value={destChain} onChange={e => { setDestChain(e.target.value); setTokenType('native'); setGasLimit(String(NATIVE_SEND_GAS)) }}>
              {Object.entries(CHAINS).map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {v.label}</option>
              ))}
            </select>
          </div>

          {/* Destination address */}
          <div className="form-group">
            <label>📍 Destination Address</label>
            <input
              type="text" className="input mono" value={destAddress}
              onChange={e => setDestAddress(e.target.value)}
              placeholder="0x... (any wallet address)"
              style={{ fontSize: 12 }}
            />
          </div>

          {/* Asset type */}
          <div className="form-group">
            <label>💎 Asset Type</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className={'btn ' + (isNative ? 'btn-primary' : 'btn-secondary')}
                onClick={() => { setTokenType('native'); setGasLimit(String(NATIVE_SEND_GAS)) }}
                style={{ fontSize: 11, padding: '8px 14px', flex: 1 }}
              >
                {destChainCfg.icon} Native ({destChainCfg.nativeSymbol})
              </button>
              <button
                className={'btn ' + (!isNative ? 'btn-primary' : 'btn-secondary')}
                onClick={() => setTokenType('erc20')}
                style={{ fontSize: 11, padding: '8px 14px', flex: 1 }}
              >
                🪙 Token (ERC20/BEP20)
              </button>
            </div>
          </div>

          {/* Token selector */}
          {!isNative && (
            <div className="form-group">
              <label>🪙 Token</label>
              <select className="input" value={selectedToken} onChange={e => setSelectedToken(e.target.value)}>
                {Object.entries(destChainCfg.tokens).map(([sym, addr]) => (
                  <option key={sym} value={sym}>{sym} — {addr.slice(0, 8)}...</option>
                ))}
                <option value="CUSTOM">Custom Token</option>
              </select>
              {selectedToken === 'CUSTOM' && (
                <input
                  type="text" className="input mono" value={customTokenAddr}
                  onChange={e => setCustomTokenAddr(e.target.value)}
                  placeholder="0x... (token contract address)"
                  style={{ marginTop: 6, fontSize: 11 }}
                />
              )}
            </div>
          )}

          {/* Amount */}
          <div className="form-group">
            <label>💵 Amount ({balanceSymbol})</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                type="text" className="input" value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder={`e.g. 0.1 ${balanceSymbol}`}
                style={{ fontSize: 12, flex: 1 }}
              />
              <button className="btn btn-secondary" onClick={handleMaxAmount} style={{ fontSize: 10, padding: '8px 10px' }}>MAX</button>
            </div>
            {availableBalance && (
              <span className="form-hint">
                Available: {parseFloat(availableBalance).toFixed(6)} {balanceSymbol}
              </span>
            )}
          </div>

          {/* Gas Price */}
          <div className="form-group">
            <label>⛽ Gas Price (Gwei)</label>
            <input
              type="number" step="0.1" className="input" value={gasPriceGwei}
              onChange={e => setGasPriceGwei(e.target.value)}
              placeholder="Auto"
              style={{ fontSize: 12 }}
            />
            <span className="form-hint">Leave as-is for auto-detected price</span>
          </div>

          {/* Gas Limit */}
          {!isNative && (
            <div className="form-group">
              <label>⛽ Gas Limit</label>
              <input
                type="number" className="input" value={gasLimit}
                onChange={e => setGasLimit(e.target.value)}
                style={{ fontSize: 12 }}
              />
            </div>
          )}
        </div>

        {/* Send button */}
        <div className="form-actions">
          <LoadingButton
            loading={loading}
            loadingText={`⏳ ${sendProgress?.msg || 'Sending...'}`}
            onClick={handleSend}
            disabled={!provider || !destAddress || !amount || parseFloat(amount) <= 0 || !availableBalance || parseFloat(availableBalance) <= 0}
            style={{
              fontSize: 14, padding: '12px 28px', minWidth: 220,
              background: loading ? undefined : 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              border: 'none',
            }}
          >
            📤 Send {amount || '...'} {balanceSymbol} to {destAddress.slice(0, 8)}...
          </LoadingButton>

          {sendProgress && (
            <div style={{ flex: 1, maxWidth: 300 }}>
              <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: 4 }}>
                <div style={{
                  height: '100%', borderRadius: 3, width: sendProgress.status === 'confirming' ? '70%' : sendProgress.status === 'sending' ? '30%' : '50%',
                  background: '#3b82f6', transition: 'width 0.3s',
                }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{sendProgress.msg}</div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Error ────────────────────────────────────────────────────── */}
      {error && (
        <div className="error-box">
          <span className="error-icon">⚠</span> {error}
        </div>
      )}

      {/* ─── Result ───────────────────────────────────────────────────── */}
      {result && (
        <div className="result-panel success">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>✅ Sent Successfully!</h3>
            <span style={{ fontSize: 10, color: '#22c55e', background: 'rgba(34,197,94,0.1)', padding: '3px 8px', borderRadius: 4 }}>
              {result.chain}
            </span>
          </div>
          <p>
            {result.amount} {result.symbol} → {result.destination?.slice(0, 10)}...{result.destination?.slice(-4)}
          </p>
          <div className="result-hash" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <CopyButton text={result.txHash} />
            <span className="mono" style={{ fontSize: 12 }}>{result.txHash.slice(0, 18)}...{result.txHash.slice(-6)}</span>
            <a href={result.explorerUrl} target="_blank" rel="noopener noreferrer" className="explorer-link">View on Explorer ↗</a>
          </div>
        </div>
      )}

      {/* ─── Activity Log ─────────────────────────────────────────────── */}
      {logs.length > 0 && (
        <div className="log-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>📋 Activity Log</h3>
            <button className="btn btn-secondary" onClick={() => setLogs([])} style={{ fontSize: 9, padding: '4px 10px' }}>Clear</button>
          </div>
          <div className="log-container" style={{ maxHeight: 200 }}>
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
        background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.12)',
        fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6,
      }}>
        <strong style={{ color: '#60a5fa' }}>🔀 Universal Send</strong> lets you send native coins or tokens from any
        balance source to any address on any supported chain.
        <ul style={{ margin: '6px 0 0 16px', color: '#888' }}>
          <li><strong>🔌 Wallet:</strong> Sends directly from your connected wallet</li>
          <li><strong>🗼 Relay Nodes:</strong> Aggregated node balances — wallet pays gas, node balances are deducted</li>
          <li><strong>📜 Contract:</strong> Calls <code>rescueNative()</code> or <code>rescueTokens()</code> on FlashArbitrage contract</li>
          <li>Supports <strong>Ethereum, BSC, Polygon, and Arbitrum</strong></li>
          <li>Token balances and decimal handling are automatic</li>
        </ul>
      </div>
    </div>
  )
}
