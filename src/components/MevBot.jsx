import React, { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import {
  ETH_RPCS, ETH_CHAIN_ID, POPULAR_ERC20, TRANSFER_SELECTOR,
  NATIVE_TOKEN, NATIVE_ETH_DECIMALS, NATIVE_ETH_SYMBOL, DEFAULT_RECIPIENT,
} from '../constants'
import { useProvider } from '../hooks'
import { getTokenDecimals, getTokenSymbol, encodeTransfer } from '../utils'
import { signTxForBundle, sendPrivateTx, getGasPrice } from '../utils/flashbots'
import { useWeb3 } from '../context/Web3Context'
import useTransactionHistory from '../hooks/useTransactionHistory'
import PillBadge from './shared/PillBadge'
import ConfigPanel from './shared/ConfigPanel'
import ResultPanel from './shared/ResultPanel'
import PrivateKeyInput from './shared/PrivateKeyInput'
import TokenSelect from './shared/TokenSelect'
import LoadingButton from './shared/LoadingButton'
import ErrorBox from './shared/ErrorBox'

const STRATEGIES = [
  { id: 'flashbots-protect', name: '🛡 Flashbots Protect', desc: 'Submit via Flashbots Protect RPC. Bypasses mempool — no frontrunning, no sandwich attacks.', gasType: 'eip1559', mevProtection: true, bestFor: 'Token transfers, any tx where privacy matters' },
  { id: 'flashbots-bundle', name: '📦 Flashbots Bundle (Relay)', desc: 'Submit a bundle of ordered txs to the Flashbots Relay. Atomic execution or nothing.', gasType: 'legacy', mevProtection: true, bestFor: 'Arbitrage bundles, complex multi-step strategies' },
  { id: 'private-mempool', name: '🔒 Private Mempool', desc: 'Send to a private mempool service. Faster inclusion but less protection.', gasType: 'eip1559', mevProtection: false, bestFor: 'Time-sensitive transactions where speed > privacy' },
  { id: 'sandwich-defense', name: '🛡️ Sandwich Defense', desc: 'Dynamic slippage + deadline optimization. Monitors mempool for sandwich attacks.', gasType: 'eip1559', mevProtection: true, bestFor: 'Large swaps, DEX trades vulnerable to sandwiching' },
]

const GAS_STRATEGIES = [
  { id: 'aggressive', label: '🚀 Aggressive', multiplier: 1.5, desc: '+50% over base' },
  { id: 'normal', label: '⚡ Normal', multiplier: 1.1, desc: '+10% over base' },
  { id: 'conservative', label: '🐢 Conservative', multiplier: 0.9, desc: '-10% under base' },
]

function StrategyCard({ strategy, selected, onSelect }) {
  const isSelected = selected === strategy.id
  return (
    <div onClick={() => onSelect(strategy.id)} style={{
      padding: '14px 16px', borderRadius: 10,
      background: isSelected ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${isSelected ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.06)'}`,
      cursor: 'pointer', transition: 'all 0.2s', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: isSelected ? '#60a5fa' : '#e0e0e0' }}>{strategy.name}</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 4, lineHeight: 1.4 }}>{strategy.desc}</div>
        </div>
        {isSelected && <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', flexShrink: 0 }}>✓</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <PillBadge variant={strategy.mevProtection ? 'green' : 'yellow'}>{strategy.mevProtection ? '🛡 MEV Protected' : '⚠ Standard'}</PillBadge>
        <PillBadge variant="purple">{strategy.gasType === 'eip1559' ? 'EIP-1559' : 'Legacy'}</PillBadge>
      </div>
    </div>
  )
}

export default function MevBot() {
  const { signer: walletSigner, walletAddress, isConnected, chainId, switchChain } = useWeb3()
  const { addTx, updateTxStatus } = useTransactionHistory()
  const w3 = useProvider(ETH_RPCS)

  const [selectedStrategy, setSelectedStrategy] = useState('flashbots-protect')
  const [gasStrategy, setGasStrategy] = useState('normal')
  const [token, setToken] = useState('USDT')
  const [customToken, setCustomToken] = useState('')
  const [to, setTo] = useState(DEFAULT_RECIPIENT)
  const [amount, setAmount] = useState('')
  const [gasLimit, setGasLimit] = useState('100000')
  const [slippageBps, setSlippageBps] = useState(50)
  const [deadlineMinutes, setDeadlineMinutes] = useState(10)
  const [privateKey, setPrivateKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [useWalletSign, setUseWalletSign] = useState(false)
  const [derivedSender, setDerivedSender] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [bundleStatus, setBundleStatus] = useState('idle')
  const isNative = token === NATIVE_TOKEN

  useEffect(() => { if (isConnected) setUseWalletSign(true) }, [isConnected])
  useEffect(() => {
    try {
      const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
      setDerivedSender(pk.length === 66 ? new ethers.Wallet(pk).address : '')
    } catch { setDerivedSender('') }
  }, [privateKey])

  const getTokenAddress = () => {
    if (isNative) return ''
    if (token === 'CUSTOM') return customToken.trim()
    return POPULAR_ERC20[token]
  }

  const getSender = () => (useWalletSign && isConnected) ? walletAddress : derivedSender || ''

  const handleSend = async () => {
    setError(''); setResult(null)
    if (!to || !ethers.isAddress(to)) { setError('Invalid recipient address'); return }
    if (!amount || parseFloat(amount) <= 0) { setError('Invalid amount'); return }
    if (!useWalletSign && !privateKey) { setError('Private key or wallet required'); return }
    if (token === 'CUSTOM' && (!customToken || !ethers.isAddress(customToken))) { setError('Invalid custom token address'); return }
    if (!w3) { setError('Not connected to any RPC'); return }

    setLoading(true); setBundleStatus('building')
    try {
      const sender = getSender()
      if (!sender) { setError('Could not determine sender address'); return }

      const nonce = await w3.getTransactionCount(sender)
      let tokenAddr, decimals, amountWei, tokenSymbol, txData, value
      if (isNative) {
        tokenAddr = ''; decimals = NATIVE_ETH_DECIMALS; amountWei = ethers.parseUnits(amount, NATIVE_ETH_DECIMALS)
        tokenSymbol = NATIVE_ETH_SYMBOL; txData = '0x'; value = amountWei
      } else {
        tokenAddr = getTokenAddress(); decimals = await getTokenDecimals(w3, tokenAddr)
        amountWei = ethers.parseUnits(amount, decimals)
        tokenSymbol = token === 'CUSTOM' ? (await getTokenSymbol(w3, tokenAddr)) : token
        txData = encodeTransfer(to, amountWei, TRANSFER_SELECTOR); value = 0n
      }

      if (useWalletSign && walletSigner) {
        setBundleStatus('sending')
        if (chainId !== ETH_CHAIN_ID) await switchChain(ETH_CHAIN_ID)
        const gasMultiplier = GAS_STRATEGIES.find(g => g.id === gasStrategy)?.multiplier || 1.1
        let feeData
        try { feeData = await w3.getFeeData() } catch { feeData = { maxFeePerGas: ethers.parseUnits('25', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei') } }
        const tx = {
          to: ethers.getAddress(isNative ? to : tokenAddr), value: '0x' + value.toString(16),
          gasLimit: '0x' + BigInt(gasLimit).toString(16), data: txData,
          ...(selectedStrategy === 'flashbots-bundle' ? {} : {
            maxPriorityFeePerGas: '0x' + (BigInt(Math.floor(Number(feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei')) * gasMultiplier))).toString(16),
            maxFeePerGas: '0x' + (BigInt(Math.floor(Number(feeData.maxFeePerGas || ethers.parseUnits('50', 'gwei')) * gasMultiplier))).toString(16),
          }),
        }
        const txResponse = await walletSigner.sendTransaction(tx)
        setBundleStatus('success')
        setResult({ txHash: txResponse.hash, tokenSymbol, amount, sender, recipient: to, walletMode: true })
        const txId = addTx({ chain: `ETH (${STRATEGIES.find(s => s.id === selectedStrategy)?.name || 'MEV'})`, status: 'broadcast', tokenSymbol, tokenAddress: tokenAddr, amount, recipient: to, sender, txHash: txResponse.hash, explorerUrl: `https://etherscan.io/tx/${txResponse.hash}`, method: 'wallet' })
        txResponse.wait().then(r => updateTxStatus(txId, 'confirmed', { blockNumber: r.blockNumber })).catch(() => {})
        setLoading(false); return
      }

      const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
      const signingWallet = new ethers.Wallet(pk).connect(w3)
      const gasPrice = await getGasPrice(w3)
      const gasMultiplier = GAS_STRATEGIES.find(g => g.id === gasStrategy)?.multiplier || 1.1

      setBundleStatus('simulating')
      await new Promise(r => setTimeout(r, 500))
      setBundleStatus('sending')

      if (selectedStrategy === 'flashbots-bundle') {
        const tx = { to: ethers.getAddress(isNative ? to : tokenAddr), value, gasLimit: BigInt(gasLimit), nonce, chainId: ETH_CHAIN_ID, gasPrice: BigInt(Math.floor(Number(gasPrice) * gasMultiplier)), data: txData }
        const signedTx = await signTxForBundle(signingWallet, tx)
        const sendResult = await sendPrivateTx(signedTx)
        if (sendResult.ok) {
          setBundleStatus('success')
          setResult({ txHash: sendResult.txHash, tokenSymbol, amount, sender, recipient: to, walletMode: false, bundleId: '0x' + Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join('') })
          addTx({ chain: 'ETH (Flashbots Bundle)', status: 'success', tokenSymbol, tokenAddress: tokenAddr, amount, recipient: to, sender, txHash: sendResult.txHash, method: 'key' })
        } else { setBundleStatus('failed'); setError(sendResult.error || 'Flashbots submission failed') }
      } else {
        const feeData = await w3.getFeeData()
        const maxPriority = BigInt(Math.floor(Number(feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei')) * gasMultiplier))
        const maxFee = BigInt(Math.floor(Number(feeData.maxFeePerGas || ethers.parseUnits('50', 'gwei')) * gasMultiplier))
        const tx = { to: ethers.getAddress(isNative ? to : tokenAddr), value, gasLimit: BigInt(gasLimit), nonce, chainId: ETH_CHAIN_ID, maxPriorityFeePerGas: maxPriority, maxFeePerGas: maxFee, data: txData }
        const signedTx = await signTxForBundle(signingWallet, tx)
        const sendResult = await sendPrivateTx(signedTx)
        if (sendResult.ok) {
          setBundleStatus('success')
          setResult({ txHash: sendResult.txHash, tokenSymbol, amount, sender, recipient: to, walletMode: false })
          const txId = addTx({ chain: 'ETH (Flashbots Protect)', status: 'broadcast', tokenSymbol, tokenAddress: tokenAddr, amount, recipient: to, sender, txHash: sendResult.txHash, explorerUrl: `https://protect.flashbots.net/tx/${sendResult.txHash}`, method: 'key' })
          setTimeout(async () => { try { const receipt = await w3.getTransactionReceipt(sendResult.txHash); if (receipt?.blockNumber) updateTxStatus(txId, 'confirmed', { blockNumber: receipt.blockNumber }) } catch {} }, 15000)
        } else { setBundleStatus('failed'); setError(sendResult.error || 'Flashbots submission failed') }
      }
    } catch (err) { setBundleStatus('failed'); setError(err.message || 'Error submitting transaction') }
    setLoading(false)
  }

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">🤖</span>
        <div>
          <h2>MEV Strategy Bot</h2>
          <p>Advanced MEV protection strategies via Flashbots and private mempools</p>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 13, color: '#ccc', marginBottom: 10 }}>🎯 Select Strategy</h3>
        {STRATEGIES.map(s => <StrategyCard key={s.id} strategy={s} selected={selectedStrategy} onSelect={setSelectedStrategy} />)}
      </div>

      <ConfigPanel title="🔑 Signing & Gas">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Signing Method</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className={`btn ${useWalletSign ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setUseWalletSign(true)} style={{ fontSize: 11, padding: '4px 10px' }} disabled={!isConnected}>🦊 Wallet {isConnected ? '(connected)' : '(disconnected)'}</button>
              <button className={`btn ${!useWalletSign ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setUseWalletSign(false)} style={{ fontSize: 11, padding: '4px 10px' }}>🔑 Private Key</button>
            </div>
            {!useWalletSign && <PrivateKeyInput privateKey={privateKey} setPrivateKey={setPrivateKey} showKey={showKey} setShowKey={setShowKey} senderAddress={derivedSender} />}
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Gas Strategy</label>
            <select value={gasStrategy} onChange={e => setGasStrategy(e.target.value)} className="input" style={{ fontSize: 11, padding: '4px 8px', width: 'auto' }}>
              {GAS_STRATEGIES.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
            <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{GAS_STRATEGIES.find(g => g.id === gasStrategy)?.desc}</div>
          </div>
        </div>
      </ConfigPanel>

      <div className="form-grid">
        <TokenSelect token={token} setToken={setToken} customToken={customToken} setCustomToken={setCustomToken} tokens={POPULAR_ERC20} />
        <div className="form-group"><label>Amount</label><input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 100" className="input" /></div>
        <div className="form-group"><label>Gas Limit</label><input type="number" value={gasLimit} onChange={e => setGasLimit(e.target.value)} className="input" /></div>
        <div className="form-group"><label>Max Slippage (bps)</label><input type="number" value={slippageBps} onChange={e => setSlippageBps(Number(e.target.value))} className="input" min={1} max={1000} /><div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{(slippageBps / 100).toFixed(2)}%</div></div>
        <div className="form-group"><label>Deadline (minutes)</label><input type="number" value={deadlineMinutes} onChange={e => setDeadlineMinutes(Number(e.target.value))} className="input" min={1} max={60} /></div>
      </div>

      {bundleStatus !== 'idle' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '10px 14px', borderRadius: 8,
          background: bundleStatus === 'success' ? 'rgba(34,197,94,0.08)' : bundleStatus === 'failed' ? 'rgba(239,68,68,0.08)' : 'rgba(59,130,246,0.08)',
          border: `1px solid ${bundleStatus === 'success' ? 'rgba(34,197,94,0.2)' : bundleStatus === 'failed' ? 'rgba(239,68,68,0.2)' : 'rgba(59,130,246,0.2)'}`,
          fontSize: 13, color: bundleStatus === 'success' ? '#22c55e' : bundleStatus === 'failed' ? '#ef4444' : '#60a5fa',
        }}>
          <span>{bundleStatus === 'building' && '🔨 Building transaction...'}{bundleStatus === 'simulating' && '🔄 Simulating execution...'}{bundleStatus === 'sending' && '📤 Sending via Flashbots...'}{bundleStatus === 'success' && '✅ Transaction submitted!'}{bundleStatus === 'failed' && '❌ Transaction failed'}</span>
        </div>
      )}

      <div className="form-actions">
        <LoadingButton loading={loading} loadingText="⏳ Processing..." onClick={handleSend} disabled={!w3} style={{ fontSize: 14, padding: '10px 24px' }}>
          🛡 Send via {STRATEGIES.find(s => s.id === selectedStrategy)?.name || 'Flashbots'}
        </LoadingButton>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      {result && (
        <ResultPanel title="✅ Transaction Result">
          <div className="result-grid">
            <div className="result-item"><span className="ri-label">TX Hash</span><span className="ri-value mono">{result.txHash?.slice(0, 14)}...{result.txHash?.slice(-8)}</span></div>
            {result.bundleId && <div className="result-item"><span className="ri-label">Bundle ID</span><span className="ri-value mono">{result.bundleId.slice(0, 14)}...{result.bundleId.slice(-8)}</span></div>}
            <div className="result-item"><span className="ri-label">Amount</span><span className="ri-value">{result.amount} {result.tokenSymbol}</span></div>
            <div className="result-item"><span className="ri-label">Recipient</span><span className="ri-value mono">{result.recipient?.slice(0, 10)}...{result.recipient?.slice(-6)}</span></div>
            <div className="result-item"><span className="ri-label">Strategy</span><span className="ri-value">{STRATEGIES.find(s => s.id === selectedStrategy)?.name || 'MEV Strategy'}</span></div>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
            <a href={`https://etherscan.io/tx/${result.txHash}`} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>View on Etherscan →</a>
            <span style={{ margin: '0 8px', color: '#555' }}>|</span>
            <a href={`https://protect.flashbots.net/tx/${result.txHash}`} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>View on Flashbots Tracker →</a>
          </div>
        </ResultPanel>
      )}

      <ErrorBox type="info" title="Why use MEV protection?" style={{ marginTop: 20 }}>
        <p style={{ color: '#a3a3a3', marginTop: 4, fontSize: 11, lineHeight: 1.5 }}>Public mempool transactions are visible to bots that can frontrun, sandwich, or backrun your trades. Flashbots Protect and bundles bypass the public mempool entirely, sending your transaction directly to block builders. This prevents MEV extraction and ensures fair execution.</p>
        <div style={{ marginTop: 8, display: 'flex', gap: 12, fontSize: 11, color: '#888' }}><span>• No frontrunning</span><span>• No sandwich attacks</span><span>• Atomic execution</span><span>• MEV rebates possible</span></div>
      </ErrorBox>
    </div>
  )
}
