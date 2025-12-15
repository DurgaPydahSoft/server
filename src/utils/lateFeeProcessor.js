import User from '../models/User.js';
import ReminderConfig from '../models/ReminderConfig.js';
import AcademicCalendar from '../models/AcademicCalendar.js';
import Payment from '../models/Payment.js';
import FeeStructure from '../models/FeeStructure.js';

/**
 * Process late fees for all students daily
 * Checks if due dates have passed and applies late fees once per term
 */
export const processLateFees = async () => {
  try {
    console.log('🔄 Starting late fee processing...');
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0); // Set to start of day for comparison
    
    let processedCount = 0;
    let lateFeeAppliedCount = 0;

    // Get all active students
    const students = await User.find({ 
      role: 'student',
      hostelStatus: 'Active'
    }).populate('course', 'name');

    console.log(`📊 Found ${students.length} active students to process`);

    for (const student of students) {
      try {
        if (!student.course || !student.academicYear || !student.year) {
          console.log(`⚠️ Skipping student ${student.name} - missing course/academicYear/year`);
          continue;
        }

        // Get term due date configuration for this student
        const termConfig = await ReminderConfig.getTermDueDateConfig(
          student.course._id,
          student.academicYear,
          student.year
        );

        if (!termConfig) {
          console.log(`⚠️ No term config found for student ${student.name} (${student.course.name}, ${student.academicYear}, Year ${student.year})`);
          continue;
        }

        // Get both semester start dates from academic calendar
        const semester1Calendar = await AcademicCalendar.findOne({
          course: student.course._id,
          academicYear: student.academicYear,
          semester: 'Semester 1',
          isActive: true
        });

        const semester2Calendar = await AcademicCalendar.findOne({
          course: student.course._id,
          academicYear: student.academicYear,
          semester: 'Semester 2',
          isActive: true
        });

        if (!semester1Calendar?.startDate && !semester2Calendar?.startDate) {
          console.log(`⚠️ No academic calendar found for student ${student.name}`);
          continue;
        }

        // Prepare semester dates object
        const semesterDates = {
          semester1: semester1Calendar?.startDate ? new Date(semester1Calendar.startDate) : null,
          semester2: semester2Calendar?.startDate ? new Date(semester2Calendar.startDate) : null
        };

        // Calculate actual due dates based on configured reference semester for each term
        const getReferenceDate = (termKey) => {
          const referenceSemester = termConfig.termDueDates[termKey]?.referenceSemester || 'Semester 1';
          if (referenceSemester === 'Semester 2' && semesterDates.semester2) {
            return semesterDates.semester2;
          }
          return semesterDates.semester1 || semesterDates.semester2; // Fallback
        };

        const dueDates = {
          term1: new Date(getReferenceDate('term1').getTime() + termConfig.termDueDates.term1.daysFromSemesterStart * 24 * 60 * 60 * 1000),
          term2: new Date(getReferenceDate('term2').getTime() + termConfig.termDueDates.term2.daysFromSemesterStart * 24 * 60 * 60 * 1000),
          term3: new Date(getReferenceDate('term3').getTime() + termConfig.termDueDates.term3.daysFromSemesterStart * 24 * 60 * 60 * 1000)
        };

        // Get fee structure to check term balances
        const feeStructure = await FeeStructure.getFeeStructure(
          student.academicYear,
          student.course?.name || student.course,
          student.branch,
          student.year,
          student.category
        );

        if (!feeStructure) {
          console.log(`⚠️ No fee structure found for student ${student.name}`);
          continue;
        }

        // Get existing payments for this student
        const existingPayments = await Payment.find({
          studentId: student._id,
          academicYear: student.academicYear,
          paymentType: 'hostel_fee',
          status: 'success'
        });

        // Calculate term balances using student's calculated fees (which account for concessions)
        const calculatedTerm1Fee = student.calculatedTerm1Fee || feeStructure.term1Fee || Math.round(feeStructure.totalFee * 0.4);
        const calculatedTerm2Fee = student.calculatedTerm2Fee || feeStructure.term2Fee || Math.round(feeStructure.totalFee * 0.3);
        const calculatedTerm3Fee = student.calculatedTerm3Fee || feeStructure.term3Fee || Math.round(feeStructure.totalFee * 0.3);

        // Calculate term balances (using calculated fees, not original fees)
        const termBalances = {
          term1: calculatedTerm1Fee - existingPayments.filter(p => p.term === 'term1' || p.term === 1).reduce((sum, p) => sum + p.amount, 0),
          term2: calculatedTerm2Fee - existingPayments.filter(p => p.term === 'term2' || p.term === 2).reduce((sum, p) => sum + p.amount, 0),
          term3: calculatedTerm3Fee - existingPayments.filter(p => p.term === 'term3' || p.term === 3).reduce((sum, p) => sum + p.amount, 0)
        };

        // Check each term for late fee application
        const terms = ['term1', 'term2', 'term3'];
        let studentUpdated = false;

        for (const term of terms) {
          const termKey = term === 'term1' ? 'term1' : term === 'term2' ? 'term2' : 'term3';
          const dueDate = dueDates[termKey];
          // Get late fee amount (stored as a number in the model)
          const lateFeeAmount = termConfig.termDueDates[termKey]?.lateFee || 0;
          const termBalance = termBalances[termKey];
          const lateFeeAppliedKey = term === 'term1' ? 'term1' : term === 'term2' ? 'term2' : 'term3';

          // Check if:
          // 1. Due date has passed (compare dates, not times)
          // 2. Term has outstanding balance (not fully paid)
          // 3. Late fee hasn't been applied yet
          // 4. Late fee amount is configured (> 0)
          const dueDateOnly = new Date(dueDate);
          dueDateOnly.setHours(0, 0, 0, 0);
          
          if (
            currentDate >= dueDateOnly &&
            termBalance > 0 &&
            !student.lateFeeApplied?.[lateFeeAppliedKey] &&
            lateFeeAmount > 0
          ) {
            // Apply late fee
            const currentLateFee = student[`${termKey}LateFee`] || 0;
            const newLateFee = currentLateFee + lateFeeAmount;

            // Update student with late fee
            await User.findByIdAndUpdate(student._id, {
              $set: {
                [`${termKey}LateFee`]: newLateFee,
                [`lateFeeApplied.${lateFeeAppliedKey}`]: true
              }
            });

            console.log(`✅ Applied late fee of ₹${lateFeeAmount} for ${student.name} - ${term} (Due: ${dueDate.toLocaleDateString()}, Balance: ₹${termBalance})`);
            lateFeeAppliedCount++;
            studentUpdated = true;
          }
        }

        if (studentUpdated) {
          processedCount++;
        }

      } catch (error) {
        console.error(`❌ Error processing late fee for student ${student.name}:`, error);
        continue;
      }
    }

    console.log(`✅ Late fee processing completed. Processed: ${processedCount} students, Applied late fees: ${lateFeeAppliedCount} times`);
    
    return {
      success: true,
      processedCount,
      lateFeeAppliedCount,
      timestamp: new Date()
    };

  } catch (error) {
    console.error('❌ Error in late fee processing:', error);
    throw error;
  }
};

/**
 * Schedule late fee processing to run daily
 * Can be called from index.js or external cron service
 */
export const scheduleLateFeeProcessing = () => {
  // Run immediately on startup (for testing)
  // In production, this should be called by a cron job or scheduled task
  
  // Process late fees daily at midnight (00:00)
  const processDaily = async () => {
    try {
      await processLateFees();
    } catch (error) {
      console.error('❌ Scheduled late fee processing failed:', error);
    }
  };

  // Run once immediately (for testing/development)
  // processDaily();

  // For production, use node-cron or external cron service
  // Example with node-cron (if installed):
  // cron.schedule('0 0 * * *', processDaily); // Run daily at midnight

  console.log('📅 Late fee processing scheduled (call processLateFees() manually or via cron)');
  
  return processDaily;
};

