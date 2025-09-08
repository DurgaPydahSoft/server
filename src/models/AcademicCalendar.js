import mongoose from 'mongoose';

const academicCalendarSchema = new mongoose.Schema({
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
        // Validate academic year format (e.g., 2023-2024)
        if (!/^\d{4}-\d{4}$/.test(v)) return false;
        const [start, end] = v.split('-').map(Number);
        return end === start + 1;
      },
      message: props => `${props.value} is not a valid academic year format! Use format YYYY-YYYY with a 1-year difference (e.g., 2023-2024)`
    }
  },
  yearOfStudy: {
    type: Number,
    required: true,
    min: 1,
    max: 10,
    validate: {
      validator: function(v) {
        return Number.isInteger(v) && v >= 1 && v <= 10;
      },
      message: 'Year of study must be an integer between 1 and 10'
    }
  },
  semester: {
    type: String,
    required: true,
    enum: ['Semester 1', 'Semester 2'],
    validate: {
      validator: function(v) {
        return ['Semester 1', 'Semester 2'].includes(v);
      },
      message: 'Semester must be either "Semester 1" or "Semester 2"'
    }
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true,
    validate: {
      validator: function(v) {
        return v > this.startDate;
      },
      message: 'End date must be after start date'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: false
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

// Compound index to ensure unique semester per course, academic year, and year of study
academicCalendarSchema.index({ course: 1, academicYear: 1, yearOfStudy: 1, semester: 1 }, { unique: true });

// Index for better query performance
academicCalendarSchema.index({ course: 1, isActive: 1 });
academicCalendarSchema.index({ academicYear: 1 });
academicCalendarSchema.index({ yearOfStudy: 1 });
academicCalendarSchema.index({ startDate: 1, endDate: 1 });

// Virtual for course details
academicCalendarSchema.virtual('courseDetails', {
  ref: 'Course',
  localField: 'course',
  foreignField: '_id',
  justOne: true
});

// Ensure virtuals are included when converting to JSON
academicCalendarSchema.set('toJSON', { virtuals: true });
academicCalendarSchema.set('toObject', { virtuals: true });

// Static method to check for overlapping semesters
academicCalendarSchema.statics.checkOverlap = async function(courseId, academicYear, yearOfStudy, semester, startDate, endDate, excludeId = null) {
  const query = {
    course: courseId,
    academicYear,
    yearOfStudy,
    semester,
    $or: [
      {
        startDate: { $lte: endDate },
        endDate: { $gte: startDate }
      }
    ]
  };

  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  const overlapping = await this.findOne(query);
  return overlapping;
};

// Static method to get semesters for a course
academicCalendarSchema.statics.getActiveSemesters = async function(courseId, academicYear = null) {
  const query = {
    course: courseId
  };

  if (academicYear) {
    query.academicYear = academicYear;
  }

  return await this.find(query)
    .populate('course', 'name code')
    .populate('createdBy', 'username')
    .populate('updatedBy', 'username')
    .sort({ academicYear: -1, yearOfStudy: 1, semester: 1 });
};

const AcademicCalendar = mongoose.model('AcademicCalendar', academicCalendarSchema);

export default AcademicCalendar;
