import asyncio
from web3 import Web3
from collections import defaultdict
import threading
from datetime import datetime

class MempoolMonitor:
    def __init__(self, rpc_urls):
        self.rpc_urls = rpc_urls
        self.mempool_data = defaultdict(list)
        self.anomaly_threshold = 0.05  # 5% deviation from median
        self.running = False

    async def _monitor(self, rpc_url):
        web3 = Web3(Web3.HTTPProvider(rpc_url))
        while True:
            mempool = web3.eth.getPendingTransactions()
            for tx in mempool:
                # Extract key features: gas price, nonce, value, contract interaction
                features = (tx['gasPrice'], tx['nonce'], tx['value'], 1 if tx['to'] else 0)
                self.mempool_data[tx['from']].append(features)
            await asyncio.sleep(10)

    def detect_anomalies(self):
        anomalies = []
        for addr, data in self.mempool_data.items():
            if len(data) < 5: continue
            median = np.median([x[0] for x in data[-5:]])  # Last 5 transactions
            for features in data[-5:]:
                if abs(features[0] - median) / median > self.anomaly_threshold:
                    anomalies.append(features)
        return anomalies

    def start(self):
        self.running = True
        tasks = [self._monitor(url) for url in self.rpc_urls]
        loop = asyncio.new_event_loop()
        for task in tasks:
            loop.create_task(task)
        asyncio.run_coroutine_threadsafe(loop.run_forever(), threading.Thread(group=threading._start_new_thread))

    def stop(self):
        self.running = False

# Initialize with ETH and BSC mempools
monitor = MempoolMonitor(["https://eth.llamarpc.com", "https://bsc-dataseed.binance.org"])