const TELEGRAM_API_BASE = 'https://api.telegram.org'

/**
 * Send a text message via a Telegram bot.
 * @param {string} botToken - Telegram bot token
 * @param {string} chatId - Chat ID to send to
 * @param {string} text - Message text
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function sendTelegramMessage(botToken, chatId, text) {
  if (!botToken || !chatId) {
    return { ok: false, error: 'Bot token and chat ID are required' }
  }
  try {
    const url = `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })
    const data = await response.json()
    if (!data.ok) {
      return { ok: false, error: data.description || 'Telegram API error' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message || 'Network error' }
  }
}

/**
 * Build a formatted transaction notification message for Telegram.
 */
export function buildTxNotification({ chain, tokenSymbol, amount, txHash, explorerUrl, sender, recipient, status = 'confirmed' }) {
  const statusEmoji = status === 'confirmed' ? '✅' : status === 'failed' ? '❌' : '⏳'
  const lines = [
    `<b>${statusEmoji} Transaction ${status === 'confirmed' ? 'Confirmed' : status === 'failed' ? 'Failed' : 'Pending'}</b>`,
    ``,
    `🔗 <b>Chain:</b> ${chain}`,
    `🪙 <b>Token:</b> ${tokenSymbol || 'N/A'}`,
    `💵 <b>Amount:</b> ${amount || 'N/A'} ${tokenSymbol || ''}`,
    ``,
    `📤 <b>From:</b> <code>${sender ? sender.slice(0, 10) + '...' + sender.slice(-6) : 'N/A'}</code>`,
    `📥 <b>To:</b> <code>${recipient ? recipient.slice(0, 10) + '...' + recipient.slice(-6) : 'N/A'}</code>`,
    ``,
  ]

  if (txHash) {
    const shortHash = txHash.slice(0, 10) + '...' + txHash.slice(-6)
    lines.push(`🔍 <b>TX:</b> <code>${shortHash}</code>`)
    if (explorerUrl) {
      lines.push(`🌐 <a href="${explorerUrl}">View on Explorer</a>`)
    }
  }

  lines.push(``)
  lines.push(`<i>Flashloan Token Toolkit</i>`)

  return lines.join('\n')
}

const STORAGE_KEY = 'flashloan_telegram_config'

/**
 * Load Telegram config from localStorage.
 */
export function loadTelegramConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { botToken: '', chatId: '', enabled: false }
    return JSON.parse(raw)
  } catch {
    return { botToken: '', chatId: '', enabled: false }
  }
}

/**
 * Save Telegram config to localStorage.
 */
export function saveTelegramConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch (e) {
    console.warn('Failed to save Telegram config:', e)
  }
}
