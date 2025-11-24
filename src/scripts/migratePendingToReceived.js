import mongoose from 'mongoose';
import Complaint from '../models/Complaint.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management');
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Migration function to update Pending status to Received
const migratePendingToReceived = async () => {
  try {
    console.log('🔄 Starting migration: Pending → Received...');
    
    // Find all complaints with currentStatus = "Pending"
    const pendingComplaints = await Complaint.find({
      currentStatus: 'Pending'
    }).select('_id currentStatus statusHistory createdAt description');
    
    console.log(`📊 Found ${pendingComplaints.length} complaints with "Pending" status`);
    
    if (pendingComplaints.length === 0) {
      console.log('✅ No complaints with "Pending" status found. Migration not needed.');
      return;
    }
    
    let updatedCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // Update each complaint
    for (const complaint of pendingComplaints) {
      try {
        console.log(`🔍 Processing complaint: ${complaint._id}`);
        console.log(`   Description: ${complaint.description?.substring(0, 50)}...`);
        
        // Update statusHistory: replace "Pending" with "Received"
        const updatedHistory = complaint.statusHistory.map(entry => {
          if (entry.status === 'Pending') {
            return {
              ...entry,
              status: 'Received',
              note: entry.note ? `${entry.note} (Migrated from Pending)` : 'Migrated from Pending status'
            };
          }
          return entry;
        });
        
        // If currentStatus is "Pending", update it to "Received"
        // Also ensure statusHistory has at least one entry
        if (updatedHistory.length === 0 || updatedHistory[updatedHistory.length - 1].status !== 'Received') {
          updatedHistory.push({
            status: 'Received',
            timestamp: complaint.createdAt || new Date(),
            note: 'Migrated from Pending status'
          });
        }
        
        // Update the complaint
        await Complaint.findByIdAndUpdate(complaint._id, {
          currentStatus: 'Received',
          statusHistory: updatedHistory
        });
        
        console.log(`   ✅ Updated successfully`);
        updatedCount++;
        
      } catch (error) {
        console.error(`   ❌ Error processing complaint ${complaint._id}:`, error.message);
        errors.push({
          complaintId: complaint._id,
          error: error.message
        });
        errorCount++;
      }
    }
    
    // Also update any statusHistory entries that might have "Pending" in complaints with other statuses
    console.log('\n🔄 Checking statusHistory entries for "Pending" status...');
    
    const complaintsWithPendingHistory = await Complaint.find({
      'statusHistory.status': 'Pending'
    }).select('_id currentStatus statusHistory');
    
    console.log(`📊 Found ${complaintsWithPendingHistory.length} complaints with "Pending" in statusHistory`);
    
    let historyUpdatedCount = 0;
    
    for (const complaint of complaintsWithPendingHistory) {
      try {
        // Check if statusHistory has "Pending" entries
        const hasPending = complaint.statusHistory.some(entry => entry.status === 'Pending');
        
        if (hasPending) {
          const updatedHistory = complaint.statusHistory.map(entry => {
            if (entry.status === 'Pending') {
              return {
                ...entry,
                status: 'Received',
                note: entry.note ? `${entry.note} (Migrated from Pending)` : 'Migrated from Pending status'
              };
            }
            return entry;
          });
          
          await Complaint.findByIdAndUpdate(complaint._id, {
            statusHistory: updatedHistory
          });
          
          historyUpdatedCount++;
        }
      } catch (error) {
        console.error(`   ❌ Error updating history for complaint ${complaint._id}:`, error.message);
      }
    }
    
    console.log('\n📊 Migration Summary:');
    console.log(`✅ Successfully updated currentStatus: ${updatedCount} complaints`);
    console.log(`✅ Successfully updated statusHistory: ${historyUpdatedCount} complaints`);
    console.log(`❌ Errors: ${errorCount} complaints`);
    
    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      errors.forEach(error => {
        console.log(`   - Complaint ${error.complaintId}: ${error.error}`);
      });
    }
    
    // Verify migration
    const remainingPending = await Complaint.countDocuments({ currentStatus: 'Pending' });
    const remainingPendingHistory = await Complaint.countDocuments({ 'statusHistory.status': 'Pending' });
    
    console.log('\n🔍 Verification:');
    console.log(`   Complaints with currentStatus = "Pending": ${remainingPending}`);
    console.log(`   Complaints with "Pending" in statusHistory: ${remainingPendingHistory}`);
    
    if (remainingPending === 0 && remainingPendingHistory === 0) {
      console.log('\n🎉 Migration completed successfully! All "Pending" statuses have been migrated to "Received".');
    } else {
      console.log('\n⚠️  Some "Pending" statuses may still exist. Please review.');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    await migratePendingToReceived();
  } catch (error) {
    console.error('❌ Script execution failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run the migration
main();

