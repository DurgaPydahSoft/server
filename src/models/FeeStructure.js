import mongoose from 'mongoose';

const feeStructureSchema = new mongoose.Schema({
  academicYear: {
    type: String,
    required: true,
    validate: {
      validator: function (v) {
        // Validate academic year format (e.g., 2022-2023)
        if (!/^\d{4}-\d{4}$/.test(v)) return false;
        const [start, end] = v.split('-').map(Number);
        return end === start + 1;
      },
      message: (props) =>
        `${props.value} is not a valid academic year format! Use format YYYY-YYYY with a 1-year difference (e.g., 2022-2023)`,
    },
  },

  // SQL course and branch names (strings)
  course: { type: String, required: true, trim: true },
  branch: { type: String, trim: true }, // optional branch
  year: { type: Number, required: true, min: 1, max: 10 },

  // New scope: hostel/category selectors (optional)
  hostelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', default: null },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'HostelCategory', default: null },

  // New fee rule shape
  feeType: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, min: 0 },

  // Legacy fields for backward compatibility (term fees + legacy category enum)
  category: {
    type: String, // legacy category kept for backward compatibility; no enum restriction
  },
  term1Fee: { type: Number, min: 0 },
  term2Fee: { type: Number, min: 0 },
  term3Fee: { type: Number, min: 0 },

  // Metadata
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  isActive: { type: Boolean, default: true },

  // Additional fees map (legacy, kept for compatibility)
  additionalFees: {
    type: Map,
    of: {
      amount: { type: Number, default: 0, min: 0 },
      description: { type: String, default: '' },
      isActive: { type: Boolean, default: true },
      categories: {
        type: [String],
        default: [], // no hardcoded enum; empty means applies to all
      },
      categoryAmounts: {
        type: Map,
        of: { type: Number, min: 0 },
        default: new Map(),
      },
    },
    default: new Map(),
  },
}, {
  timestamps: true,
});

// New uniqueness: academicYear + course + branch + year + hostel/category + feeType
feeStructureSchema.index(
  { academicYear: 1, course: 1, branch: 1, year: 1, hostelId: 1, categoryId: 1, feeType: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

// Legacy uniqueness (kept for old records)
feeStructureSchema.index(
  { academicYear: 1, course: 1, branch: 1, year: 1, category: 1 },
  { unique: false },
);

// Index for efficient querying
feeStructureSchema.index({ academicYear: 1, isActive: 1 });
feeStructureSchema.index({ course: 1, branch: 1, isActive: 1 });
feeStructureSchema.index({ year: 1, isActive: 1 });
feeStructureSchema.index({ hostelId: 1, categoryId: 1, isActive: 1 });
feeStructureSchema.index({ category: 1, isActive: 1 }); // legacy

// Virtual for total fee (legacy)
feeStructureSchema.virtual('totalFee').get(function () {
  if (this.term1Fee == null || this.term2Fee == null || this.term3Fee == null) {
    return undefined;
  }
  return this.term1Fee + this.term2Fee + this.term3Fee;
});

// Include virtuals in JSON output
feeStructureSchema.set('toJSON', { virtuals: true });
feeStructureSchema.set('toObject', { virtuals: true });

// Method to get fee for specific term
feeStructureSchema.methods.getTermFee = function (termNumber) {
  switch (termNumber) {
    case 1: return this.term1Fee;
    case 2: return this.term2Fee;
    case 3: return this.term3Fee;
    default: return 0;
  }
};

// Static method to get fee structure for academic year, course, year, and category
feeStructureSchema.statics.getFeeStructure = async function (academicYear, course, branch, year, category) {
  const query = {
    academicYear,
    course,
    year,
    category,
    isActive: true,
  };
  if (branch) {
    query.branch = branch;
  }
  return await this.findOne(query);
};

feeStructureSchema.statics.getFeeStructureStrict = async function (academicYear, course, branch, year, category) {
  return await this.findOne({
    academicYear,
    course,
    branch,
    year,
    category,
    isActive: true,
  });
};

// Static method to get all fee structures for an academic year
feeStructureSchema.statics.getFeeStructuresByYear = async function (academicYear) {
  return await this.find({
    academicYear,
    isActive: true,
  }).sort({ course: 1, branch: 1, year: 1, category: 1 });
};

// Static method to get fee structures for a specific course and academic year
feeStructureSchema.statics.getFeeStructuresByCourse = async function (academicYear, course, branch = null) {
  return await this.find({
    academicYear,
    course,
    ...(branch ? { branch } : {}),
    isActive: true,
  }).sort({ branch: 1, year: 1, category: 1 });
};

// Static method to get additional fees for an academic year
// If category is provided, only returns fees that apply to that category
feeStructureSchema.statics.getAdditionalFees = async function (academicYear, category = null) {
  const feeStructure = await this.findOne({
    academicYear,
    isActive: true,
  }).select('additionalFees');

  if (!feeStructure || !feeStructure.additionalFees || feeStructure.additionalFees.size === 0) {
    return {};
  }

  const additionalFeesObj = {};
  feeStructure.additionalFees.forEach((value, key) => {
    if (category) {
      const feeCategories = Array.isArray(value.categories) ? value.categories : [];
      if (feeCategories.length > 0 && !feeCategories.includes(category)) {
        return;
      }
    }

    const categoryAmountsObj = {};
    if (value.categoryAmounts && value.categoryAmounts instanceof Map) {
      value.categoryAmounts.forEach((amount, cat) => {
        categoryAmountsObj[cat] = amount;
      });
    } else if (value.categoryAmounts && typeof value.categoryAmounts === 'object') {
      Object.assign(categoryAmountsObj, value.categoryAmounts);
    }

    additionalFeesObj[key] = {
      amount: value.amount || 0,
      description: value.description || '',
      isActive: value.isActive !== undefined ? value.isActive : true,
      categories: Array.isArray(value.categories) ? value.categories : [],
      categoryAmounts: Object.keys(categoryAmountsObj).length > 0 ? categoryAmountsObj : undefined,
    };
  });

  return additionalFeesObj;
};

// Static method to set additional fees for an academic year
feeStructureSchema.statics.setAdditionalFees = async function (academicYear, additionalFees, adminId) {
  // Find any fee structure for this academic year to update additional fees
  const feeStructure = await this.findOne({ 
    academicYear, 
    isActive: true,
  });
  
  if (feeStructure) {
    // Convert plain object to Map
    const additionalFeesMap = new Map();
    Object.keys(additionalFees).forEach(key => {
      const feeData = additionalFees[key];
      if (typeof feeData === 'object' && feeData !== null) {
        // Convert categoryAmounts object to Map if provided
        const categoryAmountsMap = new Map();
        if (feeData.categoryAmounts && typeof feeData.categoryAmounts === 'object') {
          Object.entries(feeData.categoryAmounts).forEach(([cat, amount]) => {
            categoryAmountsMap.set(cat, Number(amount) || 0);
          });
        }
        
        // Calculate amount from categoryAmounts if not provided directly
        let calculatedAmount = feeData.amount || 0;
        if (categoryAmountsMap.size > 0 && !feeData.amount) {
          // Use average or max from categoryAmounts as fallback
          const amounts = Array.from(categoryAmountsMap.values());
          calculatedAmount = amounts.reduce((sum, amt) => sum + amt, 0) / amounts.length;
        }
        
        additionalFeesMap.set(key, {
          amount: calculatedAmount, // Keep for backward compatibility
          description: feeData.description || '',
          isActive: feeData.isActive !== undefined ? feeData.isActive : true,
          categories: Array.isArray(feeData.categories) ? feeData.categories : [],
          categoryAmounts: categoryAmountsMap.size > 0 ? categoryAmountsMap : undefined
        });
      } else {
        // Backward compatibility: if it's just a number, convert to object
        additionalFeesMap.set(key, {
          amount: feeData || 0,
          description: '',
          isActive: true,
          categories: []
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
    
    // Update all other fee structures for this academic year
    const otherFeeStructures = await this.find({ 
      academicYear, 
      isActive: true, 
      _id: { $ne: feeStructure._id } 
    });
    
    // Update each fee structure using direct MongoDB update to bypass validation
    if (otherFeeStructures.length > 0) {
      await this.updateMany(
        { academicYear, isActive: true, _id: { $ne: feeStructure._id } },
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
  const { academicYear, course, branch, year, category, term1Fee, term2Fee, term3Fee, createdBy, updatedBy } = data;
  
  console.log('🔍 Model: createOrUpdateFeeStructure called with data:', data);
  
  const existing = await this.findOne({ academicYear, course, branch, year, category });
  
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
      branch,
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