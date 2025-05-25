import User from '../models/User.js';
import XLSX from 'xlsx';
import fs from 'fs';

// Upload students via Excel
export const uploadStudents = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);
    let added = 0, skipped = 0;
    for (const row of data) {
      const {
        Name, RollNumber, Degree, Branch, Year, RoomNumber, StudentPhone, ParentPhone
      } = row;
      if (!Name || !RollNumber) { skipped++; continue; }
      const exists = await User.findOne({ rollNumber: RollNumber });
      if (exists) { skipped++; continue; }
      await User.create({
        name: Name,
        rollNumber: RollNumber,
        degree: Degree,
        branch: Branch,
        year: Year,
        roomNumber: RoomNumber,
        studentPhone: StudentPhone,
        parentPhone: ParentPhone,
        password: 'changeme',
        role: 'student',
        isRegistered: false
      });
      added++;
    }
    fs.unlinkSync(req.file.path);
    res.json({ message: `Added: ${added}, Skipped: ${skipped}` });
  } catch (error) {
    res.status(500).json({ message: 'Error uploading students', error });
  }
};

// Manual add student
export const addStudent = async (req, res) => {
  try {
    const { name, rollNumber, degree, branch, year, roomNumber, studentPhone, parentPhone } = req.body;
    if (await User.findOne({ rollNumber })) {
      return res.status(400).json({ message: 'Student already exists' });
    }
    const student = await User.create({
      name, rollNumber, degree, branch, year, roomNumber, studentPhone, parentPhone,
      password: 'changeme', role: 'student', isRegistered: false
    });
    res.json(student);
  } catch (error) {
    res.status(500).json({ message: 'Error adding student', error });
  }
};

// List all students
export const listStudents = async (req, res) => {
  try {
    const students = await User.find({ role: 'student' }).select('-password');
    res.json(students);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching students', error });
  }
};

// Edit student
export const editStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const update = req.body;
    delete update.password;
    const student = await User.findByIdAndUpdate(id, update, { new: true }).select('-password');
    if (!student) return res.status(404).json({ message: 'Student not found' });
    res.json(student);
  } catch (error) {
    res.status(500).json({ message: 'Error editing student', error });
  }
};

// Delete student
export const deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const student = await User.findByIdAndDelete(id);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    res.json({ message: 'Student deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting student', error });
  }
}; 

export const updateProfile = async (req, res) => {
  try {
    const { year } = req.body;
    const studentId = req.user.id;

    if (!year) {
      return res.status(400).json({
        success: false,
        message: 'Year is required'
      });
    }

    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Validate year based on course
    const maxYear = student.degree === 'B.Tech' || student.degree === 'Pharmacy' ? 4 : 3;
    if (year < 1 || year > maxYear) {
      return res.status(400).json({
        success: false,
        message: `Invalid year. Must be between 1 and ${maxYear} for ${student.degree}`
      });
    }

    student.year = year;
    await student.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: student
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile'
    });
  }
}; 