/**
 * One-off: assign real hostel codes before the Phase 7 backfill.
 * Boys Hostel -> BH, Girls Hostel -> GH (matches legacy BH25001/GH25001 convention).
 *
 * Usage: node -r dotenv/config src/scripts/assignHostelCodes.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import Hostel from '../models/Hostel.js';

const CODE_MAP = [
  { match: /boys/i, code: 'BH' },
  { match: /girls/i, code: 'GH' }
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const hostels = await Hostel.find({});
  for (const hostel of hostels) {
    if (hostel.code) {
      console.log(`SKIP ${hostel.name}: already has code ${hostel.code}`);
      continue;
    }
    const entry = CODE_MAP.find((e) => e.match.test(hostel.name));
    if (!entry) {
      console.log(`WARN ${hostel.name}: no mapping found — set code manually`);
      continue;
    }
    hostel.code = entry.code;
    await hostel.save();
    console.log(`SET  ${hostel.name} -> ${entry.code}`);
  }
  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
