# Contributing to Flashloan-XXX

We love contributions! Here's how you can help make this project better.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/Flashloan-XXX.git`
3. Create a feature branch: `git checkout -b feature/my-awesome-feature`
4. Install dependencies: `npm install`
5. Start the dev server: `npm run dev`

## Development Guidelines

### Code Style

- Use functional React components with hooks
- Follow existing patterns for state management
- Keep components focused on a single responsibility
- Extract reusable logic to `src/utils.js` or `src/hooks.js`
- Use the shared constants in `src/constants.js` for all chain/token config

### Adding a New Chain

1. Add RPC endpoints and chain config to `src/constants.js`
2. Add token catalog and decimal cache in the same file
3. Create or extend a component with chain selection
4. Update `docs/CHAIN_CONFIG.md` with the new chain information
5. Add tests if applicable

### Adding a New Token

1. Add the address to `POPULAR_BEP20` or `POPULAR_ERC20` in `src/constants.js`
2. Add decimal count to the corresponding `_DECIMALS` cache
3. Verify it works with the Token Info lookup component

### Commit Messages

Use clear, descriptive commit messages:
- `feat: add support for Polygon chain`
- `fix: correct BSC USDT decimal handling`
- `docs: update API reference for encodeTransfer`

## Pull Request Process

1. Ensure your code builds: `npm run build`
2. Update documentation if you're adding/changing features
3. Create a PR with a clear title and description
4. Reference any related issues

## Reporting Issues

- Use the **Bug Report** template for bugs
- Use the **Feature Request** template for suggestions
- Include relevant details: OS, browser, chain, token, error messages

## Code of Conduct

Be respectful and constructive. We're all here to learn and build cool stuff.

## Questions?

Open a [discussion](https://github.com/constanza8999/Flashloan-XXX/discussions) or create an issue.
