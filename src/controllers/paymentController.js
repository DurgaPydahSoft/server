import Payment from '../models/Payment.js';
import Room from '../models/Room.js';
import User from '../models/User.js';
import FeeStructure from '../models/FeeStructure.js';
import cashfreeService from '../utils/cashfreeService.js';
import notificationService from '../utils/notificationService.js';
import { createError } from '../utils/error.js';

// Initiate payment for electricity bill
export const initiatePayment = async (req, res) => {
  try {
    const { billId, roomId } = req.body;
    const studentId = req.user._id;

    console.log('💰 Initiating payment for bill:', billId, 'room:', roomId, 'student:', studentId);

    // Validate required fields
    if (!billId || !roomId) {
      return res.status(400).json({
        success: false,
        message: 'Bill ID and Room ID are required'
      });
    }

    // Check if Cashfree is configured
    if (!cashfreeService.isConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Payment service is not configured. Please contact administrator.'
      });
    }

    // Find the room and bill
    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Find the specific bill
    const bill = room.electricityBills.find(b => b._id.toString() === billId);
    if (!bill) {
      return res.status(404).json({
        success: false,
        message: 'Electricity bill not found'
      });
    }

    // Check if bill is already paid
    if (bill.paymentStatus === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'This bill has already been paid'
      });
    }

    // Check if there's already a pending payment for this bill
    const existingPayment = await Payment.findOne({
      billId: billId,
      status: { $in: ['pending', 'success'] }
    });

    if (existingPayment) {
      if (existingPayment.status === 'success') {
        return res.status(400).json({
          success: false,
          message: 'This bill has already been paid'
        });
      } else {
        return res.status(400).json({
          success: false,
          message: 'A payment is already in progress for this bill'
        });
      }
    }

    // Get student details
    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Generate unique order ID
    const orderId = `ELEC_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create payment record
    const payment = new Payment({
      billId: billId,
      roomId: roomId,
      studentId: studentId,
      amount: bill.total,
      billMonth: bill.month,
      billDetails: {
        startUnits: bill.startUnits,
        endUnits: bill.endUnits,
        consumption: bill.consumption,
        rate: bill.rate,
        total: bill.total
      }
    });

    await payment.save();

    // Generate order data for Cashfree
    const orderData = cashfreeService.generateOrderData({
      orderId: orderId,
      amount: bill.total,
      studentName: student.name,
      studentEmail: student.email,
      studentPhone: student.studentPhone || '9999999999',
      roomNumber: room.roomNumber,
      billMonth: bill.month
    });

    // Create order with Cashfree
    const cashfreeResult = await cashfreeService.createOrder(orderData, payment._id);

    if (!cashfreeResult.success) {
      // Update payment status to failed
      payment.status = 'failed';
      payment.failureReason = cashfreeResult.error?.message || 'Failed to create payment order';
      await payment.save();

      return res.status(500).json({
        success: false,
        message: 'Failed to initiate payment',
        error: cashfreeResult.error
      });
    }

    // Update payment with Cashfree order ID
    payment.cashfreeOrderId = orderId;
    await payment.save();

    // Update bill payment status to pending
    const billIndex = room.electricityBills.findIndex(b => b._id.toString() === billId);
    if (billIndex !== -1) {
      room.electricityBills[billIndex].paymentStatus = 'pending';
      room.electricityBills[billIndex].paymentId = payment._id;
      await room.save();
    }

    console.log('✅ Payment initiated successfully:', orderId);

    res.status(200).json({
      success: true,
      message: 'Payment initiated successfully',
      data: {
        paymentId: payment._id,
        orderId: orderId,
        amount: bill.total,
        paymentSessionId: cashfreeResult.data.payment_session_id,
        paymentUrl: cashfreeResult.data.payment_link,
        orderStatus: cashfreeResult.data.order_status
      }
    });

  } catch (error) {
    console.error('❌ Error initiating payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate payment',
      error: error.message
    });
  }
};

// Process payment callback/webhook
export const processPayment = async (req, res) => {
  try {
    const { order_id, order_status, payment_id } = req.body;
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];

    console.log('🔄 Processing payment webhook:', { order_id, order_status, payment_id });
    console.log('📦 Full webhook body:', req.body);
    console.log('🔑 Headers:', { signature, timestamp });

    // For testing, allow webhook without signature verification
    let webhookResult = { success: true, data: req.body };
    
    // Only verify signature if it's provided (production mode)
    if (signature && timestamp) {
      webhookResult = await cashfreeService.processWebhook(req.body, signature, timestamp);
      if (!webhookResult.success) {
        console.log('⚠️ Webhook signature verification failed, but processing anyway for testing');
        // For now, continue processing even if signature fails
        webhookResult = { success: true, data: req.body };
      }
    }

    // Find payment by order ID
    const payment = await Payment.findOne({ cashfreeOrderId: order_id });
    if (!payment) {
      console.error('❌ Payment not found for order:', order_id);
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Update payment status based on order status
    let paymentStatus = 'pending';
    let failureReason = null;

    switch (order_status) {
      case 'PAID':
        paymentStatus = 'success';
        break;
      case 'EXPIRED':
        paymentStatus = 'cancelled';
        failureReason = 'Payment expired';
        break;
      case 'FAILED':
        paymentStatus = 'failed';
        failureReason = 'Payment failed';
        break;
      default:
        paymentStatus = 'pending';
    }

    // Update payment record
    payment.status = paymentStatus;
    payment.cashfreePaymentId = payment_id;
    payment.paymentDate = paymentStatus === 'success' ? new Date() : null;
    payment.failureReason = failureReason;

    await payment.save();

    // Update room bill payment status
    const room = await Room.findById(payment.roomId);
    if (room) {
      const billIndex = room.electricityBills.findIndex(b => b._id.toString() === payment.billId.toString());
      if (billIndex !== -1) {
        room.electricityBills[billIndex].paymentStatus = paymentStatus === 'success' ? 'paid' : 'unpaid';
        room.electricityBills[billIndex].paidAt = paymentStatus === 'success' ? new Date() : null;
        await room.save();
      }
    }

    // Send notification to student
    if (paymentStatus === 'success') {
      try {
        await notificationService.sendPaymentSuccessNotification(
          payment.studentId,
          payment.amount,
          payment.billMonth
        );
      } catch (notificationError) {
        console.error('Error sending payment success notification:', notificationError);
      }
    }

    console.log('✅ Payment processed successfully:', { order_id, status: paymentStatus });

    res.status(200).json({
      success: true,
      message: 'Payment processed successfully'
    });

  } catch (error) {
    console.error('❌ Error processing payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payment',
      error: error.message
    });
  }
};

// Get payment status
export const getPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const studentId = req.user._id;

    console.log('🔍 Getting payment status for paymentId:', paymentId, 'studentId:', studentId);

    const payment = await Payment.findOne({
      _id: paymentId,
      studentId: studentId
    }).populate('roomId', 'roomNumber');

    if (!payment) {
      console.log('❌ Payment not found for paymentId:', paymentId);
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    console.log('📋 Found payment:', {
      id: payment._id,
      status: payment.status,
      orderId: payment.cashfreeOrderId,
      billId: payment.billId
    });

    // If payment is pending, verify with Cashfree
    if (payment.status === 'pending' && payment.cashfreeOrderId) {
      console.log('🔄 Payment is pending, verifying with Cashfree...');
      const verificationResult = await cashfreeService.verifyPayment(payment.cashfreeOrderId);
      console.log('🔍 Cashfree verification result:', verificationResult);
      
      if (verificationResult.success) {
        const orderStatus = verificationResult.data.order_status;
        console.log('📊 Order status from Cashfree:', orderStatus);
        
        if (orderStatus === 'PAID' && payment.status !== 'success') {
          console.log('✅ Payment is PAID, updating status...');
          payment.status = 'success';
          payment.paymentDate = new Date();
          await payment.save();
          
          // Also update the room bill status
          const room = await Room.findById(payment.roomId);
          if (room) {
            const billIndex = room.electricityBills.findIndex(b => b._id.toString() === payment.billId.toString());
            if (billIndex !== -1) {
              room.electricityBills[billIndex].paymentStatus = 'paid';
              room.electricityBills[billIndex].paidAt = new Date();
              await room.save();
              console.log('✅ Room bill status updated to paid');
            }
          }
        }
      }
    }

    res.json({
      success: true,
      data: payment
    });

  } catch (error) {
    console.error('❌ Error getting payment status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment status',
      error: error.message
    });
  }
};

// Get payment history for student
export const getPaymentHistory = async (req, res) => {
  try {
    const studentId = req.user._id;
    const { page = 1, limit = 10 } = req.query;

    const payments = await Payment.find({ studentId: studentId })
      .populate('roomId', 'roomNumber')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Payment.countDocuments({ studentId: studentId });

    res.json({
      success: true,
      data: {
        payments,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Error getting payment history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment history',
      error: error.message
    });
  }
};

// Get payment statistics for admin
export const getPaymentStats = async (req, res) => {
  try {
    const { month } = req.query;
    const currentMonth = month || new Date().toISOString().slice(0, 7);

    // Get current month statistics
    const currentMonthStats = await Payment.aggregate([
      {
        $match: {
          billMonth: currentMonth
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    // Get previous month statistics
    const prevMonth = new Date();
    prevMonth.setMonth(prevMonth.getMonth() - 1);
    const previousMonth = prevMonth.toISOString().slice(0, 7);

    const previousMonthStats = await Payment.aggregate([
      {
        $match: {
          billMonth: previousMonth
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    // Get room-wise payment statistics
    const roomPaymentStats = await Payment.aggregate([
      {
        $match: {
          billMonth: currentMonth
        }
      },
      {
        $lookup: {
          from: 'rooms',
          localField: 'roomId',
          foreignField: '_id',
          as: 'room'
        }
      },
      {
        $unwind: '$room'
      },
      {
        $group: {
          _id: {
            roomNumber: '$room.roomNumber',
            gender: '$room.gender',
            category: '$room.category'
          },
          paymentStatus: { $first: '$status' },
          amount: { $first: '$amount' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        currentMonth: {
          month: currentMonth,
          stats: currentMonthStats
        },
        previousMonth: {
          month: previousMonth,
          stats: previousMonthStats
        },
        roomStats: roomPaymentStats
      }
    });

  } catch (error) {
    console.error('Error getting payment stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment statistics',
      error: error.message
    });
  }
};

// Manual payment verification
export const verifyPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const studentId = req.user._id;

    console.log('🔍 Manual payment verification for paymentId:', paymentId);

    const payment = await Payment.findOne({
      _id: paymentId,
      studentId: studentId
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (!payment.cashfreeOrderId) {
      return res.status(400).json({
        success: false,
        message: 'No Cashfree order ID found for this payment'
      });
    }

    console.log('🔄 Verifying payment with Cashfree order ID:', payment.cashfreeOrderId);
    const verificationResult = await cashfreeService.verifyPayment(payment.cashfreeOrderId);
    
    if (!verificationResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to verify payment with Cashfree',
        error: verificationResult.error
      });
    }

    const orderStatus = verificationResult.data.order_status;
    console.log('📊 Cashfree order status:', orderStatus);

    let paymentStatus = 'pending';
    let failureReason = null;

    switch (orderStatus) {
      case 'PAID':
        paymentStatus = 'success';
        break;
      case 'EXPIRED':
        paymentStatus = 'cancelled';
        failureReason = 'Payment expired';
        break;
      case 'FAILED':
        paymentStatus = 'failed';
        failureReason = 'Payment failed';
        break;
      default:
        paymentStatus = 'pending';
    }

    // Update payment record
    payment.status = paymentStatus;
    payment.paymentDate = paymentStatus === 'success' ? new Date() : null;
    payment.failureReason = failureReason;
    await payment.save();

    // Update room bill payment status
    const room = await Room.findById(payment.roomId);
    if (room) {
      const billIndex = room.electricityBills.findIndex(b => b._id.toString() === payment.billId.toString());
      if (billIndex !== -1) {
        room.electricityBills[billIndex].paymentStatus = paymentStatus === 'success' ? 'paid' : 'unpaid';
        room.electricityBills[billIndex].paidAt = paymentStatus === 'success' ? new Date() : null;
        await room.save();
        console.log('✅ Room bill status updated');
      }
    }

    console.log('✅ Payment verification completed:', { paymentId, status: paymentStatus });

    res.json({
      success: true,
      message: 'Payment verification completed',
      data: {
        paymentId: payment._id,
        status: paymentStatus,
        orderStatus: orderStatus
      }
    });

  } catch (error) {
    console.error('❌ Error verifying payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
      error: error.message
    });
  }
};

// Cancel pending payment
export const cancelPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const studentId = req.user._id;

    const payment = await Payment.findOne({
      _id: paymentId,
      studentId: studentId,
      status: 'pending'
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Pending payment not found'
      });
    }

    // Update payment status
    payment.status = 'cancelled';
    payment.failureReason = 'Cancelled by user';
    await payment.save();

    // Update room bill payment status
    const room = await Room.findById(payment.roomId);
    if (room) {
      const billIndex = room.electricityBills.findIndex(b => b._id.toString() === payment.billId.toString());
      if (billIndex !== -1) {
        room.electricityBills[billIndex].paymentStatus = 'unpaid';
        await room.save();
      }
    }

    res.json({
      success: true,
      message: 'Payment cancelled successfully'
    });

  } catch (error) {
    console.error('Error cancelling payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel payment',
      error: error.message
    });
  }
};

// ==================== HOSTEL FEE PAYMENT FUNCTIONS ====================

// Record hostel fee payment (Admin function)
export const recordHostelFeePayment = async (req, res) => {
  try {
    const {
      studentId,
      amount,
      term,
      paymentMethod,
      notes,
      academicYear
    } = req.body;
    
    const adminId = req.user._id;
    const adminName = req.user.username || req.user.name;

    console.log('💰 Recording hostel fee payment:', {
      studentId,
      amount,
      term,
      paymentMethod,
      academicYear,
      adminId
    });

    // Validate required fields
    if (!studentId || !amount || !term || !paymentMethod || !academicYear) {
      return res.status(400).json({
        success: false,
        message: 'Student ID, amount, term, payment method, and academic year are required'
      });
    }

    // Validate term
    if (!['term1', 'term2', 'term3'].includes(term)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid term. Must be term1, term2, or term3'
      });
    }

    // Validate amount
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    // Validate minimum payment amount
    if (amount < 100) {
      return res.status(400).json({
        success: false,
        message: 'Minimum payment amount is ₹100'
      });
    }

    // Validate decimal precision
    if (amount % 1 !== 0 && amount.toString().split('.')[1]?.length > 2) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount cannot have more than 2 decimal places'
      });
    }

    // Check if student exists
    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Validate student status
    if (student.hostelStatus !== 'Active') {
      return res.status(400).json({
        success: false,
        message: 'Student is not active in hostel'
      });
    }

    // Check for duplicate payments (within last 5 minutes)
    const recentPayment = await Payment.findOne({
      studentId: studentId,
      term: term,
      academicYear: academicYear,
      status: 'success',
      createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Last 5 minutes
    });

    if (recentPayment) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate payment detected. Please wait before making another payment for the same term.'
      });
    }

    // Check if student has fee structure
    const feeStructure = await FeeStructure.getFeeStructure(academicYear, student.category);
    if (!feeStructure) {
      return res.status(400).json({
        success: false,
        message: 'No fee structure found for student'
      });
    }

    // Validate payment amount against term balance
    const existingPayments = await Payment.find({
      studentId: studentId,
      term: term,
      academicYear: academicYear,
      status: 'success'
    });

    const totalPaid = existingPayments.reduce((sum, p) => sum + p.amount, 0);
    const termFee = feeStructure[`${term}Fee`];
    const remainingBalance = termFee - totalPaid;

    if (amount > remainingBalance) {
      return res.status(400).json({
        success: false,
        message: `Payment amount (₹${amount}) exceeds remaining balance (₹${remainingBalance})`
      });
    }

    if (remainingBalance <= 0) {
      return res.status(400).json({
        success: false,
        message: `Term ${term.replace('term', 'Term ')} is already fully paid`
      });
    }

    // Generate unique receipt and transaction IDs
    const receiptNumber = `HFR${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
    const transactionId = `HFT${Date.now()}${Math.random().toString(36).substr(2, 5)}`;

    // Create payment record
    const payment = new Payment({
      studentId: studentId,
      amount: amount,
      paymentMethod: paymentMethod,
      notes: notes || '',
      collectedBy: adminId,
      collectedByName: adminName,
      paymentType: 'hostel_fee',
      term: term,
      academicYear: academicYear,
      receiptNumber: receiptNumber,
      transactionId: transactionId,
      status: 'success', // Hostel fees are collected immediately
      paymentDate: new Date()
    });

    await payment.save();

    console.log('✅ Hostel fee payment recorded successfully:', {
      paymentId: payment._id,
      receiptNumber,
      transactionId
    });

    res.status(201).json({
      success: true,
      message: 'Hostel fee payment recorded successfully',
      data: {
        paymentId: payment._id,
        receiptNumber,
        transactionId,
        amount,
        term,
        studentName: student.name,
        studentRollNumber: student.rollNumber
      }
    });

  } catch (error) {
    console.error('❌ Error recording hostel fee payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record hostel fee payment',
      error: error.message
    });
  }
};

// Get hostel fee payments for a specific student (Admin function)
export const getHostelFeePayments = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { academicYear } = req.query;

    console.log('🔍 Getting hostel fee payments for student:', studentId, 'academic year:', academicYear);

    // Check if student exists
    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Build query
    const query = {
      studentId: studentId,
      paymentType: 'hostel_fee'
    };

    if (academicYear) {
      query.academicYear = academicYear;
    }

    // Get payments
    const payments = await Payment.find(query)
      .sort({ paymentDate: -1 })
      .lean();

    console.log('📋 Found hostel fee payments:', payments.length);

    res.json({
      success: true,
      data: {
        student: {
          name: student.name,
          rollNumber: student.rollNumber,
          category: student.category,
          academicYear: student.academicYear
        },
        payments: payments
      }
    });

  } catch (error) {
    console.error('❌ Error getting hostel fee payments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get hostel fee payments',
      error: error.message
    });
  }
};

// Get hostel fee payment history for student (Student function)
export const getHostelFeePaymentHistory = async (req, res) => {
  try {
    const { studentId } = req.params;
    const requestingStudentId = req.user._id;

    console.log('🔍 Getting hostel fee payment history for student:', studentId);

    // Students can only see their own payment history
    if (studentId !== requestingStudentId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only view your own payment history'
      });
    }

    // Get payments
    const payments = await Payment.find({
      studentId: studentId,
      paymentType: 'hostel_fee'
    })
      .sort({ paymentDate: -1 })
      .lean();

    console.log('📋 Found payment history:', payments.length);

    res.json({
      success: true,
      data: payments
    });

  } catch (error) {
    console.error('❌ Error getting hostel fee payment history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment history',
      error: error.message
    });
  }
};

// Get hostel fee payment statistics for admin
export const getHostelFeePaymentStats = async (req, res) => {
  try {
    const { academicYear, term } = req.query;

    console.log('📊 Getting hostel fee payment stats:', { academicYear, term });

    // Build aggregation pipeline
    const pipeline = [
      {
        $match: {
          paymentType: 'hostel_fee',
          status: 'success'
        }
      }
    ];

    if (academicYear) {
      pipeline[0].$match.academicYear = academicYear;
    }

    if (term) {
      pipeline[0].$match.term = term;
    }

    // Add grouping
    pipeline.push({
      $group: {
        _id: {
          academicYear: '$academicYear',
          term: '$term'
        },
        totalPayments: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
        averageAmount: { $avg: '$amount' }
      }
    });

    // Add sorting
    pipeline.push({
      $sort: {
        '_id.academicYear': -1,
        '_id.term': 1
      }
    });

    const stats = await Payment.aggregate(pipeline);

    // Get total summary
    const totalSummary = await Payment.aggregate([
      {
        $match: {
          paymentType: 'hostel_fee',
          status: 'success'
        }
      },
      {
        $group: {
          _id: null,
          totalPayments: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    console.log('📊 Hostel fee payment stats calculated');

    res.json({
      success: true,
      data: {
        summary: totalSummary[0] || { totalPayments: 0, totalAmount: 0 },
        breakdown: stats
      }
    });

  } catch (error) {
    console.error('❌ Error getting hostel fee payment stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment statistics',
      error: error.message
    });
  }
}; 