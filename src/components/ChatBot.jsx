import React, { useState, useRef, useEffect, useCallback } from 'react'

// ─── FAQ Responses ─────────────────────────────────────────────────────

const FAQ_RESPONSES = [
  {
    keywords: ['hello', 'hi', 'hey', 'help', 'start'],
    answer: '👋 Hello! Welcome to **Token Toolkit**. I can help you with:\n\n• 💸 **Sending tokens** (BSC, ETH, Polygon, Arbitrum)\n• 📊 **Arbitrage trading** & DEX price scanning\n• 🤖 **MEV protection** & Flashbots bundles\n• 🔗 **Cross-chain bridging**\n• ⛽ **Gasless transactions**\n• 🧠 **AI price predictions**\n\nWhat would you like to know more about?',
  },
  {
    keywords: ['send', 'transfer', 'token'],
    answer: '💸 **Token Transfers**\n\nI support sending tokens on multiple chains:\n• **BSC** — BEP-20 tokens (USDT, USDC, BUSD)\n• **Ethereum** — ERC-20 via Flashbots Protect (MEV-safe)\n• **Polygon** — MATIC & tokens\n• **Arbitrum** — ETH & tokens\n\nGo to **Transfers → Send BSC/ETH** in the sidebar to start.\n\nYou can also use **Universal Send** to send from any source to any destination in one go!',
  },
  {
    keywords: ['arbitrage', 'profit', 'trade', 'dex'],
    answer: '📊 **Arbitrage Trading**\n\nOur arbitrage bot scans live DEX prices across Ethereum and BSC to find profitable opportunities:\n\n• **Supported DEXes:** Uniswap V2/V3, SushiSwap, PancakeSwap\n• **Strategies:** Flash loans, Flashbots bundles, direct swaps\n• **Auto-trading:** Configurable bot with min profit threshold\n\nHead to **Trading & Arbitrage → Arbitrage** to configure and start scanning!',
  },
  {
    keywords: ['mev', 'flashbots', 'sandwich', 'protection'],
    answer: '🛡️ **MEV Protection**\n\nI provide multiple layers of MEV protection:\n\n• **Flashbots Protect RPC** — Send transactions privately\n• **MEV Blocker** — Block sandwich attacks\n• **Validator bribes** — Incentivize block proposers\n• **Gasless bundles** — Atomic multi-tx execution\n\nCheck **Trading & Arbitrage → MEV Bot** for configuration.',
  },
  {
    keywords: ['gasless', 'gas', 'fee', 'sponsor'],
    answer: '⛽ **Gasless Transactions**\n\nUse EIP-2771 meta-transactions to send without paying gas:\n\n• **Relay Network** — Distributed relay nodes\n• **Forwarder** — TrustedForwarder contract handles execution\n• **Batch** — Send multiple gasless txs in one\n\nConfigure in **Network → Gasless Relay**. Note: requires a deployed TrustedForwarder contract.',
  },
  {
    keywords: ['cross', 'chain', 'bridge', 'bridge'],
    answer: '🌉 **Cross-Chain Bridge**\n\nBridge USDT between Ethereum and BSC:\n\n• **Stargate Finance** — LayerZero-powered instant bridging\n• **Across Protocol** — Optimistic relayer bridging\n• Auto-detects price discrepancies for arbitrage\n\nGo to **Network → Cross-Chain** to check prices and opportunities.',
  },
  {
    keywords: ['predictor', 'ai', 'predict', 'forecast', 'ml'],
    answer: '🧠 **AI Price Predictor**\n\nMachine learning models for price prediction:\n\n• **LSTM** — Deep learning price forecasting\n• **PPO** — Reinforcement learning agent\n• **Anomaly detection** — Autoencoder-based market anomalies\n• Supports USDT, USDC, WETH, WBTC, DAI, and more\n\nCheck **Trading & Arbitrage → AI Predictor** to train and predict!',
  },
  {
    keywords: ['private', 'key', 'wallet', 'connect', 'metamask'],
    answer: '🔑 **Wallet & Private Key**\n\nTwo ways to sign transactions:\n\n1. **WalletConnect (Recommended)** — Click the wallet button in the top-right header to connect MetaMask or WalletConnect\n2. **Private Key** — Enter your private key directly in the signing section of each tool\n\n⚠️ **Security note:** Private keys are never sent to our server. They\'re used only locally in your browser.',
  },
  {
    keywords: ['quantum', 'engine', 'entropy', 'rng'],
    answer: '⚛️ **Quantum Engine**\n\nC++-powered quantum-inspired tools:\n\n• **Quantum RNG** — Hardware-seeded random numbers\n• **MEV Shield** — Entropy-based transaction delays\n• **Gasless Executor** — Quantum-optimized relay\n• **Power Enhancer** — Remove entropy caps & force success\n\nCheck **Network → Quantum Engine** for the full CLI integration.',
  },
  {
    keywords: ['subscription', 'license', 'pro', 'enterprise', 'pricing', 'price'],
    answer: '💳 **Subscriptions & Pricing**\n\n• **Free** — Send BSC/ETH, check balances, token info\n• **Pro** ($29.99/mo) — All chains, Arbitrage, MEV Bot, Withdraw, Telegram\n• **Enterprise** ($99.99/mo) — All Pro + P2P Network, Cross-Chain, Relay Nodes, AI Predictor\n\nGo to **Developer → Subscription** to purchase and activate your license key.',
  },
  {
    keywords: ['admin', 'panel', 'user', 'manage'],
    answer: '🛡️ **Admin Panel**\n\nManage users and subscriptions:\n\n• View all registered users\n• Update subscription tiers\n• Generate license keys\n• Track activation status\n\nAccessible at **Developer → Admin Panel** (admin login required).',
  },
  {
    keywords: ['contract', 'deploy', 'flasharbitrage', 'solidity'],
    answer: '📦 **Contract Deployer**\n\nDeploy FlashArbitrage and TrustedForwarder contracts:\n\n• **FlashArbitrage** — Atomic flash loan arbitrage\n• **TrustedForwarder** — EIP-2771 gasless relay\n• Real-time deployment cost estimation\n• Automatic verification on Etherscan/BscScan\n\nCheck **Developer → Contract Deployer**.',
  },
  {
    keywords: ['propagation', 'broadcast', 'rpc', 'node'],
    answer: '📡 **Transaction Propagation**\n\nBroadcast transactions to multiple private endpoints:\n\n• Flashbots Protect\n• Flashbots Relay\n• MEV Blocker\n• Custom private RPCs\n\nParallel submission for maximum inclusion probability. Configure in **Network → Propagation**.',
  },
  {
    keywords: ['telegram', 'notification', 'alert', 'bot'],
    answer: '📱 **Telegram Notifications**\n\nGet real-time alerts for:\n\n• Transaction confirmations\n• Arbitrage opportunities\n• Bot execution results\n\nConfigure your Telegram bot token and chat ID in **Wallet → Telegram**.',
  },
  {
    keywords: ['mempool', 'pending', 'tx', 'transaction'],
    answer: '👁️ **Mempool Watcher**\n\nMonitor pending transactions in real-time:\n\n• Live pending tx feed\n• Anomaly detection (high gas, large value)\n• Filter by chain (Ethereum, BSC)\n\nGo to **Monitor → Mempool Watch**.',
  },
  {
    keywords: ['p2p', 'peer', 'relay', 'node', 'network'],
    answer: '🌐 **P2P Network & Relay Nodes**\n\nDistributed transaction relay infrastructure:\n\n• **P2P Network** — Direct peer-to-peer tx propagation\n• **Relay Nodes** — Master/slave node management\n• Geographic load balancing\n• Automatic failover\n\nConfigure both in the **Network** section of the sidebar.',
  },
  {
    keywords: ['balance', 'withdraw', 'profit'],
    answer: '💰 **Balances & Withdrawal**\n\n• **Balance Checker** — View native & token balances on any chain\n• **Withdraw** — Pull profits from FlashArbitrage contracts via rescueTokens() / rescueNative()\n• Supports all configured chains with real-time balance data\n\nCheck **Wallet → Balances** and **Wallet → Withdraw**.',
  },
]

// ─── Greeting message ─────────────────────────────────────────────────

const GREETING = {
  role: 'bot',
  text: '👋 **Welcome to Token Toolkit Support!**\n\nI\'m your AI support assistant. Ask me anything about:\n\n• 💸 Sending tokens & transfers\n• 📊 Arbitrage trading\n• 🛡️ MEV protection\n• 🌉 Cross-chain bridging\n• ⛽ Gasless transactions\n• 💳 Subscriptions & pricing\n• And more!\n\nJust type your question below, or say **"help"** to see all topics.',
}

// ══════════════════════════════════════════════════════════════════════
// ChatBot Component
// ══════════════════════════════════════════════════════════════════════

export default function ChatBot() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState([GREETING])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [unreadCount, setUnreadCount] = useState(1)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // ─── Scroll to bottom ───────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (isOpen) {
      scrollToBottom()
      setUnreadCount(0)
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [isOpen, messages, scrollToBottom])

  // ─── Find best FAQ match ────────────────────────────────────────
  const findResponse = (query) => {
    const q = query.toLowerCase().trim()
    // Score each FAQ by keyword matches
    let bestScore = 0
    let bestAnswer = null

    for (const faq of FAQ_RESPONSES) {
      let score = 0
      for (const kw of faq.keywords) {
        if (q.includes(kw)) {
          score += kw.length // Longer keyword matches weigh more
        }
      }
      if (score > bestScore) {
        bestScore = score
        bestAnswer = faq.answer
      }
    }

    return bestAnswer
  }

  // ─── Ref to track mounted state for cleanup ──────────────────
  const mountedRef = useRef(true)
  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  // ─── Send message ───────────────────────────────────────────────
  const handleSend = useCallback(async (overrideText) => {
    const text = (overrideText || input).trim()
    if (!text || isTyping) return

    // Add user message
    setMessages(prev => [...prev, { role: 'user', text }])
    setInput('')
    setIsTyping(true)

    // Simulate typing delay based on response length
    const response = findResponse(text) || getFallbackResponse(text)
    const delay = Math.min(800 + response.length * 5, 2500)

    await new Promise(r => setTimeout(r, delay))

    // Only update state if still mounted
    if (mountedRef.current) {
      setMessages(prev => [...prev, { role: 'bot', text: response }])
      setIsTyping(false)
    }
  }, [input, isTyping])

  // ─── Fallback when no FAQ matches ───────────────────────────────
  const getFallbackResponse = (query) => {
    const generic = [
      '🤔 I\'m not sure I understand that. Could you rephrase?\n\nTry saying **"help"** to see all topics I can assist with.',
      'I don\'t have a specific answer for that yet. Here are some things I can help with:\n\n• 💸 Token transfers\n• 📊 Arbitrage trading\n• 🛡️ MEV protection\n• 🌉 Cross-chain bridging\n• ⛽ Gasless transactions\n• 💳 Subscriptions\n\nWhat would you like to know?',
      'I\'m still learning! For now, try asking about:\n\n• send, transfer, token\n• arbitrage, profit, trade\n• mev, flashbots, protection\n• cross chain, bridge\n• gasless, gas fee\n• subscription, pro, pricing',
    ]
    return generic[Math.floor(Math.random() * generic.length)]
  }

  // ─── Handle Enter key ───────────────────────────────────────────
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ─── Render message with basic markdown ─────────────────────────
  const renderMessage = (msg) => {
    // Simple markdown-like rendering: **bold**, \n newlines
    const parts = msg.text.split(/(\*\*[^*]+\*\*)/g)
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>
      }
      return part.split('\n').map((line, j) => (
        <React.Fragment key={`${i}-${j}`}>
          {j > 0 && <br />}
          {line}
        </React.Fragment>
      ))
    })
  }

  // ─── Clear chat ─────────────────────────────────────────────────
  const handleClear = () => {
    setMessages([GREETING])
    setUnreadCount(1)
  }

  // ─── Quick action buttons ───────────────────────────────────────
  const quickActions = [
    { label: '💸 Send tokens', msg: 'How do I send tokens?' },
    { label: '📊 Arbitrage', msg: 'Tell me about arbitrage trading' },
    { label: '🛡️ MEV protection', msg: 'How does MEV protection work?' },
    { label: '💳 Pricing', msg: 'What are the subscription plans?' },
  ]

  return (
    <>
      {/* ─── Floating Chat Button ───────────────────────────────── */}
      <button
        className={`chatbot-toggle ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle support chat"
      >
        {isOpen ? (
          <span className="chatbot-toggle-icon">✕</span>
        ) : (
          <>
            <span className="chatbot-toggle-icon">💬</span>
            {unreadCount > 0 && (
              <span className="chatbot-unread-badge">{unreadCount}</span>
            )}
          </>
        )}
      </button>

      {/* ─── Chat Panel ─────────────────────────────────────────── */}
      <div className={`chatbot-panel ${isOpen ? 'open' : ''}`}>
        {/* Header */}
        <div className="chatbot-header">
          <div className="chatbot-header-info">
            <span className="chatbot-avatar">🤖</span>
            <div>
              <div className="chatbot-title">Support Assistant</div>
              <div className="chatbot-status">
                <span className="chatbot-status-dot" />
                Online
              </div>
            </div>
          </div>
          <div className="chatbot-header-actions">
            <button className="chatbot-clear-btn" onClick={handleClear} title="Clear chat">
              🗑️
            </button>
            <button className="chatbot-close-btn" onClick={() => setIsOpen(false)} title="Close">
              ✕
            </button>
          </div>
        </div>

        {/* Quick actions */}
        {messages.length <= 1 && (
          <div className="chatbot-quick-actions">
            <div className="chatbot-qa-label">Quick questions:</div>
            <div className="chatbot-qa-grid">
              {quickActions.map((qa, i) => (
                <button
                  key={i}
                  className="chatbot-qa-btn"
                  onClick={() => handleSend(qa.msg)}
                >
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="chatbot-messages">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`chatbot-msg ${msg.role === 'user' ? 'chatbot-msg-user' : 'chatbot-msg-bot'}`}
            >
              {msg.role === 'bot' && <span className="chatbot-msg-avatar">🤖</span>}
              <div className="chatbot-msg-bubble">
                {renderMessage(msg)}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {isTyping && (
            <div className="chatbot-msg chatbot-msg-bot">
              <span className="chatbot-msg-avatar">🤖</span>
              <div className="chatbot-msg-bubble chatbot-typing">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="chatbot-input-area">
          <textarea
            ref={inputRef}
            className="chatbot-input"
            placeholder="Type your question..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isTyping}
          />
          <button
            className="chatbot-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
          >
            {isTyping ? '⏳' : '➤'}
          </button>
        </div>
      </div>
    </>
  )
}
