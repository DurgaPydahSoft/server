const axios = require('axios');
const crypto = require('crypto');

class CashfreeService {
  constructor() {
    this.baseURL = process.env.NODE_ENV === 'production' 
      ? 'https://api.cashfree.com/pg' 
      : 'https://sandbox.cashfree.com/pg';
    
    this.clientId = process.env.CASHFREE_CLIENT_ID;
    this.clientSecret = process.env.CASHFREE_CLIENT_SECRET;
    this.webhookSecret = process.env.CASHFREE_WEBHOOK_SECRET;
  }

  // Generate signature for API requests
  generateSignature(payload, timestamp) {
    const message = payload + timestamp;
    return crypto
      .createHmac('sha256', this.clientSecret)
      .update(message)
      .digest('hex');
  }

  // Create order in Cashfree
  async createOrder(orderData) {
    try {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const payload = JSON.stringify(orderData);
      const signature = this.generateSignature(payload, timestamp);

      const response = await axios.post(`${this.baseURL}/orders`, orderData, {
        headers: {
          'x-client-id': this.clientId,
          'x-client-secret': this.clientSecret,
          'x-api-version': '2023-08-01',
          'x-timestamp': timestamp,
          'x-signature': signature,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Cashfree createOrder error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to create order');
    }
  }

  // Get order details
  async getOrder(orderId) {
    try {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = this.generateSignature('', timestamp);

      const response = await axios.get(`${this.baseURL}/orders/${orderId}`, {
        headers: {
          'x-client-id': this.clientId,
          'x-client-secret': this.clientSecret,
          'x-api-version': '2023-08-01',
          'x-timestamp': timestamp,
          'x-signature': signature
        }
      });

      return response.data;
    } catch (error) {
      console.error('Cashfree getOrder error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to get order');
    }
  }

  // Verify webhook signature
  verifyWebhookSignature(payload, signature, timestamp) {
    const expectedSignature = this.generateSignature(payload, timestamp);
    return signature === expectedSignature;
  }

  // Process webhook
  async processWebhook(webhookData) {
    try {
      const { orderId, orderAmount, referenceId, txStatus, txMsg, txTime, signature, timestamp } = webhookData;

      // Verify signature
      const payload = JSON.stringify(webhookData);
      if (!this.verifyWebhookSignature(payload, signature, timestamp)) {
        throw new Error('Invalid webhook signature');
      }

      return {
        orderId,
        orderAmount,
        referenceId,
        status: txStatus,
        message: txMsg,
        transactionTime: txTime
      };
    } catch (error) {
      console.error('Cashfree webhook processing error:', error);
      throw error;
    }
  }
}

module.exports = new CashfreeService(); 