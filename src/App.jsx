import React, { useState, useEffect, useCallback } from 'react'
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
import ArbitrageDashboard from './components/ArbitrageDashboard'
import MevBot from './components/MevBot'
import ProfitWithdraw from './components/ProfitWithdraw'
import GaslessRelay from './components/GaslessRelay'
import PropagationNetwork from './components/PropagationNetwork'
import CrossChainBridge from './components/CrossChainBridge'
import P2PNetwork from './components/P2PNetwork'
import RelayNodes from './components/RelayNodes'
import PricePredictor from './components/PricePredictor'
import { Web3Provider } from './context/Web3Context'

const TABS = [
  { id: 'dashboard',       label: 'Dashboard',       icon: '◈' },
  { id: 'arbitrage',       label: 'Arbitrage',       icon: '📊' },
  { id: 'mev-bot',         label: 'MEV Bot',         icon: '🤖' },
  { id: 'balances',        label: 'Balances',        icon: '💰' },
  { id: 'send-bsc',        label: 'Send BSC',        icon: '⛓' },
  { id: 'send-eth',        label: 'Send ETH FB',     icon: '🛡' },
  { id: 'send-polygon',    label: 'Send Polygon',    icon: '🔶' },
  { id: 'send-arbitrum',   label: 'Send Arbitrum',   icon: '🌀' },
  { id: 'token-info',      label: 'Token Info',      icon: '◎' },
  { id: 'auto-bot',        label: 'Auto-Bot',        icon: '⚡' },
  { id: 'mempool',         label: 'Mempool Watch',   icon: '👁' },
  { id: 'history',         label: 'History',        icon: '📜' },
  { id: 'withdraw',        label: 'Withdraw',       icon: '💸' },
  { id: 'telegram',        label: 'Telegram',        icon: '📱' },
  { id: 'flashbots-bundle',label: 'Gasless Bundle',  icon: '⚡' },
  { id: 'flash-send',      label: 'Flash Send',      icon: '⚙' },
  { id: 'gasless-relay',   label: 'Gasless Relay',   icon: '⛽' },
  { id: 'propagation',     label: 'Propagation',     icon: '📡' },
  { id: 'cross-chain',     label: 'Cross-Chain',     icon: '🌉' },
  { id: 'p2p-network',     label: 'P2P Network',     icon: '🌐' },
  { id: 'relay-nodes',     label: 'Relay Nodes',     icon: '🗼' },
  { id: 'predictor',       label: 'AI Predictor',    icon: '🧠' },
]

const THEME_STORAGE_KEY = 'tokentoolkit_theme'

function useTheme() {
  const [theme, setThemeState] = useState(() => {
    // 1. Check localStorage
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
    // 2. Fall back to system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light'
    return 'dark'
  })

  const setTheme = useCallback((t) => {
    setThemeState(t)
    localStorage.setItem(THEME_STORAGE_KEY, t)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem(THEME_STORAGE_KEY, next)
      return next
    })
  }, [])

  // Sync body class
  useEffect(() => {
    const body = document.body
    if (theme === 'light') {
      body.classList.add('light-theme')
    } else {
      body.classList.remove('light-theme')
    }
  }, [theme])

  // Listen for system preference changes (only when no stored preference)
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const handler = (e) => {
      const stored = localStorage.getItem(THEME_STORAGE_KEY)
      if (!stored) {
        setTheme(e.matches ? 'light' : 'dark')
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [setTheme])

  // Remove 'preload' class after first paint so CSS transitions kick in
  useEffect(() => {
    const body = document.body
    body.classList.add('preload')
    const raf = requestAnimationFrame(() => {
      body.classList.remove('preload')
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  return { theme, setTheme, toggleTheme, isDark: theme === 'dark' }
}

function AppContent() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard':   return <Dashboard onNavigate={setActiveTab} />
      case 'arbitrage':   return <ArbitrageDashboard />
      case 'mev-bot':     return <MevBot />
      case 'balances':    return <BalanceChecker />
      case 'send-bsc':    return <SendBSC />
      case 'send-eth':    return <SendETH />
      case 'send-polygon':    return <SendPolygon />
      case 'send-arbitrum':   return <SendArbitrum />
      case 'token-info':  return <TokenInfo />
      case 'auto-bot':    return <AutoBot />
      case 'mempool':     return <MempoolWatcher />
      case 'history':     return <TransactionHistory />
      case 'withdraw':    return <ProfitWithdraw />
      case 'telegram':    return <TelegramSettings />
      case 'flashbots-bundle': return <SendFlashbotsBundle />
      case 'flash-send':  return <FlashSend />
      case 'gasless-relay':   return <GaslessRelay />
      case 'propagation':     return <PropagationNetwork />
      case 'cross-chain':     return <CrossChainBridge />
      case 'p2p-network':     return <P2PNetwork />
      case 'relay-nodes':     return <RelayNodes />
      case 'predictor':       return <PricePredictor />
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
            <button
              className="theme-toggle-btn"
              onClick={toggleTheme}
              aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
              title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            >
              <span className="theme-toggle-icon">
                {isDark ? '☀️' : '🌙'}
              </span>
              <span className="theme-toggle-label">
                {isDark ? 'Light' : 'Dark'}
              </span>
            </button>
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
        <span>{isDark ? '🌙' : '☀️'} {isDark ? 'Dark' : 'Light'} Mode</span>
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
