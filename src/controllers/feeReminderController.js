import FeeReminder from '../models/FeeReminder.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import FeeStructure from '../models/FeeStructure.js';
import { sendFeeReminderEmail } from '../utils/emailService.js';
import { sendSMS, sendFeeReminderSMS as smsServiceFeeReminder } from '../utils/smsService.js';

// Helper function to send fee reminder SMS (wrapper)
const sendFeeReminderSMS = async (studentPhone, studentName, term, amount, dueDate) => {
  return await smsServiceFeeReminder(studentPhone, studentName, term, amount, dueDate);
};

// Get fee reminders for a student
export const getStudentFeeReminders = async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const feeReminder = await FeeReminder.findOne({ 
      student: studentId, 
      isActive: true 
    }).populate('student', 'name rollNumber');
    
    if (!feeReminder) {
      return res.status(404).json({
        success: false,
        message: 'Fee reminder not found for this student'
      });
    }
    
    // Check which reminders should be visible
    const now = new Date();
    const visibleReminders = [];
    
    // Check first reminder
    if (feeReminder.firstReminderIssuedAt && feeReminder.shouldShowReminder(1)) {
      visibleReminders.push({
        number: 1,
        issuedAt: feeReminder.firstReminderIssuedAt,
        dueDate: feeReminder.firstReminderDate,
        status: 'Active'
      });
    }
    
    // Check second reminder
    if (feeReminder.secondReminderIssuedAt && feeReminder.shouldShowReminder(2)) {
      visibleReminders.push({
        number: 2,
        issuedAt: feeReminder.secondReminderIssuedAt,
        dueDate: feeReminder.secondReminderDate,
        status: 'Active'
      });
    }
    
    // Check third reminder
    if (feeReminder.thirdReminderIssuedAt && feeReminder.shouldShowReminder(3)) {
      visibleReminders.push({
        number: 3,
        issuedAt: feeReminder.thirdReminderIssuedAt,
        dueDate: feeReminder.thirdReminderDate,
        status: 'Active'
      });
    }
    
    res.json({
      success: true,
      data: {
        feeReminder,
        visibleReminders,
        allTermsPaid: feeReminder.areAllTermsPaid()
      }
    });
  } catch (error) {
    console.error('Error fetching student fee reminders:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get all fee reminders for admin/warden dashboard
export const getAllFeeReminders = async (req, res) => {
  try {
    const { page = 1, limit = 50, search = '', academicYear = '', status = '' } = req.query;
    
    console.log('🔍 Fee Reminder Query:', { page, limit, search, academicYear, status });
    
    // If no fee reminders exist, get all students and create default fee reminders
    const totalFeeReminders = await FeeReminder.countDocuments({ isActive: true });
    console.log('🔍 Total fee reminders in database:', totalFeeReminders);
    
    if (totalFeeReminders === 0) {
      console.log('🔍 No fee reminders found, creating for all students...');
      
      // Get all students
      const students = await User.find({ role: 'student' }).limit(100);
      console.log('🔍 Found students:', students.length);
      
      // Create fee reminders for these students
      const feeReminders = [];
      for (const student of students) {
        const feeReminder = await FeeReminder.createForStudent(
          student._id,
          student.createdAt || new Date(),
          academicYear || '2024-2025'
        );
        feeReminders.push(feeReminder);
      }
      
      // Populate the created reminders
      const populatedReminders = await FeeReminder.find({ _id: { $in: feeReminders.map(fr => fr._id) } })
        .populate('student', 'name rollNumber course branch year')
        .populate('lastUpdatedBy', 'name');
      
      console.log('🔍 Created and populated reminders:', populatedReminders.length);
      
      res.json({
        success: true,
        data: {
          feeReminders: populatedReminders,
          totalPages: Math.ceil(students.length / limit),
          currentPage: parseInt(page),
          total: students.length
        }
      });
      return;
    }
    
    let query = { isActive: true };
    
    // Add academic year filter
    if (academicYear) {
      query.academicYear = academicYear;
    }
    
    // Add status filter
    if (status === 'pending') {
      query.$or = [
        { 'feeStatus.term1': 'Unpaid' },
        { 'feeStatus.term2': 'Unpaid' },
        { 'feeStatus.term3': 'Unpaid' }
      ];
    } else if (status === 'paid') {
      query.$and = [
        { 'feeStatus.term1': 'Paid' },
        { 'feeStatus.term2': 'Paid' },
        { 'feeStatus.term3': 'Paid' }
      ];
    }
    
    const skip = (page - 1) * limit;
    
    console.log('🔍 Final Query:', JSON.stringify(query, null, 2));
    
    // First get fee reminders
    let feeReminders = await FeeReminder.find(query)
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year',
        populate: {
          path: 'course',
          select: 'name code'
        }
      })
      .populate('lastUpdatedBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Batch sync fee status with actual payment data
    if (feeReminders.length > 0) {
      try {
        await batchSyncFeeStatusWithPayments(feeReminders);
      } catch (error) {
        console.error('Error batch syncing fee status:', error);
        // Continue with individual sync as fallback
        for (const reminder of feeReminders) {
          try {
            await reminder.syncFeeStatusWithPayments();
          } catch (individualError) {
            console.error(`Error syncing fee status for reminder ${reminder._id}:`, individualError);
          }
        }
      }
    }
    
    console.log(`🔍 Found ${feeReminders.length} fee reminders`);
    
    // Filter out reminders with null student references (deleted students)
    feeReminders = feeReminders.filter(reminder => reminder.student !== null);
    console.log('🔍 After filtering null students:', feeReminders.length);
    
    // Apply search filter after population
    if (search) {
      feeReminders = feeReminders.filter(reminder => 
        reminder.student && (
          reminder.student.name?.toLowerCase().includes(search.toLowerCase()) ||
          reminder.student.rollNumber?.toLowerCase().includes(search.toLowerCase())
        )
      );
      console.log('🔍 After search filter:', feeReminders.length);
    }
    
    // Get total count for pagination
    let totalQuery = { isActive: true };
    if (academicYear) {
      totalQuery.academicYear = academicYear;
    }
    
    const total = await FeeReminder.countDocuments(totalQuery);
    
    console.log('🔍 Total count:', total);
    
    // Stats are now fetched separately via getAccurateFeeReminderStats endpoint
    // No need to calculate stats here for better performance

    res.json({
      success: true,
      data: {
        feeReminders,
        totalPages: Math.ceil(total / limit),
        currentPage: parseInt(page),
        total
      }
    });
  } catch (error) {
    console.error('Error fetching all fee reminders:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update fee payment status
export const updateFeePaymentStatus = async (req, res) => {
  try {
    const { feeReminderId } = req.params;
    const { term1, term2, term3 } = req.body;
    const adminId = req.admin?._id || req.user?._id;
    
    const feeReminder = await FeeReminder.findById(feeReminderId);
    
    if (!feeReminder) {
      return res.status(404).json({
        success: false,
        message: 'Fee reminder not found'
      });
    }
    
    // Update fee status
    if (term1 !== undefined) feeReminder.feeStatus.term1 = term1;
    if (term2 !== undefined) feeReminder.feeStatus.term2 = term2;
    if (term3 !== undefined) feeReminder.feeStatus.term3 = term3;
    
    feeReminder.lastUpdatedBy = adminId;
    feeReminder.lastUpdatedAt = new Date();
    
    await feeReminder.save();
    
    // Create notification for student
    const student = await User.findById(feeReminder.student);
    if (student) {
      const notification = new Notification({
        recipient: student._id,
        recipientModel: 'User',
        title: 'Fee Payment Status Updated',
        message: `Your hostel fee payment status has been updated. Please check your dashboard for details.`,
        type: 'fee_update',
        data: {
          feeReminderId: feeReminder._id,
          updatedStatus: feeReminder.feeStatus
        }
      });
      
      await notification.save();
    }
    
    res.json({
      success: true,
      message: 'Fee payment status updated successfully',
      data: feeReminder
    });
  } catch (error) {
    console.error('Error updating fee payment status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Create fee reminder for a student (when they register)
export const createFeeReminder = async (req, res) => {
  try {
    const { studentId, registrationDate, academicYear } = req.body;
    
    console.log('➕ Creating fee reminder:', { studentId, registrationDate, academicYear });
    
    // Check if fee reminder already exists
    const existingReminder = await FeeReminder.findOne({
      student: studentId,
      academicYear,
      isActive: true
    });
    
    if (existingReminder) {
      console.log('➕ Fee reminder already exists for student:', studentId);
      return res.status(400).json({
        success: false,
        message: 'Fee reminder already exists for this student and academic year'
      });
    }
    
    const feeReminder = await FeeReminder.createForStudent(
      studentId,
      registrationDate,
      academicYear
    );
    
    console.log('➕ Fee reminder created successfully:', feeReminder._id);
    
    res.status(201).json({
      success: true,
      message: 'Fee reminder created successfully',
      data: feeReminder
    });
  } catch (error) {
    console.error('Error creating fee reminder:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Create fee reminders for all students who don't have them (admin utility)
export const createFeeRemindersForAllStudents = async (req, res) => {
  try {
    const { academicYear = '2024-2025' } = req.body;
    
    console.log('🔄 Creating fee reminders for all students:', academicYear);
    
    // Get all students
    const students = await User.find({ role: 'student' });
    console.log('🔄 Found students:', students.length);
    
    let created = 0;
    let skipped = 0;
    
    for (const student of students) {
      // Check if fee reminder already exists
      const existingReminder = await FeeReminder.findOne({
        student: student._id,
        academicYear,
        isActive: true
      });
      
      if (existingReminder) {
        skipped++;
        continue;
      }
      
      // Create fee reminder using student's registration date or current date
      const registrationDate = student.createdAt || new Date();
      
      await FeeReminder.createForStudent(
        student._id,
        registrationDate,
        academicYear
      );
      
      created++;
    }
    
    console.log('🔄 Fee reminders created:', created, 'skipped:', skipped);
    
    res.json({
      success: true,
      message: `Created ${created} fee reminders, skipped ${skipped} existing ones`,
      data: { created, skipped, totalStudents: students.length }
    });
  } catch (error) {
    console.error('Error creating fee reminders for all students:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Automated reminder system (to be called by cron job)
export const processAutomatedReminders = async () => {
  try {
    const now = new Date();
    
    // Find students who need reminders
    const feeReminders = await FeeReminder.find({
      isActive: true,
      $or: [
        // First reminder: 5 days after registration
        {
          firstReminderDate: { $lte: now },
          firstReminderIssuedAt: null,
          'feeStatus.term1': 'Unpaid'
        },
        // Second reminder: 90 days after registration
        {
          secondReminderDate: { $lte: now },
          secondReminderIssuedAt: null,
          'feeStatus.term2': 'Unpaid'
        },
        // Third reminder: 210 days after registration
        {
          thirdReminderDate: { $lte: now },
          thirdReminderIssuedAt: null,
          'feeStatus.term3': 'Unpaid'
        }
      ]
    }).populate('student', 'name rollNumber email');
    
    for (const feeReminder of feeReminders) {
      let reminderNumber = 0;
      let reminderMessage = '';
      
      // Determine which reminder to send
      if (now >= feeReminder.firstReminderDate && !feeReminder.firstReminderIssuedAt && feeReminder.feeStatus.term1 === 'Unpaid') {
        reminderNumber = 1;
        feeReminder.firstReminderIssuedAt = now;
        feeReminder.firstReminderVisible = true;
        reminderMessage = 'First reminder: Please pay your hostel fees for Term 1.';
      } else if (now >= feeReminder.secondReminderDate && !feeReminder.secondReminderIssuedAt && feeReminder.feeStatus.term2 === 'Unpaid') {
        reminderNumber = 2;
        feeReminder.secondReminderIssuedAt = now;
        feeReminder.secondReminderVisible = true;
        reminderMessage = 'Second reminder: Please pay your hostel fees for Term 2.';
      } else if (now >= feeReminder.thirdReminderDate && !feeReminder.thirdReminderIssuedAt && feeReminder.feeStatus.term3 === 'Unpaid') {
        reminderNumber = 3;
        feeReminder.thirdReminderIssuedAt = now;
        feeReminder.thirdReminderVisible = true;
        reminderMessage = 'Final reminder: Please pay your hostel fees for Term 3.';
      }
      
      if (reminderNumber > 0) {
        feeReminder.currentReminder = reminderNumber;
        await feeReminder.save();
        
        // Create notification
        const notification = new Notification({
          recipient: feeReminder.student._id,
          recipientModel: 'User',
          title: `Hostel Fee Reminder ${reminderNumber}`,
          message: reminderMessage,
          type: 'fee_reminder',
          data: {
            feeReminderId: feeReminder._id,
            reminderNumber,
            dueDate: reminderNumber === 1 ? feeReminder.firstReminderDate : 
                    reminderNumber === 2 ? feeReminder.secondReminderDate : 
                    feeReminder.thirdReminderDate
          }
        });
        
        await notification.save();
        
        // Send email notification if student has email
        if (feeReminder.student.email) {
          try {
            const dueDates = {
              term1: feeReminder.firstReminderDate,
              term2: feeReminder.secondReminderDate,
              term3: feeReminder.thirdReminderDate
            };
            
            await sendFeeReminderEmail(
              reminderNumber,
              feeReminder.student.email,
              feeReminder.student.name,
              feeReminder.student.rollNumber,
              feeReminder.academicYear,
              feeReminder.feeAmounts,
              dueDates
            );
            
            console.log(`📧 Fee reminder ${reminderNumber} email sent to: ${feeReminder.student.email}`);
          } catch (emailError) {
            console.error(`📧 Failed to send fee reminder ${reminderNumber} email to ${feeReminder.student.email}:`, emailError);
            // Continue processing even if email fails
          }
        } else {
          console.log(`📧 No email address for student: ${feeReminder.student.name} (${feeReminder.student.rollNumber})`);
        }

        // Send SMS notification if student has phone number
        if (feeReminder.student.studentPhone) {
          try {
            // Determine which term and amount to send SMS for
            let term, amount, dueDate;
            
            if (reminderNumber === 1) {
              term = 'Term 1';
              amount = feeReminder.feeAmounts.term1;
              dueDate = feeReminder.firstReminderDate;
            } else if (reminderNumber === 2) {
              term = 'Term 2';
              amount = feeReminder.feeAmounts.term2;
              dueDate = feeReminder.secondReminderDate;
            } else if (reminderNumber === 3) {
              term = 'Term 3';
              amount = feeReminder.feeAmounts.term3;
              dueDate = feeReminder.thirdReminderDate;
            }

            const smsResult = await sendFeeReminderSMS(
              feeReminder.student.studentPhone,
              feeReminder.student.name,
              term,
              amount,
              dueDate
            );

            if (smsResult.success) {
              console.log(`📱 Fee reminder ${reminderNumber} SMS sent to: ${feeReminder.student.studentPhone}`);
            } else {
              console.log(`📱 Failed to send fee reminder ${reminderNumber} SMS to ${feeReminder.student.studentPhone}: ${smsResult.reason}`);
            }
          } catch (smsError) {
            console.error(`📱 Error sending fee reminder ${reminderNumber} SMS to ${feeReminder.student.studentPhone}:`, smsError);
            // Continue processing even if SMS fails
          }
        } else {
          console.log(`📱 No phone number for student: ${feeReminder.student.name} (${feeReminder.student.rollNumber})`);
        }
      }
    }
    
    console.log(`Processed ${feeReminders.length} fee reminders`);
  } catch (error) {
    console.error('Error processing automated reminders:', error);
  }
};

// Get fee reminder statistics for dashboard
export const getFeeReminderStats = async (req, res) => {
  try {
    const { academicYear } = req.query;
    
    console.log('📊 Stats Query:', { academicYear });
    
    // Get total students from User collection (all students in system)
    const totalStudentsQuery = { role: 'student' };
    const totalStudents = await User.countDocuments(totalStudentsQuery);
    
    console.log('📊 Total Students:', totalStudents);
    
    // Get fee reminder data
    const feeReminderQuery = { isActive: true };
    if (academicYear) {
      feeReminderQuery.academicYear = academicYear;
    }
    
    const feeReminders = await FeeReminder.find(feeReminderQuery);
    
    console.log('📊 Fee Reminders Found:', feeReminders.length);
    
    // Count students with all terms paid
    const paidStudents = feeReminders.filter(reminder => 
      reminder.feeStatus.term1 === 'Paid' && 
      reminder.feeStatus.term2 === 'Paid' && 
      reminder.feeStatus.term3 === 'Paid'
    ).length;
    
    // Count students with any unpaid terms
    const pendingStudents = feeReminders.filter(reminder => 
      reminder.feeStatus.term1 === 'Unpaid' || 
      reminder.feeStatus.term2 === 'Unpaid' || 
      reminder.feeStatus.term3 === 'Unpaid'
    ).length;
    
    // Count active reminders
    const activeReminders = feeReminders.filter(reminder => 
      reminder.currentReminder > 0
    ).length;
    
    // Calculate payment rate
    const paymentRate = totalStudents > 0 ? Math.round((paidStudents / totalStudents) * 100) : 0;
    
    console.log('📊 Calculated Stats:', {
      totalStudents,
      paidStudents,
      pendingStudents,
      activeReminders,
      paymentRate
    });
    
    res.json({
      success: true,
      data: {
        totalStudents,
        paidStudents,
        pendingStudents,
        activeReminders,
        paymentRate: totalStudents > 0 ? ((paidStudents / totalStudents) * 100).toFixed(1) : 0
      }
    });
  } catch (error) {
    console.error('Error fetching fee reminder stats:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Send manual reminder to specific student
export const sendManualReminder = async (req, res) => {
  try {
    const { studentId, reminderType = 'manual', message, sendEmail = true, sendPushNotification = true, sendSMS = true } = req.body;
    const adminId = req.admin?._id || req.user?._id;
    
    console.log('📤 Sending manual reminder to student:', studentId);
    
    // Find the fee reminder for the student, or create one if it doesn't exist
    let feeReminder = await FeeReminder.findOne({ 
      student: studentId, 
      isActive: true 
    }).populate('student', 'name rollNumber email studentPhone');
    
    if (!feeReminder) {
      console.log('📝 No fee reminder found, creating one for student:', studentId);
      
      // Get student details
      const student = await User.findById(studentId);
      if (!student) {
        return res.status(404).json({
          success: false,
          message: 'Student not found'
        });
      }
      
      // Create fee reminder for the student
      const currentYear = new Date().getFullYear();
      const academicYear = `${currentYear}-${currentYear + 1}`;
      
      feeReminder = await FeeReminder.createForStudent(
        studentId, 
        student.createdAt || new Date(), 
        academicYear
      );
      
      // Populate the student data
      await feeReminder.populate('student', 'name rollNumber email studentPhone');
    }
    
    // Create notification for the student (only if push notification is enabled)
    let notification = null;
    if (sendPushNotification) {
      notification = new Notification({
        recipient: studentId,
        recipientModel: 'User',
        title: 'Hostel Fee Reminder',
        message: message || 'Please pay your pending hostel fees. Contact the hostel office for more details.',
        type: 'fee_reminder',
        data: {
          feeReminderId: feeReminder._id,
          reminderType: reminderType,
          sentBy: adminId
        }
      });
      
      await notification.save();
    }
    
    // Send email notification if student has email and email is enabled
    let emailSent = false;
    if (sendEmail && feeReminder.student.email) {
      try {
        const dueDates = {
          term1: feeReminder.firstReminderDate,
          term2: feeReminder.secondReminderDate,
          term3: feeReminder.thirdReminderDate
        };
        
        // Determine reminder number for email (use current reminder or 1 for manual)
        const reminderNumber = feeReminder.currentReminder > 0 ? feeReminder.currentReminder : 1;
        
        await sendFeeReminderEmail(
          reminderNumber,
          feeReminder.student.email,
          feeReminder.student.name,
          feeReminder.student.rollNumber,
          feeReminder.academicYear,
          feeReminder.feeAmounts,
          dueDates
        );
        
        emailSent = true;
        console.log(`📧 Manual fee reminder email sent to: ${feeReminder.student.email}`);
      } catch (emailError) {
        console.error(`📧 Failed to send manual fee reminder email to ${feeReminder.student.email}:`, emailError);
        // Continue processing even if email fails
      }
    } else if (sendEmail && !feeReminder.student.email) {
      console.log(`📧 No email address for student: ${feeReminder.student.name} (${feeReminder.student.rollNumber})`);
    }

    // Send SMS notification if student has phone number and SMS is enabled
    let smsSent = false;
    if (sendSMS && feeReminder.student.studentPhone) {
      try {
        // Determine which term and amount to send SMS for (use current reminder or 1 for manual)
        const reminderNumber = feeReminder.currentReminder > 0 ? feeReminder.currentReminder : 1;
        let term, amount, dueDate;
        
        if (reminderNumber === 1) {
          term = 'Term 1';
          amount = feeReminder.feeAmounts.term1;
          dueDate = feeReminder.firstReminderDate;
        } else if (reminderNumber === 2) {
          term = 'Term 2';
          amount = feeReminder.feeAmounts.term2;
          dueDate = feeReminder.secondReminderDate;
        } else if (reminderNumber === 3) {
          term = 'Term 3';
          amount = feeReminder.feeAmounts.term3;
          dueDate = feeReminder.thirdReminderDate;
        }

        const smsResult = await sendFeeReminderSMS(
          feeReminder.student.studentPhone,
          feeReminder.student.name,
          term,
          amount,
          dueDate
        );

        if (smsResult.success) {
          smsSent = true;
          console.log(`📱 Manual fee reminder SMS sent to: ${feeReminder.student.studentPhone}`);
        } else {
          console.log(`📱 Failed to send manual fee reminder SMS to ${feeReminder.student.studentPhone}: ${smsResult.reason}`);
        }
      } catch (smsError) {
        console.error(`📱 Error sending manual fee reminder SMS to ${feeReminder.student.studentPhone}:`, smsError);
        // Continue processing even if SMS fails
      }
    } else if (sendSMS && !feeReminder.student.studentPhone) {
      console.log(`📱 No phone number for student: ${feeReminder.student.name} (${feeReminder.student.rollNumber})`);
    }
    
    // Update reminder status
    feeReminder.currentReminder = Math.max(feeReminder.currentReminder, 1);
    feeReminder.lastUpdatedBy = adminId;
    feeReminder.lastUpdatedAt = new Date();
    await feeReminder.save();
    
    console.log('✅ Manual reminder sent successfully');
    
    res.json({
      success: true,
      message: 'Manual reminder sent successfully',
      data: {
        studentName: feeReminder.student.name,
        studentRollNumber: feeReminder.student.rollNumber,
        reminderType: reminderType,
        emailSent: emailSent,
        pushSent: !!notification,
        smsSent: smsSent
      }
    });
    
  } catch (error) {
    console.error('Error sending manual reminder:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Send bulk reminders to multiple students
export const sendBulkReminders = async (req, res) => {
  try {
    const { studentIds, message, sendEmail = true, sendPushNotification = true, sendSMS = true } = req.body;
    const adminId = req.admin?._id || req.user?._id;
    
    console.log('📤 Sending bulk reminders to:', studentIds.length, 'students');
    
    if (!studentIds || studentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No students selected for bulk reminder'
      });
    }
    
    // Find fee reminders for all selected students, create if they don't exist
    let feeReminders = await FeeReminder.find({ 
      student: { $in: studentIds }, 
      isActive: true 
    }).populate('student', 'name rollNumber email');
    
    // If some students don't have fee reminders, create them
    const existingStudentIds = feeReminders.map(fr => fr.student._id.toString());
    const missingStudentIds = studentIds.filter(id => !existingStudentIds.includes(id));
    
    if (missingStudentIds.length > 0) {
      console.log('📝 Creating fee reminders for', missingStudentIds.length, 'students');
      
      const currentYear = new Date().getFullYear();
      const academicYear = `${currentYear}-${currentYear + 1}`;
      
      for (const studentId of missingStudentIds) {
        try {
          const student = await User.findById(studentId);
          if (student) {
            const newFeeReminder = await FeeReminder.createForStudent(
              studentId, 
              student.createdAt || new Date(), 
              academicYear
            );
            await newFeeReminder.populate('student', 'name rollNumber email');
            feeReminders.push(newFeeReminder);
          }
        } catch (error) {
          console.error('Error creating fee reminder for student:', studentId, error);
        }
      }
    }
    
    if (feeReminders.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No fee reminders found for selected students'
      });
    }
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // Send reminders to each student
    for (const feeReminder of feeReminders) {
      try {
        // Create notification for the student (only if push notification is enabled)
        let notification = null;
        if (sendPushNotification) {
          notification = new Notification({
            recipient: feeReminder.student._id,
            recipientModel: 'User',
            title: 'Hostel Fee Reminder',
            message: message || 'Please pay your pending hostel fees. Contact the hostel office for more details.',
            type: 'fee_reminder',
            data: {
              feeReminderId: feeReminder._id,
              reminderType: 'bulk',
              sentBy: adminId
            }
          });
          
          await notification.save();
        }
        
        // Send email notification if student has email and email is enabled
        if (sendEmail && feeReminder.student.email) {
          try {
            const dueDates = {
              term1: feeReminder.firstReminderDate,
              term2: feeReminder.secondReminderDate,
              term3: feeReminder.thirdReminderDate
            };
            
            // Determine reminder number for email (use current reminder or 1 for bulk)
            const reminderNumber = feeReminder.currentReminder > 0 ? feeReminder.currentReminder : 1;
            
            await sendFeeReminderEmail(
              reminderNumber,
              feeReminder.student.email,
              feeReminder.student.name,
              feeReminder.student.rollNumber,
              feeReminder.academicYear,
              feeReminder.feeAmounts,
              dueDates
            );
            
            console.log(`📧 Bulk fee reminder email sent to: ${feeReminder.student.email}`);
          } catch (emailError) {
            console.error(`📧 Failed to send bulk fee reminder email to ${feeReminder.student.email}:`, emailError);
            // Continue processing even if email fails
          }
        }

        // Send SMS notification if student has phone number and SMS is enabled
        if (sendSMS && feeReminder.student.studentPhone) {
          try {
            // Determine which term and amount to send SMS for (use current reminder or 1 for bulk)
            const reminderNumber = feeReminder.currentReminder > 0 ? feeReminder.currentReminder : 1;
            let term, amount, dueDate;
            
            if (reminderNumber === 1) {
              term = 'Term 1';
              amount = feeReminder.feeAmounts.term1;
              dueDate = feeReminder.firstReminderDate;
            } else if (reminderNumber === 2) {
              term = 'Term 2';
              amount = feeReminder.feeAmounts.term2;
              dueDate = feeReminder.secondReminderDate;
            } else if (reminderNumber === 3) {
              term = 'Term 3';
              amount = feeReminder.feeAmounts.term3;
              dueDate = feeReminder.thirdReminderDate;
            }

            const smsResult = await sendFeeReminderSMS(
              feeReminder.student.studentPhone,
              feeReminder.student.name,
              term,
              amount,
              dueDate
            );

            if (smsResult.success) {
              console.log(`📱 Bulk fee reminder SMS sent to: ${feeReminder.student.studentPhone}`);
            } else {
              console.log(`📱 Failed to send bulk fee reminder SMS to ${feeReminder.student.studentPhone}: ${smsResult.reason}`);
            }
          } catch (smsError) {
            console.error(`📱 Error sending bulk fee reminder SMS to ${feeReminder.student.studentPhone}:`, smsError);
            // Continue processing even if SMS fails
          }
        }
        
        // Update reminder status
        feeReminder.currentReminder = Math.max(feeReminder.currentReminder, 1);
        feeReminder.lastUpdatedBy = adminId;
        feeReminder.lastUpdatedAt = new Date();
        await feeReminder.save();
        
        successCount++;
        
      } catch (error) {
        console.error(`Error sending reminder to student ${feeReminder.student.rollNumber}:`, error);
        errorCount++;
        errors.push({
          studentId: feeReminder.student._id,
          studentName: feeReminder.student.name,
          error: error.message
        });
      }
    }
    
    console.log(`✅ Bulk reminders sent: ${successCount} success, ${errorCount} errors`);
    
    res.json({
      success: true,
      message: `Bulk reminders sent successfully. ${successCount} sent, ${errorCount} failed.`,
      data: {
        successCount,
        errorCount,
        errors: errors.length > 0 ? errors : undefined
      }
    });
    
  } catch (error) {
    console.error('Error sending bulk reminders:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Create fee reminders for all students
export const createAllFeeReminders = async (req, res) => {
  try {
    const adminId = req.admin?._id || req.user?._id;
    
    console.log('📝 Creating fee reminders for all students...');
    
    // Get all students
    const students = await User.find({ role: 'student' });
    console.log('📝 Found students:', students.length);
    
    if (students.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No students found'
      });
    }
    
    const currentYear = new Date().getFullYear();
    const academicYear = `${currentYear}-${currentYear + 1}`;
    
    let createdCount = 0;
    let skippedCount = 0;
    const errors = [];
    
    for (const student of students) {
      try {
        // Check if fee reminder already exists
        const existingReminder = await FeeReminder.findOne({
          student: student._id,
          isActive: true
        });
        
        if (existingReminder) {
          skippedCount++;
          continue;
        }
        
        // Create fee reminder for the student
        await FeeReminder.createForStudent(
          student._id,
          student.createdAt || new Date(),
          academicYear
        );
        
        createdCount++;
      } catch (error) {
        console.error(`Error creating fee reminder for student ${student._id}:`, error);
        errors.push({
          studentId: student._id,
          studentName: student.name,
          error: error.message
        });
      }
    }
    
    console.log(`📝 Created ${createdCount} fee reminders, skipped ${skippedCount} existing ones`);
    
    res.json({
      success: true,
      message: `Fee reminders created successfully. ${createdCount} created, ${skippedCount} already existed.`,
      data: {
        created: createdCount,
        skipped: skippedCount,
        total: students.length,
        errors: errors.length > 0 ? errors : undefined
      }
    });
    
  } catch (error) {
    console.error('Error creating all fee reminders:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Sync fee status with actual payment data
export const syncFeeStatusWithPayments = async (req, res) => {
  try {
    const { studentId } = req.query;
    
    if (studentId) {
      // Sync for specific student
      const feeReminder = await FeeReminder.findOne({ 
        student: studentId, 
        isActive: true 
      });
      
      if (!feeReminder) {
        return res.status(404).json({
          success: false,
          message: 'Fee reminder not found for this student'
        });
      }
      
      const updatedStatus = await feeReminder.syncFeeStatusWithPayments();
      
      res.json({
        success: true,
        message: 'Fee status synced successfully',
        data: {
          studentId,
          feeStatus: updatedStatus
        }
      });
    } else {
      // Sync for all students
      const result = await FeeReminder.syncAllFeeStatusWithPayments();
      
      res.json({
        success: true,
        message: `Fee status synced for ${result.syncedCount} students`,
        data: result
      });
    }
  } catch (error) {
    console.error('Error syncing fee status with payments:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update reminder visibility (clean up old reminders)
export const updateReminderVisibility = async () => {
  try {
    const now = new Date();
    
    // Update first reminder visibility
    await FeeReminder.updateMany(
      {
        firstReminderIssuedAt: { $ne: null },
        firstReminderVisible: true
      },
      [
        {
          $set: {
            firstReminderVisible: {
              $cond: {
                if: {
                  $lte: [
                    { $add: ['$firstReminderIssuedAt', 3 * 24 * 60 * 60 * 1000] },
                    now
                  ]
                },
                then: false,
                else: true
              }
            }
          }
        }
      ]
    );
    
    // Update second reminder visibility
    await FeeReminder.updateMany(
      {
        secondReminderIssuedAt: { $ne: null },
        secondReminderVisible: true
      },
      [
        {
          $set: {
            secondReminderVisible: {
              $cond: {
                if: {
                  $lte: [
                    { $add: ['$secondReminderIssuedAt', 3 * 24 * 60 * 60 * 1000] },
                    now
                  ]
                },
                then: false,
                else: true
              }
            }
          }
        }
      ]
    );
    
    // Update third reminder visibility
    await FeeReminder.updateMany(
      {
        thirdReminderIssuedAt: { $ne: null },
        thirdReminderVisible: true
      },
      [
        {
          $set: {
            thirdReminderVisible: {
              $cond: {
                if: {
                  $lte: [
                    { $add: ['$thirdReminderIssuedAt', 3 * 24 * 60 * 60 * 1000] },
                    now
                  ]
                },
                then: false,
                else: true
              }
            }
          }
        }
      ]
    );
    
    console.log('Updated reminder visibility');
  } catch (error) {
    console.error('Error updating reminder visibility:', error);
  }
};

// Clean up orphaned fee reminders (reminders with deleted students)
export const cleanupOrphanedReminders = async (req, res) => {
  try {
    console.log('🧹 Starting cleanup of orphaned fee reminders...');
    
    // Find all fee reminders
    const allReminders = await FeeReminder.find({ isActive: true });
    console.log(`🔍 Found ${allReminders.length} total fee reminders`);
    
    // Find reminders with null student references
    const orphanedReminders = allReminders.filter(reminder => !reminder.student);
    console.log(`🔍 Found ${orphanedReminders.length} orphaned reminders`);
    
    if (orphanedReminders.length === 0) {
      return res.json({
        success: true,
        message: 'No orphaned fee reminders found',
        data: {
          deletedCount: 0,
          totalChecked: allReminders.length
        }
      });
    }
    
    // Delete orphaned reminders
    const deletedReminders = await FeeReminder.deleteMany({
      _id: { $in: orphanedReminders.map(r => r._id) }
    });
    
    console.log(`✅ Cleaned up ${deletedReminders.deletedCount} orphaned fee reminders`);
    
    res.json({
      success: true,
      message: `Successfully cleaned up ${deletedReminders.deletedCount} orphaned fee reminders`,
      data: {
        deletedCount: deletedReminders.deletedCount,
        totalChecked: allReminders.length
      }
    });
    
  } catch (error) {
    console.error('Error cleaning up orphaned reminders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clean up orphaned reminders',
      error: error.message
    });
  }
};

// Batch sync fee status with payments for multiple reminders
const batchSyncFeeStatusWithPayments = async (feeReminders) => {
  if (!feeReminders || feeReminders.length === 0) return;
  
  try {
    const Payment = (await import('../models/Payment.js')).default;
    
    // Get all student IDs and academic years
    const studentIds = feeReminders.map(reminder => reminder.student._id || reminder.student);
    const academicYears = [...new Set(feeReminders.map(reminder => reminder.academicYear))];
    
    // Get all payments for these students and academic years in one query
    const allPayments = await Payment.find({
      studentId: { $in: studentIds },
      paymentType: 'hostel_fee',
      academicYear: { $in: academicYears },
      status: 'success'
    });
    
    // Group payments by studentId and academicYear
    const paymentsByStudent = {};
    allPayments.forEach(payment => {
      const key = `${payment.studentId}_${payment.academicYear}`;
      if (!paymentsByStudent[key]) {
        paymentsByStudent[key] = [];
      }
      paymentsByStudent[key].push(payment);
    });
    
    // Update fee status for each reminder
    for (const reminder of feeReminders) {
      const studentId = reminder.student._id || reminder.student;
      const key = `${studentId}_${reminder.academicYear}`;
      const studentPayments = paymentsByStudent[key] || [];
      
      // Reset all terms to unpaid
      reminder.feeStatus.term1 = 'Unpaid';
      reminder.feeStatus.term2 = 'Unpaid';
      reminder.feeStatus.term3 = 'Unpaid';
      
      // Update status based on actual payments
      studentPayments.forEach(payment => {
        if (payment.term === 'term1') {
          reminder.feeStatus.term1 = 'Paid';
        } else if (payment.term === 'term2') {
          reminder.feeStatus.term2 = 'Paid';
        } else if (payment.term === 'term3') {
          reminder.feeStatus.term3 = 'Paid';
        }
      });
    }
    
    // console.log(`✅ Batch synced fee status for ${feeReminders.length} reminders`);
  } catch (error) {
    console.error('Error in batch sync:', error);
    throw error;
  }
};

// Get accurate fee reminder stats (separate endpoint for better performance)
export const getAccurateFeeReminderStats = async (req, res) => {
  try {
    const { academicYear = '' } = req.query;
    
    console.log('📊 Getting accurate fee reminder stats for academic year:', academicYear);
    
    // Get ALL students first (not just those with fee reminders)
    const User = (await import('../models/User.js')).default;
    let studentQuery = { role: 'student' };
    if (academicYear) {
      studentQuery.academicYear = academicYear;
    }
    
    const allStudents = await User.find(studentQuery)
      .populate('course', 'name code')
      .select('name rollNumber course year category academicYear');
    
    console.log('📊 Total students found:', allStudents.length);
    
    // Get fee reminders for students who have them
    let reminderQuery = { isActive: true };
    if (academicYear) {
      reminderQuery.academicYear = academicYear;
    }
    
    const allReminders = await FeeReminder.find(reminderQuery)
      .populate({
        path: 'student',
        select: 'name rollNumber course branch year',
        populate: {
          path: 'course',
          select: 'name code'
        }
      });
    
    // Filter out null students from reminders
    const validReminders = allReminders.filter(reminder => reminder.student !== null);
    console.log('📊 Students with fee reminders:', validReminders.length);
    
    // Batch sync with latest payment data
    if (validReminders.length > 0) {
      try {
        await batchSyncFeeStatusWithPayments(validReminders);
      } catch (error) {
        console.error('Error batch syncing stats reminders:', error);
      }
    }
    
    // Calculate stats based on ALL students, not just those with reminders
    const studentsWithReminders = validReminders.length;
    const studentsWithoutReminders = allStudents.length - studentsWithReminders;
    
    const paidStudents = validReminders.filter(reminder => 
      reminder.feeStatus.term1 === 'Paid' && 
      reminder.feeStatus.term2 === 'Paid' && 
      reminder.feeStatus.term3 === 'Paid'
    ).length;
    
    const pendingStudents = validReminders.filter(reminder => 
      reminder.feeStatus.term1 === 'Unpaid' || 
      reminder.feeStatus.term2 === 'Unpaid' || 
      reminder.feeStatus.term3 === 'Unpaid'
    ).length;
    
    const activeReminders = validReminders.filter(reminder => reminder.currentReminder > 0).length;
    
    // Calculate payment rate based on students with reminders only
    const paymentRate = studentsWithReminders > 0 ? Math.round((paidStudents / studentsWithReminders) * 100) : 0;
    
    const stats = {
      totalStudents: allStudents.length, // Total students in system
      studentsWithReminders: studentsWithReminders, // Students who have fee reminder records
      studentsWithoutReminders: studentsWithoutReminders, // Students without fee reminder records
      paidStudents: paidStudents, // Students with all terms paid
      pendingStudents: pendingStudents + studentsWithoutReminders, // Pending includes students without reminders
      activeReminders: activeReminders,
      paymentRate: paymentRate // Rate among students with reminders
    };
    
    console.log('📊 Accurate stats calculated:', stats);
    
    res.json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    console.error('Error getting accurate fee reminder stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get accurate stats',
      error: error.message
    });
  }
}; 