import mongoose from 'mongoose';
import AIConfig from '../models/AIConfig.js';
import dotenv from 'dotenv';

dotenv.config();

const initAIConfig = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Check if AI config already exists
    let aiConfig = await AIConfig.findOne();
    
    if (!aiConfig) {
      // Create default AI configuration
      aiConfig = new AIConfig({
        isEnabled: false,
        categories: {
          Canteen: { aiEnabled: false, autoAssign: false },
          Internet: { aiEnabled: false, autoAssign: false },
          Maintenance: { aiEnabled: false, autoAssign: false },
          Others: { aiEnabled: false, autoAssign: false }
        },
        memberEfficiencyThreshold: 70,
        autoStatusUpdate: true,
        maxWorkload: 5
      });

      await aiConfig.save();
      console.log('✅ AI configuration initialized successfully');
    } else {
      console.log('ℹ️ AI configuration already exists');
    }

    console.log('AI Configuration:', aiConfig);
    
  } catch (error) {
    console.error('❌ Error initializing AI config:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

// Run the script
initAIConfig(); 