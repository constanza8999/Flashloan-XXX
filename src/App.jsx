import React, { useState } from 'react'
import Dashboard from './components/Dashboard'
import SendBSC from './components/SendBSC'
import SendETH from './components/SendETH'
import SendPolygon from './components/SendPolygon'
import SendArbitrum from './components/SendArbitrum'
import TokenInfo from './components/TokenInfo'
import AutoBot from './components/AutoBot'
import MempoolWatcher from './components/MempoolWatcher'
import FlashSend from './components/FlashSend'
import SendFlashbotsBundle from './components/SendFlashbotsBundle'
import BalanceChecker from './components/BalanceChecker'
import TransactionHistory from './components/TransactionHistory'
import TelegramSettings from './components/TelegramSettings'
import WalletConnectButton from './components/WalletConnectButton'
import { Web3Provider } from './context/Web3Context'

const TABS = [
  { id: 'dashboard',       label: 'Dashboard',       icon: '◈' },
  { id: 'balances',        label: 'Balances',        icon: '💰' },
  { id: 'send-bsc',        label: 'Send BSC',        icon: '⛓' },
  { id: 'send-eth',        label: 'Send ETH FB',     icon: '🛡' },
  { id: 'send-polygon',    label: 'Send Polygon',    icon: '🔶' },
  { id: 'send-arbitrum',   label: 'Send Arbitrum',   icon: '🌀' },
  { id: 'token-info',      label: 'Token Info',      icon: '◎' },
  { id: 'auto-bot',        label: 'Auto-Bot',        icon: '⚡' },
  { id: 'mempool',         label: 'Mempool Watch',   icon: '👁' },
  { id: 'history',         label: 'History',        icon: '📜' },
  { id: 'telegram',        label: 'Telegram',        icon: '📱' },
  { id: 'flashbots-bundle',label: 'Gasless Bundle',  icon: '⚡' },
  { id: 'flash-send',      label: 'Flash Send',      icon: '⚙' },
]

function AppContent() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard':   return <Dashboard onNavigate={setActiveTab} />
      case 'balances':    return <BalanceChecker />
      case 'send-bsc':    return <SendBSC />
      case 'send-eth':    return <SendETH />
      case 'send-polygon':    return <SendPolygon />
      case 'send-arbitrum':   return <SendArbitrum />
      case 'token-info':  return <TokenInfo />
      case 'auto-bot':    return <AutoBot />
      case 'mempool':     return <MempoolWatcher />
      case 'history':     return <TransactionHistory />
      case 'telegram':    return <TelegramSettings />
      case 'flashbots-bundle': return <SendFlashbotsBundle />
      case 'flash-send':  return <FlashSend />
      default:            return <Dashboard onNavigate={setActiveTab} />
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="header-left">
            <div className="logo">
              <span className="logo-icon">🔷</span>
              <div className="logo-text">
                <span className="logo-title">Token Toolkit</span>
                <span className="logo-sub">Multi-Chain Transfer Suite</span>
              </div>
            </div>
          </div>
          <div className="header-right">
            <WalletConnectButton />
          </div>
          <button
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <span className={`hamburger ${mobileMenuOpen ? 'open' : ''}`}>
              <span></span>
              <span></span>
              <span></span>
            </span>
          </button>
        </div>
      </header>

      <nav className={`nav-tabs ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => { setActiveTab(tab.id); setMobileMenuOpen(false) }}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </nav>

      <main className="main-content">
        {renderTab()}
      </main>

      <footer className="app-footer">
        <span>Multi-Chain Token Toolkit v1.0</span>
        <span className="footer-divider">•</span>
        <span>Powered by ethers.js & React</span>
        <span className="footer-divider">•</span>
        <span>BSC • ETH FB • Polygon • Arbitrum • Bundles</span>
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <Web3Provider>
      <AppContent />
    </Web3Provider>
  )
}
