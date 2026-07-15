import React from 'react'

/**
 * Reusable token selector with native option, popular tokens, and custom token address input.
 * @param {{ token: string, setToken: fn, customToken: string, setCustomToken: fn, nativeSymbol?: string, tokens: object, showNative?: boolean, label?: string }} props
 */
export default function TokenSelect({
  token, setToken, customToken, setCustomToken,
  nativeSymbol = 'ETH', tokens = {}, showNative = true, label = 'Token',
}) {
  return (
    <div className="form-group">
      {label && <label>{label}</label>}
      <select value={token} onChange={e => setToken(e.target.value)} className="input">
        {showNative && <option value="NATIVE">{nativeSymbol} (Native)</option>}
        {showNative && <option disabled>──────────</option>}
        {Object.entries(tokens).map(([sym, addr]) => (
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
  )
}
