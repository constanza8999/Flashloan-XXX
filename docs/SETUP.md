# Setup Guide

## Prerequisites

- **Node.js** 18.x or later
- **npm** 9.x or later
- A modern browser (Chrome, Firefox, Edge, Safari)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/constanza8999/Flashloan-XXX.git
cd Flashloan-XXX

# Install dependencies
npm install

# Start the development server
npm run dev
```

The app will be available at `http://localhost:3000`.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build for production to `dist/` |
| `npm run preview` | Preview the production build locally |

## Deployment

### Static Hosting (Vercel, Netlify, GitHub Pages)

Since this is a client-only SPA, it can be deployed to any static hosting:

```bash
# Build the project
npm run build

# Deploy the dist/ folder to your hosting provider
```

#### Vercel (Recommended)

```bash
npm i -g vercel
vercel --prod
```

#### Netlify

```bash
npm i -g netlify-cli
netlify deploy --prod --dir=dist
```

#### GitHub Pages

```bash
npm install --save-dev gh-pages
# Add to package.json scripts:
# "deploy": "gh-pages -d dist"
npm run deploy
```

## Configuration

### RPC Endpoints

RPC endpoints are defined in `src/constants.js`:

```javascript
export const BSC_RPCS = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.defibit.io/',
  // ...
]

export const ETH_RPCS = [
  'https://eth.llamarpc.com',
  'https://cloudflare-eth.com',
  // ...
]

export const ETH_PROTECT_RPC = 'https://rpc.flashbots.net'
```

You can replace these with your own endpoints (e.g., Alchemy, Infura).

### Token Addresses

All popular token addresses are in `src/constants.js` under `POPULAR_BEP20` (BSC) and `POPULAR_ERC20` (ETH). To add a new token:

```javascript
export const POPULAR_BEP20 = {
  // ... existing tokens
  'MYTOKEN': '0x...',  // Add here
}
```

Also update the decimal cache:

```javascript
const _BSC_DECIMALS = {
  // ... existing
  'MYTOKEN': 18,  // Add decimal count
}
```

## Environment Variables

No environment variables are required. Private keys are entered directly in the browser UI and are never stored or transmitted to any server.

## Troubleshooting

### "Could not connect to any RPC"

- Check your internet connection
- The public RPC endpoints may be rate-limited; try replacing them with your own (Alchemy, Infura)
- Some regions may block certain RPC endpoints

### Transaction keeps pending

- Increase the `priority-gwei` value
- Check if you have sufficient native coin balance (BNB for BSC, ETH for Ethereum)
- Verify the token address is correct

### Auto-Bot stops unexpectedly

- Check the bot logs for error messages
- Ensure the wallet has sufficient gas balance
- The bot stops on critical errors to prevent fund loss
