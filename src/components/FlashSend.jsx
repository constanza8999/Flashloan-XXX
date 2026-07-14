import React, { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { useWeb3 } from '../context/Web3Context'
import SigningMethod from './SigningMethod'
import useTransactionHistory from '../hooks/useTransactionHistory'
import useTelegram from '../hooks/useTelegram'

const ETH_USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const ETH_CHAIN_ID = 1
const ETH_RPC = 'https://mainnet.infura.io/v3/4370fa52b6c542c0b395bca1db50e312'
const TRANSFER_SELECTOR = '0xa9059cbb'

export default function FlashSend() {
  const { signer: walletSigner, walletAddress, isConnected, chainId, switchChain } = useWeb3()

  const [privateKey, setPrivateKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [useWalletSign, setUseWalletSign] = useState(false)
  const [senderAddress, setSenderAddress] = useState('')
  const [recipient, setRecipient] = useState('0x383C896180D1505a8d4C7711BB6b299fDb1B0a09')
  const [amount, setAmount] = useState('')
  const [gasPriceGwei, setGasPriceGwei] = useState('8')
  const [gasLimit, setGasLimit] = useState('60000')

  const [txResult, setTxResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [derivedSender, setDerivedSender] = useState('')
  const { addTx, addFailedTx } = useTransactionHistory()
  const { enabled: tgEnabled, isConfigured: tgConfigured, notifyTx } = useTelegram()

  useEffect(() => {
    if (isConnected) setUseWalletSign(true)
  }, [isConnected])

  useEffect(() => {
    try {
      const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
      if (pk.length === 66) {
        const addr = new ethers.Wallet(pk).address
        setDerivedSender(addr)
        setSenderAddress(addr)
      } else {
        setDerivedSender('')
      }
    } catch { setDerivedSender('') }
  }, [privateKey])

  const handleSend = async () => {
    setError('')
    setTxResult(null)

    if (!useWalletSign && !privateKey) { setError('Private key is required (or connect a wallet)'); return }
    if (!ethers.isAddress(recipient)) { setError('Invalid recipient address'); return }
    if (!amount || parseFloat(amount) <= 0) { setError('Invalid amount'); return }

    setLoading(true)
    try {
      const provider = new ethers.JsonRpcProvider(ETH_RPC)

      let sender, signingWallet
      if (useWalletSign && walletSigner) {
        sender = walletAddress
        if (chainId !== ETH_CHAIN_ID) await switchChain(ETH_CHAIN_ID)
        signingWallet = walletSigner.connect ? walletSigner.connect(provider) : walletSigner
      } else {
        const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
        const wallet = new ethers.Wallet(pk)
        sender = wallet.address
        setSenderAddress(sender)
        signingWallet = wallet.connect(provider)
      }

      const amountInWei = ethers.parseUnits(amount, 6)
      const nonce = await provider.getTransactionCount(sender)
      const gasPrice = ethers.parseUnits(gasPriceGwei.replace(',', '.'), 'gwei')

      const data = TRANSFER_SELECTOR +
        recipient.slice(2).toLowerCase().padStart(64, '0') +
        amountInWei.toString(16).padStart(64, '0')

      const tx = {
        to: ethers.getAddress(ETH_USDT),
        value: 0n,
        gasLimit: BigInt(gasLimit),
        gasPrice,
        nonce,
        chainId: ETH_CHAIN_ID,
        data,
      }

      const sentTx = await signingWallet.sendTransaction(tx)

      addTx({
        chain: 'ETH',
        status: 'broadcast',
        tokenSymbol: 'USDT',
        tokenAddress: ETH_USDT,
        amount,
        recipient,
        sender,
        txHash: sentTx.hash,
        explorerUrl: `https://etherscan.io/tx/${sentTx.hash}`,
        method: useWalletSign ? 'wallet' : 'key',
      })

      // Send Telegram notification (fire-and-forget) using global config
      notifyTx({
        chain: 'ETH',
        tokenSymbol: 'USDT',
        amount,
        txHash: sentTx.hash,
        explorerUrl: `https://etherscan.io/tx/${sentTx.hash}`,
        sender,
        recipient,
        status: 'broadcast',
      })

      setTxResult({
        txHash: sentTx.hash,
        sender,
        recipient,
        amount,
        tgConfigured,
        tgEnabled,
        explorerUrl: `https://etherscan.io/tx/${sentTx.hash}`,
      })
    } catch (err) {
      addFailedTx({
        chain: 'ETH',
        tokenSymbol: 'USDT',
        tokenAddress: ETH_USDT,
        amount,
        recipient,
        sender: derivedSender || walletAddress, // sender from try block not accessible here
        error: err.message,
        method: useWalletSign ? 'wallet' : 'key',
      })
      setError(err.message || 'Transaction failed')
    }
    setLoading(false)
  }

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">⚙</span>
        <div>
          <h2>Flash Send (Legacy)</h2>
          <p>Quick USDT send on Ethereum with hardcoded Infura RPC</p>
        </div>
      </div>

      <div className={`tg-status-bar ${tgConfigured && tgEnabled ? 'active' : ''}`}>
        <span className="tg-status-icon">{tgConfigured && tgEnabled ? '✅' : 'ℹ️'}</span>
        <span>
          {tgConfigured && tgEnabled
            ? 'Telegram notifications are active. You\'ll get alerts when transactions confirm.'
            : 'Telegram not configured. Set it up in the Telegram tab for transaction alerts.'}
        </span>
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
          <label>Recipient Address</label>
          <input type="text" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x..." className="input mono" />
        </div>

        <div className="form-group">
          <label>Amount (USDT)</label>
          <input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 1000" className="input" />
        </div>

        <div className="form-group">
          <label>Gas Price (Gwei)</label>
          <input type="number" step="0.1" value={gasPriceGwei} onChange={e => setGasPriceGwei(e.target.value)} className="input" />
        </div>

        <div className="form-group">
          <label>Gas Limit</label>
          <input type="number" value={gasLimit} onChange={e => setGasLimit(e.target.value)} className="input" />
        </div>
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" onClick={handleSend} disabled={loading}>
          {loading ? '⏳ Sending...' : '🚀 Send USDT (Legacy)'}
        </button>
      </div>

      {error && <div className="error-box"><span className="error-icon">✕</span> {error}</div>}

      {txResult && (
        <div className="result-panel success">
          <h3>✅ Transaction Sent</h3>
          <div className="result-grid">
            <div className="result-item">
              <span className="ri-label">TX Hash</span>
              <span className="ri-value mono">{txResult.txHash}</span>
              <a href={txResult.explorerUrl} target="_blank" rel="noopener noreferrer" className="explorer-sm">View on Etherscan →</a>
            </div>
            <div className="result-item"><span className="ri-label">Block</span><span className="ri-value">{txResult.blockNumber}</span></div>
            <div className="result-item"><span className="ri-label">Amount</span><span className="ri-value">{txResult.amount} USDT</span></div>
            <div className="result-item"><span className="ri-label">Sender</span><span className="ri-value mono">{txResult.sender.slice(0, 10)}...{txResult.sender.slice(-6)}</span></div>
            <div className="result-item"><span className="ri-label">Recipient</span><span className="ri-value mono">{txResult.recipient.slice(0, 10)}...{txResult.recipient.slice(-6)}</span></div>
            {txResult.tgEnabled && <div className="result-item"><span className="ri-label">Telegram</span><span className="ri-value success">✅ Notification sent</span></div>}
          </div>
        </div>
      )}
    </div>
  )
}
