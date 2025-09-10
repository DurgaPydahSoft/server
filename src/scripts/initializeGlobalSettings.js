import mongoose from 'mongoose';
import dotenv from 'dotenv';
import GlobalSettings from '../models/GlobalSettings.js';

// Load environment variables
dotenv.config();

const initializeGlobalSettings = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management');
    console.log('✅ Connected to MongoDB');

    // Check if global settings already exist
    const existingSettings = await GlobalSettings.findOne({ isActive: true });
    
    if (existingSettings) {
      console.log('ℹ️ Global settings already exist. Skipping initialization.');
      console.log('Current settings:', {
        institution: existingSettings.institution.name,
        lastUpdated: existingSettings.lastUpdated
      });
      return;
    }

    // Create default global settings
    const defaultSettings = new GlobalSettings({
      institution: {
        name: 'Your Institution Name',
        type: 'College',
        fullName: 'Your Institution Full Name',
        address: {
          street: 'Street Address',
          city: 'City',
          state: 'State',
          pincode: 'PIN Code',
          country: 'Country'
        },
        contact: {
          phone: '+91-XXXXXXXXXX',
          email: 'info@yourinstitution.edu',
          website: 'https://yourinstitution.edu'
        },
        socialMedia: {
          facebook: 'https://facebook.com/yourinstitution',
          twitter: 'https://twitter.com/yourinstitution',
          instagram: 'https://instagram.com/yourinstitution',
          linkedin: 'https://linkedin.com/company/yourinstitution'
        }
      },
      urls: {
        mainWebsite: 'https://yourinstitution.edu',
        apiBaseUrl: 'https://hms.yourinstitution.edu',
        canonicalUrl: 'https://hms.yourinstitution.edu',
        logoUrl: 'https://hms.yourinstitution.edu/logo.png',
        ogImageUrl: 'https://hms.yourinstitution.edu/og-image.jpg'
      },
      seo: {
        defaultTitle: 'Your Institution Hostel Management System',
        defaultDescription: 'Digital hostel management system for your institution. Manage complaints, attendance, fees, and student services.',
        defaultKeywords: 'hostel management, student portal, digital hostel, your institution',
        metaAuthor: 'Your Institution Name',
        metaGenerator: 'PydahSoft'
      },
      pydahsoft: {
        companyName: 'PydahSoft',
        productName: 'PydahSoft Hostel Management System',
        tagline: 'A PydahSoft Product - Transforming hostel management through innovative digital solutions',
        logoUrl: '/PYDAHSOFT LOGO.ico',
        website: 'https://pydahsoft.in',
        description: 'Software solutions by Pydah Educational Institutions'
      },
      system: {
        timezone: 'Asia/Kolkata',
        dateFormat: 'DD/MM/YYYY',
        currency: 'INR',
        currencySymbol: '₹',
        academicYear: '2024-25'
      },
      lastUpdated: new Date(),
      isActive: true
    });

    await defaultSettings.save();
    console.log('✅ Global settings initialized successfully!');
    console.log('Default institution name:', defaultSettings.institution.name);
    console.log('Default timezone:', defaultSettings.system.timezone);
    console.log('PydahSoft branding preserved:', defaultSettings.pydahsoft.companyName);

  } catch (error) {
    console.error('❌ Error initializing global settings:', error);
    throw error;
  } finally {
    // Close MongoDB connection
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

// Run the script
initializeGlobalSettings();
