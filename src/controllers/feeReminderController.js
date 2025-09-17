import FeeReminder from '../models/FeeReminder.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import FeeStructure from '../models/FeeStructure.js';

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
    
    // Sync fee status with actual payment data for each reminder
    console.log('🔄 Syncing fee status with payment data...');
    for (const reminder of feeReminders) {
      try {
        await reminder.syncFeeStatusWithPayments();
      } catch (error) {
        console.error(`Error syncing fee status for reminder ${reminder._id}:`, error);
      }
    }
    
    // Debug: Check if students are populated
    console.log('🔍 Fee Reminders with Student Data:');
    feeReminders.forEach((reminder, index) => {
      console.log(`  ${index + 1}. ID: ${reminder._id}, Student: ${reminder.student?.name || 'NO STUDENT'}, Roll: ${reminder.student?.rollNumber || 'NO ROLL'}, Course: ${reminder.student?.course?.name || 'NO COURSE'}, Year: ${reminder.student?.year || 'NO YEAR'}, Fee Status:`, reminder.feeStatus);
    });
    
    console.log('🔍 Found Fee Reminders:', feeReminders.length);
    console.log('🔍 Sample Reminder:', feeReminders[0] ? {
      id: feeReminders[0]._id,
      student: feeReminders[0].student,
      academicYear: feeReminders[0].academicYear,
      feeStatus: feeReminders[0].feeStatus
    } : 'No reminders found');
    
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
    }).populate('student', 'name rollNumber');
    
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
    const { studentId, reminderType = 'manual', message } = req.body;
    const adminId = req.admin?._id || req.user?._id;
    
    console.log('📤 Sending manual reminder to student:', studentId);
    
    // Find the fee reminder for the student, or create one if it doesn't exist
    let feeReminder = await FeeReminder.findOne({ 
      student: studentId, 
      isActive: true 
    }).populate('student', 'name rollNumber email');
    
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
      await feeReminder.populate('student', 'name rollNumber email');
    }
    
    // Create notification for the student
    const notification = new Notification({
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
        reminderType: reminderType
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
    const { studentIds, message } = req.body;
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
        // Create notification for the student
        const notification = new Notification({
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