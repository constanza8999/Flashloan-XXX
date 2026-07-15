import torch
from torch.nn import LSTM, Linear
from torch.optim import Adam
import numpy as np
from sklearn.preprocessing import MinMaxScaler

class PricePredictor:
    def __init__(self, input_shape):
        self.model = torch.nn.Sequential(
            LSTM(input_shape, 64),
            Linear(64, 1)
        )
        self.scaler = MinMaxScaler()
        self.optimizer = Adam(self.model.parameters(), lr=0.001)

    def train(self, features, targets, epochs=1000):
        # Feature normalization
        scaled_features = self.scaler.fit_transform(features)
        scaled_targets = self.scaler.transform(targets.values.reshape(-1, 1))

        # Training loop
        for epoch in range(epochs):
            inputs = torch.tensor(scaled_features).float()
            labels = torch.tensor(scaled_targets).float().view(-1, 1)
            outputs = self.model(inputs)
            loss = torch.nn.MSELoss()(outputs, labels)
            self.optimizer.zero_grad()
            loss.backward()
            self.optimizer.step()

    def predict(self, recent_data):
        scaled = self.scaler.transform(recent_data)
        prediction = self.model(torch.tensor(scaled).float())
        return prediction.item()

# Initialize with ETH/BSC price data
predictor = PricePredictor(input_shape=30)