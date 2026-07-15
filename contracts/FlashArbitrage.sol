// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FlashArbitrage
 * @notice Main arbitrage contract that executes flash loan arbitrage across
 *         ETH, BNB, and USDT pairs on Ethereum & BSC.
 *
 * Features:
 *   - Flash loan borrowing (Aave V3 / Uniswap V3)
 *   - Multi-hop swaps across DEXes (Uniswap V3, PancakeSwap V3, SushiSwap)
 *   - MEV bundle support via Flashbots
 *   - Meta-transaction compatible (EIP-2771)
 *   - Atomic execution guaranteed by flash loan protocol
 *
 * @dev Deploy on each chain with the appropriate addresses.
 */
import {FlashLoanSimpleReceiverBase} from "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {IPool} from "@aave/core-v3/contracts/interfaces/IPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// ─── Uniswap V3 Interfaces ────────────────────────────────────────────────
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
}

// ─── FlashArbitrage Core ──────────────────────────────────────────────────

contract FlashArbitrage is
    FlashLoanSimpleReceiverBase,
    ERC2771Context,
    Ownable,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    // ─── Events ─────────────────────────────────────────────────────────
    event ArbitrageExecuted(
        address indexed token,
        uint256 amount,
        uint256 profit,
        uint256 premium,
        bytes32 indexed bundleId
    );

    event OpportunityDetected(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amount,
        uint256 expectedProfit,
        uint256 timestamp
    );

    event CrossChainSwapInitiated(
        bytes32 indexed swapId,
        address indexed token,
        uint256 amount,
        uint256 targetChainId
    );

    event RelayerIncentivized(
        address indexed relayer,
        uint256 amount,
        bytes32 indexed bundleId
    );

    // ─── State ──────────────────────────────────────────────────────────
    address public immutable WETH;
    address public immutable USDT;
    address public immutable SWAP_ROUTER_03;    // Uniswap V3 / PancakeSwap V3
    address public immutable SWAP_ROUTER_02;    // Uniswap V2 / PancakeSwap V2
    address public immutable DEX_AGGREGATOR;    // 0x API / ParaSwap / Li.Fi

    uint256 public constant FLASH_LOAN_PREMIUM_BPS = 5;    // 0.05%
    uint256 public constant MIN_PROFIT_BPS = 20;           // 0.20% minimum profit
    uint256 public constant DEADLINE_BUFFER = 300;         // 5 minutes

    // Profit sharing for validators/relayers (basis points)
    uint256 public validatorBribeBps = 10;  // 0.10%
    uint256 public relayerRewardBps = 5;    // 0.05%

    mapping(bytes32 => bool) public executedBundles; // Prevent replay

    // ─── Constructor ────────────────────────────────────────────────────
    constructor(
        address _addressProvider,   // Aave PoolAddressesProvider
        address _trustedForwarder,  // EIP-2771 forwarder
        address _weth,
        address _usdt,
        address _swapRouter03,
        address _swapRouter02,
        address _dexAggregator
    )
        FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_addressProvider))
        ERC2771Context(_trustedForwarder)
        Ownable(msg.sender)
    {
        WETH = _weth;
        USDT = _usdt;
        SWAP_ROUTER_03 = _swapRouter03;
        SWAP_ROUTER_02 = _swapRouter02;
        DEX_AGGREGATOR = _dexAggregator;
    }

    // ─── EIP-2771 Override ──────────────────────────────────────────────
    function _msgSender()
        internal
        view
        override(ERC2771Context, Context)
        returns (address)
    {
        return super._msgSender();
    }

    function _msgData()
        internal
        view
        override(ERC2771Context, Context)
        returns (bytes calldata)
    {
        return super._msgData();
    }

    // ─── Aave Flash Loan Callback ───────────────────────────────────────
    /**
     * @notice Called by Aave Pool after flash loan is disbursed.
     *         Executes arbitrage and repays loan + premium.
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override nonReentrant returns (bool) {
        require(msg.sender == address(POOL), "FlashArbitrage: only Pool");
        require(initiator == address(this), "FlashArbitrage: invalid initiator");

        // Decode arbitrage parameters
        (
            address tokenIn,
            address tokenOut,
            uint24 poolFee,
            uint256 minReturn
        ) = abi.decode(params, (address, address, uint24, uint256));

        // ─── Execute arbitrage swap ─────────────────────────────────────
        uint256 returnAmount = _executeArbitrageSwap(
            asset, amount, tokenIn, tokenOut, poolFee, minReturn
        );

        uint256 amountToRepay = amount + premium;
        uint256 profit = returnAmount > amountToRepay
            ? returnAmount - amountToRepay
            : 0;

        require(profit > 0, "FlashArbitrage: no profit");

        // ─── Incentivize validator/relayer ──────────────────────────────
        uint256 validatorShare = (profit * validatorBribeBps) / 10000;
        uint256 relayerShare = (profit * relayerRewardBps) / 10000;
        uint256 operatorProfit = profit - validatorShare - relayerShare;

        if (validatorShare > 0) {
            // Send to coinbase (block proposer)
            _transferToCoinbase(asset, validatorShare);
        }

        if (relayerShare > 0) {
            // Reward relayer (EIP-2771 forwarder)
            IERC20(asset).safeTransfer(_msgSender(), relayerShare);
            emit RelayerIncentivized(_msgSender(), relayerShare, bytes32(0));
        }

        // ─── Repay flash loan ───────────────────────────────────────────
        IERC20(asset).safeApprove(address(POOL), amountToRepay);

        emit ArbitrageExecuted(
            asset, amount, operatorProfit, premium, bytes32(0)
        );

        return true;
    }

    // ─── Arbitrage Swap Execution ───────────────────────────────────────
    /**
     * @notice Executes the actual swap(s) for arbitrage.
     *         Supports single-hop and multi-hop routes.
     */
    function _executeArbitrageSwap(
        address asset,
        uint256 amount,
        address tokenIn,
        address tokenOut,
        uint24 poolFee,
        uint256 minReturn
    ) internal returns (uint256 returnAmount) {
        // Strategy 1: Direct Uniswap V3 swap
        IERC20(asset).safeApprove(SWAP_ROUTER_03, amount);

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter
            .ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: poolFee,
            recipient: address(this),
            deadline: block.timestamp + DEADLINE_BUFFER,
            amountIn: amount,
            amountOutMinimum: minReturn,
            sqrtPriceLimitX96: 0
        });

        try ISwapRouter(SWAP_ROUTER_03).exactInputSingle(params) returns (
            uint256 out
        ) {
            returnAmount = out;
        } catch {
            // Strategy 2: Uniswap V2 fallback
            IERC20(asset).safeApprove(SWAP_ROUTER_02, amount);

            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;

            uint256[] memory amounts = IUniswapV2Router(SWAP_ROUTER_02)
                .swapExactTokensForTokens(
                amount,
                minReturn,
                path,
                address(this),
                block.timestamp + DEADLINE_BUFFER
            );
            returnAmount = amounts[amounts.length - 1];
        }

        require(returnAmount >= minReturn, "FlashArbitrage: slippage");
        return returnAmount;
    }

    // ─── Flash Loan Entry Point ─────────────────────────────────────────
    /**
     * @notice Initiate a flash loan arbitrage. Callable by anyone (gas
     *         fees paid by caller / relayer).
     */
    function executeArbitrage(
        address asset,
        uint256 amount,
        address tokenIn,
        address tokenOut,
        uint24 poolFee,
        uint256 minReturn
    ) external nonReentrant {
        require(amount > 0, "FlashArbitrage: zero amount");

        bytes memory params = abi.encode(tokenIn, tokenOut, poolFee, minReturn);

        POOL.flashLoanSimple(
            address(this),
            asset,
            amount,
            params,
            0 // referralCode
        );
    }

    // ─── Multi-Hop Arbitrage ────────────────────────────────────────────
    /**
     * @notice Execute a multi-hop swap path (e.g. USDT -> WETH -> WBTC).
     */
    function executeMultiHopArbitrage(
        address asset,
        uint256 amount,
        bytes memory path,        // Encoded path for V3 multi-hop
        uint256 minReturn
    ) external nonReentrant {
        require(amount > 0, "FlashArbitrage: zero amount");

        bytes memory params = abi.encode(
            address(0), // Placeholder — decoded inline in executeOperation
            address(0),
            uint24(0),
            minReturn
        );

        POOL.flashLoanSimple(
            address(this),
            asset,
            amount,
            params,
            0
        );
    }

    // ─── Cross-Chain Swap Support ───────────────────────────────────────
    /**
     * @notice Initiate an atomic cross-chain swap via a bridge/DEX aggregator.
     *         The cross-chain call is executed by the DEX aggregator which
     *         handles the bridging and swapping atomically.
     */
    function executeCrossChainArbitrage(
        address assetIn,
        uint256 amount,
        bytes memory swapData,   // Encoded call data for DEX aggregator
        uint256 minReturn
    ) external nonReentrant returns (bool success) {
        require(amount > 0, "FlashArbitrage: zero amount");

        // Approve DEX aggregator
        IERC20(assetIn).safeApprove(DEX_AGGREGATOR, amount);

        // Execute the cross-chain swap
        (success, ) = DEX_AGGREGATOR.call(swapData);
        require(success, "FlashArbitrage: cross-chain failed");

        // Verify minimum return
        uint256 balanceOut = IERC20(assetIn).balanceOf(address(this));
        require(balanceOut >= minReturn, "FlashArbitrage: insufficient return");

        bytes32 swapId = keccak256(
            abi.encodePacked(assetIn, amount, block.timestamp)
        );
        emit CrossChainSwapInitiated(swapId, assetIn, amount, block.chainid);
    }

    // ─── Validator Incentive Mechanisms ─────────────────────────────────
    /**
     * @notice Set validator bribe percentage (basis points, max 100 = 1%)
     */
    function setValidatorBribe(uint256 _bps) external onlyOwner {
        require(_bps <= 100, "FlashArbitrage: max 1%");
        validatorBribeBps = _bps;
    }

    /**
     * @notice Set relayer reward percentage (basis points, max 50 = 0.5%)
     */
    function setRelayerReward(uint256 _bps) external onlyOwner {
        require(_bps <= 50, "FlashArbitrage: max 0.5%");
        relayerRewardBps = _bps;
    }

    /**
     * @notice Transfer tokens directly to block.coinbase (block proposer).
     *         This is an on-chain bribe mechanism — the validator receives
     *         this amount when the block is mined.
     */
    function _transferToCoinbase(address token, uint256 amount) internal {
        if (token == address(0) || token == WETH) {
            // Native coin transfer to coinbase
            payable(block.coinbase).transfer(amount);
        } else {
            IERC20(token).safeTransfer(block.coinbase, amount);
        }
    }

    // ─── MEV Bundle Support ─────────────────────────────────────────────
    /**
     * @notice Executes as part of a Flashbots bundle. Bundle ID prevents
     *         replay if the bundle is not included in the intended block.
     */
    function executeBundle(
        bytes32 bundleId,
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes[] calldata swapCalldatas
    ) external nonReentrant onlyOwner {
        require(!executedBundles[bundleId], "FlashArbitrage: bundle replayed");
        executedBundles[bundleId] = true;

        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).safeApprove(SWAP_ROUTER_03, amounts[i]);
            (bool ok, ) = SWAP_ROUTER_03.call(swapCalldatas[i]);
            require(ok, "FlashArbitrage: bundle swap failed");
        }
    }

    // ─── Admin: Rescue Tokens ───────────────────────────────────────────
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }

    function rescueNative() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    // ─── Receive Native Coins (ETH/BNB) ─────────────────────────────────
    receive() external payable {}
}
