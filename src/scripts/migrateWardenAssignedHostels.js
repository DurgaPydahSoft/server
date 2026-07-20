/**
 * Map legacy warden hostelType (boys/girls) to Admin.assignedHostelId
 * by matching Hostel documents whose name contains "boy" or "girl".
 *
 * Usage:
 *   node -r dotenv/config src/scripts/migrateWardenAssignedHostels.js
 *   node -r dotenv/config src/scripts/migrateWardenAssignedHostels.js --dry-run
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Admin from '../models/Admin.js';
import Hostel from '../models/Hostel.js';

dotenv.config();

const dryRun = process.argv.includes('--dry-run');

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hostel-management');
  console.log('✅ Connected to MongoDB');
};

const findHostelForType = async (hostelType, hostels) => {
  const hint = hostelType === 'boys' ? /boy/i : /girl/i;
  const exactName = hostelType === 'boys' ? 'Boys Hostel' : 'Girls Hostel';

  return (
    hostels.find((h) => h.name === exactName) ||
    hostels.find((h) => hint.test(h.name || '')) ||
    null
  );
};

const migrate = async () => {
  console.log(dryRun ? '🔍 DRY RUN — no changes will be saved' : '🔄 Migrating warden assigned hostels...');

  const hostels = await Hostel.find({ isActive: true }).select('_id name isActive').lean();
  console.log(`📊 Active hostels: ${hostels.map((h) => h.name).join(', ') || '(none)'}`);

  const wardens = await Admin.find({
    role: 'warden',
    $or: [{ assignedHostelId: { $exists: false } }, { assignedHostelId: null }]
  }).select('_id username hostelType assignedHostelId isActive');

  console.log(`📊 Wardens without assignedHostelId: ${wardens.length}`);

  let updated = 0;
  let skipped = 0;
  const errors = [];

  for (const warden of wardens) {
    try {
      if (!warden.hostelType) {
        console.warn(`⚠️  Skip ${warden.username}: no hostelType and no assignedHostelId`);
        skipped += 1;
        continue;
      }

      const matched = await findHostelForType(warden.hostelType, hostels);
      if (!matched) {
        console.warn(`⚠️  Skip ${warden.username}: no Hostel matching hostelType="${warden.hostelType}"`);
        skipped += 1;
        continue;
      }

      console.log(`➡️  ${warden.username}: hostelType=${warden.hostelType} → ${matched.name} (${matched._id})`);

      if (!dryRun) {
        warden.assignedHostelId = matched._id;
        await warden.save();
      }
      updated += 1;
    } catch (err) {
      errors.push({ username: warden.username, error: err.message });
      console.error(`❌ ${warden.username}:`, err.message);
    }
  }

  console.log('\n======= Summary =======');
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors:  ${errors.length}`);
  if (dryRun) console.log('(dry-run — re-run without --dry-run to apply)');
};

const main = async () => {
  try {
    await connectDB();
    await migrate();
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected');
  }
};

main();
