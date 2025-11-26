import ReminderConfig from '../models/ReminderConfig.js';
import { validationResult } from 'express-validator';

// Get reminder configuration
const getReminderConfig = async (req, res) => {
  try {
    console.log('🔍 Getting reminder configuration...');
    
    // Try to find existing configuration
    let config = await ReminderConfig.findOne();
    
    // If no configuration exists, create default one
    if (!config) {
      config = new ReminderConfig({
        preReminders: {
          email: {
            enabled: true,
            daysBeforeDue: [7, 3, 1],
            template: 'pre_reminder_email'
          },
          push: {
            enabled: true,
            daysBeforeDue: [5, 2, 1],
            template: 'pre_reminder_push'
          },
          sms: {
            enabled: true,
            daysBeforeDue: [3, 1],
            template: 'pre_reminder_sms'
          }
        },
        postReminders: {
          email: {
            enabled: true,
            daysAfterDue: [1, 3, 7, 14],
            template: 'post_reminder_email'
          },
          push: {
            enabled: true,
            daysAfterDue: [1, 2, 5, 10],
            template: 'post_reminder_push'
          },
          sms: {
            enabled: true,
            daysAfterDue: [1, 3, 7],
            template: 'post_reminder_sms'
          }
        },
        autoReminders: {
          enabled: true,
          frequency: 'weekly',
          maxPreReminders: 3,
          maxPostReminders: 4
        }
      });
      
      await config.save();
      console.log('✅ Created default reminder configuration');
    }

    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    console.error('❌ Error getting reminder configuration:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get reminder configuration',
      error: error.message
    });
  }
};

// Update reminder configuration
const updateReminderConfig = async (req, res) => {
  try {
    console.log('🔍 Updating reminder configuration...');
    console.log('📝 Request body:', req.body);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { preReminders, postReminders, autoReminders } = req.body;

    // Validate the configuration structure
    if (!preReminders || !postReminders || !autoReminders) {
      return res.status(400).json({
        success: false,
        message: 'Invalid configuration structure. Missing required sections.'
      });
    }

    // Find existing configuration or create new one
    let config = await ReminderConfig.findOne();
    
    if (config) {
      // Update existing configuration
      config.preReminders = preReminders;
      config.postReminders = postReminders;
      config.autoReminders = autoReminders;
      config.updatedAt = new Date();
    } else {
      // Create new configuration
      config = new ReminderConfig({
        preReminders,
        postReminders,
        autoReminders
      });
    }

    await config.save();
    console.log('✅ Reminder configuration updated successfully');

    res.json({
      success: true,
      message: 'Reminder configuration updated successfully',
      data: config
    });
  } catch (error) {
    console.error('❌ Error updating reminder configuration:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update reminder configuration',
      error: error.message
    });
  }
};

// Test reminder functionality
const testReminder = async (req, res) => {
  try {
    console.log('🔍 Testing reminder functionality...');
    
    const { section, type } = req.params;
    const { testEmail, testMessage } = req.body;

    // Validate section and type
    if (!['pre', 'post'].includes(section)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid section. Must be "pre" or "post"'
      });
    }

    if (!['email', 'push', 'sms'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid type. Must be "email", "push", or "sms"'
      });
    }

    // Get current configuration
    const config = await ReminderConfig.findOne();
    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Reminder configuration not found'
      });
    }

    // Check if the reminder type is enabled
    const reminderConfig = config[`${section}Reminders`][type];
    if (!reminderConfig.enabled) {
      return res.status(400).json({
        success: false,
        message: `${section} ${type} reminders are disabled`
      });
    }

    // TODO: Implement actual reminder sending logic
    // For now, just simulate success
    console.log(`📧 Testing ${section} ${type} reminder...`);
    console.log(`📧 Test email: ${testEmail || 'admin@example.com'}`);
    console.log(`📧 Test message: ${testMessage || 'This is a test reminder'}`);

    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    res.json({
      success: true,
      message: `${section} ${type} reminder test completed successfully`,
      data: {
        section,
        type,
        testEmail: testEmail || 'admin@example.com',
        testMessage: testMessage || 'This is a test reminder',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Error testing reminder:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test reminder',
      error: error.message
    });
  }
};

// Reset reminder configuration to defaults
const resetReminderConfig = async (req, res) => {
  try {
    console.log('🔍 Resetting reminder configuration to defaults...');

    // Delete existing configuration
    await ReminderConfig.deleteMany({});

    // Create default configuration
    const defaultConfig = new ReminderConfig({
      preReminders: {
        email: {
          enabled: true,
          daysBeforeDue: [7, 3, 1],
          template: 'pre_reminder_email'
        },
        push: {
          enabled: true,
          daysBeforeDue: [5, 2, 1],
          template: 'pre_reminder_push'
        },
        sms: {
          enabled: true,
          daysBeforeDue: [3, 1],
          template: 'pre_reminder_sms'
        }
      },
      postReminders: {
        email: {
          enabled: true,
          daysAfterDue: [1, 3, 7, 14],
          template: 'post_reminder_email'
        },
        push: {
          enabled: true,
          daysAfterDue: [1, 2, 5, 10],
          template: 'post_reminder_push'
        },
        sms: {
          enabled: true,
          daysAfterDue: [1, 3, 7],
          template: 'post_reminder_sms'
        }
      },
      autoReminders: {
        enabled: true,
        frequency: 'weekly',
        maxPreReminders: 3,
        maxPostReminders: 4
      }
    });

    await defaultConfig.save();
    console.log('✅ Reminder configuration reset to defaults');

    res.json({
      success: true,
      message: 'Reminder configuration reset to defaults successfully',
      data: defaultConfig
    });
  } catch (error) {
    console.error('❌ Error resetting reminder configuration:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset reminder configuration',
      error: error.message
    });
  }
};

// Get term due date configurations
const getTermDueDateConfigs = async (req, res) => {
  try {
    const config = await ReminderConfig.findOne({});
    
    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Reminder configuration not found'
      });
    }

    // Populate course details
    const populatedConfigs = await ReminderConfig.findOne({})
      .populate('termDueDateConfigs.course', 'name code')
      .select('termDueDateConfigs');

    res.json({
      success: true,
      data: populatedConfigs?.termDueDateConfigs || []
    });
  } catch (error) {
    console.error('Error fetching term due date configs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch term due date configurations',
      error: error.message
    });
  }
};

// Add or update term due date configuration
const updateTermDueDateConfig = async (req, res) => {
  try {
    const { courseId, academicYear, yearOfStudy, termDueDates, reminderDays } = req.body;

    // Validate required fields
    if (!courseId || !academicYear || !yearOfStudy || !termDueDates || !reminderDays) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required: courseId, academicYear, yearOfStudy, termDueDates, reminderDays'
      });
    }

    // Validate term due dates structure
    const requiredTerms = ['term1', 'term2', 'term3'];
    const validSemesters = ['Semester 1', 'Semester 2'];
    
    for (const term of requiredTerms) {
      if (!termDueDates[term] || typeof termDueDates[term].daysFromSemesterStart !== 'number') {
        return res.status(400).json({
          success: false,
          message: `Invalid term due dates structure for ${term}`
        });
      }
      
      // Validate and set referenceSemester (optional field, defaults to 'Semester 1')
      if (termDueDates[term].referenceSemester) {
        if (!validSemesters.includes(termDueDates[term].referenceSemester)) {
          return res.status(400).json({
            success: false,
            message: `Reference semester for ${term} must be 'Semester 1' or 'Semester 2'`
          });
        }
      } else {
        // Default to 'Semester 1' if not provided
        termDueDates[term].referenceSemester = 'Semester 1';
      }
      
      // Validate lateFee if provided (optional field, but must be valid number if present)
      if (termDueDates[term].lateFee !== undefined && termDueDates[term].lateFee !== null) {
        const lateFee = parseFloat(termDueDates[term].lateFee);
        if (isNaN(lateFee) || lateFee < 0) {
          return res.status(400).json({
            success: false,
            message: `Late fee for ${term} must be a valid number >= 0`
          });
        }
        // Ensure lateFee is stored as a number
        termDueDates[term].lateFee = lateFee;
      } else {
        // Default to 0 if not provided
        termDueDates[term].lateFee = 0;
      }
    }

    // Validate reminder days structure
    for (const term of requiredTerms) {
      if (!reminderDays[term] || !Array.isArray(reminderDays[term].preReminders) || !Array.isArray(reminderDays[term].postReminders)) {
        return res.status(400).json({
          success: false,
          message: `Invalid reminder days structure for ${term}`
        });
      }
    }

    const config = await ReminderConfig.updateTermDueDateConfig(
      courseId,
      academicYear,
      yearOfStudy,
      termDueDates,
      reminderDays
    );

    res.json({
      success: true,
      message: 'Term due date configuration updated successfully',
      data: config
    });
  } catch (error) {
    console.error('Error updating term due date config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update term due date configuration',
      error: error.message
    });
  }
};

// Get term due date configuration for specific course/academic year/year of study
const getTermDueDateConfig = async (req, res) => {
  try {
    const { courseId, academicYear, yearOfStudy } = req.params;

    const config = await ReminderConfig.getTermDueDateConfig(courseId, academicYear, yearOfStudy);

    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Term due date configuration not found'
      });
    }

    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    console.error('Error fetching term due date config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch term due date configuration',
      error: error.message
    });
  }
};

// Calculate term due dates for a specific course/academic year/year of study
const calculateTermDueDates = async (req, res) => {
  try {
    const { courseId, academicYear, yearOfStudy } = req.params;
    const { semesterStartDate } = req.body;

    if (!semesterStartDate) {
      return res.status(400).json({
        success: false,
        message: 'Semester start date is required'
      });
    }

    const dueDates = await ReminderConfig.calculateTermDueDates(
      courseId,
      academicYear,
      yearOfStudy,
      new Date(semesterStartDate)
    );

    res.json({
      success: true,
      data: dueDates
    });
  } catch (error) {
    console.error('Error calculating term due dates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate term due dates',
      error: error.message
    });
  }
};

// Recalculate all reminder dates when configurations change
const recalculateAllReminderDates = async (req, res) => {
  try {
    const FeeReminder = mongoose.model('FeeReminder');
    
    const result = await FeeReminder.recalculateAllReminderDates();
    
    res.json({
      success: true,
      message: `Recalculated reminder dates for ${result.recalculatedCount} students`,
      data: result
    });
  } catch (error) {
    console.error('Error recalculating reminder dates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to recalculate reminder dates',
      error: error.message
    });
  }
};

// Delete term due date configuration
const deleteTermDueDateConfig = async (req, res) => {
  try {
    const { courseId, academicYear, yearOfStudy } = req.params;

    const config = await ReminderConfig.findOne({});
    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Reminder configuration not found'
      });
    }

    // Find and remove the specific configuration
    const configIndex = config.termDueDateConfigs.findIndex(tc => 
      tc.course.toString() === courseId &&
      tc.academicYear === academicYear &&
      tc.yearOfStudy === parseInt(yearOfStudy)
    );

    if (configIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Term due date configuration not found'
      });
    }

    // Remove the configuration
    config.termDueDateConfigs.splice(configIndex, 1);
    await config.save();

    res.json({
      success: true,
      message: 'Term due date configuration deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting term due date config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete term due date configuration',
      error: error.message
    });
  }
};

// Process late fees for all students
const processLateFees = async (req, res) => {
  try {
    const { processLateFees: processLateFeesFn } = await import('../utils/lateFeeProcessor.js');
    const result = await processLateFeesFn();
    
    res.json({
      success: true,
      message: `Late fee processing completed. Processed ${result.processedCount} students, Applied ${result.lateFeeAppliedCount} late fees.`,
      data: result
    });
  } catch (error) {
    console.error('Error processing late fees:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process late fees',
      error: error.message
    });
  }
};

export {
  getReminderConfig,
  updateReminderConfig,
  testReminder,
  resetReminderConfig,
  getTermDueDateConfigs,
  updateTermDueDateConfig,
  getTermDueDateConfig,
  calculateTermDueDates,
  recalculateAllReminderDates,
  deleteTermDueDateConfig,
  processLateFees
};
