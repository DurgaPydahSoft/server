import mongoose from 'mongoose';
import FeeStructure from '../models/FeeStructure.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables - try multiple paths
dotenv.config({ path: join(__dirname, '../../.env') }); // server/.env
dotenv.config({ path: join(__dirname, '../../../.env') }); // project root .env
dotenv.config(); // Fallback to default location

/**
 * Migration script to convert old additionalFees format to new Map format
 * 
 * Old format: additionalFees: { cautionDeposit: 7000 }
 * New format: additionalFees: Map { 'cautionDeposit' => { amount: 7000, description: '', isActive: true } }
 * 
 * Usage: node server/src/scripts/migrateAdditionalFeesToMapFormat.js
 */
const migrateAdditionalFees = async () => {
  try {
    console.log('🚀 Starting additional fees migration to Map format...');
    
    // Connect to MongoDB with fallback
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MongoDB URI not found in environment variables. Please set MONGODB_URI in your .env file.');
    }
    
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Find all fee structures that might have old format additionalFees
    // We'll use raw MongoDB query to avoid Mongoose validation issues
    const db = mongoose.connection.db;
    const collection = db.collection('feestructures');
    
    // Find all documents with additionalFees field
    const feeStructures = await collection.find({ 
      additionalFees: { $exists: true, $ne: null } 
    }).toArray();
    
    console.log(`📊 Found ${feeStructures.length} fee structures with additionalFees`);

    if (feeStructures.length === 0) {
      console.log('✅ No fee structures with additionalFees found. Migration not needed.');
      await mongoose.disconnect();
      return;
    }

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const doc of feeStructures) {
      try {
        const additionalFees = doc.additionalFees;
        
        // Skip if already in Map format (check if it's an object with nested objects)
        let needsMigration = false;
        
        if (additionalFees && typeof additionalFees === 'object') {
          // Check if any value is a primitive (old format)
          const keys = Object.keys(additionalFees);
          for (const key of keys) {
            const value = additionalFees[key];
            // If value is a number (primitive), it's old format
            if (typeof value === 'number') {
              needsMigration = true;
              break;
            }
            // If value is an object but doesn't have 'amount' property, might be old format
            if (typeof value === 'object' && value !== null && !('amount' in value)) {
              needsMigration = true;
              break;
            }
          }
        }

        if (!needsMigration) {
          console.log(`⏭️  Skipping ${doc._id} - already in new format or empty`);
          skippedCount++;
          continue;
        }

        console.log(`🔄 Migrating fee structure ${doc._id}...`);
        
        // Convert old format to new format
        const migratedFees = {};
        Object.keys(additionalFees).forEach(key => {
          const value = additionalFees[key];
          
          if (typeof value === 'object' && value !== null && 'amount' in value) {
            // Already in new format
            migratedFees[key] = {
              amount: value.amount || 0,
              description: value.description || '',
              isActive: value.isActive !== undefined ? value.isActive : true
            };
          } else if (typeof value === 'number') {
            // Old format: convert to new format
            migratedFees[key] = {
              amount: value || 0,
              description: '',
              isActive: true
            };
            console.log(`   ✓ Migrated ${key}: ${value} -> {amount: ${value}, description: '', isActive: true}`);
          } else {
            // Unknown format, set defaults
            migratedFees[key] = {
              amount: 0,
              description: '',
              isActive: true
            };
            console.log(`   ⚠️  Unknown format for ${key}, set to defaults`);
          }
        });

        // Update the document using raw MongoDB update
        // Mongoose Map is stored as a plain object in MongoDB
        await collection.updateOne(
          { _id: doc._id },
          { 
            $set: { 
              additionalFees: migratedFees 
            } 
          }
        );

        migratedCount++;
        console.log(`✅ Successfully migrated fee structure ${doc._id}`);
        
      } catch (error) {
        console.error(`❌ Error migrating fee structure ${doc._id}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Migrated: ${migratedCount}`);
    console.log(`   ⏭️  Skipped: ${skippedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📝 Total processed: ${feeStructures.length}`);

    if (migratedCount > 0) {
      console.log('\n✅ Migration completed successfully!');
      console.log('💡 The additionalFees field has been migrated to the new Map format.');
      console.log('💡 You can now use the new Additional Fees Setup tab in the admin panel.');
    } else {
      console.log('\n✅ No migration needed - all data is already in the correct format.');
    }

    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

// Run migration
migrateAdditionalFees();

