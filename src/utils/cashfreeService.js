import axios from 'axios';
import crypto from 'crypto';

class CashfreeService {
  constructor() {
    this.clientId = process.env.CASHFREE_CLIENT_ID;
    this.clientSecret = process.env.CASHFREE_CLIENT_SECRET;
    this.apiUrl = process.env.CASHFREE_API_URL || 'https://api.cashfree.com/pg';
    this.webhookSecret = process.env.CASHFREE_WEBHOOK_SECRET;
    
    console.log('🔧 Cashfree Service Configuration:');
    console.log('  - Client ID:', this.clientId ? 'Present' : 'Missing');
    console.log('  - Client Secret:', this.clientSecret ? 'Present' : 'Missing');
    console.log('  - API URL:', this.apiUrl);
    console.log('  - Webhook Secret:', this.webhookSecret ? 'Present' : 'Missing');
    
    if (!this.clientId || !this.clientSecret) {
      console.error('❌ Cashfree credentials not configured!');
      console.error('Please set CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET in your environment variables.');
      throw new Error('Cashfree credentials not configured. Please set CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET.');
    } else {
      console.log('✅ Cashfree credentials found - using real API');
    }
  }

  // Generate signature for API requests
  generateSignature(payload, timestamp) {
    const message = payload + timestamp;
    return crypto
      .createHmac('sha256', this.clientSecret)
      .update(message)
      .digest('hex');
  }

  // Verify webhook signature
  verifyWebhookSignature(payload, signature, timestamp) {
    if (!this.webhookSecret) {
      console.warn('⚠️ Webhook secret not configured. Skipping signature verification.');
      return true;
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload + timestamp)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  // Create a new order with Cashfree
  async createOrder(orderData, paymentId = null) {
    try {
      console.log('🔧 createOrder called with:');
      console.log('  - Client ID present:', !!this.clientId);
      console.log('  - Client Secret present:', !!this.clientSecret);
      
      console.log('🌐 Real API mode: Making request to Cashfree');
      
      // Use production API URL
      const apiUrl = this.apiUrl;
      
      // Create headers
      const headers = {
        'x-client-id': this.clientId,
        'x-client-secret': this.clientSecret,
        'x-api-version': '2023-08-01',
        'Content-Type': 'application/json'
      };

      console.log('Using headers:', {
        'x-client-id': headers['x-client-id'] ? 'Set' : 'Not set',
        'x-client-secret': headers['x-client-secret'] ? 'Set' : 'Not set',
        'x-api-version': headers['x-api-version']
      });

      // Update order data to match reference structure
      // Clean URLs to prevent double slashes
      const cleanFrontendUrl = (process.env.FRONTEND_URL).replace(/\/$/, '');
      const cleanBackendUrl = (process.env.BACKEND_URL ).replace(/\/$/, '');

      const enhancedOrderData = {
        ...orderData,
        order_meta: {
          ...orderData.order_meta, // Use the order_meta from orderData (which has the correct return_url)
          notify_url: `${cleanBackendUrl}/api/payments/webhook`,
          payment_methods: 'cc,dc,upi,nb,app'
        }
      };

      console.log('Creating order with data:', enhancedOrderData);
      console.log('Using API URL:', apiUrl);

      const response = await axios.post(
        `${apiUrl}/orders`,
        enhancedOrderData,
        { 
          headers,
          timeout: 30000 // 30 second timeout
        }
      );

      console.log('✅ Cashfree order created successfully:', response.data.order_id);
      console.log('Payment Session ID:', response.data.payment_session_id);
      
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('❌ Error creating Cashfree order:', error.response?.data || error.message);
      
      // Provide more specific error messages
      let errorMessage = 'Failed to create payment order';
      let errorDetails = error.response?.data || error.message;
      
      if (error.response?.status === 401) {
        errorMessage = 'Authentication failed - Please check your Cashfree credentials';
      } else if (error.response?.status === 403) {
        errorMessage = 'Access denied - Please check your Cashfree account permissions';
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = 'Request timeout - Please try again';
      }
      
      return {
        success: false,
        error: errorMessage,
        details: errorDetails,
        suggestion: 'Please verify your Cashfree credentials and ensure your domain is whitelisted'
      };
    }
  }

  // Verify payment with Cashfree
  async verifyPayment(orderId) {
    try {
      console.log('🌐 Verifying payment with Cashfree API');
      
      const headers = {
        'x-client-id': this.clientId,
        'x-client-secret': this.clientSecret,
        'x-api-version': '2023-08-01',
        'Content-Type': 'application/json'
      };

      const response = await axios.get(
        `${this.apiUrl}/orders/${orderId}`,
        { 
          headers,
          timeout: 30000
        }
      );

      console.log('✅ Payment verification successful:', response.data.order_status);
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('❌ Error verifying payment:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  // Get payment details
  async getPaymentDetails(orderId) {
    try {
      if (!this.clientId || !this.clientSecret) {
        throw new Error('Cashfree credentials not configured');
      }

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = this.generateSignature('', timestamp);

      const response = await axios.get(
        `${this.apiUrl}/orders/${orderId}/payments`,
        {
          headers: {
            'x-client-id': this.clientId,
            'x-client-secret': this.clientSecret,
            'x-api-version': '2023-08-01',
            'x-timestamp': timestamp,
            'x-signature': signature
          }
        }
      );

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('❌ Error getting payment details:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }

  // Process webhook notification
  async processWebhook(webhookData, signature, timestamp) {
    try {
      // Verify webhook signature
      const payload = JSON.stringify(webhookData);
      const isValidSignature = this.verifyWebhookSignature(payload, signature, timestamp);

      if (!isValidSignature) {
        console.error('❌ Invalid webhook signature');
        return {
          success: false,
          error: 'Invalid webhook signature'
        };
      }

      console.log('✅ Webhook signature verified');
      console.log('📦 Webhook data:', webhookData);

      return {
        success: true,
        data: webhookData
      };
    } catch (error) {
      console.error('❌ Error processing webhook:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Generate order data for hostel fee payment
  generateHostelFeeOrderData(paymentData) {
    const {
      orderId,
      amount,
      studentName,
      studentEmail,
      studentPhone,
      academicYear,
      studentId
    } = paymentData;

    console.log('🔧 generateHostelFeeOrderData called with:', paymentData);

    // Generate a valid customer_id (alphanumeric with underscores/hyphens only, max 50 chars)
    const emailPrefix = studentEmail.split('@')[0]; // Get part before @
    const shortTimestamp = Date.now().toString().slice(-6); // Last 6 digits
    const validCustomerId = `cust_${emailPrefix}_${shortTimestamp}`;
    
    // Ensure it's within 50 character limit
    const finalCustomerId = validCustomerId.length > 50 
      ? validCustomerId.substring(0, 50) 
      : validCustomerId;

    // Clean URLs to prevent double slashes
    const cleanFrontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    const cleanBackendUrl = (process.env.BACKEND_URL || 'http://localhost:5000').replace(/\/$/, '');

    return {
      order_id: orderId,
      order_amount: amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: finalCustomerId,
        customer_name: studentName,
        customer_email: studentEmail,
        customer_phone: studentPhone
      },
      order_meta: {
        return_url: `${cleanFrontendUrl}/student/hostel-fee?payment_success=true&order_id={order_id}`,
        notify_url: `${cleanBackendUrl}/api/payments/webhook`,
        payment_methods: 'cc,dc,upi,nb,app'
      },
      order_note: `Hostel fee payment for Academic Year ${academicYear}`,
      order_tags: {
        student_id: studentId,
        academic_year: academicYear,
        payment_type: 'hostel_fee'
      }
    };
  }

  // Generate order data for electricity bill payment
  generateOrderData(paymentData) {
    const {
      orderId,
      amount,
      studentName,
      studentEmail,
      studentPhone,
      roomNumber,
      billMonth,
      billId
    } = paymentData;

    console.log('🔧 generateOrderData called with billId:', billId);
    console.log('🔧 Full paymentData:', paymentData);
    console.log('🔧 billId type:', typeof billId);
    console.log('🔧 billId value:', billId);

    // Generate a valid customer_id (alphanumeric with underscores/hyphens only, max 50 chars)
    const emailPrefix = studentEmail.split('@')[0]; // Get part before @
    const shortTimestamp = Date.now().toString().slice(-6); // Last 6 digits
    const validCustomerId = `cust_${emailPrefix}_${shortTimestamp}`;
    
    // Ensure it's within 50 character limit
    const finalCustomerId = validCustomerId.length > 50 
      ? validCustomerId.substring(0, 50) 
      : validCustomerId;

    // Clean URLs to prevent double slashes
    const cleanFrontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    const cleanBackendUrl = (process.env.BACKEND_URL || 'http://localhost:5000').replace(/\/$/, '');

    return {
      order_id: orderId,
      order_amount: amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: finalCustomerId,
        customer_name: studentName,
        customer_email: studentEmail,
        customer_phone: studentPhone
      },
      order_meta: {
        return_url: (() => {
          const returnUrl = `${cleanFrontendUrl}/student/payment-status/${billId}?order_id={order_id}`;
          console.log('🔧 Generating return URL with billId:', billId);
          console.log('🔧 Return URL:', returnUrl);
          return returnUrl;
        })(),
        notify_url: `${cleanBackendUrl}/api/payments/webhook`,
        payment_methods: 'cc,dc,upi,nb,app'
      },
      order_note: `Electricity bill payment for Room ${roomNumber} - ${billMonth}`,
      order_tags: {
        room_number: roomNumber,
        bill_month: billMonth,
        payment_type: 'electricity_bill'
      }
    };
  }

  // Check if service is properly configured
  isConfigured() {
    return !!(this.clientId && this.clientSecret);
  }
}

// Create singleton instance
const cashfreeService = new CashfreeService();

export default cashfreeService; 