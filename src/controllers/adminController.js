import User, { COURSES, BRANCHES, ROOM_MAPPINGS } from '../models/User.js';
import TempStudent from '../models/TempStudent.js';
import { createError } from '../utils/error.js';
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
      batch
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
      isPasswordChanged: false
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

// Bulk add new students
export const bulkAddStudents = async (req, res, next) => {
  if (!req.file) {
    return next(createError(400, 'No Excel file uploaded.'));
  }

  const results = {
    successCount: 0,
    failureCount: 0,
    addedStudents: [],
    errors: [],
  };

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(worksheet);

    if (!jsonData || jsonData.length === 0) {
      return next(createError(400, 'Excel file is empty or data could not be read.'));
    }

    for (let i = 0; i < jsonData.length; i++) {
      const row = jsonData[i];
      const rowIndex = i + 2; // For user-friendly error reporting (1-based index + header row)

      const {
        Name,
        RollNumber,
        Gender,
        Course,
        Branch,
        Year,
        Category,
        RoomNumber,
        StudentPhone,
        ParentPhone,
        Batch
      } = row;

      // Basic validation
      if (!Name || !RollNumber || !Gender || !Course || !Branch || !Year || !Category || !RoomNumber || !StudentPhone || !ParentPhone || !Batch) {
        results.failureCount++;
        results.errors.push({ row: rowIndex, error: 'Missing one or more required fields.', details: row });
        continue;
      }

      // Validate gender
      if (!['Male', 'Female'].includes(Gender)) {
        results.failureCount++;
        results.errors.push({ row: rowIndex, error: 'Invalid gender. Must be Male or Female.', details: row });
        continue;
      }

      // Validate category based on gender
      const validCategories = Gender === 'Male' ? ['A+', 'A', 'B+', 'B'] : ['A+', 'A', 'B', 'C'];
      if (!validCategories.includes(Category)) {
        results.failureCount++;
        results.errors.push({ row: rowIndex, error: 'Invalid category for the selected gender.', details: row });
        continue;
      }

      // Validate room number
      const validRooms = ROOM_MAPPINGS[Gender]?.[Category] || [];
      if (!validRooms.includes(RoomNumber)) {
        results.failureCount++;
        results.errors.push({ row: rowIndex, error: 'Invalid room number for the selected gender and category.', details: row });
        continue;
      }

      // Validate batch format and duration based on course
      if (!validateBatch(Batch, Course)) {
        results.failureCount++;
        results.errors.push({ 
          row: rowIndex, 
          error: `Invalid batch format for ${Course}. Must be YYYY-YYYY with correct duration (${Course === 'B.Tech' || Course === 'Pharmacy' ? '4' : '3'} years).`, 
          details: row 
        });
        continue;
      }

      try {
        const rollNumberUpper = RollNumber.toString().trim().toUpperCase();
        const existingStudent = await User.findOne({ rollNumber: rollNumberUpper });
        if (existingStudent) {
          results.failureCount++;
          results.errors.push({ row: rowIndex, error: 'Student with this roll number already exists.', details: row });
          continue;
        }

        const generatedPassword = User.generateRandomPassword();

        const newStudent = new User({
          name: Name.toString().trim(),
          rollNumber: rollNumberUpper,
          password: generatedPassword,
          role: 'student',
          gender: Gender.toString().trim(),
          course: Course.toString().trim(),
          year: parseInt(Year, 10),
          branch: Branch.toString().trim(),
          category: Category.toString().trim(),
          roomNumber: RoomNumber.toString().trim(),
          studentPhone: StudentPhone.toString().trim(),
          parentPhone: ParentPhone.toString().trim(),
          batch: Batch.toString().trim(),
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
        results.errors.push({ row: rowIndex, error: error.message, details: row });
      }
    }

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    next(error);
  }
};

// Get all students with pagination and filters
export const getStudents = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, course, branch, gender, category, roomNumber, batch, search } = req.query;
    const query = { role: 'student' };

    // Add filters if provided
    if (course) query.course = course;
    if (branch) query.branch = branch;
    if (gender) query.gender = gender;
    if (category) query.category = category;
    if (roomNumber) query.roomNumber = roomNumber;
    if (batch) query.batch = batch;

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
      batch 
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

    // Validate phone numbers
    if (studentPhone && !/^[0-9]{10}$/.test(studentPhone)) {
      throw createError(400, 'Student phone number must be 10 digits.');
    }
    if (parentPhone && !/^[0-9]{10}$/.test(parentPhone)) {
      throw createError(400, 'Parent phone number must be 10 digits.');
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
          batch: student.batch
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
    const student = await User.findOneAndDelete({ _id: req.params.id, role: 'student' });
    
    if (!student) {
      throw createError(404, 'Student not found');
    }

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