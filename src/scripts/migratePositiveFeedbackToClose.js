/**
 * Migration Script: Move complaints with positive feedback to Closed status
 * 
 * This script finds all complaints that:
 * 1. Have feedback with isSatisfied = true
 * 2. Still have currentStatus = 'Resolved'
 * 
 * And updates them to:
 * 1. currentStatus = 'Closed'
 * 2. isLockedForUpdates = true
 * 3. Adds status history entry
 * 
 * Usage: node src/scripts/migratePositiveFeedbackToClose.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Import Complaint model
import Complaint from '../models/Complaint.js';

const migratePositiveFeedbackComplaints = async () => {
  try {
    console.log('🔄 Starting migration: Moving positive feedback complaints to Closed status...\n');

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MongoDB URI not found in environment variables');
    }

    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Find complaints with positive feedback that are still "Resolved"
    const complaintsToMigrate = await Complaint.find({
      'feedback.isSatisfied': true,
      currentStatus: 'Resolved'
    });

    console.log(`📊 Found ${complaintsToMigrate.length} complaints with positive feedback still in "Resolved" status\n`);

    if (complaintsToMigrate.length === 0) {
      console.log('✨ No complaints need migration. All positive feedback complaints are already closed.\n');
      await mongoose.disconnect();
      return;
    }

    // Display complaints to be migrated
    console.log('📋 Complaints to migrate:');
    console.log('─'.repeat(80));
    complaintsToMigrate.forEach((complaint, index) => {
      console.log(`${index + 1}. ID: ${complaint._id}`);
      console.log(`   Description: ${complaint.description?.substring(0, 50)}...`);
      console.log(`   Current Status: ${complaint.currentStatus}`);
      console.log(`   Feedback: Satisfied (${complaint.feedback?.comment || 'No comment'})`);
      console.log(`   Created: ${complaint.createdAt}`);
      console.log('─'.repeat(80));
    });

    // Confirm migration
    console.log('\n⚠️  This will update all above complaints to "Closed" status.\n');

    // Perform migration
    let successCount = 0;
    let errorCount = 0;

    for (const complaint of complaintsToMigrate) {
      try {
        complaint.currentStatus = 'Closed';
        complaint.isLockedForUpdates = true;
        complaint.statusHistory.push({
          status: 'Closed',
          timestamp: new Date(),
          note: 'Migrated to Closed status (positive feedback migration script)'
        });

        await complaint.save();
        successCount++;
        console.log(`✅ Migrated complaint ${complaint._id}`);
      } catch (err) {
        errorCount++;
        console.error(`❌ Failed to migrate complaint ${complaint._id}:`, err.message);
      }
    }

    console.log('\n' + '═'.repeat(80));
    console.log('📊 MIGRATION SUMMARY');
    console.log('═'.repeat(80));
    console.log(`✅ Successfully migrated: ${successCount} complaints`);
    console.log(`❌ Failed: ${errorCount} complaints`);
    console.log(`📋 Total processed: ${complaintsToMigrate.length} complaints`);
    console.log('═'.repeat(80));

    // Verify migration
    const remainingResolved = await Complaint.countDocuments({
      'feedback.isSatisfied': true,
      currentStatus: 'Resolved'
    });

    const closedWithFeedback = await Complaint.countDocuments({
      'feedback.isSatisfied': true,
      currentStatus: 'Closed'
    });

    console.log('\n📈 VERIFICATION:');
    console.log(`   Complaints with positive feedback still in "Resolved": ${remainingResolved}`);
    console.log(`   Complaints with positive feedback now in "Closed": ${closedWithFeedback}`);

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
    console.log('🎉 Migration completed!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

// Run the migration
migratePositiveFeedbackComplaints();

