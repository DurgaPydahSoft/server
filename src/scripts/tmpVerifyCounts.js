import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import User from '../models/User.js';
import RoomOccupancyHistory from '../models/RoomOccupancyHistory.js';
import HostelRequest from '../models/HostelRequest.js';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const byAY = await User.aggregate([
    { $match: { role: 'student' } },
    { $group: { _id: '$academicYear', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
  console.log('Users by AY now:', JSON.stringify(byAY));
  console.log('Total students now:', await User.countDocuments({ role: 'student' }));

  const hist27 = await RoomOccupancyHistory.aggregate([
    { $match: { academicYear: '2026-2027' } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);
  console.log('History 2026-2027 by status:', JSON.stringify(hist27));

  console.log('HostelRequest count:', await HostelRequest.countDocuments({}));

  const recent = await User.find({ role: 'student' }).sort({ createdAt: -1 }).limit(10)
    .select('rollNumber name academicYear hostelStatus applicationStatus createdAt').lean();
  console.log('Most recent users:');
  recent.forEach(u => console.log(`  ${u.rollNumber} | AY=${u.academicYear} | as=${u.applicationStatus} | created=${u.createdAt?.toISOString()}`));

  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
