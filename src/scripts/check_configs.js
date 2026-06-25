import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ApplicationExpiryConfig from '../models/ApplicationExpiryConfig.js';
import User from '../models/User.js';

dotenv.config();

const run = async () => {
  try {
    const uri = process.env.MONGODB_URI;
    console.log('Connecting to:', uri);
    await mongoose.connect(uri);

    const configs = await ApplicationExpiryConfig.find({});
    console.log('\n=== APPLICATION EXPIRY CONFIGS ===');
    console.log(`Total configs found: ${configs.length}`);
    configs.forEach(c => {
      console.log(`- AY: ${c.academicYear} | Course: ${c.courseName} | Year: ${c.yearOfStudy} | Month: ${c.expiryMonth} | Day: ${c.expiryDay} | Active: ${c.isActive}`);
    });

    console.log('\n=== SQL SEMESTER DATES PREVIEW ===');
    // We can check some SQL semester dates if we query the SQL database.
    // Let's import the SQL service and query.
    try {
      const sqlService = await import('../utils/sqlService.js');
      const pool = sqlService.default;
      const [rows] = await pool.execute('SELECT * FROM semesters LIMIT 20');
      console.log(`Total semesters in SQL: ${rows.length}`);
      rows.forEach(r => {
        console.log(`- ID: ${r.id} | Course ID: ${r.course_id} | Year: ${r.year_of_study} | Semester: ${r.semester_number} | End Date: ${r.end_date}`);
      });
    } catch (sqlErr) {
      console.log('Error reading SQL semesters:', sqlErr.message);
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
    // Exit process since SQL pool might keep it alive
    process.exit(0);
  }
};

run();
