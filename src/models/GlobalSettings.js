import mongoose from 'mongoose';

const GlobalSettingsSchema = new mongoose.Schema({
  // Institution Details
  institution: {
    name: {
      type: String,
      required: true,
      trim: true,
      default: 'Your Institution Name'
    },
    type: {
      type: String,
      enum: ['College', 'University', 'Institute'],
      default: 'College'
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      default: 'Your Institution Full Name'
    },
    address: {
      street: {
        type: String,
        trim: true,
        default: 'Street Address'
      },
      city: {
        type: String,
        trim: true,
        default: 'City'
      },
      state: {
        type: String,
        trim: true,
        default: 'State'
      },
      pincode: {
        type: String,
        trim: true,
        default: 'PIN Code'
      },
      country: {
        type: String,
        trim: true,
        default: 'Country'
      }
    },
    contact: {
      phone: {
        type: String,
        trim: true,
        default: '+91-XXXXXXXXXX'
      },
      email: {
        type: String,
        trim: true,
        default: 'info@yourinstitution.edu'
      },
      website: {
        type: String,
        trim: true,
        default: 'https://yourinstitution.edu'
      }
    },
    socialMedia: {
      facebook: {
        type: String,
        trim: true,
        default: 'https://facebook.com/yourinstitution'
      },
      twitter: {
        type: String,
        trim: true,
        default: 'https://twitter.com/yourinstitution'
      },
      instagram: {
        type: String,
        trim: true,
        default: 'https://instagram.com/yourinstitution'
      },
      linkedin: {
        type: String,
        trim: true,
        default: 'https://linkedin.com/company/yourinstitution'
      }
    }
  },

  // System URLs
  urls: {
    mainWebsite: {
      type: String,
      trim: true,
      default: 'https://yourinstitution.edu'
    },
    apiBaseUrl: {
      type: String,
      trim: true,
      default: 'https://hms.yourinstitution.edu'
    },
    canonicalUrl: {
      type: String,
      trim: true,
      default: 'https://hms.yourinstitution.edu'
    },
    logoUrl: {
      type: String,
      trim: true,
      default: 'https://hms.yourinstitution.edu/logo.png'
    },
    ogImageUrl: {
      type: String,
      trim: true,
      default: 'https://hms.yourinstitution.edu/og-image.jpg'
    }
  },

  // SEO Settings
  seo: {
    defaultTitle: {
      type: String,
      trim: true,
      default: 'Your Institution Hostel Management System'
    },
    defaultDescription: {
      type: String,
      trim: true,
      default: 'Digital hostel management system for your institution. Manage complaints, attendance, fees, and student services.'
    },
    defaultKeywords: {
      type: String,
      trim: true,
      default: 'hostel management, student portal, digital hostel, your institution'
    },
    metaAuthor: {
      type: String,
      trim: true,
      default: 'Your Institution Name'
    },
    metaGenerator: {
      type: String,
      trim: true,
      default: 'PydahSoft'
    }
  },

  // PydahSoft Branding (Read-only, preserved)
  pydahsoft: {
    companyName: {
      type: String,
      default: 'PydahSoft',
      immutable: true
    },
    productName: {
      type: String,
      default: 'PydahSoft Hostel Management System',
      immutable: true
    },
    tagline: {
      type: String,
      default: 'A PydahSoft Product - Transforming hostel management through innovative digital solutions',
      immutable: true
    },
    logoUrl: {
      type: String,
      default: '/PYDAHSOFT LOGO.ico',
      immutable: true
    },
    website: {
      type: String,
      default: 'https://pydahsoft.in',
      immutable: true
    },
    description: {
      type: String,
      default: 'Software solutions by Pydah Educational Institutions',
      immutable: true
    }
  },

  // System Settings
  system: {
    timezone: {
      type: String,
      default: 'Asia/Kolkata'
    },
    dateFormat: {
      type: String,
      enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'],
      default: 'DD/MM/YYYY'
    },
    currency: {
      type: String,
      enum: ['INR', 'USD', 'EUR'],
      default: 'INR'
    },
    currencySymbol: {
      type: String,
      default: '₹'
    },
    academicYear: {
      type: String,
      trim: true,
      default: '2024-25'
    }
  },

  // Audit fields
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  collection: 'globalsettings'
});

// Ensure only one global settings document exists
GlobalSettingsSchema.index({ isActive: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

// Virtual for formatted address
GlobalSettingsSchema.virtual('institution.formattedAddress').get(function() {
  const addr = this.institution.address;
  if (!addr) return '';
  
  const parts = [addr.street, addr.city, addr.state, addr.pincode].filter(Boolean);
  return parts.join(', ');
});

// Virtual for full contact info
GlobalSettingsSchema.virtual('institution.fullContact').get(function() {
  const contact = this.institution.contact;
  if (!contact) return '';
  
  return {
    phone: contact.phone || '',
    email: contact.email || '',
    website: contact.website || ''
  };
});

// Method to get settings by section
GlobalSettingsSchema.methods.getSection = function(section) {
  return this[section];
};

// Method to update section
GlobalSettingsSchema.methods.updateSection = function(section, data) {
  this[section] = { ...this[section], ...data };
  this.lastUpdated = new Date();
  return this.save();
};

// Static method to get or create global settings
GlobalSettingsSchema.statics.getOrCreate = async function() {
  let settings = await this.findOne({ isActive: true });
  
  if (!settings) {
    settings = new this({});
    await settings.save();
  }
  
  return settings;
};

// Static method to update settings
GlobalSettingsSchema.statics.updateSettings = async function(section, data, updatedBy) {
  const settings = await this.getOrCreate();
  
  // Update the specific section
  settings[section] = { ...settings[section], ...data };
  settings.lastUpdated = new Date();
  settings.updatedBy = updatedBy;
  
  await settings.save();
  return settings;
};

export default mongoose.model('GlobalSettings', GlobalSettingsSchema);
