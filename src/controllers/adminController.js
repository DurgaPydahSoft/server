import User, { COURSES, BRANCHES, ROOM_MAPPINGS } from '../models/User.js';
import TempStudent from '../models/TempStudent.js';
import { createError } from '../utils/error.js';
import { uploadToS3, deleteFromS3 } from '../utils/s3Service.js';
import xlsx from 'xlsx';
import Room from '../models/Room.js';

// Add a new student
export const addStudent = async (req, res, next) => {
  try {
    const {
      name,
      rollNumber,
      gender,
      course,
      year,
      branch,
      category,
      roomNumber,
      studentPhone,
      parentPhone,
      batch,
      academicYear
    } = req.body;

    // Check if student already exists
    const existingStudent = await User.findOne({ rollNumber });
    if (existingStudent) {
      throw createError(400, 'Student with this roll number already exists');
    }

    // Validate room number based on gender and category
    const validRooms = ROOM_MAPPINGS[gender]?.[category] || [];
    if (!validRooms.includes(roomNumber)) {
      throw createError(400, 'Invalid room number for the selected gender and category');
    }

    // Check bed count limit
    const RoomModel = (await import('../models/Room.js')).default;
    const roomDoc = await RoomModel.findOne({ roomNumber, gender, category });
    if (!roomDoc) {
      throw createError(400, 'Room not found');
    }
    const studentCount = await User.countDocuments({ roomNumber, gender, category, role: 'student' });
    if (studentCount >= roomDoc.bedCount) {
      throw createError(400, 'Room is full. Cannot register more students.');
    }

    // Generate random password
    const generatedPassword = User.generateRandomPassword();

    // Handle photo uploads
    let studentPhotoUrl = null;
    let guardianPhoto1Url = null;
    let guardianPhoto2Url = null;

    if (req.files) {
      if (req.files.studentPhoto && req.files.studentPhoto[0]) {
        studentPhotoUrl = await uploadToS3(req.files.studentPhoto[0], 'student-photos');
      }
      if (req.files.guardianPhoto1 && req.files.guardianPhoto1[0]) {
        guardianPhoto1Url = await uploadToS3(req.files.guardianPhoto1[0], 'guardian-photos');
      }
      if (req.files.guardianPhoto2 && req.files.guardianPhoto2[0]) {
        guardianPhoto2Url = await uploadToS3(req.files.guardianPhoto2[0], 'guardian-photos');
      }
    }

    // Create new student
    const student = new User({
      name,
      rollNumber: rollNumber.toUpperCase(),
      password: generatedPassword,
      role: 'student',
      gender,
      course,
      year,
      branch,
      category,
      roomNumber,
      studentPhone,
      parentPhone,
      batch,
      academicYear,
      isPasswordChanged: false,
      studentPhoto: studentPhotoUrl,
      guardianPhoto1: guardianPhoto1Url,
      guardianPhoto2: guardianPhoto2Url
    });

    const savedStudent = await student.save();

    // Create TempStudent record for pending password reset
    const tempStudent = new TempStudent({
      name: savedStudent.name,
      rollNumber: savedStudent.rollNumber,
      studentPhone: savedStudent.studentPhone,
      generatedPassword: generatedPassword,
      isFirstLogin: true,
      mainStudentId: savedStudent._id,
    });
    await tempStudent.save();

    res.json({
      success: true,
      data: {
        student: savedStudent,
        generatedPassword
      }
    });
  } catch (error) {
    next(error);
  }
};

// Add batch validation function
const validateBatch = (batch, course) => {
  // Check if batch matches the format YYYY-YYYY
  if (!/^\d{4}-\d{4}$/.test(batch)) {
    return false;
  }

  const [startYear, endYear] = batch.split('-').map(Number);
  
  // Check if duration matches course
  const duration = endYear - startYear;
  if (course === 'B.Tech' || course === 'Pharmacy') {
    return duration === 4;
  } else if (course === 'Diploma' || course === 'Degree') {
    return duration === 3;
  }

  return false;
};

// Validate academic year
const validateAcademicYear = (year) => {
  if (!/^\d{4}-\d{4}$/.test(year)) return false;
  const [start, end] = year.split('-').map(Number);
  return end === start + 1;
};

// Preview bulk student upload
export const previewBulkUpload = async (req, res, next) => {
  if (!req.file) {
    return next(createError(400, 'No Excel file uploaded.'));
  }

  const results = {
    validStudents: [],
    invalidStudents: [],
    rawData: [], // Add raw data for debugging
  };

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(worksheet);

    if (!jsonData || jsonData.length === 0) {
      return next(createError(400, 'Excel file is empty or data could not be read.'));
    }

    // Debug: Log the first row to see actual column names
    console.log('First row from Excel:', jsonData[0]);
    console.log('Available columns:', Object.keys(jsonData[0]));
    console.log('Total rows:', jsonData.length);

    // For now, just return all data as-is without validation
    for (let i = 0; i < jsonData.length; i++) {
      const row = jsonData[i];
      const rowIndex = i + 2;
      
      // Store raw data for debugging
      results.rawData.push({
        row: rowIndex,
        data: row,
        columnNames: Object.keys(row)
      });

      // For now, treat all rows as valid to see the data
      results.validStudents.push(row);
    }

    res.json({ 
      success: true, 
      data: results,
      debug: {
        totalRows: jsonData.length,
        firstRowColumns: Object.keys(jsonData[0]),
        firstRowData: jsonData[0]
      }
    });

  } catch (error) {
    next(error);
  }
};

// Bulk add new students (now for committing)
export const bulkAddStudents = async (req, res, next) => {
  const { students } = req.body;
  if (!students || !Array.isArray(students)) {
    return next(createError(400, 'A list of students is required.'));
  }

  const results = {
    successCount: 0,
    failureCount: 0,
    addedStudents: [],
    errors: [],
  };

  for (const studentData of students) {
    // Flexible column mapping - handle different possible column names
    const Name = studentData.Name || studentData.name || studentData['Student Name'] || studentData['STUDENT NAME'] || studentData['Full Name'] || studentData['FULL NAME'];
    const RollNumber = studentData.RollNumber || studentData.rollNumber || studentData['Roll Number'] || studentData['ROLL NUMBER'] || studentData['Roll No'] || studentData['ROLL NO'];
    const Gender = studentData.Gender || studentData.gender || studentData['Student Gender'] || studentData['STUDENT GENDER'];
    const Course = studentData.Course || studentData.course || studentData['Program'] || studentData['PROGRAM'] || studentData['Degree'] || studentData['DEGREE'];
    const Branch = studentData.Branch || studentData.branch || studentData['Specialization'] || studentData['SPECIALIZATION'] || studentData['Department'] || studentData['DEPARTMENT'];
    const Year = studentData.Year || studentData.year || studentData['Year of Study'] || studentData['YEAR OF STUDY'] || studentData['Current Year'] || studentData['CURRENT YEAR'];
    const Category = studentData.Category || studentData.category || studentData['Student Category'] || studentData['STUDENT CATEGORY'] || studentData['Fee Category'] || studentData['FEE CATEGORY'];
    const RoomNumber = studentData.RoomNumber || studentData.roomNumber || studentData['Room Number'] || studentData['ROOM NUMBER'] || studentData['Room No'] || studentData['ROOM NO'];
    const StudentPhone = studentData.StudentPhone || studentData.studentPhone || studentData['Student Phone'] || studentData['STUDENT PHONE'] || studentData['Phone'] || studentData['PHONE'];
    const ParentPhone = studentData.ParentPhone || studentData.parentPhone || studentData['Parent Phone'] || studentData['PARENT PHONE'] || studentData['Guardian Phone'] || studentData['GUARDIAN PHONE'];
    const Batch = studentData.Batch || studentData.batch || studentData['Batch Year'] || studentData['BATCH YEAR'] || studentData['Admission Batch'] || studentData['ADMISSION BATCH'];
    const AcademicYear = studentData.AcademicYear || studentData.academicYear || studentData['Academic Year'] || studentData['ACADEMIC YEAR'] || studentData['Current Academic Year'] || studentData['CURRENT ACADEMIC YEAR'];

    try {
      const rollNumberUpper = String(RollNumber).trim().toUpperCase();
      
      // Check for duplicates in both User and TempStudent collections
      const [existingStudent, existingTempStudent] = await Promise.all([
        User.findOne({ rollNumber: rollNumberUpper }),
        TempStudent.findOne({ rollNumber: rollNumberUpper })
      ]);

      if (existingStudent) {
        results.failureCount++;
        results.errors.push({ error: `Student with roll number ${rollNumberUpper} already exists in the main database.`, details: studentData });
        continue;
      }

      if (existingTempStudent) {
        results.failureCount++;
        results.errors.push({ error: `Student with roll number ${rollNumberUpper} already exists in temporary records. Please clear temp students first or use a different roll number.`, details: studentData });
        continue;
      }

      const generatedPassword = User.generateRandomPassword();

      const newStudent = new User({
        name: String(Name).trim(),
        rollNumber: rollNumberUpper,
        password: generatedPassword,
        role: 'student',
        gender: String(Gender).trim(),
        course: String(Course).trim(),
        year: parseInt(Year, 10),
        branch: String(Branch).trim(),
        category: String(Category).trim(),
        roomNumber: String(RoomNumber).trim(),
        studentPhone: String(StudentPhone).trim(),
        parentPhone: String(ParentPhone).trim(),
        batch: String(Batch).trim(),
        academicYear: String(AcademicYear).trim(),
        isPasswordChanged: false,
      });

      const savedStudent = await newStudent.save();

      const tempStudent = new TempStudent({
        name: savedStudent.name,
        rollNumber: savedStudent.rollNumber,
        studentPhone: savedStudent.studentPhone,
        generatedPassword: generatedPassword,
        isFirstLogin: true,
        mainStudentId: savedStudent._id,
      });
      await tempStudent.save();

      results.successCount++;
      results.addedStudents.push({
        name: savedStudent.name,
        rollNumber: savedStudent.rollNumber,
        generatedPassword: generatedPassword,
      });

    } catch (error) {
      results.failureCount++;
      results.errors.push({ error: error.message, details: studentData });
    }
  }

  res.json({
    success: true,
    message: 'Bulk upload process completed.',
    data: results
  });
};

// Get all students with pagination and filters
export const getStudents = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, course, branch, gender, category, roomNumber, batch, academicYear, search } = req.query;
    const query = { role: 'student' };

    // Add filters if provided
    if (course) query.course = course;
    if (branch) query.branch = branch;
    if (gender) query.gender = gender;
    if (category) query.category = category;
    if (roomNumber) query.roomNumber = roomNumber;
    if (batch) query.batch = batch;
    if (academicYear) query.academicYear = academicYear;

    // Add search functionality if search term is provided
    if (search) {
      const searchRegex = new RegExp(search, 'i'); // 'i' for case-insensitive
      query.$or = [
        { name: searchRegex },
        { rollNumber: searchRegex }
      ];
    }

    console.log('Query:', query); // Debug log

    const students = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        students,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        totalStudents: count
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get student by ID
export const getStudentById = async (req, res, next) => {
  try {
    const student = await User.findOne({ _id: req.params.id, role: 'student' })
      .select('-password');
    
    if (!student) {
      throw createError(404, 'Student not found');
    }

    res.json({
      success: true,
      data: student
    });
  } catch (error) {
    next(error);
  }
};

// Update student
export const updateStudent = async (req, res, next) => {
  try {
    const { 
      name, 
      course, 
      year,
      branch, 
      gender,
      category,
      roomNumber, 
      studentPhone, 
      parentPhone,
      batch,
      academicYear
    } = req.body;
    
    const student = await User.findOne({ _id: req.params.id, role: 'student' });
    if (!student) {
      throw createError(404, 'Student not found');
    }

    // Validate gender if provided
    if (gender && !['Male', 'Female'].includes(gender)) {
      throw createError(400, 'Invalid gender. Must be Male or Female.');
    }

    // Validate category based on gender
    if (category) {
      const validCategories = (gender || student.gender) === 'Male' 
        ? ['A+', 'A', 'B+', 'B'] 
        : ['A+', 'A', 'B', 'C'];
      if (!validCategories.includes(category)) {
        throw createError(400, 'Invalid category for the selected gender.');
      }
    }

    // Validate room number based on gender and category
    if (roomNumber) {
      const validRooms = ROOM_MAPPINGS[gender || student.gender]?.[category || student.category] || [];
      if (!validRooms.includes(roomNumber)) {
        throw createError(400, 'Invalid room number for the selected gender and category.');
      }
    }

    // Validate batch format and duration based on course
    if (batch && !validateBatch(batch, course || student.course)) {
      throw createError(400, `Invalid batch format. Must be YYYY-YYYY with correct duration (${(course || student.course) === 'B.Tech' || (course || student.course) === 'Pharmacy' ? '4' : '3'} years).`);
    }

    // Validate academic year
    if (academicYear && !validateAcademicYear(academicYear)) {
      throw createError(400, 'Invalid Academic Year format. Must be YYYY-YYYY with a 1-year difference.');
    }

    // Validate phone numbers
    if (studentPhone && !/^[0-9]{10}$/.test(studentPhone)) {
      throw createError(400, 'Student phone number must be 10 digits.');
    }
    if (parentPhone && !/^[0-9]{10}$/.test(parentPhone)) {
      throw createError(400, 'Parent phone number must be 10 digits.');
    }

    // Handle photo uploads
    if (req.files) {
      if (req.files.studentPhoto && req.files.studentPhoto[0]) {
        // Delete old photo if exists
        if (student.studentPhoto) {
          try {
            await deleteFromS3(student.studentPhoto);
          } catch (error) {
            console.error('Error deleting old student photo:', error);
          }
        }
        // Upload new photo
        student.studentPhoto = await uploadToS3(req.files.studentPhoto[0], 'student-photos');
      }
      if (req.files.guardianPhoto1 && req.files.guardianPhoto1[0]) {
        // Delete old photo if exists
        if (student.guardianPhoto1) {
          try {
            await deleteFromS3(student.guardianPhoto1);
          } catch (error) {
            console.error('Error deleting old guardian photo 1:', error);
          }
        }
        // Upload new photo
        student.guardianPhoto1 = await uploadToS3(req.files.guardianPhoto1[0], 'guardian-photos');
      }
      if (req.files.guardianPhoto2 && req.files.guardianPhoto2[0]) {
        // Delete old photo if exists
        if (student.guardianPhoto2) {
          try {
            await deleteFromS3(student.guardianPhoto2);
          } catch (error) {
            console.error('Error deleting old guardian photo 2:', error);
          }
        }
        // Upload new photo
        student.guardianPhoto2 = await uploadToS3(req.files.guardianPhoto2[0], 'guardian-photos');
      }
    }

    // Update fields
    if (name) student.name = name;
    if (course) student.course = course;
    if (year) student.year = year;
    if (branch) student.branch = branch;
    if (gender) student.gender = gender;
    if (category) student.category = category;
    if (roomNumber) student.roomNumber = roomNumber;
    if (studentPhone) student.studentPhone = studentPhone;
    if (parentPhone) student.parentPhone = parentPhone;
    if (batch) student.batch = batch;
    if (academicYear) student.academicYear = academicYear;

    await student.save();

    res.json({
      success: true,
      data: {
        student: {
          id: student._id,
          name: student.name,
          rollNumber: student.rollNumber,
          gender: student.gender,
          course: student.course,
          year: student.year,
          branch: student.branch,
          category: student.category,
          roomNumber: student.roomNumber,
          studentPhone: student.studentPhone,
          parentPhone: student.parentPhone,
          batch: student.batch,
          academicYear: student.academicYear,
          studentPhoto: student.studentPhoto,
          guardianPhoto1: student.guardianPhoto1,
          guardianPhoto2: student.guardianPhoto2
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Delete student
export const deleteStudent = async (req, res, next) => {
  try {
    const student = await User.findOne({ _id: req.params.id, role: 'student' });
    
    if (!student) {
      throw createError(404, 'Student not found');
    }

    // Delete photos from S3
    const photosToDelete = [student.studentPhoto, student.guardianPhoto1, student.guardianPhoto2].filter(Boolean);
    
    for (const photoUrl of photosToDelete) {
      try {
        await deleteFromS3(photoUrl);
      } catch (error) {
        console.error('Error deleting photo from S3:', error);
      }
    }

    // Delete the student
    await User.findByIdAndDelete(req.params.id);

    // Also delete the corresponding TempStudent record
    await TempStudent.deleteOne({ mainStudentId: student._id });

    res.json({
      success: true,
      message: 'Student deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Get branches by course
export const getBranchesByCourse = async (req, res, next) => {
  try {
    const { course } = req.params;
    
    if (!COURSES[course.toUpperCase()]) {
      throw createError(400, 'Invalid course');
    }

    const branches = BRANCHES[course.toUpperCase()];
    
    res.json({
      success: true,
      data: branches
    });
  } catch (error) {
    next(error);
  }
};

// Get temporary students summary for admin dashboard
export const getTempStudentsSummary = async (req, res, next) => {
  try {
    // Get all students who haven't changed their password
    const studentsWithTempRecords = await User.find({ 
      role: 'student',
      isPasswordChanged: false 
    }).select('_id');

    // Get temp student records only for students who haven't changed their password
    const tempStudents = await TempStudent.find({
      mainStudentId: { $in: studentsWithTempRecords.map(s => s._id) }
    })
    .select('name rollNumber studentPhone generatedPassword createdAt')
    .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: tempStudents,
    });
  } catch (error) {
    console.error('Error fetching temporary students summary:', error);
    next(createError(500, 'Failed to fetch temporary student summary.'));
  }
};

// Get total student count for admin dashboard
export const getStudentsCount = async (req, res, next) => {
  try {
    const totalStudents = await User.countDocuments({ role: 'student' });
    res.status(200).json({
      success: true,
      data: {
        count: totalStudents,
      },
    });
  } catch (error) {
    console.error('Error fetching total student count:', error);
    next(createError(500, 'Failed to fetch total student count.'));
  }
};

// Add electricity bill for a room
export const addElectricityBill = async (req, res, next) => {
  try {
    const { roomId } = req.params;
    const { month, startUnits, endUnits, rate } = req.body;

    // Validate input
    if (!month || !startUnits || !endUnits) {
      throw createError(400, 'Month, startUnits, and endUnits are required');
    }

    if (endUnits < startUnits) {
      throw createError(400, 'End units cannot be less than start units');
    }

    // Parse rate as number if provided
    let billRate = Room.defaultElectricityRate;
    if (rate !== undefined && rate !== null && rate !== '') {
      const parsedRate = Number(rate);
      if (!isNaN(parsedRate)) {
        billRate = parsedRate;
        if (parsedRate !== Room.defaultElectricityRate) {
          Room.setDefaultElectricityRate(parsedRate);
        }
      }
    }

    const consumption = endUnits - startUnits;
    const total = consumption * billRate;

    const room = await Room.findById(roomId);
    if (!room) {
      throw createError(404, 'Room not found');
    }

    // Check if bill for this month already exists
    const existingBill = room.electricityBills.find(bill => bill.month === month);
    if (existingBill) {
      throw createError(400, 'Bill for this month already exists');
    }

    // Add new bill
    room.electricityBills.push({
      month,
      startUnits,
      endUnits,
      rate: billRate,
      total
    });

    await room.save();

    res.json({
      success: true,
      data: room.electricityBills[room.electricityBills.length - 1]
    });
  } catch (error) {
    next(error);
  }
};

// Get electricity bills for a room
export const getElectricityBills = async (req, res, next) => {
  try {
    const { roomId } = req.params;

    const room = await Room.findById(roomId);
    if (!room) {
      throw createError(404, 'Room not found');
    }

    // Sort bills by month in descending order
    const sortedBills = room.electricityBills.sort((a, b) => b.month.localeCompare(a.month));

    res.json({
      success: true,
      data: sortedBills
    });
  } catch (error) {
    next(error);
  }
};

// Batch Renewal
export const renewBatches = async (req, res, next) => {
  try {
    const { fromAcademicYear, toAcademicYear, studentIds } = req.body;

    if (!fromAcademicYear || !toAcademicYear || !studentIds) {
      throw createError(400, 'Academic years and a list of student IDs are required.');
    }
    if (!Array.isArray(studentIds)) {
      throw createError(400, 'studentIds must be an array.');
    }

    if (!validateAcademicYear(fromAcademicYear) || !validateAcademicYear(toAcademicYear)) {
      throw createError(400, 'Invalid academic year format.');
    }

    const [fromStart] = fromAcademicYear.split('-').map(Number);
    const [toStart] = toAcademicYear.split('-').map(Number);

    if (toStart <= fromStart) {
      throw createError(400, '"To" academic year must be after "From" academic year.');
    }

    // Find all students in the 'from' academic year to know who to deactivate
    const allStudentsInYear = await User.find({ academicYear: fromAcademicYear, role: 'student' });
    const allStudentIdsInYear = allStudentsInYear.map(s => s._id.toString());

    // Determine who was unchecked
    const uncheckedStudentIds = allStudentIdsInYear.filter(id => !studentIds.includes(id));

    let renewedCount = 0;
    let graduatedCount = 0;
    let deactivatedCount = 0;
    const errors = [];

    // Renew selected students
    for (const studentId of studentIds) {
      try {
        const student = await User.findById(studentId);
        if (!student) {
          errors.push({ id: studentId, error: 'Student not found.' });
          continue;
        }

        const courseKey = Object.keys(COURSES).find(key => COURSES[key] === student.course);
        const maxYear = (courseKey === 'BTECH' || courseKey === 'PHARMACY') ? 4 : 3;
        
        if (student.year >= maxYear) {
          graduatedCount++;
          student.hostelStatus = 'Inactive'; // Mark as inactive upon graduation
          await student.save();
          continue;
        }

        student.year += 1;
        student.academicYear = toAcademicYear;
        await student.save();
        renewedCount++;
      } catch (error) {
        errors.push({ id: studentId, error: error.message });
      }
    }

    // Deactivate unselected students
    for (const studentId of uncheckedStudentIds) {
      try {
        await User.findByIdAndUpdate(studentId, { hostelStatus: 'Inactive' });
        deactivatedCount++;
      } catch (error) {
        errors.push({ id: studentId, error: `Failed to deactivate: ${error.message}` });
      }
    }

    res.json({
      success: true,
      message: 'Batch renewal process completed.',
      data: {
        renewedCount,
        graduatedCount,
        deactivatedCount,
        errors,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Clear all temporary students
export const clearTempStudents = async (req, res, next) => {
  try {
    const result = await TempStudent.deleteMany({});
    
    res.json({
      success: true,
      message: `Cleared ${result.deletedCount} temporary student records.`,
      data: { deletedCount: result.deletedCount }
    });
  } catch (error) {
    next(error);
  }
};

// Search student by Roll Number for Security
export const searchStudentByRollNumber = async (req, res, next) => {
  try {
    const { rollNumber } = req.params;
    if (!rollNumber) {
      return next(createError(400, 'Roll number is required.'));
    }

    const student = await User.findOne({ rollNumber: new RegExp(`^${rollNumber}$`, 'i'), role: 'student' })
      .select('-password');

    if (!student) {
      return next(createError(404, 'Student with this roll number not found.'));
    }
    
    res.status(200).json({
      success: true,
      data: student
    });
  } catch (error) {
    next(error);
  }
}; 