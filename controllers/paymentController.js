const Payment = require('../models/Payment');
const Room = require('../models/Room');
const Student = require('../models/Student');
const cashfreeService = require('../services/cashfreeService');

// Initiate payment
const initiatePayment = async (req, res) => {
  try {
    const { billId, roomId } = req.body;
    const studentId = req.user.id;

    // Validate input
    if (!billId || !roomId) {
      return res.status(400).json({
        success: false,
        message: 'Bill ID and Room ID are required'
      });
    }

    // Get room and bill details
    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Find the electricity bill
    const electricityBill = room.electricityBills.find(bill => bill._id.toString() === billId);
    if (!electricityBill) {
      return res.status(404).json({
        success: false,
        message: 'Electricity bill not found'
      });
    }

    // Check if bill is already paid
    if (electricityBill.paymentStatus === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Bill is already paid'
      });
    }

    // Check if payment is already in progress
    const existingPayment = await Payment.findOne({
      billId,
      status: 'pending'
    });

    if (existingPayment) {
      return res.status(400).json({
        success: false,
        message: 'Payment already in progress for this bill'
      });
    }

    // Generate unique order ID
    const orderId = `ELEC_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const paymentId = `PAY_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create order data for Cashfree
    const orderData = {
      order_id: orderId,
      order_amount: electricityBill.total,
      order_currency: "INR",
      customer_details: {
        customer_id: studentId,
        customer_name: req.user.name,
        customer_email: req.user.email,
        customer_phone: req.user.phone || "9999999999"
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL}/student/payment-status?order_id=${orderId}`,
        notify_url: `${process.env.BACKEND_URL}/api/payments/webhook`
      }
    };

    // Create order in Cashfree
    const cashfreeResponse = await cashfreeService.createOrder(orderData);

    // Create payment record
    const payment = new Payment({
      paymentId,
      orderId,
      billId,
      roomId,
      studentId,
      amount: electricityBill.total,
      status: 'pending',
      paymentUrl: cashfreeResponse.payment_link
    });

    await payment.save();

    // Update bill payment status to pending
    electricityBill.paymentStatus = 'pending';
    electricityBill.paymentId = paymentId;
    await room.save();

    res.json({
      success: true,
      message: 'Payment initiated successfully',
      data: {
        paymentId,
        orderId,
        paymentUrl: cashfreeResponse.payment_link,
        amount: electricityBill.total
      }
    });

  } catch (error) {
    console.error('Payment initiation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to initiate payment'
    });
  }
};

// Check payment status
const checkPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await Payment.findOne({ paymentId });
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Get latest status from Cashfree
    const cashfreeOrder = await cashfreeService.getOrder(payment.orderId);
    
    // Update payment status if changed
    if (cashfreeOrder.order_status !== payment.status) {
      payment.status = cashfreeOrder.order_status;
      payment.transactionId = cashfreeOrder.transaction_id;
      
      if (cashfreeOrder.order_status === 'PAID') {
        payment.paidAt = new Date();
        payment.status = 'success';
        
        // Update room bill status
        const room = await Room.findById(payment.roomId);
        if (room) {
          const bill = room.electricityBills.find(b => b._id.toString() === payment.billId.toString());
          if (bill) {
            bill.paymentStatus = 'paid';
            bill.paidAt = new Date();
            await room.save();
          }
        }
      } else if (cashfreeOrder.order_status === 'EXPIRED' || cashfreeOrder.order_status === 'FAILED') {
        payment.status = 'failed';
        payment.failureReason = cashfreeOrder.payment_message || 'Payment failed';
      }
      
      await payment.save();
    }

    res.json({
      success: true,
      data: {
        status: payment.status,
        failureReason: payment.failureReason,
        paidAt: payment.paidAt
      }
    });

  } catch (error) {
    console.error('Payment status check error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to check payment status'
    });
  }
};

// Process webhook
const processWebhook = async (req, res) => {
  try {
    const webhookData = req.body;
    
    // Process webhook data
    const processedData = await cashfreeService.processWebhook(webhookData);
    
    // Find payment by order ID
    const payment = await Payment.findOne({ orderId: processedData.orderId });
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Update payment status
    payment.status = processedData.status === 'SUCCESS' ? 'success' : 'failed';
    payment.transactionId = processedData.referenceId;
    payment.webhookData = webhookData;
    
    if (processedData.status === 'SUCCESS') {
      payment.paidAt = new Date();
      
      // Update room bill status
      const room = await Room.findById(payment.roomId);
      if (room) {
        const bill = room.electricityBills.find(b => b._id.toString() === payment.billId.toString());
        if (bill) {
          bill.paymentStatus = 'paid';
          bill.paidAt = new Date();
          await room.save();
        }
      }
    } else {
      payment.failureReason = processedData.message || 'Payment failed';
    }
    
    await payment.save();

    res.json({ success: true, message: 'Webhook processed successfully' });

  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to process webhook'
    });
  }
};

// Get payment history
const getPaymentHistory = async (req, res) => {
  try {
    const studentId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const payments = await Payment.find({ studentId })
      .populate('roomId', 'roomNumber')
      .populate('billId', 'month total')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Payment.countDocuments({ studentId });

    res.json({
      success: true,
      data: {
        payments,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Payment history error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get payment history'
    });
  }
};

// Cancel payment
const cancelPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const studentId = req.user.id;

    const payment = await Payment.findOne({ paymentId, studentId });
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (payment.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Payment cannot be cancelled'
      });
    }

    payment.status = 'cancelled';
    await payment.save();

    // Update room bill status
    const room = await Room.findById(payment.roomId);
    if (room) {
      const bill = room.electricityBills.find(b => b._id.toString() === payment.billId.toString());
      if (bill) {
        bill.paymentStatus = 'unpaid';
        bill.paymentId = null;
        await room.save();
      }
    }

    res.json({
      success: true,
      message: 'Payment cancelled successfully'
    });

  } catch (error) {
    console.error('Payment cancellation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to cancel payment'
    });
  }
};

// Get payment statistics
const getPaymentStatistics = async (req, res) => {
  try {
    const { month, year } = req.query;
    const currentDate = new Date();
    const currentMonth = month || currentDate.getMonth() + 1;
    const currentYear = year || currentDate.getFullYear();

    // Get current month statistics
    const currentMonthStart = new Date(currentYear, currentMonth - 1, 1);
    const currentMonthEnd = new Date(currentYear, currentMonth, 0, 23, 59, 59);

    const currentMonthPayments = await Payment.find({
      createdAt: { $gte: currentMonthStart, $lte: currentMonthEnd },
      status: 'success'
    });

    // Get previous month statistics
    const previousMonthStart = new Date(currentYear, currentMonth - 2, 1);
    const previousMonthEnd = new Date(currentYear, currentMonth - 1, 0, 23, 59, 59);

    const previousMonthPayments = await Payment.find({
      createdAt: { $gte: previousMonthStart, $lte: previousMonthEnd },
      status: 'success'
    });

    // Get room-wise statistics
    const roomStats = await Payment.aggregate([
      {
        $match: {
          createdAt: { $gte: currentMonthStart, $lte: currentMonthEnd },
          status: 'success'
        }
      },
      {
        $group: {
          _id: '$roomId',
          totalAmount: { $sum: '$amount' },
          paymentCount: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'rooms',
          localField: '_id',
          foreignField: '_id',
          as: 'room'
        }
      },
      {
        $unwind: '$room'
      },
      {
        $project: {
          roomNumber: '$room.roomNumber',
          totalAmount: 1,
          paymentCount: 1
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        currentMonth: {
          totalPayments: currentMonthPayments.length,
          totalAmount: currentMonthPayments.reduce((sum, p) => sum + p.amount, 0),
          payments: currentMonthPayments
        },
        previousMonth: {
          totalPayments: previousMonthPayments.length,
          totalAmount: previousMonthPayments.reduce((sum, p) => sum + p.amount, 0),
          payments: previousMonthPayments
        },
        roomStatistics: roomStats
      }
    });

  } catch (error) {
    console.error('Payment statistics error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get payment statistics'
    });
  }
};

module.exports = {
  initiatePayment,
  checkPaymentStatus,
  processWebhook,
  getPaymentHistory,
  cancelPayment,
  getPaymentStatistics
}; 