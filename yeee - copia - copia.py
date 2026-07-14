import os
import sys
import time
import argparse
from datetime import datetime

from web3 import Web3
from eth_account import Account
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.live import Live
from rich.theme import Theme

# Configuración de Tema Profesional
custom_theme = Theme({
    "info": "cyan",
    "warning": "yellow",
    "error": "bold red",
    "success": "bold green",
    "header": "bold magenta",
})

console = Console(theme=custom_theme)

# ---------------------------------------------------------------------------
# Configuración de Redes y Contratos
# ---------------------------------------------------------------------------

BSC_RPCS = [
    "https://bsc-dataseed.binance.org/",
    "https://bsc-dataseed1.defibit.io/",
    "https://bsc-dataseed1.ninicoin.io/",
    "https://bsc-dataseed2.defibit.io/",
    "https://bsc.publicnode.com",
]

ETH_RPCS = [
    "https://eth.llamarpc.com",
    "https://cloudflare-eth.com",
    "https://rpc.etherbase.com",
]

ETH_PROTECT_RPC = "https://rpc.flashbots.net"

# Direcciones de Contratos USDT
BSC_USDT = "0x55d398326f99059fF775485246999027B3197955"
ETH_USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7"

BSC_CHAIN_ID = 56
ETH_CHAIN_ID = 1

TRANSFER_SELECTOR = "a9059cbb"
DEFAULT_BSC_GAS = 100_000
DEFAULT_ETH_GAS = 100_000

# ---------------------------------------------------------------------------
# Utilidades de Interfaz de Usuario
# ---------------------------------------------------------------------------

def display_banner():
    console.print(Panel.fit(
        "[bold magenta]Multi-chain USDT Transfer Toolkit[/bold magenta]\n"
        "[italic white]System Terminal Interface - Ready[/italic white]",
        border_style="magenta"
    ))

def print_config(chain, to, amount, priority, max_fee, gas_limit):
    table = Table(title="Configuración de la Transacción", show_header=True, header_style="bold cyan")
    table.add_column("Parámetro", style="dim")
    table.add_column("Valor")
    
    table.add_row("Red", chain.upper())
    table.add_row("Destinatario", to)
    table.add_row("Monto", f"{amount:,} USDT")
    table.add_row("Prioridad (Gwei)", str(priority))
    table.add_row("Tarifa Máxima (Gwei)", str(max_fee) if max_fee else "Auto")
    table.add_row("Límite de Gas", f"{gas_limit:,}")
    
    console.print(table)

# ---------------------------------------------------------------------------
# Lógica de Conexión y Transacción
# ---------------------------------------------------------------------------

def connect(rpcs, timeout=10):
    with console.status("[bold info]Estableciendo conexión con nodos RPC...", spinner="dots"):
        for rpc in rpcs:
            try:
                w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": timeout}))
                if w3.is_connected():
                    console.print(f"[success]Conexión exitosa:[/success] {rpc}")
                    return w3
            except Exception:
                continue
    console.print("[error]Error: No se pudo conectar a ningún proveedor RPC.[/error]")
    sys.exit(1)

def load_key(env_name):
    key = os.environ.get(env_name)
    if not key:
        console.print(f"[error]Error: La variable de entorno {env_name} no está configurada.[/error]")
        sys.exit(1)
    key = key.strip()
    if not key.startswith("0x"):
        key = "0x" + key
    if len(key) != 66:
        console.print(f"[error]Error: {env_name} no es una clave privada válida de 32 bytes.[/error]")
        sys.exit(1)
    return key

def encode_transfer(to, amount_wei):
    to = Web3.to_checksum_address(to)
    return (
        TRANSFER_SELECTOR
        + to[2:].lower().rjust(64, "0")
        + format(amount_wei, "x").rjust(64, "0")
    )

def estimate_eip1559(w3, priority_gwei, max_fee_gwei=None):
    priority = w3.to_wei(priority_gwei, "gwei")
    if max_fee_gwei is not None:
        return priority, w3.to_wei(max_fee_gwei, "gwei")
    
    try:
        block = w3.eth.get_block("latest")
        base_fee = block.get("baseFeePerGas", w3.to_wei(20, "gwei"))
    except Exception:
        base_fee = w3.to_wei(20, "gwei")
    return priority, int(base_fee) + priority

# ---------------------------------------------------------------------------
# Comandos de Ejecución
# ---------------------------------------------------------------------------

def send_bsc_usdt(to, amount, priority_gwei=1.0, max_fee_gwei=None, gas_limit=DEFAULT_BSC_GAS):
    display_banner()
    print_config("BSC", to, amount, priority_gwei, max_fee_gwei, gas_limit)
    
    w3 = connect(BSC_RPCS)
    pk = load_key("BSC_PRIVATE_KEY")
    sender = Account.from_key(pk).address
    
    amount_wei = int(amount * 10**18)
    nonce = w3.eth.get_transaction_count(sender)
    priority, max_fee = estimate_eip1559(w3, priority_gwei, max_fee_gwei)

    tx = {
        "to": Web3.to_checksum_address(BSC_USDT),
        "value": 0,
        "gas": gas_limit,
        "nonce": nonce,
        "chainId": BSC_CHAIN_ID,
        "maxPriorityFeePerGas": priority,
        "maxFeePerGas": max_fee,
        "data": encode_transfer(to, amount_wei),
    }

    signed = Account.sign_transaction(tx, pk)
    
    with console.status("[bold yellow]Transmitiendo a Binance Smart Chain...", spinner="earth"):
        raw_tx = signed.rawTransaction if hasattr(signed, 'rawTransaction') else signed.raw_transaction
        tx_hash = w3.eth.send_raw_transaction(raw_tx)
    
    console.print(Panel(
        f"[bold success]Transacción Enviada Correctamente[/bold success]\n\n"
        f"Hash: [white]0x{tx_hash.hex()}[/white]\n"
        f"Explorador: [link=https://bscscan.com/tx/0x{tx_hash.hex()}]https://bscscan.com/tx/0x{tx_hash.hex()}[/link]",
        title="Estado BSC", border_style="green"
    ))

def send_eth_usdt_via_flashbots(to, amount, priority_gwei=1.0, max_fee_gwei=None, gas_limit=DEFAULT_ETH_GAS):
    display_banner()
    print_config("Ethereum", to, amount, priority_gwei, max_fee_gwei, gas_limit)
    
    w3 = connect(ETH_RPCS)
    pk = load_key("ETH_PRIVATE_KEY")
    sender = Account.from_key(pk).address

    amount_wei = int(amount * 10**6)
    nonce = w3.eth.get_transaction_count(sender)
    priority, max_fee = estimate_eip1559(w3, priority_gwei, max_fee_gwei)

    tx = {
        "to": Web3.to_checksum_address(ETH_USDT),
        "value": 0,
        "gas": gas_limit,
        "nonce": nonce,
        "chainId": ETH_CHAIN_ID,
        "maxPriorityFeePerGas": priority,
        "maxFeePerGas": max_fee,
        "data": encode_transfer(to, amount_wei),
    }

    signed = Account.sign_transaction(tx, pk)
    
    with console.status("[bold yellow]Transmitiendo vía Flashbots Protect...", spinner="pulse"):
        protect_w3 = Web3(Web3.HTTPProvider(ETH_PROTECT_RPC))
        raw_tx = signed.rawTransaction if hasattr(signed, 'rawTransaction') else signed.raw_transaction
        tx_hash = protect_w3.eth.send_raw_transaction(raw_tx)
    
    h = "0x" + tx_hash.hex()
    console.print(Panel(
        f"[bold success]Transacción Enviada vía Flashbots[/bold success]\n\n"
        f"Hash: [white]{h}[/white]\n"
        f"Rastreador: [link=https://protect.flashbots.net/tx/{h}]https://protect.flashbots.net/tx/{h}[/link]",
        title="Estado Ethereum", border_style="green"
    ))

def watch_pending(chain, max_n=20, timeout_s=60):
    display_banner()
    w3 = connect(BSC_RPCS if chain == "bsc" else ETH_RPCS)
    console.print(f"[info]Monitoreando mempool de {chain.upper()} (Máx: {max_n} txs)...[/info]")
    
    seen = set()
    start = time.time()
    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Hora", style="dim", width=12)
    table.add_column("Hash de Transacción Pendiente")

    with Live(table, refresh_per_second=4):
        while time.time() - start < timeout_s and len(seen) < max_n:
            try:
                block = w3.eth.get_block("pending", full_transactions=True)
                for tx in block.transactions:
                    h_hex = tx.hash.hex() if not isinstance(tx.hash, str) else tx.hash
                    if not h_hex.startswith("0x"): h_hex = "0x" + h_hex
                    if h_hex not in seen:
                        seen.add(h_hex)
                        table.add_row(datetime.now().strftime("%H:%M:%S"), h_hex)
                        if len(seen) >= max_n: break
            except Exception:
                pass
            time.sleep(1)

# ---------------------------------------------------------------------------
# Punto de Entrada CLI
# ---------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(prog="transfer_toolkit")
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("send-bsc", help="Enviar USDT en la red BSC")
    b.add_argument("--to", required=True)
    b.add_argument("--amount", type=float, required=True)
    b.add_argument("--priority-gwei", type=float, default=1.0)
    b.add_argument("--max-fee-gwei", type=float, default=None)
    b.add_argument("--gas-limit", type=int, default=DEFAULT_BSC_GAS)

    e = sub.add_parser("send-eth", help="Enviar USDT en la red Ethereum")
    e.add_argument("--to", required=True)
    e.add_argument("--amount", type=float, required=True)
    e.add_argument("--priority-gwei", type=float, default=1.0)
    e.add_argument("--max-fee-gwei", type=float, default=None)
    e.add_argument("--gas-limit", type=int, default=DEFAULT_ETH_GAS)

    w = sub.add_parser("watch", help="Monitorear transacciones pendientes")
    w.add_argument("--chain", choices=["bsc", "eth"], default="bsc")
    w.add_argument("--max", type=int, default=20)
    w.add_argument("--timeout", type=int, default=60)

    args = p.parse_args()

    try:
        if args.cmd == "send-bsc":
            send_bsc_usdt(args.to, args.amount, args.priority_gwei, args.max_fee_gwei, args.gas_limit)
        elif args.cmd == "send-eth":
            send_eth_usdt_via_flashbots(args.to, args.amount, args.priority_gwei, args.max_fee_gwei, args.gas_limit)
        elif args.cmd == "watch":
            watch_pending(args.chain, args.max, args.timeout)
    except KeyboardInterrupt:
        console.print("\n[warning]Operación cancelada por el usuario.[/warning]")
    except Exception as e:
        console.print(f"\n[error]Error Crítico:[/error] {str(e)}")

if __name__ == "__main__":
    main()
