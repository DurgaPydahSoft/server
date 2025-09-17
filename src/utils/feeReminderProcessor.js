import FeeReminder from '../models/FeeReminder.js';
import Notification from '../models/Notification.js';

// Process automated fee reminders
export const processAutomatedReminders = async () => {
  try {
    console.log('🔄 Processing automated fee reminders...');
    
    const now = new Date();
    const feeReminders = await FeeReminder.find({ isActive: true }).populate('student', 'name rollNumber');
    
    let processedCount = 0;
    
    for (const reminder of feeReminders) {
      let shouldUpdate = false;
      const updates = {};
      
      // Check first reminder (5 days after registration)
      if (!reminder.firstReminderVisible && 
          now >= new Date(reminder.firstReminderDate) && 
          reminder.feeStatus.term1 === 'Unpaid') {
        
        updates.firstReminderVisible = true;
        updates.currentReminder = 1;
        updates.firstReminderIssuedAt = now;
        shouldUpdate = true;
        
        // Create notification
        await createFeeReminderNotification(reminder.student._id, 1, reminder.academicYear);
      }
      
      // Check second reminder (90 days after registration)
      if (!reminder.secondReminderVisible && 
          now >= new Date(reminder.secondReminderDate) && 
          (reminder.feeStatus.term1 === 'Unpaid' || reminder.feeStatus.term2 === 'Unpaid')) {
        
        updates.secondReminderVisible = true;
        updates.currentReminder = 2;
        updates.secondReminderIssuedAt = now;
        shouldUpdate = true;
        
        // Create notification
        await createFeeReminderNotification(reminder.student._id, 2, reminder.academicYear);
      }
      
      // Check third reminder (210 days after registration)
      if (!reminder.thirdReminderVisible && 
          now >= new Date(reminder.thirdReminderDate) && 
          (reminder.feeStatus.term1 === 'Unpaid' || reminder.feeStatus.term2 === 'Unpaid' || reminder.feeStatus.term3 === 'Unpaid')) {
        
        updates.thirdReminderVisible = true;
        updates.currentReminder = 3;
        updates.thirdReminderIssuedAt = now;
        shouldUpdate = true;
        
        // Create notification
        await createFeeReminderNotification(reminder.student._id, 3, reminder.academicYear);
      }
      
      // Update reminder visibility after 3 days
      const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));
      
      if (reminder.firstReminderVisible && 
          reminder.firstReminderIssuedAt && 
          new Date(reminder.firstReminderIssuedAt) < threeDaysAgo) {
        updates.firstReminderVisible = false;
        shouldUpdate = true;
      }
      
      if (reminder.secondReminderVisible && 
          reminder.secondReminderIssuedAt && 
          new Date(reminder.secondReminderIssuedAt) < threeDaysAgo) {
        updates.secondReminderVisible = false;
        shouldUpdate = true;
      }
      
      if (reminder.thirdReminderVisible && 
          reminder.thirdReminderIssuedAt && 
          new Date(reminder.thirdReminderIssuedAt) < threeDaysAgo) {
        updates.thirdReminderVisible = false;
        shouldUpdate = true;
      }
      
      // Update current reminder if all visible reminders are expired
      if (!updates.firstReminderVisible && !updates.secondReminderVisible && !updates.thirdReminderVisible) {
        updates.currentReminder = 0;
      }
      
      if (shouldUpdate) {
        updates.lastUpdatedAt = now;
        await FeeReminder.findByIdAndUpdate(reminder._id, updates);
        processedCount++;
      }
    }
    
    console.log(`✅ Processed ${processedCount} fee reminders`);
    return { success: true, processedCount };
    
  } catch (error) {
    console.error('❌ Error processing fee reminders:', error);
    return { success: false, error: error.message };
  }
};

// Create fee reminder notification
const createFeeReminderNotification = async (studentId, reminderNumber, academicYear) => {
  try {
    const messages = {
      1: `First hostel fee reminder for ${academicYear}. Please check your fee status.`,
      2: `Second hostel fee reminder for ${academicYear}. Payment is due soon.`,
      3: `Final hostel fee reminder for ${academicYear}. Immediate payment required.`
    };
    
    const notification = new Notification({
      recipient: studentId,
      recipientModel: 'User',
      type: 'fee_reminder',
      title: `Hostel Fee Reminder #${reminderNumber}`,
      message: messages[reminderNumber],
      priority: reminderNumber === 3 ? 'high' : 'medium',
      isRead: false
    });
    
    await notification.save();
    
  } catch (error) {
    console.error('Error creating fee reminder notification:', error);
  }
};

// Update reminder visibility when fee status changes
export const updateReminderVisibility = async (feeReminderId) => {
  try {
    const reminder = await FeeReminder.findById(feeReminderId);
    if (!reminder) return;
    
    const updates = {};
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));
    
    // Check if reminders should be hidden based on payment status
    if (reminder.feeStatus.term1 === 'Paid' && reminder.firstReminderVisible) {
      updates.firstReminderVisible = false;
    }
    
    if (reminder.feeStatus.term2 === 'Paid' && reminder.secondReminderVisible) {
      updates.secondReminderVisible = false;
    }
    
    if (reminder.feeStatus.term3 === 'Paid' && reminder.thirdReminderVisible) {
      updates.thirdReminderVisible = false;
    }
    
    // Update current reminder if all visible reminders are expired
    if (!updates.firstReminderVisible && !updates.secondReminderVisible && !updates.thirdReminderVisible) {
      updates.currentReminder = 0;
    }
    
    if (Object.keys(updates).length > 0) {
      updates.lastUpdatedAt = now;
      await FeeReminder.findByIdAndUpdate(feeReminderId, updates);
    }
    
  } catch (error) {
    console.error('Error updating reminder visibility:', error);
  }
};

// Schedule reminder processing (run every hour)
export const scheduleReminderProcessing = () => {
  // Run every hour
  setInterval(async () => {
    await processAutomatedReminders();
  }, 60 * 60 * 1000); // 1 hour
  
  // Also run immediately on startup
  processAutomatedReminders();
};

export default {
  processAutomatedReminders,
  updateReminderVisibility,
  scheduleReminderProcessing
}; 