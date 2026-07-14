import { useState, useCallback, useEffect } from 'react'
import { loadTelegramConfig, saveTelegramConfig, sendTelegramMessage, buildTxNotification } from '../utils/telegram'

/**
 * Hook for managing Telegram bot configuration and sending notifications.
 * Config is persisted in localStorage.
 */
export default function useTelegram() {
  const [config, setConfig] = useState({ botToken: '', chatId: '', enabled: false })
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    setConfig(loadTelegramConfig())
  }, [])

  const updateConfig = useCallback((updates) => {
    setConfig(prev => {
      const next = { ...prev, ...updates }
      saveTelegramConfig(next)
      return next
    })
  }, [])

  const setBotToken = useCallback((botToken) => updateConfig({ botToken }), [updateConfig])
  const setChatId = useCallback((chatId) => updateConfig({ chatId }), [updateConfig])
  const setEnabled = useCallback((enabled) => updateConfig({ enabled }), [updateConfig])

  /**
   * Send a test message to verify the bot configuration.
   */
  const sendTest = useCallback(async () => {
    if (!config.botToken || !config.chatId) {
      setTestResult({ ok: false, message: 'Bot token and Chat ID are required' })
      return
    }
    setTesting(true)
    setTestResult(null)
    const result = await sendTelegramMessage(
      config.botToken,
      config.chatId,
      '<b>🔔 Test Notification</b>\n\nYour Flashloan Token Toolkit is connected!\n\n<i>If you see this, notifications are working.</i>'
    )
    setTestResult({
      ok: result.ok,
      message: result.ok
        ? '✅ Test message sent! Check your Telegram.'
        : `❌ Failed: ${result.error}`,
    })
    setTesting(false)
  }, [config.botToken, config.chatId])

  /**
   * Send a transaction notification via Telegram.
   * Returns {ok: boolean, error?: string}
   */
  const notifyTx = useCallback(async (txInfo) => {
    if (!config.enabled || !config.botToken || !config.chatId) {
      return { ok: false, error: 'Telegram not configured or disabled' }
    }
    const message = buildTxNotification(txInfo)
    return await sendTelegramMessage(config.botToken, config.chatId, message)
  }, [config.enabled, config.botToken, config.chatId])

  return {
    botToken: config.botToken,
    chatId: config.chatId,
    enabled: config.enabled,
    setBotToken,
    setChatId,
    setEnabled,
    sendTest,
    testResult,
    testing,
    notifyTx,
    isConfigured: !!(config.botToken && config.chatId),
  }
}
