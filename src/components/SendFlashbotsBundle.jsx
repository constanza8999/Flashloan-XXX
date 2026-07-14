import React, { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { ETH_RPCS, POPULAR_ERC20, TRANSFER_SELECTOR, DEFAULT_ETH_GAS } from '../constants'
import { useProvider } from '../hooks'
import { getTokenDecimals, getTokenSymbol, encodeTransfer } from '../utils'
import { signTxForBundle, submitBundle, getNextBlockNumber } from '../utils/flashbots'
import { useWeb3 } from '../context/Web3Context'
import SigningMethod from './SigningMethod'
import useTransactionHistory from '../hooks/useTransactionHistory'

export default function SendFlashbotsBundle() {
  const { signer: walletSigner, walletAddress, isConnected } = useWeb3()

  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [token, setToken] = useState('USDT')
  const [customToken, setCustomToken] = useState('')
  const [gasLimit, setGasLimit] = useState(String(DEFAULT_ETH_GAS))
  const [privateKey, setPrivateKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [useWalletSign, setUseWalletSign] = useState(false)

  const [bundleResult, setBundleResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [derivedSender, setDerivedSender] = useState('')
  const [targetBlock, setTargetBlock] = useState(null)
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
    if (!w3) { setError('Not connected to any RPC'); return }

    setLoading(true)

    try {
      // Get the signing wallet/signer
      let signingWallet
      if (useWalletSign && walletSigner) {
        signingWallet = walletSigner
      } else {
        const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
        const wallet = new ethers.Wallet(pk)
        signingWallet = wallet.connect(w3)
      }

      const sender = getSender()
      if (!sender) { setError('Could not determine sender address'); return }

      // Get token info
      const tokenAddr = getTokenAddress()
      const decimals = await getTokenDecimals(w3, tokenAddr)
      const amountWei = ethers.parseUnits(amount, decimals)
      const tokenSymbol = token === 'CUSTOM' ? (await getTokenSymbol(w3, tokenAddr)) : token

      // Build the tx with ZERO gas price (gasless)
      const nonce = await w3.getTransactionCount(sender)
      const data = encodeTransfer(to, amountWei, TRANSFER_SELECTOR)

      const tx = {
        to: ethers.getAddress(tokenAddr),
        value: 0n,
        gasLimit: BigInt(gasLimit),
        nonce,
        chainId: 1, // Ethereum mainnet
        gasPrice: 0n, // Gasless — zero gas price
        data,
      }

      // Sign the transaction
      const signedTx = await signTxForBundle(signingWallet, tx)

      // Get target block
      const blockNumber = await getNextBlockNumber(w3)
      setTargetBlock(blockNumber)

      // Get auth signer (used for Flashbots relay authentication — uses signMessage, no private key needed)
      const authSigner = useWalletSign && walletSigner
        ? walletSigner
        : new ethers.Wallet(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey)

      // Submit bundle
      const result = await submitBundle([signedTx], blockNumber, authSigner)

      if (result.ok) {
        addTx({
          chain: 'ETH (Flashbots Bundle)',
          status: 'broadcast',
          tokenSymbol,
          tokenAddress: tokenAddr,
          amount,
          recipient: to,
          sender,
          txHash: null, // No tx hash until included
          method: useWalletSign ? 'wallet' : 'key',
        })

        setBundleResult({
          bundleHash: result.bundleHash,
          blockNumber,
          txHash: ethers.keccak256(signedTx).slice(0, 66),
          tokenSymbol,
          amount,
          sender,
          recipient: to,
        })
      } else {
        setError(result.error || 'Bundle submission failed')
      }
    } catch (err) {
      setError(err.message || 'Error submitting bundle')
    }
    setLoading(false)
  }

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">⚡</span>
        <div>
          <h2>Gasless Flashbots Bundle</h2>
          <p>Send tokens with zero gas price via Flashbots bundle relay</p>
        </div>
      </div>

      <div className="error-box" style={{ borderColor: 'rgba(234, 179, 8, 0.3)', background: 'rgba(234, 179, 8, 0.05)' }}>
        <span className="error-icon" style={{ background: 'rgba(234, 179, 8, 0.2)', color: '#fbbf24' }}>⚠</span>
        <div>
          <strong style={{ color: '#fbbf24' }}>Experimental</strong>
          <p style={{ color: '#a3a3a3', marginTop: 4, fontSize: 12 }}>
            Gasless bundles require the transaction to generate enough MEV to be profitable for validators.
            Simple token transfers may not be included. The transaction is valid for one block only.
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
          <select value={token} onChange={e => setToken(e.target.value)} className="input">
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
          {loading ? '⏳ Submitting Bundle...' : '⚡ Submit Gasless Bundle'}
        </button>
      </div>

      {error && <div className="error-box"><span className="error-icon">✕</span> {error}</div>}

      {bundleResult && (
        <div className="result-panel success">
          <h3>✅ Bundle Submitted</h3>
          <div className="result-grid">
            <div className="result-item">
              <span className="ri-label">Bundle Hash</span>
              <span className="ri-value mono">{bundleResult.bundleHash || 'N/A'}</span>
            </div>
            <div className="result-item">
              <span className="ri-label">Target Block</span>
              <span className="ri-value">#{bundleResult.blockNumber}</span>
            </div>
            <div className="result-item">
              <span className="ri-label">TX Hash (preview)</span>
              <span className="ri-value mono">{bundleResult.txHash?.slice(0, 34)}...</span>
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
            The bundle was submitted for block #{bundleResult.blockNumber}. Check back after the block is mined to see if it was included.
          </p>
        </div>
      )}
    </div>
  )
}
