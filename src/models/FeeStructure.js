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

// Compound unique index for academic year and category
feeStructureSchema.index({ academicYear: 1, category: 1 }, { unique: true });

// Index for efficient querying
feeStructureSchema.index({ academicYear: 1, isActive: 1 });
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

// Static method to get fee structure for academic year and category
feeStructureSchema.statics.getFeeStructure = async function(academicYear, category) {
  return await this.findOne({ 
    academicYear, 
    category, 
    isActive: true 
  });
};

// Static method to get all fee structures for an academic year
feeStructureSchema.statics.getFeeStructuresByYear = async function(academicYear) {
  return await this.find({ 
    academicYear, 
    isActive: true 
  }).sort({ category: 1 });
};

// Static method to create or update fee structure
feeStructureSchema.statics.createOrUpdateFeeStructure = async function(data) {
  const { academicYear, category, term1Fee, term2Fee, term3Fee, createdBy, updatedBy } = data;
  
  console.log('🔍 Model: createOrUpdateFeeStructure called with data:', data);
  
  const existing = await this.findOne({ academicYear, category });
  
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