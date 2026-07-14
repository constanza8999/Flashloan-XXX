import React from 'react'
import { useWeb3 } from '../context/Web3Context'

/**
 * Reusable component that shows either wallet connection info or private key input.
 * 
 * Props:
 *   - useWalletSign: boolean - if true, uses wallet's signer
 *   - setUseWalletSign: fn - toggles wallet signing
 *   - privateKey: string
 *   - setPrivateKey: fn
 *   - showKey: boolean
 *   - setShowKey: fn
 *   - senderAddress: string (derived from private key, optional)
 *   - label: string (optional, default "Signing Method")
 */
export default function SigningMethod({
  useWalletSign,
  setUseWalletSign,
  privateKey,
  setPrivateKey,
  showKey,
  setShowKey,
  senderAddress,
  label = 'Signing Method',
}) {
  const { isConnected, walletAddress, walletType, connectWallet, chainId } = useWeb3()

  const walletLabel = walletType === 'metamask' ? 'MetaMask' : walletType === 'walletconnect' ? 'WalletConnect' : 'Wallet'
  const formatAddr = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : ''

  return (
    <div className="signing-method-card">
      <div className="sm-header">
        <span className="sm-label">{label}</span>
        {isConnected && (
          <label className="sm-toggle">
            <input
              type="checkbox"
              checked={useWalletSign}
              onChange={e => setUseWalletSign(e.target.checked)}
            />
            <span className="sm-toggle-slider"></span>
            <span className="sm-toggle-text">
              {useWalletSign ? 'Using Wallet' : 'Using Key'}
            </span>
          </label>
        )}
      </div>

      {isConnected && useWalletSign ? (
        <div className="sm-wallet-active">
          <div className="sm-wallet-info">
            <span className="sm-wallet-icon">
              {walletType === 'metamask' ? '🦊' : '🔗'}
            </span>
            <div className="sm-wallet-details">
              <span className="sm-wallet-addr">{formatAddr(walletAddress)}</span>
              <span className="sm-wallet-name">{walletLabel} • Chain: {chainId || '?'}</span>
            </div>
            <span className="sm-wallet-badge">Connected</span>
          </div>
          <p className="sm-hint">
            Transactions will be signed by your {walletLabel} wallet.
            You will be prompted to confirm in the extension.
          </p>
        </div>
      ) : isConnected && !useWalletSign ? (
        <div className="sm-key-area">
          <p className="sm-hint">
            Wallet <strong>{formatAddr(walletAddress)}</strong> is connected but you're signing with a key.
            <button className="sm-link" onClick={() => setUseWalletSign(true)}>
              Switch to wallet signing
            </button>
          </p>
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
          {senderAddress && (
            <small className="form-hint success">
              Sender: {formatAddr(senderAddress)}
            </small>
          )}
        </div>
      ) : (
        <div className="sm-key-area">
          {!isConnected && (
            <p className="sm-hint">
              <button className="sm-link" onClick={() => connectWallet('metamask')}>
                Connect MetaMask
              </button>
              {' '}or enter a private key below.
            </p>
          )}
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
          {senderAddress && (
            <small className="form-hint success">
              Sender: {formatAddr(senderAddress)}
            </small>
          )}
        </div>
      )}
    </div>
  )
}
