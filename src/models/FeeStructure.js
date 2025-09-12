import mongoose from 'mongoose';

const feeStructureSchema = new mongoose.Schema({
  academicYear: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        // Validate academic year format (e.g., 2022-2023)
        if (!/^\d{4}-\d{4}$/.test(v)) return false;
        const [start, end] = v.split('-').map(Number);
        return end === start + 1;
      },
      message: props => `${props.value} is not a valid academic year format! Use format YYYY-YYYY with a 1-year difference (e.g., 2022-2023)`
    }
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  year: {
    type: Number,
    required: true,
    min: 1,
    max: 10,
    validate: {
      validator: async function(v) {
        if (!this.course) return true;
        const Course = mongoose.model('Course');
        const course = await Course.findById(this.course);
        if (!course) return false;
        return v >= 1 && v <= course.duration;
      },
      message: 'Year of study must be within the course duration'
    }
  },
  category: {
    type: String,
    required: true,
    enum: ['A+', 'A', 'B+', 'B', 'C']
  },
  term1Fee: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: function(v) {
        return v >= 0;
      },
      message: 'Term 1 fee must be a positive number'
    }
  },
  term2Fee: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: function(v) {
        return v >= 0;
      },
      message: 'Term 2 fee must be a positive number'
    }
  },
  term3Fee: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: function(v) {
        return v >= 0;
      },
      message: 'Term 3 fee must be a positive number'
    }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Compound unique index for academic year, course, year, and category
feeStructureSchema.index({ academicYear: 1, course: 1, year: 1, category: 1 }, { unique: true });

// Index for efficient querying
feeStructureSchema.index({ academicYear: 1, isActive: 1 });
feeStructureSchema.index({ course: 1, isActive: 1 });
feeStructureSchema.index({ year: 1, isActive: 1 });
feeStructureSchema.index({ category: 1, isActive: 1 });

// Virtual for total fee
feeStructureSchema.virtual('totalFee').get(function() {
  return this.term1Fee + this.term2Fee + this.term3Fee;
});

// Include virtuals in JSON output
feeStructureSchema.set('toJSON', { virtuals: true });
feeStructureSchema.set('toObject', { virtuals: true });

// Method to get fee for specific term
feeStructureSchema.methods.getTermFee = function(termNumber) {
  switch(termNumber) {
    case 1: return this.term1Fee;
    case 2: return this.term2Fee;
    case 3: return this.term3Fee;
    default: return 0;
  }
};

// Static method to get fee structure for academic year, course, year, and category
feeStructureSchema.statics.getFeeStructure = async function(academicYear, course, year, category) {
  return await this.findOne({ 
    academicYear, 
    course, 
    year, 
    category, 
    isActive: true 
  }).populate('course', 'name duration');
};

// Static method to get all fee structures for an academic year
feeStructureSchema.statics.getFeeStructuresByYear = async function(academicYear) {
  return await this.find({ 
    academicYear, 
    isActive: true 
  }).populate('course', 'name duration').sort({ 'course.name': 1, year: 1, category: 1 });
};

// Static method to get fee structures for a specific course and academic year
feeStructureSchema.statics.getFeeStructuresByCourse = async function(academicYear, course) {
  return await this.find({ 
    academicYear, 
    course, 
    isActive: true 
  }).populate('course', 'name duration').sort({ year: 1, category: 1 });
};

// Static method to create or update fee structure
feeStructureSchema.statics.createOrUpdateFeeStructure = async function(data) {
  const { academicYear, course, year, category, term1Fee, term2Fee, term3Fee, createdBy, updatedBy } = data;
  
  console.log('🔍 Model: createOrUpdateFeeStructure called with data:', data);
  
  const existing = await this.findOne({ academicYear, course, year, category });
  
  if (existing) {
    console.log('🔍 Model: Updating existing fee structure');
    // Update existing
    existing.term1Fee = term1Fee;
    existing.term2Fee = term2Fee;
    existing.term3Fee = term3Fee;
    existing.updatedBy = updatedBy;
    existing.isActive = true; // Ensure it's active
    const updated = await existing.save();
    console.log('🔍 Model: Updated fee structure:', updated);
    return updated;
  } else {
    console.log('🔍 Model: Creating new fee structure');
    // Create new
    const created = await this.create({
      academicYear,
      course,
      year,
      category,
      term1Fee,
      term2Fee,
      term3Fee,
      createdBy,
      isActive: true // Ensure it's active
    });
    console.log('🔍 Model: Created fee structure:', created);
    return created;
  }
};

const FeeStructure = mongoose.model('FeeStructure', feeStructureSchema);

export default FeeStructure; 