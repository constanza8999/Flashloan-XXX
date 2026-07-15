import React, { useState, useRef, useEffect } from 'react'
import { useWeb3 } from '../context/Web3Context'

export default function WalletConnectButton() {
  const {
    walletAddress,
    chainId,
    chainName,
    isConnecting,
    walletType,
    isConnected,
    error,
    connectWallet,
    disconnect,
    switchChain,
  } = useWeb3()

  const [showDropdown, setShowDropdown] = useState(false)
  const [showWalletModal, setShowWalletModal] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const formatAddress = (addr) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

    const walletIcon = walletType === 'metamask' ? '🦊' : walletType === 'walletconnect' ? '🔗' : '👛'

    const chainClass = chainId === 1 ? 'eth' : chainId === 56 ? 'bsc' : chainId === 137 ? 'polygon' : chainId === 42161 ? 'arbitrum' : 'unknown'

    if (isConnected && walletAddress) {
      return (
        <div className="wallet-dropdown" ref={dropdownRef}>
          <button
            className={`wallet-badge connected ${chainClass}`}
            onClick={() => setShowDropdown(!showDropdown)}
          >
            <span className={`chain-indicator-dot ${chainClass}`} />
            <span className="wallet-icon">{walletIcon}</span>
            <span className="wallet-addr">{formatAddress(walletAddress)}</span>
            <span className="wallet-chain-badge">{chainName}</span>
            <span className={`wallet-dot ${showDropdown ? 'open' : ''}`}>▾</span>
          </button>

        {showDropdown && (
          <div className="wallet-dropdown-menu">
            <div className="wd-header">
              <span className="wd-icon">{walletIcon}</span>
              <div className="wd-info">
                <span className="wd-addr">{walletAddress}</span>
                <span className="wd-type">{walletType === 'metamask' ? 'MetaMask' : 'WalletConnect'}</span>
              </div>
            </div>

            <div className="wd-divider" />

            <div className="wd-section">
              <span className="wd-section-title">Switch Network</span>
              <div className="wd-chains">
                <button
                  className={`wd-chain-btn ${chainId === 1 ? 'active' : ''}`}
                  onClick={() => { switchChain(1); setShowDropdown(false) }}
                >
                  <span className="wd-chain-icon">🛡</span>
                  <span>Ethereum</span>
                  {chainId === 1 && <span className="wd-check">✓</span>}
                </button>
                <button
                  className={`wd-chain-btn ${chainId === 56 ? 'active' : ''}`}
                  onClick={() => { switchChain(56); setShowDropdown(false) }}
                >
                  <span className="wd-chain-icon">⛓</span>
                  <span>BSC</span>
                  {chainId === 56 && <span className="wd-check">✓</span>}
                </button>
                <button
                  className={`wd-chain-btn ${chainId === 137 ? 'active' : ''}`}
                  onClick={() => { switchChain(137); setShowDropdown(false) }}
                >
                  <span className="wd-chain-icon">🔶</span>
                  <span>Polygon</span>
                  {chainId === 137 && <span className="wd-check">✓</span>}
                </button>
                <button
                  className={`wd-chain-btn ${chainId === 42161 ? 'active' : ''}`}
                  onClick={() => { switchChain(42161); setShowDropdown(false) }}
                >
                  <span className="wd-chain-icon">🌀</span>
                  <span>Arbitrum</span>
                  {chainId === 42161 && <span className="wd-check">✓</span>}
                </button>
              </div>
            </div>

            <div className="wd-divider" />

            <button className="wd-disconnect" onClick={() => { disconnect(); setShowDropdown(false) }}>
              Disconnect
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <button
        className="wallet-connect-btn"
        onClick={() => setShowWalletModal(true)}
        disabled={isConnecting}
      >
        {isConnecting ? (
          <><span className="spinner" /> Connecting...</>
        ) : (
          <><span className="wallet-btn-icon">👛</span> Connect Wallet</>
        )}
      </button>

      {error && <span className="wallet-error-tooltip">{error}</span>}

      {/* Wallet Selection Modal */}
      {showWalletModal && (
        <div className="wallet-modal-overlay" onClick={() => setShowWalletModal(false)}>
          <div className="wallet-modal" onClick={e => e.stopPropagation()}>
            <div className="wallet-modal-header">
              <h3>Connect Wallet</h3>
              <button className="wallet-modal-close" onClick={() => setShowWalletModal(false)}>✕</button>
            </div>
            <p className="wallet-modal-desc">
              Choose how you'd like to sign transactions. Your private key never leaves your wallet.
            </p>

            <button
              className="wallet-option-btn metamask"
              onClick={() => { connectWallet('metamask'); setShowWalletModal(false) }}
              disabled={isConnecting}
            >
              <span className="wo-icon">🦊</span>
              <div className="wo-body">
                <span className="wo-title">MetaMask</span>
                <span className="wo-desc">Connect using the MetaMask browser extension</span>
              </div>
              {!window.ethereum && (
                <span className="wo-not-found">Not detected</span>
              )}
            </button>

            <button
              className="wallet-option-btn walletconnect"
              onClick={() => { connectWallet('walletconnect'); setShowWalletModal(false) }}
              disabled={isConnecting}
            >
              <span className="wo-icon">🔗</span>
              <div className="wo-body">
                <span className="wo-title">WalletConnect</span>
                <span className="wo-desc">Scan QR code with your mobile wallet</span>
              </div>
            </button>

            <div className="wallet-modal-footer">
              <hr />
              <p className="wallet-modal-note">
                You can also enter a private key directly in each tool's form.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
