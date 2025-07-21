import mongoose from 'mongoose';
import Member from '../models/Member.js';
import Complaint from '../models/Complaint.js';
import dotenv from 'dotenv';

dotenv.config();

const updateMemberEfficiency = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get all members
    const members = await Member.find({ isActive: true });
    console.log(`Found ${members.length} active members`);

    for (const member of members) {
      console.log(`Processing member: ${member.name} (${member.category})`);
      
      try {
        // Update efficiency metrics
        await member.updateEfficiencyMetrics();
        
        // Update workload
        await member.updateWorkload();
        
        console.log(`✅ Updated ${member.name}: Efficiency=${member.efficiencyScore}, Workload=${member.currentWorkload}`);
      } catch (error) {
        console.error(`❌ Error updating ${member.name}:`, error.message);
      }
    }

    console.log('✅ Member efficiency update completed');
    
  } catch (error) {
    console.error('❌ Error updating member efficiency:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

// Run the script
updateMemberEfficiency(); 