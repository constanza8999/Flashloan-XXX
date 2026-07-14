import React, { useState } from 'react'
import useTelegram from '../hooks/useTelegram'

export default function TelegramSettings() {
  const {
    botToken, chatId, enabled,
    setBotToken, setChatId, setEnabled,
    sendTest, testResult, testing,
    isConfigured,
  } = useTelegram()

  const [showToken, setShowToken] = useState(false)

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">📱</span>
        <div>
          <h2>Telegram Bot Notifications</h2>
          <p>Get real-time transaction alerts sent directly to your Telegram</p>
        </div>
      </div>

      <div className="tg-card">
        <h3>Bot Configuration</h3>

        <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="form-group">
            <label>Bot Token</label>
            <div className="input-with-toggle">
              <input
                type={showToken ? 'text' : 'password'}
                value={botToken}
                onChange={e => setBotToken(e.target.value)}
                placeholder="1234567890:ABCdefGHIjklmNOPqrSTUvwxYZ"
                className="input mono"
              />
              <button className="toggle-btn" onClick={() => setShowToken(!showToken)}>
                {showToken ? '🙈' : '👁'}
              </button>
            </div>
            <small className="form-hint">
              Get your bot token from <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">@BotFather</a> on Telegram
            </small>
          </div>

          <div className="form-group">
            <label>Chat ID</label>
            <input
              type="text"
              value={chatId}
              onChange={e => setChatId(e.target.value)}
              placeholder="123456789"
              className="input mono"
            />
            <small className="form-hint">
              Your Telegram user/group ID. Find it with <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer">@userinfobot</a>
            </small>
          </div>

          <div className="form-group">
            <label className="checkbox-label" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={e => setEnabled(e.target.checked)}
                  disabled={!isConfigured}
                />
                <span>Enable Telegram Notifications</span>
              </div>
              {enabled && <span className="tg-badge-active">Active</span>}
            </label>
          </div>
        </div>

        <div className="tg-actions">
          <button
            className="btn btn-primary"
            onClick={sendTest}
            disabled={testing || !isConfigured}
          >
            {testing ? '⏳ Sending...' : '📨 Send Test Message'}
          </button>
        </div>

        {testResult && (
          <div className={`tg-test-result ${testResult.ok ? 'success' : 'error'}`}>
            <span className="tg-test-icon">{testResult.ok ? '✅' : '❌'}</span>
            <span>{testResult.message}</span>
          </div>
        )}
      </div>

      <div className="tg-info-card">
        <h4>💡 How to set up</h4>
        <ol className="tg-steps">
          <li>
            <strong>Create a bot</strong> — Open Telegram, search for <code>@BotFather</code>, send <code>/newbot</code>, and follow the prompts. You'll receive a <strong>bot token</strong>.
          </li>
          <li>
            <strong>Get your Chat ID</strong> — Start a chat with your bot (send any message), then visit{' '}
            <code>https://api.telegram.org/bot&lt;YOUR_TOKEN&gt;/getUpdates</code> and look for            <code>&#123;"chat":&#123;"id":123456789&#125;&#125;</code>.
          </li>
          <li>
            <strong>Enable notifications</strong> — Paste the token and chat ID above, toggle notifications on, and click <strong>Send Test Message</strong> to verify.
          </li>
          <li>
            <strong>Automatic alerts</strong> — Once configured, every successful transaction sent via <strong>Send BSC</strong>, <strong>Send ETH Flashbots</strong>, or <strong>Flash Send</strong> will trigger a Telegram notification.
          </li>
        </ol>
      </div>
    </div>
  )
}
