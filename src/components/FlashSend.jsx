import React, { useState } from 'react'
import { ethers } from 'ethers'

const ETH_USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const ETH_CHAIN_ID = 1
const ETH_RPC = 'https://mainnet.infura.io/v3/4370fa52b6c542c0b395bca1db50e312'
const TRANSFER_SELECTOR = 'a9059cbb'

export default function FlashSend() {
  const [privateKey, setPrivateKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [senderAddress, setSenderAddress] = useState('')
  const [recipient, setRecipient] = useState('0x383C896180D1505a8d4C7711BB6b299fDb1B0a09')
  const [amount, setAmount] = useState('')
  const [gasPriceGwei, setGasPriceGwei] = useState('8')
  const [gasLimit, setGasLimit] = useState('60000')
  const [telegramToken, setTelegramToken] = useState('')
  const [telegramChatId, setTelegramChatId] = useState('')
  const [sendToTelegram, setSendToTelegram] = useState(true)

  const [txResult, setTxResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSend = async () => {
    setError('')
    setTxResult(null)

    if (!privateKey) { setError('Private key is required'); return }
    if (!ethers.isAddress(recipient)) { setError('Invalid recipient address'); return }
    if (!amount || parseFloat(amount) <= 0) { setError('Invalid amount'); return }

    setLoading(true)
    try {
      const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
      const wallet = new ethers.Wallet(pk)
      const sender = wallet.address
      setSenderAddress(sender)

      const provider = new ethers.JsonRpcProvider(ETH_RPC)
      const signingWallet = wallet.connect(provider)

      const amountInWei = ethers.parseUnits(amount, 6) // USDT is 6 decimals on ETH
      const nonce = await provider.getTransactionCount(sender)
      const gasPrice = ethers.parseUnits(gasPriceGwei, 'gwei')

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
      const receipt = await sentTx.wait()

      let telegramSent = false
      if (sendToTelegram && telegramToken && telegramChatId) {
        try {
          const msg = encodeURIComponent(
            `Transaction Info:\nTX Hash: ${sentTx.hash}\nSender: ${sender}\nRecipient: ${recipient}\nAmount: ${amount} USDT`
          )
          await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage?chat_id=${telegramChatId}&text=${msg}`)
          telegramSent = true
        } catch {
          // Telegram notification failed silently
        }
      }

      setTxResult({
        txHash: sentTx.hash,
        blockNumber: receipt.blockNumber,
        sender,
        recipient,
        amount,
        telegramSent,
        explorerUrl: `https://etherscan.io/tx/${sentTx.hash}`,
      })
    } catch (err) {
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
          <p>Quick USDT send on Ethereum with hardcoded Infura RPC and optional Telegram notification</p>
        </div>
      </div>

      <div className="form-grid">
        <div className="form-group">
          <label>Private Key</label>
          <div className="input-with-toggle">
            <input type={showKey ? 'text' : 'password'} value={privateKey} onChange={e => { setPrivateKey(e.target.value); setSenderAddress('') }} placeholder="0x..." className="input mono" />
            <button className="toggle-btn" onClick={() => setShowKey(!showKey)}>{showKey ? '🙈' : '👁'}</button>
          </div>
          {privateKey && !senderAddress && (
            <small className="form-hint">Enter key and submit to derive address</small>
          )}
          {senderAddress && (
            <small className="form-hint success">Sender: {senderAddress.slice(0, 10)}...{senderAddress.slice(-6)}</small>
          )}
        </div>

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

        <div className="form-separator">
          <span>Telegram Notification (optional)</span>
        </div>

        <div className="form-group">
          <label>Bot Token</label>
          <input type="text" value={telegramToken} onChange={e => setTelegramToken(e.target.value)} placeholder="6638058790:AA..." className="input mono" />
        </div>

        <div className="form-group">
          <label>Chat ID</label>
          <input type="text" value={telegramChatId} onChange={e => setTelegramChatId(e.target.value)} placeholder="6530323383" className="input" />
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input type="checkbox" checked={sendToTelegram} onChange={e => setSendToTelegram(e.target.checked)} />
            <span>Send notification to Telegram</span>
          </label>
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
            <div className="result-item">
              <span className="ri-label">Block</span>
              <span className="ri-value">{txResult.blockNumber}</span>
            </div>
            <div className="result-item">
              <span className="ri-label">Amount</span>
              <span className="ri-value">{txResult.amount} USDT</span>
            </div>
            <div className="result-item">
              <span className="ri-label">Sender</span>
              <span className="ri-value mono">{txResult.sender.slice(0, 10)}...{txResult.sender.slice(-6)}</span>
            </div>
            <div className="result-item">
              <span className="ri-label">Recipient</span>
              <span className="ri-value mono">{txResult.recipient.slice(0, 10)}...{txResult.recipient.slice(-6)}</span>
            </div>
            {txResult.telegramSent && (
              <div className="result-item">
                <span className="ri-label">Telegram</span>
                <span className="ri-value success">✅ Notification sent</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
