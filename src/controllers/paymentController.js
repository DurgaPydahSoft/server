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
    console.log('🔍 Bill payment status:', bill.paymentStatus);
    if (bill.paymentStatus === 'paid') {
      console.log('❌ Bill already marked as paid in room');
      return res.status(400).json({
        success: false,
        message: 'This bill has already been paid'
      });
    }

    // Check if this specific student has already paid for this bill
    const existingPayment = await Payment.findOne({
      billId: billId,
      studentId: studentId,
      status: 'success'
    });

    console.log('🔍 Existing payment found:', !!existingPayment);
    if (existingPayment) {
      console.log('❌ Payment record already exists for this student');
      console.log('🔍 Payment details:', {
        paymentId: existingPayment._id,
        amount: existingPayment.amount,
        status: existingPayment.status,
        paymentDate: existingPayment.paymentDate
      });
      
      // If payment exists but bill status is not updated, fix it
      if (bill.paymentStatus !== 'paid') {
        console.log('🔧 Fixing bill status - updating to paid');
        const billIndex = room.electricityBills.findIndex(b => b._id.toString() === billId);
        if (billIndex !== -1) {
          room.electricityBills[billIndex].paymentStatus = 'paid';
          room.electricityBills[billIndex].paymentId = existingPayment._id;
          room.electricityBills[billIndex].paidAt = existingPayment.paymentDate;
          await room.save();
          console.log('✅ Bill status updated to paid');
        }
      }
      
      return res.status(400).json({
        success: false,
        message: 'You have already paid for this bill'
      });
    }

    // Get student details
    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Calculate student's share
    let studentAmount = 0;
    const studentBill = bill.studentBills?.find(sb => sb.studentId.toString() === studentId.toString());
    
    if (studentBill) {
      // New format - has studentBills array
      studentAmount = studentBill.amount;
    } else {
      // Old format - calculate equal share
      const studentsInRoom = await User.countDocuments({
        roomNumber: room.roomNumber,
        gender: room.gender,
        category: room.category,
        role: 'student',
        hostelStatus: 'Active'
      });
      
      if (studentsInRoom === 0) {
        return res.status(400).json({
          success: false,
          message: 'No students found in room'
        });
      }
      
      studentAmount = Math.round(bill.total / studentsInRoom);
    }

    // Generate unique order ID
    const orderId = `ELEC_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log('🔧 About to generate order data with billId:', billId);
    console.log('🔧 Bill object:', bill);

    // Generate order data for Cashfree
    const orderData = cashfreeService.generateOrderData({
      orderId: orderId,
      amount: studentAmount,
      studentName: student.name,
      studentEmail: student.email,
      studentPhone: student.studentPhone || '9999999999',
      roomNumber: room.roomNumber,
      billMonth: bill.month,
      billId: billId
    });

    // Create order with Cashfree
    const cashfreeResult = await cashfreeService.createOrder(orderData, null); // No payment ID yet

    if (!cashfreeResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to initiate payment',
        error: cashfreeResult.error
      });
    }

    // Update bill payment status to pending (no Payment record created yet)
    const billIndex = room.electricityBills.findIndex(b => b._id.toString() === billId);
    if (billIndex !== -1) {
      room.electricityBills[billIndex].paymentStatus = 'pending';
      room.electricityBills[billIndex].cashfreeOrderId = orderId; // Store order ID for webhook processing
      room.electricityBills[billIndex].payingStudentId = studentId; // Store student ID for webhook processing
      await room.save();
      
      console.log('✅ Bill updated with cashfreeOrderId:', orderId);
      console.log('✅ Bill details:', {
        billId: room.electricityBills[billIndex]._id,
        cashfreeOrderId: room.electricityBills[billIndex].cashfreeOrderId,
        paymentStatus: room.electricityBills[billIndex].paymentStatus
      });
    } else {
      console.error('❌ Bill not found in room for billId:', billId);
    }

    console.log('✅ Payment initiated successfully:', orderId);

    res.status(200).json({
      success: true,
      message: 'Payment initiated successfully',
      data: {
        billId: billId,
        orderId: orderId,
        amount: studentAmount,
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
    // Extract data from Cashfree webhook structure
    const { data } = req.body;
    const order_id = data?.order?.order_id;
    const order_status = data?.payment?.payment_status;
    const payment_id = data?.payment?.cf_payment_id;
    const utr_number = data?.payment?.utr || data?.payment?.utr_number || data?.utr;
    
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];

    console.log('🔄 Processing payment webhook:', { order_id, order_status, payment_id, utr_number });
    console.log('📦 Full webhook body:', req.body);
    console.log('🔑 Headers:', { signature, timestamp });

    // Verify webhook signature for security
    let webhookResult = { success: false, data: null };
    
    if (signature && timestamp) {
      webhookResult = await cashfreeService.processWebhook(req.body, signature, timestamp);
      if (!webhookResult.success) {
        console.log('❌ Webhook signature verification failed - rejecting webhook');
        return res.status(400).json({
          success: false,
          message: 'Invalid webhook signature'
        });
      }
    } else {
      console.log('❌ Missing webhook signature or timestamp - rejecting webhook');
      return res.status(400).json({
        success: false,
        message: 'Missing webhook signature or timestamp'
      });
    }

    // Check if this is a hostel fee payment or electricity bill payment
    // First check for pending hostel fee payment in student records
    const studentWithPendingPayment = await User.findOne({ 
      'pendingHostelPayment.cashfreeOrderId': order_id
    });
    
    let pendingPayment = null;
    if (studentWithPendingPayment) {
      pendingPayment = {
        _id: studentWithPendingPayment._id,
        studentId: studentWithPendingPayment._id,
        amount: studentWithPendingPayment.pendingHostelPayment.amount,
        academicYear: studentWithPendingPayment.pendingHostelPayment.academicYear,
        paymentType: studentWithPendingPayment.pendingHostelPayment.paymentType,
        status: studentWithPendingPayment.pendingHostelPayment.status
      };
    } else {
      // Check for electricity bill payment
      pendingPayment = await Payment.findOne({ 
        cashfreeOrderId: order_id,
        status: 'pending'
      });
    }
    
    if (pendingPayment) {
      console.log('🔍 Processing hostel fee payment for order:', order_id);
      console.log('📊 Pending payment details:', {
        id: pendingPayment._id,
        studentId: pendingPayment.studentId,
        amount: pendingPayment.amount,
        status: pendingPayment.status,
        academicYear: pendingPayment.academicYear
      });
      
      // Validate order status before processing
      const validOrderStatuses = ['PAID', 'SUCCESS', 'EXPIRED', 'FAILED', 'PENDING', 'CANCELLED'];
      if (!validOrderStatuses.includes(order_status)) {
        console.log('❌ Invalid order status received:', order_status);
        return res.status(400).json({
          success: false,
          message: 'Invalid order status'
        });
      }

      // Determine payment status based on order status
      let paymentStatus = 'pending';
      let failureReason = null;

      switch (order_status) {
        case 'PAID':
        case 'SUCCESS':
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
        case 'CANCELLED':
          paymentStatus = 'cancelled';
          failureReason = 'Payment cancelled';
          break;
        case 'PENDING':
        default:
          paymentStatus = 'pending';
      }
      
      console.log('🔄 Payment status determined:', { order_status, paymentStatus, failureReason, utr_number, payment_id });
      
      // Process hostel fee payment
      if (paymentStatus === 'success') {
        try {
          console.log('✅ Processing successful payment...');
          
          // Get student details
          const student = await User.findById(pendingPayment.studentId);
          if (!student) {
            console.error('❌ Student not found for payment:', pendingPayment.studentId);
            return res.status(404).json({
              success: false,
              message: 'Student not found'
            });
          }
          
          console.log('👤 Student found:', { id: student._id, name: student.name, course: student.course, year: student.year, category: student.category });

        // Get fee structure
        const feeStructure = await FeeStructure.getFeeStructure(
          pendingPayment.academicYear, 
          student.course, 
          student.year, 
          student.category
        );
        
        if (!feeStructure) {
          console.error('❌ Fee structure not found for student');
          return res.status(404).json({
            success: false,
            message: 'Fee structure not found'
          });
        }

        // Get existing payments for auto-deduction calculation
        const existingPayments = await Payment.find({
          studentId: pendingPayment.studentId,
          academicYear: pendingPayment.academicYear,
          paymentType: 'hostel_fee',
          status: 'success'
        });

        // Calculate current balances for each term
        const termBalances = {
          term1: feeStructure.term1Fee - existingPayments.filter(p => p.term === 'term1').reduce((sum, p) => sum + p.amount, 0),
          term2: feeStructure.term2Fee - existingPayments.filter(p => p.term === 'term2').reduce((sum, p) => sum + p.amount, 0),
          term3: feeStructure.term3Fee - existingPayments.filter(p => p.term === 'term3').reduce((sum, p) => sum + p.amount, 0)
        };

        // Apply auto-deduction logic (same as admin payments)
        let remainingAmount = pendingPayment.amount;
        const paymentRecords = [];
        
        // Process term1 first
        if (remainingAmount > 0 && termBalances.term1 > 0) {
          const term1Payment = Math.min(remainingAmount, termBalances.term1);
          const receiptNumber = `HFR${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
          const transactionId = `HFT${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
          
          const term1PaymentRecord = new Payment({
            studentId: pendingPayment.studentId,
            amount: term1Payment,
            paymentMethod: 'Online',
            notes: 'Online payment via Cashfree',
            collectedBy: pendingPayment.studentId,
            collectedByName: student.name,
            paymentType: 'hostel_fee',
            term: 'term1',
            academicYear: pendingPayment.academicYear,
            receiptNumber: receiptNumber,
            transactionId: transactionId,
            cashfreeOrderId: `${order_id}_term1`, // Make unique by adding term suffix
            cashfreePaymentId: payment_id,
            utrNumber: utr_number || payment_id || `CF_${order_id}`,
            status: 'success',
            paymentDate: new Date()
          });
          
          console.log('💾 Creating Term 1 payment record with UTR:', {
            utr_number,
            payment_id,
            fallback_utr: `CF_${order_id}`,
            final_utr: utr_number || payment_id || `CF_${order_id}`
          });
          
          await term1PaymentRecord.save();
          paymentRecords.push(term1PaymentRecord);
          remainingAmount -= term1Payment;
        }
        
        // Process term2 if there's remaining amount
        if (remainingAmount > 0 && termBalances.term2 > 0) {
          const term2Payment = Math.min(remainingAmount, termBalances.term2);
          const receiptNumber = `HFR${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
          const transactionId = `HFT${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
          
          const term2PaymentRecord = new Payment({
            studentId: pendingPayment.studentId,
            amount: term2Payment,
            paymentMethod: 'Online',
            notes: 'Online payment via Cashfree',
            collectedBy: pendingPayment.studentId,
            collectedByName: student.name,
            paymentType: 'hostel_fee',
            term: 'term2',
            academicYear: pendingPayment.academicYear,
            receiptNumber: receiptNumber,
            transactionId: transactionId,
            cashfreeOrderId: `${order_id}_term2`, // Make unique by adding term suffix
            cashfreePaymentId: payment_id,
            utrNumber: utr_number || payment_id || `CF_${order_id}`,
            status: 'success',
            paymentDate: new Date()
          });
          
          console.log('💾 Creating Term 2 payment record with UTR:', {
            utr_number,
            payment_id,
            fallback_utr: `CF_${order_id}`,
            final_utr: utr_number || payment_id || `CF_${order_id}`
          });
          
          await term2PaymentRecord.save();
          paymentRecords.push(term2PaymentRecord);
          remainingAmount -= term2Payment;
        }
        
        // Process term3 if there's remaining amount
        if (remainingAmount > 0 && termBalances.term3 > 0) {
          const term3Payment = Math.min(remainingAmount, termBalances.term3);
          const receiptNumber = `HFR${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
          const transactionId = `HFT${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
          
          const term3PaymentRecord = new Payment({
            studentId: pendingPayment.studentId,
            amount: term3Payment,
            paymentMethod: 'Online',
            notes: 'Online payment via Cashfree',
            collectedBy: pendingPayment.studentId,
            collectedByName: student.name,
            paymentType: 'hostel_fee',
            term: 'term3',
            academicYear: pendingPayment.academicYear,
            receiptNumber: receiptNumber,
            transactionId: transactionId,
            cashfreeOrderId: `${order_id}_term3`, // Make unique by adding term suffix
            cashfreePaymentId: payment_id,
            utrNumber: utr_number || payment_id || `CF_${order_id}`,
            status: 'success',
            paymentDate: new Date()
          });
          
          console.log('💾 Creating Term 3 payment record with UTR:', {
            utr_number,
            payment_id,
            fallback_utr: `CF_${order_id}`,
            final_utr: utr_number || payment_id || `CF_${order_id}`
          });
          
          await term3PaymentRecord.save();
          paymentRecords.push(term3PaymentRecord);
          remainingAmount -= term3Payment;
        }

        // Clear the pending payment from student record
        await User.findByIdAndUpdate(pendingPayment.studentId, {
          $unset: { pendingHostelPayment: 1 }
        });

        // Send notification to student
        try {
          await notificationService.sendPaymentSuccessNotification(
            student._id,
            pendingPayment.amount,
            `Hostel Fee - ${pendingPayment.academicYear}`
          );
        } catch (notificationError) {
          console.error('Error sending payment success notification:', notificationError);
        }

          console.log('✅ Hostel fee payment processed successfully:', { 
            order_id, 
            paymentRecords: paymentRecords.length,
            totalAmount: pendingPayment.amount,
            remainingAmount: remainingAmount,
            termBalances: termBalances
          });
        } catch (error) {
          console.error('❌ Error processing successful payment:', error);
          console.error('❌ Error details:', {
            message: error.message,
            stack: error.stack,
            order_id,
            pendingPaymentId: pendingPayment._id
          });
          
          // Clear pending payment from student record on error
          await User.findByIdAndUpdate(pendingPayment.studentId, {
            $unset: { pendingHostelPayment: 1 }
          });
          
          return res.status(500).json({
            success: false,
            message: 'Error processing payment',
            error: error.message
          });
        }
      } else {
        // Payment failed or cancelled - clear pending payment from student record
        await User.findByIdAndUpdate(pendingPayment.studentId, {
          $unset: { pendingHostelPayment: 1 }
        });
        
        console.log('❌ Hostel fee payment failed/cancelled:', { order_id, status: paymentStatus, reason: failureReason });
      }

      return res.status(200).json({
        success: true,
        message: 'Hostel fee payment processed successfully'
      });
    }

    // If not a hostel fee payment, process as electricity bill payment
    console.log('🔍 Processing electricity bill payment for order:', order_id);
    
    // Find the bill by order ID (stored in room.electricityBills)
    const room = await Room.findOne({ 
      'electricityBills.cashfreeOrderId': order_id 
    });
    
    if (!room) {
      console.error('❌ Bill not found for order:', order_id);
      console.log('🔍 Searching all rooms with electricity bills...');
      
      // Debug: Check all rooms with electricity bills
      const allRooms = await Room.find({ 'electricityBills.0': { $exists: true } });
      console.log('🔍 Found rooms with electricity bills:', allRooms.length);
      
      for (const r of allRooms) {
        console.log('🔍 Room:', r.roomNumber, 'Bills:', r.electricityBills.map(b => ({
          id: b._id,
          cashfreeOrderId: b.cashfreeOrderId,
          paymentStatus: b.paymentStatus
        })));
      }
      
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    // Find the specific bill
    const billIndex = room.electricityBills.findIndex(b => b.cashfreeOrderId === order_id);
    if (billIndex === -1) {
      console.error('❌ Bill not found in room for order:', order_id);
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    const bill = room.electricityBills[billIndex];

    // Determine payment status based on order status
    let paymentStatus = 'pending';
    let failureReason = null;

    switch (order_status) {
      case 'PAID':
      case 'SUCCESS':
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

    // Only create Payment record if payment is successful
    if (paymentStatus === 'success') {
      // Get the specific student who made the payment
      const student = await User.findById(bill.payingStudentId);

      if (student) {
        // Calculate student's share
        const studentsInRoom = await User.countDocuments({
          roomNumber: room.roomNumber,
          gender: room.gender,
          category: room.category,
          role: 'student',
          hostelStatus: 'Active'
        });

        const studentAmount = studentsInRoom > 0 ? Math.round(bill.total / studentsInRoom) : bill.total;

        // Create Payment record only for successful payments
        const payment = new Payment({
          billId: bill._id,
          roomId: room._id,
          studentId: student._id,
          amount: studentAmount,
          billMonth: bill.month,
          paymentType: 'electricity',
          paymentMethod: 'Online',
          status: 'success',
          collectedBy: student._id,
          collectedByName: student.name,
          cashfreeOrderId: order_id,
          cashfreePaymentId: payment_id,
          utrNumber: utr_number || payment_id || `CF_${order_id}`,
          paymentDate: new Date(),
          billDetails: {
            startUnits: bill.startUnits,
            endUnits: bill.endUnits,
            consumption: bill.consumption,
            rate: bill.rate,
            total: bill.total
          }
        });
        
        console.log('💾 Creating electricity bill payment record with UTR:', {
          utr_number,
          payment_id,
          fallback_utr: `CF_${order_id}`,
          final_utr: utr_number || payment_id || `CF_${order_id}`
        });

        await payment.save();

        // Update bill with payment ID
        room.electricityBills[billIndex].paymentId = payment._id;
        room.electricityBills[billIndex].paidAt = new Date();

    // Send notification to student
      try {
        await notificationService.sendPaymentSuccessNotification(
            student._id,
            studentAmount,
            bill.month
        );
      } catch (notificationError) {
        console.error('Error sending payment success notification:', notificationError);
        }
      }
    }

    // Update room bill payment status
    room.electricityBills[billIndex].paymentStatus = paymentStatus === 'success' ? 'paid' : paymentStatus;
    await room.save();
    
    console.log('✅ Bill status updated to:', room.electricityBills[billIndex].paymentStatus);

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

// Get payment status (now checks bill status instead of Payment record)
export const getPaymentStatus = async (req, res) => {
  try {
    const { billId } = req.params;
    const studentId = req.user._id;

    console.log('🔍 Getting payment status for billId:', billId, 'studentId:', studentId);

    // Find the student's room
    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    const room = await Room.findOne({
      roomNumber: student.roomNumber,
      gender: student.gender,
      category: student.category
    });

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
        message: 'Bill not found'
      });
    }

    // Check if there's a successful Payment record
    const payment = await Payment.findOne({
      billId: billId,
      studentId: studentId,
      status: 'success'
    });

    // Calculate student's share
    const studentsInRoom = await User.countDocuments({
      roomNumber: student.roomNumber,
      gender: student.gender,
      category: student.category,
      role: 'student',
      hostelStatus: 'Active'
    });

    const studentAmount = studentsInRoom > 0 ? Math.round(bill.total / studentsInRoom) : bill.total;

    res.json({
      success: true,
      data: {
        billId: billId,
        status: payment ? 'success' : (bill.paymentStatus === 'paid' ? 'success' : bill.paymentStatus || 'unpaid'),
        amount: payment?.amount || studentAmount,
        orderId: bill.cashfreeOrderId,
        paymentId: payment?._id,
        paidAt: payment?.paymentDate || bill.paidAt,
        createdAt: bill.createdAt,
        billMonth: bill.month,
        roomNumber: room.roomNumber,
        totalBill: bill.total,
        studentShare: studentAmount,
        consumption: bill.consumption,
        rate: bill.rate,
        startUnits: bill.startUnits,
        endUnits: bill.endUnits
      }
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

// Initiate hostel fee payment (Student function)
export const initiateHostelFeePayment = async (req, res) => {
  try {
    const { amount, academicYear } = req.body;
    const studentId = req.user._id;

    console.log('💰 Initiating hostel fee payment for student:', studentId, 'amount:', amount, 'academicYear:', academicYear);

    // Validate required fields
    if (!amount || !academicYear) {
      return res.status(400).json({
        success: false,
        message: 'Amount and academic year are required'
      });
    }

    // Validate amount
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    // Check if Cashfree is configured
    if (!cashfreeService.isConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Payment service is not configured. Please contact administrator.'
      });
    }

    // Get student details
    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Get fee structure for student
    const feeStructure = await FeeStructure.getFeeStructure(academicYear, student.course, student.year, student.category);
    if (!feeStructure) {
      return res.status(404).json({
        success: false,
        message: 'Fee structure not found for your course and category'
      });
    }

    // Get existing payments for this student and academic year
    const existingPayments = await Payment.find({
      studentId: studentId,
      academicYear: academicYear,
      paymentType: 'hostel_fee',
      status: 'success'
    });

    // Calculate current balances for each term
    const termBalances = {
      term1: feeStructure.term1Fee - existingPayments.filter(p => p.term === 'term1').reduce((sum, p) => sum + p.amount, 0),
      term2: feeStructure.term2Fee - existingPayments.filter(p => p.term === 'term2').reduce((sum, p) => sum + p.amount, 0),
      term3: feeStructure.term3Fee - existingPayments.filter(p => p.term === 'term3').reduce((sum, p) => sum + p.amount, 0)
    };

    // Calculate total remaining balance
    const totalRemainingBalance = Object.values(termBalances).reduce((sum, balance) => sum + Math.max(0, balance), 0);

    // Validate payment amount against remaining balance
    if (amount > totalRemainingBalance) {
      return res.status(400).json({
        success: false,
        message: `Payment amount (₹${amount}) cannot exceed remaining balance (₹${totalRemainingBalance})`
      });
    }

    // Check for duplicate payments (within last 5 minutes)
    const recentPayment = await Payment.findOne({
      studentId: studentId,
      academicYear: academicYear,
      paymentType: 'hostel_fee',
      status: 'pending',
      createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Last 5 minutes
    });

    if (recentPayment) {
      return res.status(400).json({
        success: false,
        message: 'A payment is already in progress. Please wait before making another payment.'
      });
    }

    // Generate unique order ID
    const orderId = `HOSTEL_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Generate order data for Cashfree
    const orderData = cashfreeService.generateHostelFeeOrderData({
      orderId: orderId,
      amount: amount,
      studentName: student.name,
      studentEmail: student.email,
      studentPhone: student.studentPhone || '9999999999',
      academicYear: academicYear,
      studentId: studentId
    });

    // Create order with Cashfree
    const cashfreeResult = await cashfreeService.createOrder(orderData, null);

    if (!cashfreeResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to initiate payment',
        error: cashfreeResult.error
      });
    }

    // Store payment details in student record for webhook processing (no Payment record created yet)
    // This will be used by the webhook to create Payment records only on success
    const paymentData = {
      cashfreeOrderId: orderId,
      amount: amount,
      academicYear: academicYear,
      paymentType: 'hostel_fee',
      status: 'pending',
      initiatedAt: new Date()
    };

    // Store in student record for webhook processing
    await User.findByIdAndUpdate(studentId, {
      $set: { pendingHostelPayment: paymentData }
    });

    console.log('✅ Hostel fee payment initiated successfully:', orderId);

    res.status(200).json({
      success: true,
      message: 'Payment initiated successfully',
      data: {
        orderId: orderId,
        amount: amount,
        paymentSessionId: cashfreeResult.data.payment_session_id,
        paymentUrl: cashfreeResult.data.payment_link,
        orderStatus: cashfreeResult.data.order_status,
        academicYear: academicYear,
        termBalances: termBalances,
        totalRemainingBalance: totalRemainingBalance
      }
    });

  } catch (error) {
    console.error('❌ Error initiating hostel fee payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate payment',
      error: error.message
    });
  }
};

// Record hostel fee payment (Admin function)
// Record electricity bill payment (Admin function)
// Get all payments for admin (both hostel fee and electricity)
export const getAllPayments = async (req, res) => {
  try {
    const { page = 1, limit = 50, paymentType, studentId } = req.query;
    const skip = (page - 1) * limit;

    console.log('🔍 Getting all payments with filters:', { page, limit, paymentType, studentId });

    // Build query
    const query = {};
    if (paymentType) {
      query.paymentType = paymentType;
    }
    if (studentId) {
      query.studentId = studentId;
    }

    // Get payments with pagination
    const payments = await Payment.find(query)
      .populate('studentId', 'name rollNumber category academicYear roomNumber')
      .populate('roomId', 'roomNumber')
      .sort({ paymentDate: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count
    const totalCount = await Payment.countDocuments(query);

    // Transform payments to include student details - handle null studentId
    const transformedPayments = payments
      .filter(payment => payment.studentId !== null && payment.studentId !== undefined) // Filter out payments with deleted students
      .map(payment => ({
        _id: payment._id,
        studentId: payment.studentId?._id || payment.studentId,
        studentName: payment.studentId?.name || 'Unknown Student',
        studentRollNumber: payment.studentId?.rollNumber || 'N/A',
        category: payment.studentId?.category || null,
        academicYear: payment.studentId?.academicYear || payment.academicYear || null,
        roomNumber: payment.studentId?.roomNumber || payment.roomId?.roomNumber || null,
        amount: payment.amount,
        paymentType: payment.paymentType,
        paymentMethod: payment.paymentMethod,
        paymentDate: payment.paymentDate,
        status: payment.status,
        notes: payment.notes,
        collectedByName: payment.collectedByName,
        // Payment type specific fields
        term: payment.term,
        billMonth: payment.billMonth,
        billDetails: payment.billDetails,
        receiptNumber: payment.receiptNumber,
        transactionId: payment.transactionId,
        cashfreeOrderId: payment.cashfreeOrderId
      }));

    console.log('📋 Found payments:', transformedPayments.length);

    res.json({
      success: true,
      data: {
        payments: transformedPayments,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCount / limit),
          totalCount,
          hasNext: skip + payments.length < totalCount,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('❌ Error getting all payments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payments',
      error: error.message
    });
  }
};

export const recordElectricityPayment = async (req, res) => {
  try {
    const {
      studentId,
      billId,
      roomId,
      amount,
      paymentMethod,
      notes,
      utrNumber
    } = req.body;
    
    const adminId = req.user._id;
    const adminName = req.user.username || req.user.name;

    console.log('⚡ Recording electricity payment:', {
      studentId,
      billId,
      roomId,
      amount,
      paymentMethod,
      adminId
    });

    // Validate required fields
    if (!studentId || !billId || !roomId || !amount || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Student ID, bill ID, room ID, amount, and payment method are required'
      });
    }

    // Validate UTR for online payments
    if (paymentMethod === 'Online' && !utrNumber) {
      return res.status(400).json({
        success: false,
        message: 'UTR number is required for online payments'
      });
    }

    // Validate amount
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
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

    // Find room and bill
    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    const bill = room.electricityBills.find(b => b._id.toString() === billId);
    if (!bill) {
      return res.status(404).json({
        success: false,
        message: 'Electricity bill not found'
      });
    }

    // Find student's share in the bill
    let studentBill = null;
    let studentAmount = 0;
    
    if (bill.studentBills && bill.studentBills.length > 0) {
      // New format - has studentBills array
      studentBill = bill.studentBills.find(sb => sb.studentId.toString() === studentId);
      if (!studentBill) {
        return res.status(404).json({
          success: false,
          message: 'Student bill not found'
        });
      }
      
      // Check if already paid
      if (studentBill.paymentStatus === 'paid') {
        return res.status(400).json({
          success: false,
          message: 'This bill has already been paid'
        });
      }
      studentAmount = studentBill.amount;
    } else {
      // Old format - no studentBills array
      if (bill.paymentStatus === 'paid') {
        return res.status(400).json({
          success: false,
          message: 'This bill has already been paid'
        });
      }
      
      // Get current student count in room
      const studentsInRoom = await User.countDocuments({
        roomNumber: room.roomNumber,
        gender: room.gender,
        category: room.category,
        role: 'student',
        hostelStatus: 'Active'
      });
      
      if (studentsInRoom === 0) {
        return res.status(400).json({
          success: false,
          message: 'No students found in room'
        });
      }
      
      studentAmount = Math.round(bill.total / studentsInRoom);
    }

    // Create payment record
    const payment = new Payment({
      studentId: studentId,
      amount: amount,
      paymentMethod: paymentMethod,
      notes: notes || '',
      collectedBy: adminId,
      collectedByName: adminName,
      paymentType: 'electricity',
      billId: billId,
      roomId: roomId,
      billMonth: bill.month,
      utrNumber: utrNumber,
      billDetails: {
        startUnits: bill.startUnits,
        endUnits: bill.endUnits,
        consumption: bill.consumption,
        rate: bill.rate,
        total: bill.total
      },
      status: 'success'
    });

    await payment.save();

    // Update bill status
    if (studentBill) {
      // New format - update student bill
      studentBill.paymentStatus = 'paid';
      studentBill.paymentId = payment._id;
      studentBill.paidAt = new Date();

      // Check if all students in room have paid
      const allPaid = bill.studentBills.every(sb => sb.paymentStatus === 'paid');
      if (allPaid) {
        bill.paymentStatus = 'paid';
        bill.paymentId = payment._id;
        bill.paidAt = new Date();
      }
    } else {
      // Old format - mark entire room bill as paid
      bill.paymentStatus = 'paid';
      bill.paymentId = payment._id;
      bill.paidAt = new Date();
    }

    await room.save();

    console.log('✅ Electricity payment recorded successfully:', {
      paymentId: payment._id,
      amount,
      billMonth: bill.month,
      studentName: student.name,
      studentRollNumber: student.rollNumber
    });

    res.status(201).json({
      success: true,
      message: 'Electricity bill payment recorded successfully',
      data: {
        paymentId: payment._id,
        amount,
        billMonth: bill.month,
        studentName: student.name,
        studentRollNumber: student.rollNumber,
        paymentType: 'electricity'
      }
    });

  } catch (error) {
    console.error('❌ Error recording electricity payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record electricity payment',
      error: error.message
    });
  }
};

// Record additional fee payment (e.g., caution deposit)
export const recordAdditionalFeePayment = async (req, res) => {
  try {
    const {
      studentId,
      amount,
      paymentMethod,
      notes,
      academicYear,
      utrNumber,
      additionalFeeType = 'caution_deposit'
    } = req.body;
    
    const adminId = req.user._id;
    const adminName = req.user.username || req.user.name;

    console.log('💰 Recording additional fee payment:', {
      studentId,
      amount,
      paymentMethod,
      academicYear,
      additionalFeeType,
      adminId
    });

    // Validate required fields
    if (!studentId || !amount || !paymentMethod || !academicYear || !additionalFeeType) {
      return res.status(400).json({
        success: false,
        message: 'Student ID, amount, payment method, academic year, and additional fee type are required'
      });
    }

    // Validate UTR for online payments
    if (paymentMethod === 'Online' && !utrNumber) {
      return res.status(400).json({
        success: false,
        message: 'UTR number is required for online payments'
      });
    }

    // Validate amount
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
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
      academicYear: academicYear,
      paymentType: additionalFeeType === 'caution_deposit' ? 'caution_deposit' : 'additional_fee',
      additionalFeeType: additionalFeeType,
      status: 'success',
      createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Last 5 minutes
    });

    if (recentPayment) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate payment detected. Please wait before making another payment.'
      });
    }

    // Get additional fees for this academic year to validate amount
    const FeeStructure = (await import('../models/FeeStructure.js')).default;
    const additionalFees = await FeeStructure.getAdditionalFees(academicYear);
    
    // Validate that the fee type exists and amount doesn't exceed configured amount
    const feeAmount = additionalFees[additionalFeeType] || 0;
    if (feeAmount > 0 && amount > feeAmount) {
      return res.status(400).json({
        success: false,
        message: `Payment amount (₹${amount}) exceeds configured ${additionalFeeType} amount (₹${feeAmount})`
      });
    }

    // Generate receipt and transaction IDs
    const receiptNumber = `AFR${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
    const transactionId = `AFT${Date.now()}${Math.random().toString(36).substr(2, 5)}`;

    // Create payment record
    const paymentRecord = new Payment({
      studentId: studentId,
      amount: amount,
      paymentMethod: paymentMethod,
      notes: notes || `Payment for ${additionalFeeType}`,
      collectedBy: adminId,
      collectedByName: adminName,
      paymentType: additionalFeeType === 'caution_deposit' ? 'caution_deposit' : 'additional_fee',
      additionalFeeType: additionalFeeType,
      academicYear: academicYear,
      receiptNumber: receiptNumber,
      transactionId: transactionId,
      utrNumber: utrNumber || '',
      status: 'success',
      paymentDate: new Date()
    });

    await paymentRecord.save();

    console.log('✅ Additional fee payment recorded successfully:', {
      paymentId: paymentRecord._id,
      studentId,
      amount,
      additionalFeeType
    });

    res.json({
      success: true,
      message: `${additionalFeeType} payment recorded successfully`,
      data: {
        payment: paymentRecord,
        receiptNumber: receiptNumber,
        transactionId: transactionId
      }
    });
  } catch (error) {
    console.error('Error recording additional fee payment:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

export const recordHostelFeePayment = async (req, res) => {
  try {
    const {
      studentId,
      amount,
      paymentMethod,
      notes,
      academicYear,
      utrNumber
    } = req.body;
    
    const adminId = req.user._id;
    const adminName = req.user.username || req.user.name;

    console.log('💰 Recording hostel fee payment:', {
      studentId,
      amount,
      paymentMethod,
      academicYear,
      adminId
    });

    // Validate required fields
    if (!studentId || !amount || !paymentMethod || !academicYear) {
      return res.status(400).json({
        success: false,
        message: 'Student ID, amount, payment method, and academic year are required'
      });
    }

    // Validate UTR for online payments
    if (paymentMethod === 'Online' && !utrNumber) {
      return res.status(400).json({
        success: false,
        message: 'UTR number is required for online payments'
      });
    }

    // Validate amount
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
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
      academicYear: academicYear,
      paymentType: 'hostel_fee',
      status: 'success',
      createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Last 5 minutes
    });

    if (recentPayment) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate payment detected. Please wait before making another payment.'
      });
    }

    // Check if student has fee structure
    const feeStructure = await FeeStructure.getFeeStructure(academicYear, student.course, student.year, student.category);
    if (!feeStructure) {
      return res.status(400).json({
        success: false,
        message: 'No fee structure found for student'
      });
    }

    // Get all existing payments for this student and academic year
    const existingPayments = await Payment.find({
      studentId: studentId,
      academicYear: academicYear,
      paymentType: 'hostel_fee',
      status: 'success'
    });

    // Calculate current balances for each term
    const termBalances = {
      term1: feeStructure.term1Fee - existingPayments.filter(p => p.term === 'term1').reduce((sum, p) => sum + p.amount, 0),
      term2: feeStructure.term2Fee - existingPayments.filter(p => p.term === 'term2').reduce((sum, p) => sum + p.amount, 0),
      term3: feeStructure.term3Fee - existingPayments.filter(p => p.term === 'term3').reduce((sum, p) => sum + p.amount, 0)
    };

    // Calculate total remaining balance
    const totalRemainingBalance = Object.values(termBalances).reduce((sum, balance) => sum + Math.max(0, balance), 0);

    if (totalRemainingBalance <= 0) {
      return res.status(400).json({
        success: false,
        message: 'All terms are already fully paid'
      });
    }

    // Auto-deduction logic: Apply payment to terms in order (term1, term2, term3)
    let remainingAmount = amount;
    const paymentRecords = [];
    
    // Process term1 first
    if (remainingAmount > 0 && termBalances.term1 > 0) {
      const term1Payment = Math.min(remainingAmount, termBalances.term1);
      const receiptNumber = `HFR${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
      const transactionId = `HFT${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
      
      const term1PaymentRecord = new Payment({
        studentId: studentId,
        amount: term1Payment,
        paymentMethod: paymentMethod,
        notes: notes || '',
        collectedBy: adminId,
        collectedByName: adminName,
        paymentType: 'hostel_fee',
        term: 'term1',
        academicYear: academicYear,
        receiptNumber: receiptNumber,
        transactionId: transactionId,
        utrNumber: utrNumber,
        status: 'success',
        paymentDate: new Date()
      });
      
      await term1PaymentRecord.save();
      paymentRecords.push(term1PaymentRecord);
      remainingAmount -= term1Payment;
    }
    
    // Process term2 if there's remaining amount
    if (remainingAmount > 0 && termBalances.term2 > 0) {
      const term2Payment = Math.min(remainingAmount, termBalances.term2);
      const receiptNumber = `HFR${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
      const transactionId = `HFT${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
      
      const term2PaymentRecord = new Payment({
        studentId: studentId,
        amount: term2Payment,
        paymentMethod: paymentMethod,
        notes: notes || '',
        collectedBy: adminId,
        collectedByName: adminName,
        paymentType: 'hostel_fee',
        term: 'term2',
        academicYear: academicYear,
        receiptNumber: receiptNumber,
        transactionId: transactionId,
        utrNumber: utrNumber,
        status: 'success',
        paymentDate: new Date()
      });
      
      await term2PaymentRecord.save();
      paymentRecords.push(term2PaymentRecord);
      remainingAmount -= term2Payment;
    }
    
    // Process term3 if there's remaining amount
    if (remainingAmount > 0 && termBalances.term3 > 0) {
      const term3Payment = Math.min(remainingAmount, termBalances.term3);
      const receiptNumber = `HFR${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
      const transactionId = `HFT${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
      
      const term3PaymentRecord = new Payment({
        studentId: studentId,
        amount: term3Payment,
        paymentMethod: paymentMethod,
        notes: notes || '',
        collectedBy: adminId,
        collectedByName: adminName,
        paymentType: 'hostel_fee',
        term: 'term3',
        academicYear: academicYear,
        receiptNumber: receiptNumber,
        transactionId: transactionId,
        utrNumber: utrNumber,
        status: 'success',
        paymentDate: new Date()
      });
      
      await term3PaymentRecord.save();
      paymentRecords.push(term3PaymentRecord);
      remainingAmount -= term3Payment;
    }
    
    // If there's still remaining amount, it means overpayment
    if (remainingAmount > 0) {
      console.log(`⚠️ Overpayment detected: ₹${remainingAmount} will be applied as excess payment`);
    }

    console.log('✅ Hostel fee payment recorded successfully:', {
      paymentRecords: paymentRecords.length,
      totalAmount: amount,
      remainingAmount
    });

    res.status(201).json({
      success: true,
      message: 'Hostel fee payment recorded successfully',
      data: {
        paymentRecords: paymentRecords,
        totalAmount: amount,
        remainingAmount: remainingAmount,
        studentName: student.name,
        studentRollNumber: student.rollNumber,
        paymentType: 'hostel_fee'
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

// Clean up expired pending payments
export const cleanupExpiredPayments = async (req, res) => {
  try {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    // Find and delete expired pending payments
    const result = await Payment.deleteMany({
      status: 'pending',
      createdAt: { $lt: thirtyMinutesAgo }
    });

    console.log(`🧹 Cleaned up ${result.deletedCount} expired pending payments`);

    res.json({
      success: true,
      message: `Cleaned up ${result.deletedCount} expired pending payments`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error cleaning up expired payments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clean up expired payments',
      error: error.message
    });
  }
}; 