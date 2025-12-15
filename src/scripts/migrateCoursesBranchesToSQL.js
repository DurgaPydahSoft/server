/**
 * Course & Branch Migration Script - SQL as Single Source of Truth
 * 
 * PURPOSE:
 * This script migrates student course/branch data from SQL database to MongoDB.
 * SQL database is the SINGLE SOURCE OF TRUTH - it completely overrides MongoDB values.
 * 
 * LOGIC:
 * 1. For each student in MongoDB:
 *    - Find student in SQL using rollNumber/PIN/admissionNumber (with normalization)
 *    - Extract course and branch from SQL student record
 *    - Match SQL course/branch to MongoDB Course/Branch documents
 *    - REPLACE MongoDB course/branch ObjectIDs with SQL-mapped values
 * 
 * KEY PRINCIPLE:
 * - Whatever course/branch the student has in SQL MUST completely override MongoDB
 * - Old/incorrect MongoDB ObjectIDs are completely replaced
 * - SQL is authoritative - no exceptions
 * 
 * EXAMPLE:
 * MongoDB student: rollNumber="1234", course=ObjectId("649abc123"), branch=ObjectId("834xyz789")
 * SQL record: roll_no="1234", course="BTECH", branch="CSE"
 * Result: MongoDB course/branch replaced with BTECH/CSE (mapped to MongoDB documents)
 * 
 * USAGE:
 *   node migrateCoursesBranchesToSQL.js              # Normal run (force update all)
 *   node migrateCoursesBranchesToSQL.js --dry-run     # Dry run (no changes)
 *   node migrateCoursesBranchesToSQL.js --no-force    # Skip already-synced students
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import Course from '../models/Course.js';
import Branch from '../models/Branch.js';
import { getCoursesFromSQL, getBranchesFromSQL } from '../utils/courseBranchMapper.js';
import { fetchCoursesFromSQL, fetchBranchesFromSQL, fetchStudentByIdentifier } from '../utils/sqlService.js';
import { matchCourse, matchBranch } from '../utils/courseBranchMatcher.js';
import { ensureMongoDBCourse, ensureMongoDBBranch } from '../utils/courseBranchResolver.js';

dotenv.config();

/**
 * Normalize course/branch name for matching
 */
const normalizeName = (name) => {
  if (!name) return '';
  return name.trim().toUpperCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+/g, '');
};

/**
 * Calculate similarity between two strings
 */
const calculateSimilarity = (str1, str2) => {
  const s1 = normalizeName(str1);
  const s2 = normalizeName(str2);
  
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;
  
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;
  
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  const overlap = [...shorter].filter(char => longer.includes(char)).length;
  return overlap / longer.length;
};

/**
 * Find best matching course from SQL
 */
const findMatchingCourse = (mongoCourseName, sqlCourses) => {
  const normalizedMongo = normalizeName(mongoCourseName);
  let bestMatch = null;
  let bestScore = 0;
  
  for (const sqlCourse of sqlCourses) {
    const normalizedSQL = normalizeName(sqlCourse.name);
    
    if (normalizedSQL === normalizedMongo) {
      return { match: sqlCourse, score: 1.0, type: 'exact' };
    }
    
    const score = calculateSimilarity(mongoCourseName, sqlCourse.name);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = sqlCourse;
    }
  }
  
  if (bestScore >= 0.7 && bestMatch) {
    return { match: bestMatch, score: bestScore, type: 'fuzzy' };
  }
  
  return null;
};

/**
 * Find best matching branch from SQL
 */
const findMatchingBranch = (mongoBranchName, sqlBranches, sqlCourseId) => {
  // Filter branches by course
  const courseBranches = sqlBranches.filter(b => b.course_id === sqlCourseId);
  
  const normalizedMongo = normalizeName(mongoBranchName);
  let bestMatch = null;
  let bestScore = 0;
  
  for (const sqlBranch of courseBranches) {
    const normalizedSQL = normalizeName(sqlBranch.name);
    
    if (normalizedSQL === normalizedMongo) {
      return { match: sqlBranch, score: 1.0, type: 'exact' };
    }
    
    const score = calculateSimilarity(mongoBranchName, sqlBranch.name);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = sqlBranch;
    }
  }
  
  if (bestScore >= 0.7 && bestMatch) {
    return { match: bestMatch, score: bestScore, type: 'fuzzy' };
  }
  
  return null;
};

/**
 * Normalize roll number/admission number/PIN for matching
 * Handles formats like: 24320-CM-007, 24320CM007, etc.
 */
const normalizeIdentifier = (identifier) => {
  if (!identifier) return '';
  // Remove hyphens, spaces, convert to uppercase
  return identifier.toString()
    .replace(/[-\/]/g, '') // remove hyphens and slashes
    .replace(/\s+/g, '')
    .toUpperCase()
    .trim();
};

/**
 * Generate identifier variants (with/without hyphens) to improve matching
 * Examples:
 *  - 24320CM007 -> 24320-CM-007
 *  - 24320EC025 -> 24320-EC-025
 *  - PT-AHP/23-25 -> PTAHP2325, PT-AHP-23-25, PT-AHP/23-25
 */
const generateIdentifierVariants = (identifier) => {
  const variants = new Set();
  if (!identifier) return [];

  const raw = identifier.toString().trim();
  const normalized = normalizeIdentifier(raw);

  // Always try raw and normalized (no hyphens/spaces)
  variants.add(raw);
  variants.add(normalized);

  // If pattern looks like digits + letters + digits, add dashed variant
  const match = normalized.match(/^(\d+)([A-Z]+)(\d+)$/);
  if (match) {
    const [, part1, letters, part2] = match;
    variants.add(`${part1}-${letters}-${part2}`);
    variants.add(`${part1}-${letters}${part2}`);
    variants.add(`${part1}${letters}-${part2}`);
  }

   // If pattern looks like letters+digits+letters or letters+digits (for cases like PTAHP2325 / PT-AHP/23-25)
   const alphaNumSplit = normalized.match(/^([A-Z]+)(\d+)([A-Z]*)$/);
   if (alphaNumSplit) {
     const [, letters1, digits, letters2] = alphaNumSplit;
     if (letters2) {
       variants.add(`${letters1}-${digits}-${letters2}`);
       variants.add(`${letters1}-${digits}${letters2}`);
     } else {
       variants.add(`${letters1}-${digits}`);
     }
    // If digits can be split into year-batch (e.g., 202409 -> 2024-09)
    if (digits.length >= 5) {
      const head = digits.slice(0, 4);
      const tail = digits.slice(4);
      variants.add(`${letters1}-${head}-${tail}`);
      if (letters2) {
        variants.add(`${letters1}-${head}-${tail}-${letters2}`);
      }
    }
   }

  return Array.from(variants).filter(Boolean);
};

/**
 * Try to match student in SQL database using multiple identifiers
 * Handles format variations (with/without hyphens)
 */
const findStudentInSQL = async (rollNumber, admissionNumber = null, pinNumber = null) => {
  // Collect all variants from roll, admission, pin
  const identifiers = new Set();
  generateIdentifierVariants(rollNumber).forEach(id => identifiers.add(id));
  generateIdentifierVariants(admissionNumber).forEach(id => identifiers.add(id));
  generateIdentifierVariants(pinNumber).forEach(id => identifiers.add(id));

  // Try each variant until one succeeds
  for (const id of identifiers) {
    const result = await fetchStudentByIdentifier(id);
    if (result.success) {
      return result;
    }
  }

  return { success: false, error: 'Student not found in SQL database' };
};

/**
 * Main migration function - Sync student course/branch from SQL
 * SQL is the SINGLE SOURCE OF TRUTH - completely overrides MongoDB values
 * @param {Object} options - Migration options
 * @param {boolean} options.forceUpdate - Force update all students even if already synced
 * @param {boolean} options.dryRun - Dry run mode (don't actually update database)
 */
const migrateCoursesBranchesToSQL = async (options = {}) => {
  const { forceUpdate = true, dryRun = false } = options;
  
  try {
    console.log('🚀 Starting Student Course/Branch Migration from SQL...\n');
    console.log('📌 SQL Database is the SINGLE SOURCE OF TRUTH');
    console.log('📌 MongoDB course/branch will be COMPLETELY REPLACED with SQL values\n');
    
    if (dryRun) {
      console.log('⚠️  DRY RUN MODE - No database changes will be made\n');
    }
    
    if (forceUpdate) {
      console.log('🔄 FORCE UPDATE MODE - All students will be updated regardless of sync status\n');
    }

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI not found in environment variables');
    }

    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Fetch all students from MongoDB
    console.log('📊 Fetching all students from MongoDB...');
    const students = await User.find({ role: 'student' })
      .select('_id rollNumber name course branch year admissionNumber pinNumber sqlCourseId sqlBranchId syncedAt')
      .populate('course', 'name code')
      .populate('branch', 'name code');

    console.log(`📊 Found ${students.length} students in MongoDB\n`);

    // Statistics
    const stats = {
      total: students.length,
      updated: 0,
      replaced: 0, // Students whose course/branch was replaced
      notFound: 0,
      invalidIdentifier: 0,
      courseBranchNotFound: 0,
      errors: 0,
      skipped: 0,
      unchanged: 0 // Students where SQL matches MongoDB (no change needed)
    };

    const unmatchedStudents = [];
    const updateOperations = [];
    const replacementLog = []; // Track what was replaced

    console.log('🔄 Processing students and syncing from SQL...\n');

    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      
      try {
        // Extract identifiers
        // rollNumber may actually be admission number or PIN
        const rollNumber = student.rollNumber;
        
        // Check if student has additional identifier fields (if they exist in schema)
        const admissionNumber = student.admissionNumber || null;
        const pinNumber = student.pinNumber || null;

        if (!rollNumber) {
          stats.invalidIdentifier++;
          unmatchedStudents.push({
            rollNumber: 'N/A',
            name: student.name,
            reason: 'No rollNumber identifier found'
          });
          continue;
        }

        // Try to find student in SQL using rollNumber (which may be admission number or PIN)
        const sqlStudentResult = await findStudentInSQL(rollNumber, admissionNumber, pinNumber);

        if (!sqlStudentResult.success) {
          stats.notFound++;
          unmatchedStudents.push({
            rollNumber: rollNumber || 'N/A',
            name: student.name,
            reason: 'Student not found in SQL database'
          });
          continue;
        }

        const sqlStudent = sqlStudentResult.data;

        // Extract course and branch from SQL
        const sqlCourseName = sqlStudent.course;
        const sqlBranchName = sqlStudent.branch;
        const sqlYear = sqlStudent.current_year || null;
        const sqlSemester = sqlStudent.current_semester || null;
        const sqlAdmissionNumber = sqlStudent.admission_number || sqlStudent.admission_no || null;
        const sqlRollNumber = sqlStudent.pin_no || sqlAdmissionNumber || null; // no roll_number column in SQL; use pin_no as rollNumber source

        if (!sqlCourseName || !sqlBranchName) {
          stats.courseBranchNotFound++;
          unmatchedStudents.push({
            rollNumber: rollNumber || 'N/A',
            name: student.name,
            reason: `Missing course or branch in SQL (course: ${sqlCourseName || 'N/A'}, branch: ${sqlBranchName || 'N/A'})`
          });
          continue;
        }

        // Use SQL values directly (SQL is the single source of truth)
        const sqlCourseId = sqlStudent.course_id || null;
        const sqlBranchId = sqlStudent.branch_id || null;
        const newCourseName = sqlCourseName;
        const newBranchName = sqlBranchName;
        const newRollNumber = sqlRollNumber || rollNumber;
        const newAdmissionNumber = sqlAdmissionNumber || student.admissionNumber || null;

        // Track what's being replaced
        const oldCourseVal = student.course || 'N/A';
        const oldBranchVal = student.branch || 'N/A';
        const oldRollVal = student.rollNumber || 'N/A';
        const oldAdmissionVal = student.admissionNumber || 'N/A';

        // Check if update is needed
        const courseChanged = oldCourseVal !== newCourseName;
        const branchChanged = oldBranchVal !== newBranchName;
        const rollChanged = newRollNumber && oldRollVal !== newRollNumber;
        const admissionChanged = newAdmissionNumber && oldAdmissionVal !== newAdmissionNumber;
        const yearChanged = sqlYear && student.year !== sqlYear;
        const sqlIdsChanged = 
          (sqlCourseId && student.sqlCourseId !== sqlCourseId) ||
          (sqlBranchId && student.sqlBranchId !== sqlBranchId);
        
        const needsUpdate = forceUpdate || courseChanged || branchChanged || rollChanged || admissionChanged || yearChanged || sqlIdsChanged;

        if (!needsUpdate) {
          stats.unchanged++;
          continue;
        }

        // Track replacements for logging
        if (courseChanged || branchChanged) {
          stats.replaced++;
          replacementLog.push({
            rollNumber: rollNumber || 'N/A',
            name: student.name,
            oldCourse: `${oldCourseVal}`,
            newCourse: `${newCourseName}`,
            oldBranch: `${oldBranchVal}`,
            newBranch: `${newBranchName}`
          });
        }

        // Prepare update object - SQL COMPLETELY OVERRIDES MongoDB
        const updateData = {
          course: newCourseName, // store string from SQL
          branch: newBranchName, // store string from SQL
          rollNumber: newRollNumber,
          admissionNumber: newAdmissionNumber,
          courseMatchType: 'exact',
          branchMatchType: 'exact',
          syncedAt: new Date()
        };

        // Add SQL IDs if available (these are the source of truth)
        if (sqlCourseId) {
          updateData.sqlCourseId = sqlCourseId;
        }
        if (sqlBranchId) {
          updateData.sqlBranchId = sqlBranchId;
        }

        // Add year if available from SQL
        if (sqlYear) {
          updateData.year = sqlYear;
        }

        // Create update operation
        if (!dryRun) {
          updateOperations.push({
            updateOne: {
              filter: { _id: student._id },
              update: { $set: updateData }
            }
          });
        }

        stats.updated++;

        // Progress logging
        if ((i + 1) % 50 === 0) {
          console.log(`  ✅ Processed ${i + 1}/${students.length} students (${stats.updated} updated, ${stats.notFound} not found)...`);
        }

      } catch (error) {
        stats.errors++;
        console.error(`  ❌ Error processing student ${student.rollNumber || 'N/A'}:`, error.message);
        unmatchedStudents.push({
          rollNumber: student.rollNumber || 'N/A',
          name: student.name,
          reason: `Error: ${error.message}`
        });
      }
    }

    console.log('\n📝 Applying updates to database...');
    
    if (dryRun) {
      console.log(`  ⚠️  DRY RUN: Would update ${updateOperations.length} students (no changes made)`);
    } else if (updateOperations.length > 0) {
      // Batch update in chunks of 100
      const chunkSize = 100;
      for (let i = 0; i < updateOperations.length; i += chunkSize) {
        const chunk = updateOperations.slice(i, i + chunkSize);
        await User.bulkWrite(chunk);
        console.log(`  ✅ Updated ${Math.min(i + chunkSize, updateOperations.length)}/${updateOperations.length} students`);
      }
    } else {
      console.log('  ℹ️  No updates needed');
    }

    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total Students Processed: ${stats.total}`);
    console.log(`✅ Successfully Updated: ${stats.updated}`);
    console.log(`🔄 Course/Branch Replaced: ${stats.replaced}`);
    console.log(`✓  Unchanged (SQL matches MongoDB): ${stats.unchanged}`);
    console.log(`⏭️  Skipped: ${stats.skipped}`);
    console.log(`❌ Not Found in SQL: ${stats.notFound}`);
    console.log(`⚠️  Invalid Identifier: ${stats.invalidIdentifier}`);
    console.log(`⚠️  Course/Branch Not Found: ${stats.courseBranchNotFound}`);
    console.log(`❌ Errors: ${stats.errors}`);
    
    if (dryRun) {
      console.log('\n⚠️  DRY RUN MODE - No actual changes were made to the database');
    }

    // Show replacement details
    if (replacementLog.length > 0) {
      console.log('\n🔄 COURSE/BRANCH REPLACEMENTS:');
      console.log('='.repeat(70));
      replacementLog.slice(0, 20).forEach((item, index) => {
        console.log(`\n${index + 1}. ${item.rollNumber} - ${item.name}`);
        if (item.oldCourse !== item.newCourse) {
          console.log(`   Course: ${item.oldCourse} → ${item.newCourse}`);
        }
        if (item.oldBranch !== item.newBranch) {
          console.log(`   Branch: ${item.oldBranch} → ${item.newBranch}`);
        }
      });
      if (replacementLog.length > 20) {
        console.log(`\n... and ${replacementLog.length - 20} more replacements`);
      }
    }

    if (unmatchedStudents.length > 0) {
      console.log('\n⚠️  UNMATCHED/ERROR STUDENTS:');
      console.log('='.repeat(70));
      unmatchedStudents.slice(0, 30).forEach((student, index) => {
        console.log(`${index + 1}. ${student.rollNumber} - ${student.name}`);
        console.log(`   Reason: ${student.reason}`);
      });
      if (unmatchedStudents.length > 30) {
        console.log(`\n... and ${unmatchedStudents.length - 30} more`);
      }
    }

    console.log('\n✅ Migration completed!');
    console.log('\n📌 SQL Database is now the SINGLE SOURCE OF TRUTH for course/branch data');
    console.log('📌 All MongoDB course/branch references have been updated to match SQL');

  } catch (error) {
    console.error('\n❌ Sync failed:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
};

// Main execution function
const main = async () => {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run') || args.includes('-d');
    const forceUpdate = !args.includes('--no-force'); // Default to true unless --no-force is specified
    
    const options = {
      forceUpdate,
      dryRun
    };
    
    if (dryRun) {
      console.log('⚠️  Running in DRY RUN mode - no changes will be made\n');
    }
    
    console.log('📝 Migration script starting...');
    console.log(`Options: forceUpdate=${forceUpdate}, dryRun=${dryRun}\n`);
    
    await migrateCoursesBranchesToSQL(options);
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Script failed:', error);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
};

// Run the migration (similar to other scripts in this project)
console.log('🔧 Script file loaded, executing main function...');
console.log('Usage: node migrateCoursesBranchesToSQL.js [--dry-run] [--no-force]');
console.log('  --dry-run    : Run without making database changes');
console.log('  --no-force   : Skip students that are already synced\n');
main();

export default migrateCoursesBranchesToSQL;

