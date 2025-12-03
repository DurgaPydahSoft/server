import Payment from '../models/Payment.js';
import User from '../models/User.js';
import FeeStructure from '../models/FeeStructure.js';
import xlsx from 'xlsx';
import { createError } from '../utils/error.js';

// Helper function to parse dates from various formats
const parseDate = (dateValue) => {
  if (!dateValue) return null;
  
  // If it's already a Date object
  if (dateValue instanceof Date) {
    return isNaN(dateValue.getTime()) ? null : dateValue;
  }
  
  // If it's a number (Excel serial date)
  if (typeof dateValue === 'number') {
    // Excel serial date: days since January 1, 1900 (where 1 = Jan 1, 1900)
    // Direct conversion: Excel serial date N = Jan 1, 1900 + (N - 1) days
    // JavaScript Date(1900, 0, 1) = January 1, 1900
    const excelEpoch = new Date(1900, 0, 1); // January 1, 1900
    const date = new Date(excelEpoch.getTime() + (dateValue - 1) * 24 * 60 * 60 * 1000);
    
    // Validate the date is reasonable (between 1900 and 2100)
    if (!isNaN(date.getTime()) && date.getFullYear() >= 1900 && date.getFullYear() <= 2100) {
      return date;
    }
    return null;
  }
  
  const dateStr = String(dateValue).trim();
  
  // Try DD/MM/YYYY format (most common in Indian Excel files)
  const ddmmyyyyMatch = dateStr.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (ddmmyyyyMatch) {
    const [, day, month, year] = ddmmyyyyMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  
  // Try MM/DD/YYYY format (US format)
  const mmddyyyyMatch = dateStr.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (mmddyyyyMatch) {
    const [, month, day, year] = mmddyyyyMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  
  // Try YYYY-MM-DD format (ISO format)
  const yyyymmddMatch = dateStr.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (yyyymmddMatch) {
    const [, year, month, day] = yyyymmddMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  
  // Try DD-MM-YYYY format (with dashes)
  const ddmmyyyyDashMatch = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (ddmmyyyyDashMatch) {
    const [, day, month, year] = ddmmyyyyDashMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  
  // Try parsing as number (might be Excel serial date as string)
  const numericValue = parseFloat(dateStr);
  if (!isNaN(numericValue) && numericValue > 0 && numericValue < 100000) {
    // Likely an Excel serial date stored as string
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + (numericValue + 1) * 24 * 60 * 60 * 1000);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  
  // Try standard Date parsing (handles ISO strings and other formats)
  const date = new Date(dateValue);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  return null;
};

// Helper function to get UTR number - generate default for online payments if missing
const getUTRNumber = (paymentMethod, utrNumber, receiptNumber, transactionId) => {
  // If UTR is provided, use it
  if (utrNumber && String(utrNumber).trim()) {
    return String(utrNumber).trim();
  }
  
  // For online payments, generate a default UTR if not provided (required by schema)
  if (paymentMethod === 'Online') {
    // Use transaction ID as primary fallback, then receipt number, then generate unique one
    if (transactionId && String(transactionId).trim()) {
      return String(transactionId).trim();
    }
    if (receiptNumber && String(receiptNumber).trim()) {
      return String(receiptNumber).trim();
    }
    // Generate a unique UTR for past payment uploads
    return `UTR_UPLOAD_${Date.now()}_${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
  }
  
  // For cash payments, UTR is not required
  return null;
};

// Preview past payment upload from Excel
export const previewPastPayments = async (req, res, next) => {
  if (!req.file) {
    return next(createError(400, 'No Excel file uploaded.'));
  }

  const results = {
    validPayments: [],
    invalidPayments: [],
    summary: {
      totalRows: 0,
      validCount: 0,
      invalidCount: 0
    }
  };

  try {
    // Read Excel with date handling enabled
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    // Use raw: false to get formatted date strings, or raw: true to get serial numbers
    const jsonData = xlsx.utils.sheet_to_json(worksheet, { raw: true, defval: null });

    if (!jsonData || jsonData.length === 0) {
      return next(createError(400, 'Excel file is empty or data could not be read.'));
    }

    results.summary.totalRows = jsonData.length;

    console.log('First row from Excel:', jsonData[0]);
    console.log('Available columns:', Object.keys(jsonData[0]));
    // Debug: Check date column format
    const firstDateValue = jsonData[0]?.TransDate || jsonData[0]?.transDate || jsonData[0]?.['TransDate'];
    if (firstDateValue) {
      console.log('🔍 First date value:', firstDateValue, 'Type:', typeof firstDateValue);
    }

    // OPTIMIZATION: Batch load all unique roll numbers
    const uniqueRollNumbers = new Set();
    const receiptNumbers = new Set();
    const transactionIds = new Set();
    
    for (let i = 0; i < jsonData.length; i++) {
      const row = jsonData[i];
      const RollNumber = row.AdmnNo || row.admnNo || row['AdmnNo'] || row['ADMNO'] || row['Admission No'] || row['ADMISSION NO'] ||
                        row.RollNumber || row.rollNumber || row['Roll Number'] || row['ROLL NUMBER'] || row['Roll No'] || row['ROLL NO'];
      const ReceiptNumber = row.RecNo || row.recNo || row['RecNo'] || row['RECNO'] || row['Receipt Number'] || row['RECEIPT NUMBER'] ||
                           row.ReceiptNumber || row.receiptNumber || row['Receipt No'] || row['RECEIPT NO'];
      const TransactionId = row.TransactionId || row.transactionId || row['Transaction ID'] || row['TRANSACTION ID'] || row['Transaction Number'] || row['TRANSACTION NUMBER'];
      
      if (RollNumber) {
        uniqueRollNumbers.add(String(RollNumber).trim().toUpperCase());
      }
      if (ReceiptNumber) {
        receiptNumbers.add(String(ReceiptNumber).trim());
      }
      if (TransactionId) {
        transactionIds.add(String(TransactionId).trim());
      }
    }

    // Batch load all students at once
    const studentsMap = new Map();
    if (uniqueRollNumbers.size > 0) {
      const students = await User.find({
        rollNumber: { $in: Array.from(uniqueRollNumbers) },
        role: 'student'
      });
      students.forEach(student => {
        studentsMap.set(student.rollNumber.toUpperCase(), student);
      });
    }

    // Batch load existing receipt numbers
    const existingReceipts = new Set();
    if (receiptNumbers.size > 0) {
      const receipts = await Payment.find({
        receiptNumber: { $in: Array.from(receiptNumbers) }
      }).select('receiptNumber');
      receipts.forEach(payment => {
        existingReceipts.add(payment.receiptNumber);
      });
    }

    // Batch load existing transaction IDs
    const existingTransactionIds = new Set();
    if (transactionIds.size > 0) {
      const transactions = await Payment.find({
        transactionId: { $in: Array.from(transactionIds) }
      }).select('transactionId');
      transactions.forEach(payment => {
        existingTransactionIds.add(payment.transactionId);
      });
    }

    // Cache for fee structures to avoid repeated queries
    const feeStructureCache = new Map();

    for (let i = 0; i < jsonData.length; i++) {
      const row = jsonData[i];
      const rowIndex = i + 2; // Excel row number (accounting for header)

      // Flexible column mapping - support both standard and actual Excel format
      const RollNumber = row.AdmnNo || row.admnNo || row['AdmnNo'] || row['ADMNO'] || row['Admission No'] || row['ADMISSION NO'] ||
                        row.RollNumber || row.rollNumber || row['Roll Number'] || row['ROLL NUMBER'] || row['Roll No'] || row['ROLL NO'];
      const Amount = row.Amount || row.amount || row['Payment Amount'] || row['PAYMENT AMOUNT'] || row['Amount Paid'] || row['AMOUNT PAID'];
      const PaymentMode = row.PayMode || row.payMode || row['PayMode'] || row['PAYMODE'] || row['Payment Mode'] || row['PAYMENT MODE'] ||
                         row.PaymentMode || row.paymentMode || row['Mode'] || row['MODE'] || '';
      const PaymentMethod = row.PaymentMethod || row.paymentMethod || row['Payment Method'] || row['PAYMENT METHOD'] || row['Method'] || row['METHOD'] || '';
      const PaymentDate = row.TransDate || row.transDate || row['TransDate'] || row['TRANSDATE'] || row['Transaction Date'] || row['TRANSACTION DATE'] ||
                         row.PaymentDate || row.paymentDate || row['Payment Date'] || row['PAYMENT DATE'] || row['Date'] || row['DATE'];
      const AcademicYear = row.AcademicYear || row.academicYear || row['Academic Year'] || row['ACADEMIC YEAR'] || row['Year'] || row['YEAR'];
      const Term = row.Term || row.term || row['Term'] || row['TERM'] || row['Fee Term'] || row['FEE TERM'];
      const ReceiptNumber = row.RecNo || row.recNo || row['RecNo'] || row['RECNO'] || row['Receipt Number'] || row['RECEIPT NUMBER'] ||
                           row.ReceiptNumber || row.receiptNumber || row['Receipt No'] || row['RECEIPT NO'];
      const TransactionId = row.TransactionId || row.transactionId || row['Transaction ID'] || row['TRANSACTION ID'] || row['Transaction Number'] || row['TRANSACTION NUMBER'];
      const UTRNumber = row.UTRNumber || row.utrNumber || row['UTR Number'] || row['UTR NUMBER'] || row['UTR'] || row['UTR No'] || row['UTR NO'];
      const Notes = row.Notes || row.notes || row['Notes'] || row['NOTES'] || row['Remarks'] || row['REMARKS'] || '';

      const errors = {};
      const warnings = {};

      // Validate required fields
      if (!RollNumber) {
        errors.RollNumber = 'Roll number is required.';
      } else {
        // Normalize roll number (uppercase, trim)
        const normalizedRollNumber = String(RollNumber).trim().toUpperCase();
        if (!/^[A-Z0-9]+$/.test(normalizedRollNumber)) {
          errors.RollNumber = 'Invalid roll number format. Must be alphanumeric.';
        }
      }

      if (!Amount) {
        errors.Amount = 'Amount is required.';
      } else {
        const amountValue = parseFloat(Amount);
        if (isNaN(amountValue) || amountValue <= 0) {
          errors.Amount = 'Amount must be a positive number.';
        } else if (amountValue % 1 !== 0 && amountValue.toString().split('.')[1]?.length > 2) {
          errors.Amount = 'Amount cannot have more than 2 decimal places.';
        }
      }

      // Payment method - check Payment Mode first, then Payment Method, default to 'Cash'
      let normalizedPaymentMethod = 'Cash';
      
      // First check Payment Mode column (if "bank" then "Online", otherwise "Cash")
      if (PaymentMode) {
        const normalizedMode = String(PaymentMode).trim().toLowerCase();
        if (normalizedMode === 'bank') {
          normalizedPaymentMethod = 'Online';
        } else {
          normalizedPaymentMethod = 'Cash';
        }
      } else if (PaymentMethod) {
        // If Payment Mode not found, check Payment Method column
        const normalizedMethod = String(PaymentMethod).trim();
        const validMethods = ['Cash', 'Online', 'card', 'upi', 'netbanking', 'wallet', 'other'];
        if (validMethods.some(m => m.toLowerCase() === normalizedMethod.toLowerCase())) {
          normalizedPaymentMethod = normalizedMethod;
        } else {
          warnings.PaymentMethod = `Payment method "${normalizedMethod}" not recognized. Defaulting to "Cash".`;
        }
      }

      // Payment date - parse from various formats
      let paymentDateValue = null;
      if (!PaymentDate) {
        errors.PaymentDate = 'Payment date is required.';
      } else {
        paymentDateValue = parseDate(PaymentDate);
        if (!paymentDateValue) {
          errors.PaymentDate = 'Invalid date format. Expected DD/MM/YYYY or valid date.';
        } else if (paymentDateValue > new Date()) {
          warnings.PaymentDate = 'Payment date is in the future.';
        }
      }

      // Academic year - try to infer from payment date if not provided
      let academicYearStr = null;
      if (!AcademicYear) {
        if (paymentDateValue) {
          // Infer academic year from payment date
          const paymentYear = paymentDateValue.getFullYear();
          const paymentMonth = paymentDateValue.getMonth() + 1; // 1-12
          
          // Academic year typically starts in June/July
          // If payment is before June, it's for previous academic year
          if (paymentMonth < 6) {
            academicYearStr = `${paymentYear - 1}-${paymentYear}`;
          } else {
            academicYearStr = `${paymentYear}-${paymentYear + 1}`;
          }
          warnings.AcademicYear = `Academic year inferred from payment date: ${academicYearStr}`;
        } else {
          errors.AcademicYear = 'Academic year is required.';
        }
      } else {
        academicYearStr = String(AcademicYear).trim();
        if (!/^\d{4}-\d{4}$/.test(academicYearStr)) {
          errors.AcademicYear = 'Academic year must be in YYYY-YYYY format (e.g., 2024-2025).';
        }
      }

      // Validate term if provided
      if (Term) {
        const normalizedTerm = String(Term).trim().toLowerCase().replace(/\s+/g, '');
        const validTerms = ['term1', 'term2', 'term3', '1', '2', '3'];
        if (!validTerms.some(t => t === normalizedTerm)) {
          errors.Term = 'Invalid term. Must be term1, term2, or term3.';
        }
      }

      // Validate UTR for online payments
      if (PaymentMethod && String(PaymentMethod).trim().toLowerCase() === 'online' && !UTRNumber) {
        warnings.UTRNumber = 'UTR number is recommended for online payments.';
      }

      // Check if student exists (only if roll number is valid) - use cached map
      let student = null;
      if (!errors.RollNumber && RollNumber) {
        const normalizedRollNumber = String(RollNumber).trim().toUpperCase();
        student = studentsMap.get(normalizedRollNumber);
        if (!student) {
          errors.RollNumber = `Student with roll number "${normalizedRollNumber}" not found.`;
        } else if (student.hostelStatus !== 'Active') {
          warnings.StudentStatus = `Student is not active in hostel (Status: ${student.hostelStatus}).`;
        }
      }

      // Check if fee structure exists for student - use cache
      if (student && !errors.AcademicYear && academicYearStr) {
        const cacheKey = `${academicYearStr}_${student.course}_${student.year}_${student.category}`;
        let feeStructure = feeStructureCache.get(cacheKey);
        
        if (!feeStructure) {
          feeStructure = await FeeStructure.getFeeStructure(
            academicYearStr,
            student.course,
            student.year,
            student.category
          );
          feeStructureCache.set(cacheKey, feeStructure);
        }
        
        if (!feeStructure) {
          warnings.FeeStructure = 'Fee structure not found for this student. Payment will still be recorded.';
        }
      }

      // Check for duplicate receipt/transaction IDs - use cached sets
      if (ReceiptNumber) {
        const receiptNum = String(ReceiptNumber).trim();
        if (existingReceipts.has(receiptNum)) {
          warnings.ReceiptNumber = 'Receipt number already exists in system.';
        }
      }

      if (TransactionId) {
        const transId = String(TransactionId).trim();
        if (existingTransactionIds.has(transId)) {
          warnings.TransactionId = 'Transaction ID already exists in system.';
        }
      }

      const paymentData = {
        rowIndex,
        rollNumber: RollNumber ? String(RollNumber).trim().toUpperCase() : '',
        amount: Amount ? parseFloat(Amount) : null,
        paymentMethod: normalizedPaymentMethod,
        paymentDate: paymentDateValue,
        academicYear: academicYearStr,
        term: Term ? String(Term).trim().toLowerCase().replace(/\s+/g, '') : null,
        receiptNumber: ReceiptNumber ? String(ReceiptNumber).trim() : null,
        transactionId: TransactionId ? String(TransactionId).trim() : null,
        utrNumber: UTRNumber ? String(UTRNumber).trim() : null,
        notes: Notes ? String(Notes).trim() : '',
        student: student ? {
          _id: student._id,
          name: student.name,
          course: student.course,
          year: student.year,
          category: student.category
        } : null,
        errors: Object.keys(errors).length > 0 ? errors : null,
        warnings: Object.keys(warnings).length > 0 ? warnings : null
      };

      if (Object.keys(errors).length > 0) {
        results.invalidPayments.push(paymentData);
        results.summary.invalidCount++;
      } else {
        results.validPayments.push(paymentData);
        results.summary.validCount++;
      }
    }

    res.json({
      success: true,
      data: results
    });

  } catch (error) {
    console.error('Error previewing past payments:', error);
    return next(createError(500, 'Failed to process Excel file: ' + error.message));
  }
};

// Upload past payments from Excel
export const uploadPastPayments = async (req, res, next) => {
  if (!req.file) {
    return next(createError(400, 'No Excel file uploaded.'));
  }

  const results = {
    successful: [],
    failed: [],
    summary: {
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
      totalAmount: 0
    }
  };

  try {
    // Read Excel with date handling enabled
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    // Use raw: true to get serial numbers for dates, which we'll parse
    const jsonData = xlsx.utils.sheet_to_json(worksheet, { raw: true, defval: null });

    if (!jsonData || jsonData.length === 0) {
      return next(createError(400, 'Excel file is empty or data could not be read.'));
    }

    results.summary.totalProcessed = jsonData.length;

    for (let i = 0; i < jsonData.length; i++) {
      const row = jsonData[i];
      const rowIndex = i + 2;

      // Extract data (same as preview) - declare outside try block for error handling
      const RollNumber = row.AdmnNo || row.admnNo || row['AdmnNo'] || row['ADMNO'] || row['Admission No'] || row['ADMISSION NO'] ||
                        row.RollNumber || row.rollNumber || row['Roll Number'] || row['ROLL NUMBER'] || row['Roll No'] || row['ROLL NO'];
      const Amount = row.Amount || row.amount || row['Payment Amount'] || row['PAYMENT AMOUNT'] || row['Amount Paid'] || row['AMOUNT PAID'];
      const PaymentMode = row.PayMode || row.payMode || row['PayMode'] || row['PAYMODE'] || row['Payment Mode'] || row['PAYMENT MODE'] ||
                         row.PaymentMode || row.paymentMode || row['Mode'] || row['MODE'] || '';
      const PaymentMethod = row.PaymentMethod || row.paymentMethod || row['Payment Method'] || row['PAYMENT METHOD'] || row['Method'] || row['METHOD'] || '';
      const PaymentDate = row.TransDate || row.transDate || row['TransDate'] || row['TRANSDATE'] || row['Transaction Date'] || row['TRANSACTION DATE'] ||
                         row.PaymentDate || row.paymentDate || row['Payment Date'] || row['PAYMENT DATE'] || row['Date'] || row['DATE'];
      const AcademicYear = row.AcademicYear || row.academicYear || row['Academic Year'] || row['ACADEMIC YEAR'] || row['Year'] || row['YEAR'];
      const Term = row.Term || row.term || row['Term'] || row['TERM'] || row['Fee Term'] || row['FEE TERM'];
      const ReceiptNumber = row.RecNo || row.recNo || row['RecNo'] || row['RECNO'] || row['Receipt Number'] || row['RECEIPT NUMBER'] ||
                           row.ReceiptNumber || row.receiptNumber || row['Receipt No'] || row['RECEIPT NO'];
      const TransactionId = row.TransactionId || row.transactionId || row['Transaction ID'] || row['TRANSACTION ID'] || row['Transaction Number'] || row['TRANSACTION NUMBER'];
      const UTRNumber = row.UTRNumber || row.utrNumber || row['UTR Number'] || row['UTR NUMBER'] || row['UTR'] || row['UTR No'] || row['UTR NO'];
      const Notes = row.Notes || row.notes || row['Notes'] || row['NOTES'] || row['Remarks'] || row['REMARKS'] || '';

      try {

        // Validate required fields
        if (!RollNumber || !Amount || !PaymentDate) {
          throw new Error('Missing required fields: Roll Number (AdmnNo), Amount, or Payment Date (TransDate)');
        }

        const normalizedRollNumber = String(RollNumber).trim().toUpperCase();
        const amountValue = parseFloat(Amount);
        
        // Parse date using helper function
        const paymentDateValue = parseDate(PaymentDate);
        if (!paymentDateValue) {
          throw new Error('Invalid payment date format. Expected DD/MM/YYYY or valid date.');
        }

        // Determine academic year
        let academicYearStr = null;
        if (AcademicYear) {
          academicYearStr = String(AcademicYear).trim();
          if (!/^\d{4}-\d{4}$/.test(academicYearStr)) {
            throw new Error('Invalid academic year format. Must be YYYY-YYYY.');
          }
        } else {
          // Infer from payment date
          const paymentYear = paymentDateValue.getFullYear();
          const paymentMonth = paymentDateValue.getMonth() + 1;
          if (paymentMonth < 6) {
            academicYearStr = `${paymentYear - 1}-${paymentYear}`;
          } else {
            academicYearStr = `${paymentYear}-${paymentYear + 1}`;
          }
        }

        // Normalize payment method - check Payment Mode first, then Payment Method
        let paymentMethodStr = 'Cash';
        
        // First check Payment Mode column (if "bank" then "Online", otherwise "Cash")
        if (PaymentMode) {
          const normalizedMode = String(PaymentMode).trim().toLowerCase();
          if (normalizedMode === 'bank') {
            paymentMethodStr = 'Online';
          } else {
            paymentMethodStr = 'Cash';
          }
        } else if (PaymentMethod) {
          // If Payment Mode not found, check Payment Method column
          const normalizedMethod = String(PaymentMethod).trim();
          const validMethods = ['Cash', 'Online', 'card', 'upi', 'netbanking', 'wallet', 'other'];
          if (validMethods.some(m => m.toLowerCase() === normalizedMethod.toLowerCase())) {
            paymentMethodStr = normalizedMethod;
          }
        }

        // Validate amount
        if (isNaN(amountValue) || amountValue <= 0) {
          throw new Error('Invalid amount');
        }

        // Find student
        const student = await User.findOne({ rollNumber: normalizedRollNumber, role: 'student' });
        if (!student) {
          throw new Error(`Student with roll number "${normalizedRollNumber}" not found`);
        }

        // Get fee structure
        const feeStructure = await FeeStructure.getFeeStructure(
          academicYearStr,
          student.course,
          student.year,
          student.category
        );

        if (!feeStructure) {
          throw new Error('Fee structure not found for student');
        }

        // Get existing payments
        const existingPayments = await Payment.find({
          studentId: student._id,
          academicYear: academicYearStr,
          paymentType: 'hostel_fee',
          status: 'success'
        });

        // Calculate term balances
        const termBalances = {
          term1: feeStructure.term1Fee - existingPayments.filter(p => p.term === 'term1').reduce((sum, p) => sum + p.amount, 0),
          term2: feeStructure.term2Fee - existingPayments.filter(p => p.term === 'term2').reduce((sum, p) => sum + p.amount, 0),
          term3: feeStructure.term3Fee - existingPayments.filter(p => p.term === 'term3').reduce((sum, p) => sum + p.amount, 0)
        };

        // Normalize term if provided
        let targetTerm = null;
        if (Term) {
          const normalizedTerm = String(Term).trim().toLowerCase().replace(/\s+/g, '');
          if (normalizedTerm === 'term1' || normalizedTerm === '1') {
            targetTerm = 'term1';
          } else if (normalizedTerm === 'term2' || normalizedTerm === '2') {
            targetTerm = 'term2';
          } else if (normalizedTerm === 'term3' || normalizedTerm === '3') {
            targetTerm = 'term3';
          }
        }

        // Process payment with auto-deduction logic (same as recordHostelFeePayment)
        let remainingAmount = amountValue;
        const paymentRecords = [];

        // If specific term is provided, apply to that term only
        if (targetTerm) {
          const termBalance = termBalances[targetTerm];
          if (termBalance <= 0) {
            throw new Error(`Term ${targetTerm} is already fully paid`);
          }
          const termPayment = Math.min(remainingAmount, termBalance);
          
          // Generate receipt and transaction IDs if not provided
          const receiptNumber = ReceiptNumber ? String(ReceiptNumber).trim() : `HFR${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
          const transactionId = TransactionId ? String(TransactionId).trim() : `HFT${Date.now()}${Math.random().toString(36).substr(2, 5)}`;

          // Check for duplicate receipt/transaction IDs
          if (ReceiptNumber) {
            const existing = await Payment.findOne({ receiptNumber });
            if (existing) {
              throw new Error(`Receipt number "${receiptNumber}" already exists`);
            }
          }
          if (TransactionId) {
            const existing = await Payment.findOne({ transactionId });
            if (existing) {
              throw new Error(`Transaction ID "${transactionId}" already exists`);
            }
          }

          const paymentRecord = new Payment({
            studentId: student._id,
            amount: termPayment,
            paymentMethod: paymentMethodStr,
            notes: Notes ? String(Notes).trim() : 'Uploaded from past payment Excel',
            collectedBy: student._id, // System upload, no specific collector
            collectedByName: 'System Upload',
            paymentType: 'hostel_fee',
            term: targetTerm,
            academicYear: academicYearStr,
            receiptNumber: receiptNumber,
            transactionId: transactionId,
            utrNumber: getUTRNumber(paymentMethodStr, UTRNumber, receiptNumber, transactionId),
            status: 'success',
            paymentDate: paymentDateValue
          });

          await paymentRecord.save();
          paymentRecords.push(paymentRecord);
          remainingAmount -= termPayment;
        } else {
          // Auto-deduction: Apply to terms in order (term1, term2, term3)
          // Process term1 first
          if (remainingAmount > 0 && termBalances.term1 > 0) {
            const term1Payment = Math.min(remainingAmount, termBalances.term1);
            const receiptNumber = ReceiptNumber ? String(ReceiptNumber).trim() : `HFR${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
            const transactionId = TransactionId ? String(TransactionId).trim() : `HFT${Date.now()}${Math.random().toString(36).substr(2, 5)}`;

            // Check for duplicates only for first term (if provided)
            if (ReceiptNumber && paymentRecords.length === 0) {
              const existing = await Payment.findOne({ receiptNumber });
              if (existing) {
                throw new Error(`Receipt number "${receiptNumber}" already exists`);
              }
            }
            if (TransactionId && paymentRecords.length === 0) {
              const existing = await Payment.findOne({ transactionId });
              if (existing) {
                throw new Error(`Transaction ID "${transactionId}" already exists`);
              }
            }

            const term1ReceiptNumber = paymentRecords.length === 0 ? receiptNumber : `HFR${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
            const term1TransactionId = paymentRecords.length === 0 ? transactionId : `HFT${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
            
            const term1PaymentRecord = new Payment({
              studentId: student._id,
              amount: term1Payment,
              paymentMethod: paymentMethodStr,
              notes: Notes ? String(Notes).trim() : 'Uploaded from past payment Excel',
              collectedBy: student._id,
              collectedByName: 'System Upload',
              paymentType: 'hostel_fee',
              term: 'term1',
              academicYear: academicYearStr,
              receiptNumber: term1ReceiptNumber,
              transactionId: term1TransactionId,
              utrNumber: getUTRNumber(paymentMethodStr, UTRNumber, term1ReceiptNumber, term1TransactionId),
              status: 'success',
              paymentDate: paymentDateValue
            });

            await term1PaymentRecord.save();
            paymentRecords.push(term1PaymentRecord);
            remainingAmount -= term1Payment;
          }

          // Process term2 if there's remaining amount
          if (remainingAmount > 0 && termBalances.term2 > 0) {
            const term2Payment = Math.min(remainingAmount, termBalances.term2);
            const receiptNumber = `HFR${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
            const transactionId = `HFT${Date.now()}${Math.random().toString(36).substr(2, 5)}`;

            const term2PaymentRecord = new Payment({
              studentId: student._id,
              amount: term2Payment,
              paymentMethod: paymentMethodStr,
              notes: Notes ? String(Notes).trim() : 'Uploaded from past payment Excel',
              collectedBy: student._id,
              collectedByName: 'System Upload',
              paymentType: 'hostel_fee',
              term: 'term2',
              academicYear: academicYearStr,
              receiptNumber: receiptNumber,
              transactionId: transactionId,
              utrNumber: getUTRNumber(paymentMethodStr, UTRNumber, receiptNumber, transactionId),
              status: 'success',
              paymentDate: paymentDateValue
            });

            await term2PaymentRecord.save();
            paymentRecords.push(term2PaymentRecord);
            remainingAmount -= term2Payment;
          }

          // Process term3 if there's remaining amount
          if (remainingAmount > 0 && termBalances.term3 > 0) {
            const term3Payment = Math.min(remainingAmount, termBalances.term3);
            const receiptNumber = `HFR${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
            const transactionId = `HFT${Date.now()}${Math.random().toString(36).substr(2, 5)}`;

            const term3PaymentRecord = new Payment({
              studentId: student._id,
              amount: term3Payment,
              paymentMethod: paymentMethodStr,
              notes: Notes ? String(Notes).trim() : 'Uploaded from past payment Excel',
              collectedBy: student._id,
              collectedByName: 'System Upload',
              paymentType: 'hostel_fee',
              term: 'term3',
              academicYear: academicYearStr,
              receiptNumber: receiptNumber,
              transactionId: transactionId,
              utrNumber: getUTRNumber(paymentMethodStr, UTRNumber, receiptNumber, transactionId),
              status: 'success',
              paymentDate: paymentDateValue
            });

            await term3PaymentRecord.save();
            paymentRecords.push(term3PaymentRecord);
            remainingAmount -= term3Payment;
          }
        }

        results.successful.push({
          rowIndex,
          rollNumber: normalizedRollNumber,
          studentName: student.name,
          amount: amountValue,
          paymentRecords: paymentRecords.length,
          remainingAmount: remainingAmount > 0 ? remainingAmount : 0
        });

        results.summary.successCount++;
        results.summary.totalAmount += amountValue;

      } catch (error) {
        results.failed.push({
          rowIndex,
          rollNumber: RollNumber ? String(RollNumber).trim().toUpperCase() : 'N/A',
          error: error.message
        });
        results.summary.failureCount++;
      }
    }

    res.json({
      success: true,
      message: `Processed ${results.summary.totalProcessed} payments. ${results.summary.successCount} successful, ${results.summary.failureCount} failed.`,
      data: results
    });

  } catch (error) {
    console.error('Error uploading past payments:', error);
    return next(createError(500, 'Failed to process Excel file: ' + error.message));
  }
};

