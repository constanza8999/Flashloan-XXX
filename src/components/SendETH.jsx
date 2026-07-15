import React, { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { POPULAR_ERC20, ETH_RPCS, ETH_PROTECT_RPC, ETH_CHAIN_ID, TRANSFER_SELECTOR, DEFAULT_ETH_GAS, NATIVE_TOKEN, NATIVE_ETH_DECIMALS, NATIVE_ETH_SYMBOL, NATIVE_SEND_GAS, DEFAULT_RECIPIENT } from '../constants'
import { useProvider } from '../hooks'
import { getTokenDecimals, getTokenSymbol, encodeTransfer } from '../utils'
import { useWeb3 } from '../context/Web3Context'
import CopyButton from './shared/CopyButton'
import SigningMethod from './SigningMethod'
import useTransactionHistory from '../hooks/useTransactionHistory'
import useTelegram from '../hooks/useTelegram'

export default function SendETH() {
  const { signer: walletSigner, walletAddress, isConnected, chainId, switchChain } = useWeb3()

  const [to, setTo] = useState(DEFAULT_RECIPIENT)
  const [amount, setAmount] = useState('')
  const [token, setToken] = useState('USDT')
  const [customToken, setCustomToken] = useState('')
  const [priorityGwei, setPriorityGwei] = useState('1.0')
  const [maxFeeGwei, setMaxFeeGwei] = useState('')
  const [gasLimit, setGasLimit] = useState(String(DEFAULT_ETH_GAS))
  const isNative = token === NATIVE_TOKEN
  const [privateKey, setPrivateKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [useWalletSign, setUseWalletSign] = useState(false)
  const [dryRun, setDryRun] = useState(false)

  const [txConfig, setTxConfig] = useState(null)
  const [txResult, setTxResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [derivedSender, setDerivedSender] = useState('')
  const { addTx, addFailedTx, updateTxStatus } = useTransactionHistory()
  const { notifyTx } = useTelegram()

  const w3 = useProvider(ETH_RPCS)

  useEffect(() => {
    if (isConnected) setUseWalletSign(true)
  }, [isConnected])

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

  const handlePreview = async () => {
    setError('')
    setTxResult(null)
    setTxConfig(null)

    if (!to || !ethers.isAddress(to)) { setError('Invalid recipient address'); return }
    if (!amount || parseFloat(amount) <= 0) { setError('Invalid amount'); return }
    if (!useWalletSign && !privateKey) { setError('Private key is required (or connect a wallet)'); return }      if (token === 'CUSTOM' && (!customToken || !ethers.isAddress(customToken))) {
      setError('Invalid custom token address'); return
    }
    if (isNative && !to) { setError('Recipient address is required for native ETH send'); return }
    if (!w3) { setError('Not connected to any RPC'); return }

    try {
      const sender = getSender()
      if (!sender) { setError('Could not determine sender address'); return }

      const nonce = await w3.getTransactionCount(sender)
      const feeData = await w3.getFeeData()
      const priority = ethers.parseUnits(priorityGwei.replace(',', '.'), 'gwei')
      const maxFee = maxFeeGwei
        ? ethers.parseUnits(maxFeeGwei.replace(',', '.'), 'gwei')
        : feeData.maxFeePerGas || (feeData.gasPrice || ethers.parseUnits('20', 'gwei'))

      let tx, tokenSymbol, tokenAddr, decimals, amountWei

      if (isNative) {
        // Native ETH send — value holds the amount, no data
        amountWei = ethers.parseUnits(amount, NATIVE_ETH_DECIMALS)
        tokenSymbol = NATIVE_ETH_SYMBOL
        tokenAddr = ''
        decimals = NATIVE_ETH_DECIMALS

        tx = {
          to: ethers.getAddress(to),
          value: amountWei,
          gasLimit: BigInt(NATIVE_SEND_GAS),
          nonce,
          chainId: ETH_CHAIN_ID,
          maxPriorityFeePerGas: priority,
          maxFeePerGas: maxFee,
          data: '0x',
        }
      } else {
        // ERC20 token send — call transfer() on token contract
        tokenAddr = getTokenAddress()
        decimals = await getTokenDecimals(w3, tokenAddr)
        amountWei = ethers.parseUnits(amount, decimals)
        tokenSymbol = token === 'CUSTOM' ? (await getTokenSymbol(w3, tokenAddr)) : token

        const data = encodeTransfer(to, amountWei, TRANSFER_SELECTOR)

        tx = {
          to: ethers.getAddress(tokenAddr),
          value: 0n,
          gasLimit: BigInt(gasLimit),
          nonce,
          chainId: ETH_CHAIN_ID,
          maxPriorityFeePerGas: priority,
          maxFeePerGas: maxFee,
          data,
        }
      }

      setTxConfig({
        ...tx,
        tokenSymbol,
        tokenAddress: tokenAddr,
        amountHuman: amount,
        decimals,
        amountWei: amountWei.toString(),
        sender,
        gasLimit: isNative ? String(NATIVE_SEND_GAS) : gasLimit,
        maxFeeGwei: ethers.formatUnits(maxFee, 'gwei'),
        priorityGwei: ethers.formatUnits(priority, 'gwei'),
        chain: 'ETH (Flashbots)',
        signingMethod: useWalletSign ? 'wallet' : 'key',
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
      const { to: txTo, value, gasLimit: gl, nonce, chainId, maxPriorityFeePerGas, maxFeePerGas, data } = txConfig
      const tx = { to: txTo, value, gasLimit: gl, nonce, chainId, maxPriorityFeePerGas, maxFeePerGas, data }

      if (dryRun) {
        setTxResult({
          status: 'dry-run',
          message: 'Transaction built successfully (DRY RUN — not submitted via Flashbots)',
          details: tx,
        })
        setLoading(false)
        return
      }

      let sentTx
      if (useWalletSign && walletSigner) {
        if (chainId !== ETH_CHAIN_ID) await switchChain(ETH_CHAIN_ID)
        // Use Flashbots Protect RPC with wallet signer
        const protectProvider = new ethers.JsonRpcProvider(ETH_PROTECT_RPC)
        const connectedSigner = walletSigner.connect ? walletSigner.connect(protectProvider) : walletSigner
        sentTx = await connectedSigner.sendTransaction(tx)
      } else {
        const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey
        const wallet = new ethers.Wallet(pk)
        const protectProvider = new ethers.JsonRpcProvider(ETH_PROTECT_RPC)
        const signingWallet = wallet.connect(protectProvider)
        sentTx = await signingWallet.sendTransaction(tx)
      }

      const txId = addTx({
        chain: 'ETH (Flashbots)',
        status: 'broadcast',
        tokenSymbol: txConfig.tokenSymbol,
        tokenAddress: txConfig.tokenAddress,
        amount: txConfig.amountHuman,
        recipient: to,
        sender: txConfig.sender,
        txHash: sentTx.hash,
        explorerUrl: `https://protect.flashbots.net/tx/${sentTx.hash}`,
        method: txConfig.signingMethod,
      })
      // Wait for next-block confirmation in background
      sentTx.wait()
        .then(receipt => updateTxStatus(txId, 'confirmed', { blockNumber: receipt.blockNumber }))
        .catch(() => console.warn('TX confirmation failed for', sentTx.hash))
      // Send Telegram notification (fire-and-forget)
      notifyTx({
        chain: 'ETH (Flashbots)',
        tokenSymbol: txConfig.tokenSymbol,
        amount: txConfig.amountHuman,
        txHash: sentTx.hash,
        explorerUrl: `https://protect.flashbots.net/tx/${sentTx.hash}`,
        sender: txConfig.sender,
        recipient: to,
        status: 'broadcast',
      })
      setTxResult({
        status: 'success',
        message: `Transaction broadcast via Flashbots!`,
        txHash: sentTx.hash,
        explorerUrl: `https://protect.flashbots.net/tx/${sentTx.hash}`,
      })
    } catch (err) {
      addFailedTx({
        chain: 'ETH (Flashbots)',
        tokenSymbol: txConfig?.tokenSymbol,
        tokenAddress: txConfig?.tokenAddress,
        amount: txConfig?.amountHuman,
        recipient: to,
        sender: txConfig?.sender,
        error: err.message,
        method: txConfig?.signingMethod,
      })
      setError(err.message || 'Transaction failed')
    }
    setLoading(false)
  }

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">🛡</span>
        <div>
          <h2>Send ETH via Flashbots Protect</h2>
          <p>Send ERC20 tokens on Ethereum mainnet with MEV protection</p>
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
          <label>Amount (human units)</label>
          <input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 500" className="input" />
        </div>

        <div className="form-group">
          <label>Priority Fee (Gwei)</label>
          <input type="number" step="0.1" value={priorityGwei} onChange={e => setPriorityGwei(e.target.value)} className="input" />
        </div>

        <div className="form-group">
          <label>Max Fee (Gwei) — optional</label>
          <input type="number" step="0.1" value={maxFeeGwei} onChange={e => setMaxFeeGwei(e.target.value)} placeholder="Auto from base fee" className="input" />
        </div>

        <div className="form-group">
          <label>Gas Limit</label>
          <input type="number" value={gasLimit} onChange={e => setGasLimit(e.target.value)} className="input" />
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
            {dryRun ? '📋 Simulate' : '🚀 Send via Flashbots'}
          </button>
        )}
      </div>

      {error && <div className="error-box"><span className="error-icon">✕</span> {error}</div>}

      {txConfig && (
        <div className="config-panel">
          <h3>Transaction Preview — <span className="highlight">{txConfig.tokenSymbol}</span></h3>
          <div className="config-grid">
            <div className="config-item"><span className="ci-label">Chain</span><span className="ci-value">{txConfig.chain}</span></div>
            <div className="config-item"><span className="ci-label">Signing</span><span className="ci-value">{txConfig.signingMethod === 'wallet' ? '🦊 Wallet' : '🔑 Private Key'}</span></div>
            <div className="config-item"><span className="ci-label">Token</span><span className="ci-value">{txConfig.tokenSymbol} ({txConfig.tokenAddress.slice(0, 10)}...)</span></div>
            <div className="config-item"><span className="ci-label">Amount</span><span className="ci-value">{txConfig.amountHuman} {txConfig.tokenSymbol}</span></div>
            <div className="config-item"><span className="ci-label">Amount (wei)</span><span className="ci-value mono">{txConfig.amountWei}</span></div>
            <div className="config-item"><span className="ci-label">Decimals</span><span className="ci-value">{txConfig.decimals}</span></div>
            <div className="config-item"><span className="ci-label">Sender</span><span className="ci-value mono">{txConfig.sender.slice(0, 10)}...{txConfig.sender.slice(-6)}</span></div>
            <div className="config-item"><span className="ci-label">Recipient</span><span className="ci-value mono">{to.slice(0, 10)}...{to.slice(-6)}</span></div>
            <div className="config-item"><span className="ci-label">Priority Fee</span><span className="ci-value">{parseFloat(txConfig.priorityGwei).toFixed(4)} Gwei</span></div>
            <div className="config-item"><span className="ci-label">Max Fee</span><span className="ci-value">{parseFloat(txConfig.maxFeeGwei).toFixed(4)} Gwei</span></div>
            <div className="config-item"><span className="ci-label">Gas Limit</span><span className="ci-value">{Number(txConfig.gasLimit).toLocaleString()}</span></div>
            <div className="config-item"><span className="ci-label">Nonce</span><span className="ci-value">{txConfig.nonce}</span></div>
            <div className="config-item"><span className="ci-label">Chain ID</span><span className="ci-value">{txConfig.chainId}</span></div>
          </div>
        </div>
      )}

      {txResult && (
        <div className={`result-panel ${txResult.status}`}>
          <h3>{txResult.status === 'success' ? '✅ Sent via Flashbots!' : '📋 Dry Run Complete'}</h3>
          <p>{txResult.message}</p>
          {txResult.txHash && (
            <div className="result-hash">
              <span className="mono">{txResult.txHash}</span>
              <CopyButton text={txResult.txHash} />
              <a href={txResult.explorerUrl} target="_blank" rel="noopener noreferrer" className="explorer-link">
                View on Flashbots Tracker →
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
