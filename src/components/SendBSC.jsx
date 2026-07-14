import React, { useState } from 'react'
import { ethers } from 'ethers'
import { POPULAR_BEP20, BSC_RPCS, BSC_CHAIN_ID, TRANSFER_SELECTOR, DEFAULT_BSC_GAS } from '../constants'
import { useProvider } from '../hooks'
import { getTokenDecimals, getTokenSymbol, encodeTransfer } from '../utils'

export default function SendBSC() {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [token, setToken] = useState('USDT')
  const [customToken, setCustomToken] = useState('')
  const [priorityGwei, setPriorityGwei] = useState('1.0')
  const [maxFeeGwei, setMaxFeeGwei] = useState('')
  const [gasLimit, setGasLimit] = useState(String(DEFAULT_BSC_GAS))
  const [privateKey, setPrivateKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [dryRun, setDryRun] = useState(false)

  const [txConfig, setTxConfig] = useState(null)
  const [txResult, setTxResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const w3 = useProvider(BSC_RPCS)

  const getTokenAddress = () => {
    if (token === 'CUSTOM') return customToken.trim()
    return POPULAR_BEP20[token]
  }

  const handlePreview = async () => {
    setError('')
    setTxResult(null)
    setTxConfig(null)

    if (!to || !ethers.isAddress(to)) { setError('Invalid recipient address'); return }
    if (!amount || parseFloat(amount) <= 0) { setError('Invalid amount'); return }
    if (!privateKey) { setError('Private key is required'); return }
    if (token === 'CUSTOM' && (!customToken || !ethers.isAddress(customToken))) {
      setError('Invalid custom token address'); return
    }
    if (!w3) { setError('Not connected to any RPC'); return }

    try {
      const tokenAddr = getTokenAddress()
      const decimals = await getTokenDecimals(w3, tokenAddr)
      const amountWei = ethers.parseUnits(amount, decimals)
      const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
      const wallet = new ethers.Wallet(pk)
      const sender = wallet.address

      const nonce = await w3.getTransactionCount(sender)
      const feeData = await w3.getFeeData()
      const priority = ethers.parseUnits(priorityGwei, 'gwei')
      const maxFee = maxFeeGwei
        ? ethers.parseUnits(maxFeeGwei, 'gwei')
        : feeData.maxFeePerGas || (feeData.gasPrice || ethers.parseUnits('20', 'gwei'))

      const data = encodeTransfer(to, amountWei, TRANSFER_SELECTOR)

      const tx = {
        to: ethers.getAddress(tokenAddr),
        value: 0n,
        gasLimit: BigInt(gasLimit),
        nonce,
        chainId: BSC_CHAIN_ID,
        maxPriorityFeePerGas: priority,
        maxFeePerGas: maxFee,
        data,
      }

      const tokenSymbol = token === 'CUSTOM' ? (await getTokenSymbol(w3, tokenAddr)) : token

      setTxConfig({
        ...tx,
        tokenSymbol,
        tokenAddress: tokenAddr,
        amountHuman: amount,
        decimals,
        amountWei: amountWei.toString(),
        sender,
        gasLimit: gasLimit,
        maxFeeGwei: ethers.formatUnits(maxFee, 'gwei'),
        priorityGwei: ethers.formatUnits(priority, 'gwei'),
        chain: 'BSC',
      })
    } catch (err) {
      setError(err.message || 'Error building transaction')
    }
  }

  const handleSend = async () => {
    if (!txConfig) return
    setLoading(true)
    setTxResult(null)
    setError('')

    try {
      const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
      const wallet = new ethers.Wallet(pk)
      const signingWallet = wallet.connect(w3)

      const { to: txTo, value, gasLimit: gl, nonce, chainId, maxPriorityFeePerGas, maxFeePerGas, data } = txConfig
      const tx = { to: txTo, value, gasLimit: gl, nonce, chainId, maxPriorityFeePerGas, maxFeePerGas, data }

      if (dryRun) {
        setTxResult({
          status: 'dry-run',
          message: 'Transaction built successfully (DRY RUN — not submitted)',
          details: tx,
        })
        setLoading(false)
        return
      }

      const sentTx = await signingWallet.sendTransaction(tx)
      const receipt = await sentTx.wait()
      setTxResult({
        status: 'success',
        message: `Transaction confirmed in block ${receipt.blockNumber}`,
        txHash: sentTx.hash,
        explorerUrl: `https://bscscan.com/tx/${sentTx.hash}`,
        receipt,
      })
    } catch (err) {
      setError(err.message || 'Transaction failed')
    }
    setLoading(false)
  }

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">⛓</span>
        <div>
          <h2>Send BSC Tokens</h2>
          <p>Transfer BEP20 tokens on Binance Smart Chain with EIP-1559 fee estimation</p>
        </div>
      </div>

      <div className="form-grid">
        <div className="form-group">
          <label>Private Key</label>
          <div className="input-with-toggle">
            <input
              type={showKey ? 'text' : 'password'}
              value={privateKey}
              onChange={e => setPrivateKey(e.target.value)}
              placeholder="0x..."
              className="input mono"
            />
            <button className="toggle-btn" onClick={() => setShowKey(!showKey)}>
              {showKey ? '🙈' : '👁'}
            </button>
          </div>
        </div>

        <div className="form-group">
          <label>Token</label>
          <select value={token} onChange={e => setToken(e.target.value)} className="input">
            {Object.entries(POPULAR_BEP20).map(([sym, addr]) => (
              <option key={sym} value={sym}>{sym} — {addr.slice(0, 8)}...</option>
            ))}
            <option value="CUSTOM">Custom Token</option>
          </select>
          {token === 'CUSTOM' && (
            <input
              type="text"
              value={customToken}
              onChange={e => setCustomToken(e.target.value)}
              placeholder="0x token contract address"
              className="input mono"
              style={{ marginTop: 8 }}
            />
          )}
        </div>

        <div className="form-group">
          <label>Recipient Address</label>
          <input
            type="text"
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder="0x..."
            className="input mono"
          />
        </div>

        <div className="form-group">
          <label>Amount (human units)</label>
          <input
            type="text"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="e.g. 1000"
            className="input"
          />
        </div>

        <div className="form-group">
          <label>Priority Fee (Gwei)</label>
          <input
            type="number"
            step="0.1"
            value={priorityGwei}
            onChange={e => setPriorityGwei(e.target.value)}
            className="input"
          />
        </div>

        <div className="form-group">
          <label>Max Fee (Gwei) — optional</label>
          <input
            type="number"
            step="0.1"
            value={maxFeeGwei}
            onChange={e => setMaxFeeGwei(e.target.value)}
            placeholder="Auto from base fee"
            className="input"
          />
        </div>

        <div className="form-group">
          <label>Gas Limit</label>
          <input
            type="number"
            value={gasLimit}
            onChange={e => setGasLimit(e.target.value)}
            className="input"
          />
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
            <span>Dry Run (simulate only)</span>
          </label>
        </div>
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" onClick={handlePreview} disabled={loading || !w3}>
          {loading ? 'Processing...' : '🔍 Preview Transaction'}
        </button>
        {txConfig && (
          <button className="btn btn-success" onClick={handleSend} disabled={loading}>
            {dryRun ? '📋 Simulate' : '🚀 Send Transaction'}
          </button>
        )}
      </div>

      {error && <div className="error-box"><span className="error-icon">✕</span> {error}</div>}

      {txConfig && (
        <div className="config-panel">
          <h3>Transaction Preview — <span className="highlight">{txConfig.tokenSymbol}</span></h3>
          <div className="config-grid">
            <div className="config-item"><span className="ci-label">Chain</span><span className="ci-value">{txConfig.chain}</span></div>
            <div className="config-item"><span className="ci-label">Token</span><span className="ci-value">{txConfig.tokenSymbol} ({txConfig.tokenAddress.slice(0, 10)}...)</span></div>
            <div className="config-item"><span className="ci-label">Amount</span><span className="ci-value">{txConfig.amountHuman} {txConfig.tokenSymbol}</span></div>
            <div className="config-item"><span className="ci-label">Amount (wei)</span><span className="ci-value mono">{txConfig.amountWei}</span></div>
            <div className="config-item"><span className="ci-label">Decimals</span><span className="ci-value">{txConfig.decimals}</span></div>
            <div className="config-item"><span className="ci-label">Sender</span><span className="ci-value mono">{txConfig.sender.slice(0, 10)}...{txConfig.sender.slice(-6)}</span></div>
            <div className="config-item"><span className="ci-label">Recipient</span><span className="ci-value mono">{to.slice(0, 10)}...{to.slice(-6)}</span></div>
            <div className="config-item"><span className="ci-label">Priority Fee</span><span className="ci-value">{parseFloat(txConfig.priorityGwei).toFixed(2)} Gwei</span></div>
            <div className="config-item"><span className="ci-label">Max Fee</span><span className="ci-value">{parseFloat(txConfig.maxFeeGwei).toFixed(2)} Gwei</span></div>
            <div className="config-item"><span className="ci-label">Gas Limit</span><span className="ci-value">{Number(txConfig.gasLimit).toLocaleString()}</span></div>
            <div className="config-item"><span className="ci-label">Nonce</span><span className="ci-value">{txConfig.nonce}</span></div>
            <div className="config-item"><span className="ci-label">Chain ID</span><span className="ci-value">{txConfig.chainId}</span></div>
          </div>
        </div>
      )}

      {txResult && (
        <div className={`result-panel ${txResult.status}`}>
          <h3>{txResult.status === 'success' ? '✅ Transaction Confirmed' : '📋 Dry Run Complete'}</h3>
          <p>{txResult.message}</p>
          {txResult.txHash && (
            <div className="result-hash">
              <span className="mono">{txResult.txHash}</span>
              <a href={txResult.explorerUrl} target="_blank" rel="noopener noreferrer" className="explorer-link">
                View on BscScan →
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
