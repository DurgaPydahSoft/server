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
    // Days from semester start date for each term due date
    termDueDates: {
      term1: {
        daysFromSemesterStart: { type: Number, required: true, min: 1, max: 365 },
        referenceSemester: { type: String, enum: ['Semester 1', 'Semester 2'], default: 'Semester 1' },
        description: { type: String, default: 'Term 1 Due Date' },
        lateFee: { type: Number, default: 0, min: 0 } // Late fee amount for term1
      },
      term2: {
        daysFromSemesterStart: { type: Number, required: true, min: 1, max: 365 },
        referenceSemester: { type: String, enum: ['Semester 1', 'Semester 2'], default: 'Semester 1' },
        description: { type: String, default: 'Term 2 Due Date' },
        lateFee: { type: Number, default: 0, min: 0 } // Late fee amount for term2
      },
      term3: {
        daysFromSemesterStart: { type: Number, required: true, min: 1, max: 365 },
        referenceSemester: { type: String, enum: ['Semester 1', 'Semester 2'], default: 'Semester 1' },
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

// Static method to calculate actual due dates based on configured semester start dates
// semesterDates should be an object: { semester1: Date, semester2: Date }
reminderConfigSchema.statics.calculateTermDueDates = async function(courseId, academicYear, yearOfStudy, semesterDates) {
  const termConfig = await this.getTermDueDateConfig(courseId, academicYear, yearOfStudy);
  
  // Handle backward compatibility: if semesterDates is a Date (old format), treat it as semester 1
  let semester1Date, semester2Date;
  if (semesterDates instanceof Date) {
    semester1Date = semesterDates;
    semester2Date = null;
  } else {
    semester1Date = semesterDates?.semester1 ? new Date(semesterDates.semester1) : null;
    semester2Date = semesterDates?.semester2 ? new Date(semesterDates.semester2) : null;
  }
  
  if (!termConfig) {
    // Fallback to default values (using semester 1 start date)
    const fallbackDate = semester1Date || new Date();
    return {
      term1: new Date(fallbackDate.getTime() + 5 * 24 * 60 * 60 * 1000),
      term2: new Date(fallbackDate.getTime() + 90 * 24 * 60 * 60 * 1000),
      term3: new Date(fallbackDate.getTime() + 210 * 24 * 60 * 60 * 1000)
    };
  }
  
  // Helper function to get the reference date based on configured semester
  const getReferenceDate = (termKey) => {
    const referenceSemester = termConfig.termDueDates[termKey]?.referenceSemester || 'Semester 1';
    if (referenceSemester === 'Semester 2' && semester2Date) {
      return semester2Date;
    }
    return semester1Date || new Date();
  };
  
  const term1RefDate = getReferenceDate('term1');
  const term2RefDate = getReferenceDate('term2');
  const term3RefDate = getReferenceDate('term3');
  
  return {
    term1: new Date(term1RefDate.getTime() + termConfig.termDueDates.term1.daysFromSemesterStart * 24 * 60 * 60 * 1000),
    term2: new Date(term2RefDate.getTime() + termConfig.termDueDates.term2.daysFromSemesterStart * 24 * 60 * 60 * 1000),
    term3: new Date(term3RefDate.getTime() + termConfig.termDueDates.term3.daysFromSemesterStart * 24 * 60 * 60 * 1000)
  };
};

export default mongoose.model('ReminderConfig', reminderConfigSchema);
