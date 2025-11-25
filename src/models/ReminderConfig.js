import mongoose from 'mongoose';

const reminderConfigSchema = new mongoose.Schema({
  preReminders: {
    email: {
      enabled: {
        type: Boolean,
        default: true
      },
      daysBeforeDue: [{
        type: Number,
        min: 1,
        max: 365
      }],
      template: {
        type: String,
        default: 'pre_reminder_email'
      }
    },
    push: {
      enabled: {
        type: Boolean,
        default: true
      },
      daysBeforeDue: [{
        type: Number,
        min: 1,
        max: 365
      }],
      template: {
        type: String,
        default: 'pre_reminder_push'
      }
    },
    sms: {
      enabled: {
        type: Boolean,
        default: false
      },
      daysBeforeDue: [{
        type: Number,
        min: 1,
        max: 365
      }],
      template: {
        type: String,
        default: 'pre_reminder_sms'
      }
    }
  },
  postReminders: {
    email: {
      enabled: {
        type: Boolean,
        default: true
      },
      daysAfterDue: [{
        type: Number,
        min: 1,
        max: 365
      }],
      template: {
        type: String,
        default: 'post_reminder_email'
      }
    },
    push: {
      enabled: {
        type: Boolean,
        default: true
      },
      daysAfterDue: [{
        type: Number,
        min: 1,
        max: 365
      }],
      template: {
        type: String,
        default: 'post_reminder_push'
      }
    },
    sms: {
      enabled: {
        type: Boolean,
        default: false
      },
      daysAfterDue: [{
        type: Number,
        min: 1,
        max: 365
      }],
      template: {
        type: String,
        default: 'post_reminder_sms'
      }
    }
  },
  autoReminders: {
    enabled: {
      type: Boolean,
      default: true
    },
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly'],
      default: 'weekly'
    },
    maxPreReminders: {
      type: Number,
      min: 1,
      max: 10,
      default: 3
    },
    maxPostReminders: {
      type: Number,
      min: 1,
      max: 10,
      default: 4
    }
  },
  // Term due date configurations per course/academic year/year of study
  termDueDateConfigs: [{
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true
    },
    academicYear: {
      type: String,
      required: true,
      validate: {
        validator: function(v) {
          return /^\d{4}-\d{4}$/.test(v);
        },
        message: 'Academic year must be in format YYYY-YYYY'
      }
    },
    yearOfStudy: {
      type: Number,
      required: true,
      min: 1,
      max: 10
    },
    // Days from semester-1 start date for each term due date
    termDueDates: {
      term1: {
        daysFromSemesterStart: { type: Number, required: true, min: 1, max: 365 },
        description: { type: String, default: 'Term 1 Due Date' },
        lateFee: { type: Number, default: 0, min: 0 } // Late fee amount for term1
      },
      term2: {
        daysFromSemesterStart: { type: Number, required: true, min: 1, max: 365 },
        description: { type: String, default: 'Term 2 Due Date' },
        lateFee: { type: Number, default: 0, min: 0 } // Late fee amount for term2
      },
      term3: {
        daysFromSemesterStart: { type: Number, required: true, min: 1, max: 365 },
        description: { type: String, default: 'Term 3 Due Date' },
        lateFee: { type: Number, default: 0, min: 0 } // Late fee amount for term3
      }
    },
    // Reminder days configuration for each term
    reminderDays: {
      term1: {
        preReminders: { type: [Number], default: [7, 3, 1] }, // Days before due date
        postReminders: { type: [Number], default: [1, 3, 7] } // Days after due date
      },
      term2: {
        preReminders: { type: [Number], default: [7, 3, 1] },
        postReminders: { type: [Number], default: [1, 3, 7] }
      },
      term3: {
        preReminders: { type: [Number], default: [7, 3, 1] },
        postReminders: { type: [Number], default: [1, 3, 7] }
      }
    },
    isActive: { type: Boolean, default: true }
  }]
}, {
  timestamps: true
});

// Ensure only one configuration document exists
reminderConfigSchema.index({}, { unique: true });

// Index for term due date configs
reminderConfigSchema.index({ 'termDueDateConfigs.course': 1, 'termDueDateConfigs.academicYear': 1, 'termDueDateConfigs.yearOfStudy': 1 });

// Static method to get term due date configuration for a specific course/academic year/year of study
reminderConfigSchema.statics.getTermDueDateConfig = async function(courseId, academicYear, yearOfStudy) {
  const config = await this.findOne({});
  if (!config) return null;
  
  const termConfig = config.termDueDateConfigs.find(tc => 
    tc.course.toString() === courseId.toString() &&
    tc.academicYear === academicYear &&
    tc.yearOfStudy === yearOfStudy &&
    tc.isActive
  );
  
  return termConfig || null;
};

// Static method to add or update term due date configuration
reminderConfigSchema.statics.updateTermDueDateConfig = async function(courseId, academicYear, yearOfStudy, termDueDates, reminderDays) {
  let config = await this.findOne({});
  
  if (!config) {
    config = new this({});
  }
  
  // Find existing config for this course/academic year/year of study
  const existingIndex = config.termDueDateConfigs.findIndex(tc => 
    tc.course.toString() === courseId.toString() &&
    tc.academicYear === academicYear &&
    tc.yearOfStudy === yearOfStudy
  );
  
  const termConfig = {
    course: courseId,
    academicYear,
    yearOfStudy,
    termDueDates,
    reminderDays,
    isActive: true
  };
  
  if (existingIndex >= 0) {
    config.termDueDateConfigs[existingIndex] = termConfig;
  } else {
    config.termDueDateConfigs.push(termConfig);
  }
  
  return await config.save();
};

// Static method to calculate actual due dates based on semester-1 start date
reminderConfigSchema.statics.calculateTermDueDates = async function(courseId, academicYear, yearOfStudy, semesterStartDate) {
  const termConfig = await this.getTermDueDateConfig(courseId, academicYear, yearOfStudy);
  
  if (!termConfig) {
    // Fallback to default values (current hardcoded behavior)
    return {
      term1: new Date(semesterStartDate.getTime() + 5 * 24 * 60 * 60 * 1000),
      term2: new Date(semesterStartDate.getTime() + 90 * 24 * 60 * 60 * 1000),
      term3: new Date(semesterStartDate.getTime() + 210 * 24 * 60 * 60 * 1000)
    };
  }
  
  const startDate = new Date(semesterStartDate);
  
  return {
    term1: new Date(startDate.getTime() + termConfig.termDueDates.term1.daysFromSemesterStart * 24 * 60 * 60 * 1000),
    term2: new Date(startDate.getTime() + termConfig.termDueDates.term2.daysFromSemesterStart * 24 * 60 * 60 * 1000),
    term3: new Date(startDate.getTime() + termConfig.termDueDates.term3.daysFromSemesterStart * 24 * 60 * 60 * 1000)
  };
};

export default mongoose.model('ReminderConfig', reminderConfigSchema);
