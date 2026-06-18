import mongoose from 'mongoose';
import dotenv from 'dotenv';
// Load schemas
import '../models/Hostel.js';
import '../models/HostelCategory.js';
import '../models/Room.js';
import '../models/User.js';

import { fetchStudentsForAcademicYear } from '../utils/applicationExpiryService.js';

// Load .env
dotenv.config();

const run = async () => {
  try {
    const uri = process.env.MONGODB_URI;
    console.log('Connecting to:', uri);
    await mongoose.connect(uri);

    const ay = '2026-2027';
    console.log(`\n--- Verification for Academic Year ${ay} ---`);

    // 1. Fetch all students
    const all = await fetchStudentsForAcademicYear({
      academicYear: ay,
      page: 1,
      limit: 1000
    });
    console.log(`Total students for ${ay}: ${all.count}`);
    
    // 2. Fetch active students
    const active = await fetchStudentsForAcademicYear({
      academicYear: ay,
      filters: { hostelStatus: 'Active' },
      page: 1,
      limit: 1000
    });
    console.log(`Active students for ${ay}: ${active.count}`);

    // 3. Fetch inactive (expired) students
    const inactive = await fetchStudentsForAcademicYear({
      academicYear: ay,
      filters: { hostelStatus: 'Inactive' },
      page: 1,
      limit: 1000
    });
    console.log(`Inactive/Expired students for ${ay}: ${inactive.count}`);

    // Print details of active vs inactive/expired
    console.log('\n--- Active Student Samples ---');
    active.students.slice(0, 5).forEach(s => {
      console.log(`Name: ${s.name}, Roll: ${s.rollNumber}, hostelStatus: ${s.hostelStatus}, applicationStatus: ${s.applicationStatus}`);
    });

    console.log('\n--- Inactive/Expired Student Samples ---');
    inactive.students.slice(0, 5).forEach(s => {
      console.log(`Name: ${s.name}, Roll: ${s.rollNumber}, hostelStatus: ${s.hostelStatus}, applicationStatus: ${s.applicationStatus}`);
    });

    // Check historical year as well (e.g. 2025-2026)
    const prevAy = '2025-2026';
    console.log(`\n--- Verification for Academic Year ${prevAy} ---`);

    const allPrev = await fetchStudentsForAcademicYear({
      academicYear: prevAy,
      page: 1,
      limit: 1000
    });
    console.log(`Total students for ${prevAy}: ${allPrev.count}`);

    const activePrev = await fetchStudentsForAcademicYear({
      academicYear: prevAy,
      filters: { hostelStatus: 'Active' },
      page: 1,
      limit: 1000
    });
    console.log(`Active students for ${prevAy}: ${activePrev.count}`);

    const inactivePrev = await fetchStudentsForAcademicYear({
      academicYear: prevAy,
      filters: { hostelStatus: 'Inactive' },
      page: 1,
      limit: 1000
    });
    console.log(`Inactive/Expired students for ${prevAy}: ${inactivePrev.count}`);

    console.log(`\n--- Active Student Samples (${prevAy}) ---`);
    activePrev.students.slice(0, 5).forEach(s => {
      console.log(`Name: ${s.name}, Roll: ${s.rollNumber}, hostelStatus: ${s.hostelStatus}, applicationStatus: ${s.applicationStatus}`);
    });

    console.log(`\n--- Inactive/Expired Student Samples (${prevAy}) ---`);
    inactivePrev.students.slice(0, 5).forEach(s => {
      console.log(`Name: ${s.name}, Roll: ${s.rollNumber}, hostelStatus: ${s.hostelStatus}, applicationStatus: ${s.applicationStatus}`);
    });

  } catch (err) {
    console.error('Error during verification:', err);
  } finally {
    await mongoose.connection.close();
  }
};

run();
