import React, { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { ETH_RPCS, ETH_CHAIN_ID, POPULAR_ERC20, TRANSFER_SELECTOR, DEFAULT_ETH_GAS, NATIVE_TOKEN, NATIVE_ETH_DECIMALS, NATIVE_ETH_SYMBOL, NATIVE_SEND_GAS } from '../constants'
import { useProvider } from '../hooks'
import { getTokenDecimals, getTokenSymbol, encodeTransfer } from '../utils'
import { signTxForBundle, sendPrivateTx, getGasPrice } from '../utils/flashbots'
import { useWeb3 } from '../context/Web3Context'
import SigningMethod from './SigningMethod'
import useTransactionHistory from '../hooks/useTransactionHistory'

export default function SendFlashbotsBundle() {
  const { signer: walletSigner, walletAddress, isConnected, chainId, switchChain } = useWeb3()

  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [token, setToken] = useState('USDT')
  const [customToken, setCustomToken] = useState('')
  const [gasLimit, setGasLimit] = useState(String(DEFAULT_ETH_GAS))
  const isNative = token === NATIVE_TOKEN
  const [privateKey, setPrivateKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [useWalletSign, setUseWalletSign] = useState(false)

  const [bundleResult, setBundleResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [derivedSender, setDerivedSender] = useState('')
  const { addTx } = useTransactionHistory()

  const w3 = useProvider(ETH_RPCS)

  // Auto-enable wallet signing when wallet connects
  useEffect(() => {
    if (isConnected) setUseWalletSign(true)
  }, [isConnected])

  // Derive sender from private key
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

  const getTokenAddress = () => {
    if (isNative) return ''
    if (token === 'CUSTOM') return customToken.trim()
    return POPULAR_ERC20[token]
  }

  const getSender = () => {
    if (useWalletSign && isConnected) return walletAddress
    return derivedSender || ''
  }

  const handleSendBundle = async () => {
    setError('')
    setBundleResult(null)

    // Validate inputs
    if (!to || !ethers.isAddress(to)) { setError('Invalid recipient address'); return }
    if (!amount || parseFloat(amount) <= 0) { setError('Invalid amount'); return }
    if (!useWalletSign && !privateKey) { setError('Private key is required (or connect a wallet)'); return }
    if (token === 'CUSTOM' && (!customToken || !ethers.isAddress(customToken))) {
      setError('Invalid custom token address'); return
    }
    if (isNative && !to) { setError('Recipient address is required for native ETH send'); return }
    if (!w3) { setError('Not connected to any RPC'); return }

    setLoading(true)

    try {
      const sender = getSender()
      if (!sender) { setError('Could not determine sender address'); return }

      // Get token info
      const nonce = await w3.getTransactionCount(sender)

      let tokenAddr, decimals, amountWei, tokenSymbol, txData

      if (isNative) {
        // Native ETH send
        tokenAddr = ''
        decimals = NATIVE_ETH_DECIMALS
        amountWei = ethers.parseUnits(amount, NATIVE_ETH_DECIMALS)
        tokenSymbol = NATIVE_ETH_SYMBOL
        txData = '0x'
      } else {
        // ERC20 token send
        tokenAddr = getTokenAddress()
        decimals = await getTokenDecimals(w3, tokenAddr)
        amountWei = ethers.parseUnits(amount, decimals)
        tokenSymbol = token === 'CUSTOM' ? (await getTokenSymbol(w3, tokenAddr)) : token
        txData = encodeTransfer(to, amountWei, TRANSFER_SELECTOR)
      }

      // ───────────────────────────────────────────────────────
      // WALLET MODE — Use eth_sendTransaction (MetaMask/WalletConnect)
      // ───────────────────────────────────────────────────────
      if (useWalletSign && walletSigner) {
        // Switch to Ethereum mainnet if not already on it
        if (chainId !== ETH_CHAIN_ID) {
          await switchChain(ETH_CHAIN_ID)
        }

        const tx = {
          to: ethers.getAddress(isNative ? to : tokenAddr),
          value: isNative ? '0x' + amountWei.toString(16) : '0x0',
          gasLimit: '0x' + BigInt(isNative ? NATIVE_SEND_GAS : gasLimit).toString(16),
          data: txData,
        }

        // sendTransaction calls eth_sendTransaction which ALL wallets support
        const txResponse = await walletSigner.sendTransaction(tx)
        const receipt = await txResponse.wait()

        const txHash = receipt?.hash || txResponse.hash

        addTx({
          chain: 'ETH (Wallet Send)',
          status: 'success',
          tokenSymbol,
          tokenAddress: tokenAddr,
          amount,
          recipient: to,
          sender,
          txHash,
          method: 'wallet',
        })

        setBundleResult({
          txHash,
          tokenSymbol,
          amount,
          sender,
          recipient: to,
          walletMode: true,
        })
        setLoading(false)
        return
      }

      // ───────────────────────────────────────────────────────
      // PRIVATE KEY MODE — Flashbots Protect (MEV-protected send)
      // ───────────────────────────────────────────────────────
      const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
      const signingWallet = new ethers.Wallet(pk).connect(w3)

      // Get current gas price from the Flashbots Protect RPC
      const gasPrice = await getGasPrice(w3)

      const tx = {
        to: ethers.getAddress(isNative ? to : tokenAddr),
        value: isNative ? amountWei : 0n,
        gasLimit: BigInt(isNative ? NATIVE_SEND_GAS : gasLimit),
        nonce,
        chainId: 1,
        gasPrice,
        data: txData,
      }

      // Sign locally
      const signedTx = await signTxForBundle(signingWallet, tx)

      // Submit to Flashbots Protect RPC (eth_sendRawTransaction)
      const result = await sendPrivateTx(signedTx)

      if (result.ok) {
        addTx({
          chain: 'ETH (Flashbots Protect)',
          status: 'success',
          tokenSymbol,
          tokenAddress: tokenAddr,
          amount,
          recipient: to,
          sender,
          txHash: result.txHash,
          method: 'key',
        })

        setBundleResult({
          txHash: result.txHash,
          tokenSymbol,
          amount,
          sender,
          recipient: to,
          walletMode: false,
        })
      } else {
        setError(result.error || 'Flashbots submission failed')
      }
    } catch (err) {
      setError(err.message || 'Error submitting transaction')
    }
    setLoading(false)
  }

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">⚡</span>
        <div>
          <h2>Flashbots Private Send</h2>
          <p>Send tokens with MEV protection via Flashbots Protect RPC</p>
        </div>
      </div>

      <div className="error-box" style={{ borderColor: 'rgba(59, 130, 246, 0.3)', background: 'rgba(59, 130, 246, 0.05)' }}>
        <span className="error-icon" style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa' }}>🛡</span>
        <div>
          <strong style={{ color: '#60a5fa' }}>How it works</strong>
          <p style={{ color: '#a3a3a3', marginTop: 4, fontSize: 12 }}>
            Your transaction is submitted directly to the <strong>Flashbots Protect RPC</strong>,
            bypassing the public mempool. This prevents frontrunning, sandwich attacks, and other MEV exploits.
            Standard gas fees apply. Your transaction never hits the public mempool.
          </p>
        </div>
      </div>

      <SigningMethod
        useWalletSign={useWalletSign}
        setUseWalletSign={setUseWalletSign}
        privateKey={privateKey}
        setPrivateKey={setPrivateKey}
        showKey={showKey}
        setShowKey={setShowKey}
        senderAddress={derivedSender}
      />

      <div className="form-grid">
        <div className="form-group">
          <label>Token</label>
          <select value={token} onChange={e => { setToken(e.target.value); if (e.target.value === NATIVE_TOKEN) setGasLimit(String(NATIVE_SEND_GAS)) }} className="input">
            <option value={NATIVE_TOKEN}>ETH (Native)</option>
            <option disabled>──────────</option>
            {Object.entries(POPULAR_ERC20).map(([sym, addr]) => (
              <option key={sym} value={sym}>{sym} — {addr.slice(0, 8)}...</option>
            ))}
            <option value="CUSTOM">Custom Token</option>
          </select>
          {token === 'CUSTOM' && (
            <input type="text" value={customToken} onChange={e => setCustomToken(e.target.value)} placeholder="0x token contract address" className="input mono" style={{ marginTop: 8 }} />
          )}
        </div>

        <div className="form-group">
          <label>Recipient Address</label>
          <input type="text" value={to} onChange={e => setTo(e.target.value)} placeholder="0x..." className="input mono" />
        </div>

        <div className="form-group">
          <label>Amount (human units)</label>
          <input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 500" className="input" />
        </div>

        <div className="form-group">
          <label>Gas Limit</label>
          <input type="number" value={gasLimit} onChange={e => setGasLimit(e.target.value)} className="input" />
        </div>
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" onClick={handleSendBundle} disabled={loading || !w3}>
          {loading
            ? '⏳ Sending...'
            : (useWalletSign && isConnected ? '🦊 Send via Wallet' : '🛡 Send via Flashbots Protect')
          }
        </button>
      </div>

      {error && <div className="error-box"><span className="error-icon">✕</span> {error}</div>}

      {bundleResult && (
        <div className="result-panel success">
          <h3>✅ Transaction Sent via Flashbots</h3>
          <div className="result-grid">
            <div className="result-item">
              <span className="ri-label">TX Hash</span>
              <span className="ri-value mono">{bundleResult.txHash?.slice(0, 18)}...{bundleResult.txHash?.slice(-6)}</span>
            </div>
            <div className="result-item">
              <span className="ri-label">Amount</span>
              <span className="ri-value">{bundleResult.amount} {bundleResult.tokenSymbol}</span>
            </div>
            <div className="result-item">
              <span className="ri-label">Sender</span>
              <span className="ri-value mono">{bundleResult.sender?.slice(0, 10)}...{bundleResult.sender?.slice(-6)}</span>
            </div>
            <div className="result-item">
              <span className="ri-label">Recipient</span>
              <span className="ri-value mono">{bundleResult.recipient?.slice(0, 10)}...{bundleResult.recipient?.slice(-6)}</span>
            </div>
          </div>
          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
            View on{' '}
            <a href={`https://etherscan.io/tx/${bundleResult.txHash}`} target="_blank" rel="noreferrer">Etherscan →</a>
          </p>
        </div>
      )}
    </div>
  )
}
