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
    enum: ['A+', 'A', 'B+', 'B']
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
  },
  // Additional fees that can be category-specific per academic year
  // Using Map to support dynamic fee types (caution deposit, diesel charges, etc.)
  // Each fee can apply to specific categories (A+, A, B+, B)
  additionalFees: {
    type: Map,
    of: {
      amount: { type: Number, default: 0, min: 0 },
      description: { type: String, default: '' },
      isActive: { type: Boolean, default: true },
      categories: { 
        type: [String], 
        default: ['A+', 'A', 'B+', 'B'], // Default to all categories
        enum: ['A+', 'A', 'B+', 'B']
      }
    },
    default: new Map()
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

// Static method to get additional fees for an academic year
// If category is provided, only returns fees that apply to that category
feeStructureSchema.statics.getAdditionalFees = async function(academicYear, category = null) {
  const feeStructure = await this.findOne({ 
    academicYear, 
    isActive: true 
  }).select('additionalFees');
  
  if (!feeStructure || !feeStructure.additionalFees || feeStructure.additionalFees.size === 0) {
    return {};
  }
  
  // Convert Map to plain object for JSON response
  const additionalFeesObj = {};
  feeStructure.additionalFees.forEach((value, key) => {
    // If category is specified, only include fees that apply to that category
    if (category) {
      const feeCategories = value.categories || ['A+', 'A', 'B+', 'B'];
      if (!feeCategories.includes(category)) {
        return; // Skip this fee if it doesn't apply to the specified category
      }
    }
    
    additionalFeesObj[key] = {
      amount: value.amount || 0,
      description: value.description || '',
      isActive: value.isActive !== undefined ? value.isActive : true,
      categories: value.categories || ['A+', 'A', 'B+', 'B'] // Default to all categories
    };
  });
  
  return additionalFeesObj;
};

// Static method to set additional fees for an academic year
feeStructureSchema.statics.setAdditionalFees = async function(academicYear, additionalFees, adminId) {
  // Valid categories enum
  const validCategories = ['A+', 'A', 'B+', 'B'];
  
  // Find any fee structure for this academic year with a valid category to update additional fees
  // Filter out fee structures with invalid categories (like 'C')
  const feeStructure = await this.findOne({ 
    academicYear, 
    isActive: true,
    category: { $in: validCategories } // Only find fee structures with valid categories
  });
  
  if (feeStructure) {
    // Convert plain object to Map
    const additionalFeesMap = new Map();
    Object.keys(additionalFees).forEach(key => {
      const feeData = additionalFees[key];
      if (typeof feeData === 'object' && feeData !== null) {
        additionalFeesMap.set(key, {
          amount: feeData.amount || 0,
          description: feeData.description || '',
          isActive: feeData.isActive !== undefined ? feeData.isActive : true,
          categories: Array.isArray(feeData.categories) && feeData.categories.length > 0 
            ? feeData.categories 
            : ['A+', 'A', 'B+', 'B'] // Default to all categories if not specified
        });
      } else {
        // Backward compatibility: if it's just a number, convert to object
        additionalFeesMap.set(key, {
          amount: feeData || 0,
          description: '',
          isActive: true,
          categories: ['A+', 'A', 'B+', 'B'] // Default to all categories
        });
      }
    });
    
    // Convert Map to plain object for MongoDB update (to avoid validation issues)
    const additionalFeesObject = {};
    additionalFeesMap.forEach((value, key) => {
      additionalFeesObject[key] = value;
    });
    
    // Update additional fees on this structure using direct MongoDB update to bypass validation
    // This avoids validation errors if the fee structure has invalid category
    await this.updateOne(
      { _id: feeStructure._id },
      { 
        $set: { 
          additionalFees: additionalFeesObject,
          updatedBy: adminId
        } 
      }
    );
    
    // Update all other fee structures for this academic year with valid categories
    // Only update fee structures with valid categories to avoid validation errors
    const otherFeeStructures = await this.find({ 
      academicYear, 
      isActive: true, 
      category: { $in: validCategories }, // Only update fee structures with valid categories
      _id: { $ne: feeStructure._id } 
    });
    
    // Update each fee structure using direct MongoDB update to bypass validation
    if (otherFeeStructures.length > 0) {
      await this.updateMany(
        { 
          academicYear, 
          isActive: true, 
          category: { $in: validCategories },
          _id: { $ne: feeStructure._id } 
        },
        { 
          $set: { 
            additionalFees: additionalFeesObject,
            updatedBy: adminId
          } 
        }
      );
    }
    
    // Return the updated fee structure
    const updatedFeeStructure = await this.findById(feeStructure._id);
    return updatedFeeStructure;
  } else {
    // If no fee structure exists, create a dummy one just for additional fees
    // This shouldn't happen in normal flow, but handle it gracefully
    throw new Error('No fee structure found for academic year. Please create fee structures first.');
  }
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