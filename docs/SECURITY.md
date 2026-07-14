# Security Model

## Core Principle

**Private keys never leave your browser.** All transaction signing happens client-side using ethers.js. No data is sent to any backend server.

## Key Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────┐
│ User enters  │────▶│ ethers.js Wallet │────▶│ Signed TX    │
│ Private Key  │     │ (Browser memory)  │     │ (Hex string) │
└─────────────┘     └─────────────────┘     └──────┬───────┘
                                                    │
                                           ┌────────▼───────┐
                                           │  Public RPC     │
                                           │  (Submit only)  │
                                           └────────────────┘
```

- Private keys are stored **only in React component state** (in-memory)
- They are **never written to localStorage, cookies, or any persistent storage**
- They are **never sent over the network** — only the signed transaction hex is submitted
- Refreshing the page clears all key data

## Security Best Practices

### For Users

1. **Use dedicated wallets**: Never use a wallet with significant funds for testing. Create separate wallets for this tool.
2. **Start with dry-run**: Always use the "Dry Run" checkbox to verify transaction parameters before sending real funds.
3. **Double-check addresses**: Verify recipient addresses character-by-character. Copy-paste attacks are common.
4. **Use reasonable gas limits**: Overly high gas limits waste funds; too low causes transaction failure.
5. **Monitor the Auto-Bot**: Don't leave the auto-bot running unattended with large amounts. Use `--max-count` to set a safety limit.

### For Developers

1. **Private key handling**: Never log private keys to console, store them in source code, or send them to any API.
2. **RPC security**: Public RPC endpoints can see your IP and transaction patterns. For sensitive operations, use private RPC endpoints.
3. **No sensitive data in URLs**: Ensure no private keys or personal data are passed as URL parameters.
4. **Content Security Policy**: When deploying, consider adding CSP headers to prevent XSS.

## Known Risks

### 1. Malicious RPC Endpoints
Public RPCs could potentially:
- Track your IP address and transaction patterns
- Front-run your transactions (though Flashbots Protect mitigates this for ETH)
- Return false data (balance, nonce, etc.)

**Mitigation**: Use trusted RPC providers (Infura, Alchemy, your own node).

### 2. Browser Security
- Malicious browser extensions could read form inputs
- Keyloggers could capture typed private keys
- Cross-site scripting (XSS) could steal in-memory data

**Mitigation**: Use a clean browser profile, disable unnecessary extensions, and ensure you're on the correct URL.

### 3. Transaction Front-running
- Public mempool transactions can be seen and front-run by MEV bots
- This is especially risky for large token transfers

**Mitigation**: ETH sends use Flashbots Protect RPC, which bypasses the public mempool. For BSC, consider using a private RPC or MEV protection service.

### 4. Decimal Mismatch
- Using wrong token decimals can result in sending vastly incorrect amounts
- E.g., sending 6-decimal USDT amounts with 18-decimal encoding

**Mitigation**: The app auto-detects token decimals and performs cross-validation in the transaction preview.

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it by creating an issue in the GitHub repository. Do not disclose it publicly until it has been addressed.

## Liability

This software is provided "as is", without warranty of any kind. The authors are not responsible for any loss of funds or data resulting from the use of this software. Users are responsible for understanding the risks of blockchain transactions and for securing their own private keys.
