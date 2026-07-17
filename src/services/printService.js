import pkg from 'jspdf';
const { jsPDF } = pkg;
import autoTable from 'jspdf-autotable';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import QRCode from 'qrcode';

import User from '../models/User.js';
import Payment from '../models/Payment.js';
import FeeStructure from '../models/FeeStructure.js';
import TempStudent from '../models/TempStudent.js';
import GlobalSettings from '../models/GlobalSettings.js';
import StaffGuest from '../models/StaffGuest.js';
import Course from '../models/Course.js';

import { enrichStudentAcademics } from '../utils/studentAcademicEnricher.js';
import { photoToBase64ForExport } from '../utils/studentPhotoService.js';

// Helper function to format date as dd/mm/yyyy
const formatDateDDMMYYYY = (date) => {
  if (!date) return 'N/A';
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

// Helper function to fetch image and convert to base64
const fetchImageAsBase64 = async (imageUrl) => {
  if (!imageUrl) return null;
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000
    });
    
    const buffer = Buffer.from(response.data, 'binary');
    const base64 = buffer.toString('base64');
    const mimeType = response.headers['content-type'] || 'image/jpeg';
    
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('Error fetching image from URL:', imageUrl, error.message);
    return null;
  }
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to load static assets from the client/public folder as base64 for jsPDF
const getAssetAsBase64 = (relativePath) => {
  try {
    const filePath = path.resolve(__dirname, relativePath);
    if (fs.existsSync(filePath)) {
      const bitmap = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      return `data:${mime};base64,${bitmap.toString('base64')}`;
    }
  } catch (error) {
    console.error(`Error loading asset ${relativePath}:`, error);
  }
  return null;
};

// Helper to parse base64 data URLs for jsPDF addImage in Node.js
const getBase64ImageUint8Array = (dataUrl) => {
  if (!dataUrl || !dataUrl.startsWith('data:image')) return null;
  try {
    const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,([\s\S]+)$/);
    if (matches && matches.length === 3) {
      const format = matches[1].toUpperCase() === 'PNG' ? 'PNG' : 'JPEG';
      const base64Data = matches[2].replace(/\s/g, '');
      const buffer = Buffer.from(base64Data, 'base64');
      return {
        data: new Uint8Array(buffer),
        format
      };
    }
  } catch (error) {
    console.error('Error decoding base64 data URL:', error);
  }
  return null;
};

const LOCAL_LOGO_RELATIVE_PATH = '../../../client/public/PYDAH_LOGO_PHOTO.jpg';
/** Same CDN logo used by the admissions application print templates. */
const FALLBACK_PRINT_LOGO_URL =
  'https://static.wixstatic.com/media/bfee2e_7d499a9b2c40442e85bb0fa99e7d5d37~mv2.png/v1/fill/w_162,h_89,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/logo1.png';

const resolveAbsoluteAssetUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return null;
};

/** Load Pydah logo for PDF printing: local file, then GlobalSettings URL, then CDN fallback. */
const loadPrintLogoImage = async () => {
  const localBase64 = getAssetAsBase64(LOCAL_LOGO_RELATIVE_PATH);
  if (localBase64) {
    const decoded = getBase64ImageUint8Array(localBase64);
    if (decoded) return decoded;
  }

  try {
    const settings = await GlobalSettings.findOne().lean();
    const settingsUrl = resolveAbsoluteAssetUrl(settings?.urls?.logoUrl);
    if (settingsUrl) {
      const remoteBase64 = await fetchImageAsBase64(settingsUrl);
      const decoded = remoteBase64 ? getBase64ImageUint8Array(remoteBase64) : null;
      if (decoded) return decoded;
    }
  } catch (error) {
    console.error('Error loading logo from GlobalSettings:', error.message);
  }

  const fallbackBase64 = await fetchImageAsBase64(FALLBACK_PRINT_LOGO_URL);
  return fallbackBase64 ? getBase64ImageUint8Array(fallbackBase64) : null;
};

const drawPrintLogoPlaceholder = (doc, x, y, w, h) => {
  doc.setFillColor(240, 240, 240);
  doc.rect(x, y, w, h);
  doc.setFontSize(6);
  doc.text('PYDAH', x + w / 2, y + h / 2, { align: 'center' });
};

const addPrintLogoToDoc = (doc, logoImage, x, y, w = 22, h = 12) => {
  if (logoImage?.data) {
    try {
      doc.addImage(logoImage.data, logoImage.format, x, y, w, h);
      return;
    } catch (error) {
      console.error('Error adding print logo to PDF:', error.message);
    }
  }
  drawPrintLogoPlaceholder(doc, x, y, w, h);
};

const LOCAL_QR_RELATIVE_PATH = '../../../client/public/qrcode_hms.pydahsoft.in.png';
const DEFAULT_HMS_PORTAL_URL = 'https://hms.pydahsoft.in';

const generateQrImageFromText = async (text) => {
  if (!text) return null;
  try {
    const dataUrl = await QRCode.toDataURL(text, {
      width: 256,
      margin: 1,
      errorCorrectionLevel: 'M',
    });
    return getBase64ImageUint8Array(dataUrl);
  } catch (error) {
    console.error('Error generating QR code:', error.message);
    return null;
  }
};

/** Load HMS portal QR for PDF printing: local PNG, remote asset, then generate from portal URL. */
const loadPrintQrImage = async () => {
  const localBase64 = getAssetAsBase64(LOCAL_QR_RELATIVE_PATH);
  if (localBase64) {
    const decoded = getBase64ImageUint8Array(localBase64);
    if (decoded) return decoded;
  }

  const remoteCandidates = [
    `${DEFAULT_HMS_PORTAL_URL}/qrcode_hms.pydahsoft.in.png`,
    'https://hostel.pydah.edu/qrcode_hms.pydahsoft.in.png',
  ];

  let portalUrl = DEFAULT_HMS_PORTAL_URL;
  try {
    const settings = await GlobalSettings.findOne().lean();
    const canonical = resolveAbsoluteAssetUrl(settings?.urls?.canonicalUrl);
    const apiBase = resolveAbsoluteAssetUrl(settings?.urls?.apiBaseUrl);
    if (canonical) {
      portalUrl = canonical.replace(/\/$/, '');
      remoteCandidates.unshift(`${portalUrl}/qrcode_hms.pydahsoft.in.png`);
    }
    if (apiBase) {
      remoteCandidates.push(`${apiBase.replace(/\/$/, '')}/qrcode_hms.pydahsoft.in.png`);
    }
  } catch (error) {
    console.error('Error loading QR settings:', error.message);
  }

  for (const url of remoteCandidates) {
    const remoteBase64 = await fetchImageAsBase64(url);
    const decoded = remoteBase64 ? getBase64ImageUint8Array(remoteBase64) : null;
    if (decoded) return decoded;
  }

  return generateQrImageFromText(portalUrl);
};

const addPrintQrToDoc = (doc, qrImage, x, y, size, placeholderLabel = 'QR CODE') => {
  if (qrImage?.data) {
    try {
      doc.addImage(qrImage.data, qrImage.format, x, y, size, size);
      return;
    } catch (error) {
      console.error('Error adding print QR to PDF:', error.message);
    }
  }
  doc.setFontSize(4);
  doc.text(placeholderLabel, x + size / 2, y + size / 2, { align: 'center' });
};

// Helper for course name
const getCourseName = (course) => {
  if (!course) return 'Unknown';
  if (typeof course === 'string') return course;
  return course.name || course;
};

/**
 * FEE RECEIPT GENERATOR
 */
export const generateFeeReceipt = async (receiptId) => {
  // Query payment
  const payment = await Payment.findById(receiptId)
    .populate('studentId')
    .populate('roomId');
  
  if (!payment) {
    throw new Error('Payment record not found');
  }

  const user = payment.studentId;
  const settings = await GlobalSettings.findOne();

  const doc = new jsPDF();
  
  const defaultSettings = {
    institution: {
      name: "Pydah Hostel Management System",
      fullName: "Pydah Educational Institutions"
    }
  };
  
  const institutionSettings = settings || defaultSettings;
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  const margin = 20;
  
  // Add header
  doc.setFontSize(24);
  doc.setTextColor(30, 64, 175); // Blue-900
  doc.setFont(undefined, 'bold');
  doc.text('PAYMENT RECEIPT', pageWidth / 2, 35, { align: 'center' });
  
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'normal');
  doc.text(institutionSettings.institution.name.toUpperCase(), pageWidth / 2, 45, { align: 'center' });
  
  // Add decorative line
  doc.setDrawColor(30, 64, 175);
  doc.setLineWidth(0.5);
  doc.line(margin, 55, pageWidth - margin, 55);
  
  let currentY = 70;
  
  // Receipt details
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('Receipt Details', margin, currentY);
  currentY += 15;
  
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  
  const receiptNumber = payment.receiptNumber || payment._id?.toString().slice(-8) || 'N/A';
  doc.text(`Receipt No: ${receiptNumber}`, margin, currentY);
  currentY += 10;
  
  const transactionId = payment.transactionId || payment.cashfreeOrderId || payment._id?.toString().slice(-8) || 'N/A';
  doc.text(`Transaction ID: ${transactionId}`, margin, currentY);
  currentY += 10;
  
  const paymentDate = payment.paymentDate || payment.createdAt;
  const formattedDate = paymentDate ? new Date(paymentDate).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }) : 'N/A';
  doc.text(`Date: ${formattedDate}`, margin, currentY);
  currentY += 10;
  
  const paymentTypeText = payment.paymentType === 'electricity' ? 'Electricity Bill' : 'Hostel Fee';
  doc.text(`Payment Type: ${paymentTypeText}`, margin, currentY);
  currentY += 15;
  
  // Student details
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('Student Details', margin, currentY);
  currentY += 15;
  
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  
  const studentName = payment.studentName || user?.name || user?.fullName || 'N/A';
  doc.text(`Name: ${studentName}`, margin, currentY);
  currentY += 10;
  
  const rollNumber = payment.studentRollNumber || user?.rollNumber || user?.rollNo || user?.studentId || 'N/A';
  doc.text(`Roll Number: ${rollNumber}`, margin, currentY);
  currentY += 10;
  
  const roomNumber = user?.roomNumber || payment.roomId?.roomNumber || 'N/A';
  doc.text(`Room Number: ${roomNumber}`, margin, currentY);
  currentY += 10;
  
  const academicYear = payment.academicYear || user?.academicYear || 'N/A';
  doc.text(`Academic Year: ${academicYear}`, margin, currentY);
  currentY += 10;
  
  const category = payment.category || user?.category || 'N/A';
  doc.text(`Category: ${category}`, margin, currentY);
  currentY += 15;
  
  // Payment details
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('Payment Details', margin, currentY);
  currentY += 15;
  
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  
  const amount = payment.amount || 0;
  doc.text(`Amount: ₹${amount.toLocaleString('en-IN')}`, margin, currentY);
  currentY += 10;
  
  if (payment.paymentType === 'electricity') {
    const billMonth = payment.billMonth || 'N/A';
    doc.text(`Bill Month: ${billMonth}`, margin, currentY);
  } else {
    const term = payment.term || 'N/A';
    doc.text(`Term: ${term}`, margin, currentY);
  }
  currentY += 10;
  
  const paymentMethod = payment.paymentMethod || 'Cash';
  doc.text(`Payment Method: ${paymentMethod}`, margin, currentY);
  currentY += 10;
  
  if (paymentMethod === 'Online' && payment.utrNumber) {
    doc.text(`UTR Number: ${payment.utrNumber}`, margin, currentY);
    currentY += 10;
  }
  
  const status = payment.status?.toUpperCase() || 'SUCCESS';
  doc.text(`Status: ${status}`, margin, currentY);
  currentY += 10;
  
  const collectedBy = payment.collectedByName || 'Admin';
  doc.text(`Collected By: ${collectedBy}`, margin, currentY);
  currentY += 15;
  
  if (payment.paymentType === 'electricity') {
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('Bill Details', margin, currentY);
    currentY += 15;
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    
    const consumption = payment.consumption || payment.billDetails?.consumption;
    if (consumption !== undefined && consumption !== null) {
      doc.text(`Consumption: ${consumption} units`, margin, currentY);
      currentY += 10;
    }
    
    const rate = payment.billDetails?.rate;
    if (rate !== undefined && rate !== null) {
      doc.text(`Rate: ₹${rate} per unit`, margin, currentY);
      currentY += 10;
    }
    
    const totalBill = payment.billDetails?.total;
    if (totalBill !== undefined && totalBill !== null) {
      doc.text(`Total Room Bill: ₹${totalBill.toLocaleString('en-IN')}`, margin, currentY);
      currentY += 10;
    }
    
    doc.text(`Your Share: ₹${amount.toLocaleString('en-IN')}`, margin, currentY);
    currentY += 15;
  }
  
  if (payment.notes) {
    doc.text(`Notes: ${payment.notes}`, margin, currentY);
    currentY += 15;
  }
  
  // Add border
  doc.setDrawColor(209, 213, 219);
  doc.setLineWidth(0.5);
  doc.rect(margin - 5, margin - 5, pageWidth - (2 * margin) + 10, pageHeight - (2 * margin) + 10);
  
  // Footer
  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.text('This is a computer generated receipt and does not require a signature.', pageWidth / 2, pageHeight - 20, { align: 'center' });
  doc.text(`Generated on: ${new Date().toLocaleString()}`, pageWidth / 2, pageHeight - 15, { align: 'center' });
  
  doc.autoPrint();
  return Buffer.from(doc.output('arraybuffer'));
};

/**
 * HOSTEL ADMIT CARD GENERATOR
 */
export const generateHostelAdmit = async (studentId) => {
  const studentDoc = await User.findById(studentId)
    .populate('hostel')
    .populate('hostelCategory')
    .populate('room');

  if (!studentDoc) {
    throw new Error('Student record not found');
  }

  const studentObj = studentDoc.toObject();
  const student = await enrichStudentAcademics(studentObj);

  if (student.studentPhoto) {
    if (!student.studentPhoto.startsWith('data:image')) {
      const photoBase64 = await photoToBase64ForExport(student.studentPhoto, fetchImageAsBase64);
      if (photoBase64) {
        student.studentPhoto = photoBase64;
      }
    }
  }

  // Get academic year
  const studentAcademicYear = student.academicYear || '2024-2025';

  // Get course name from enriched student details
  const courseName = student.course?.name || student.course;

  // Fetch fee structure using string course name (e.g. 'B.Tech') as per schema definition
  const baseQueryForFee = {
    academicYear: studentAcademicYear,
    course: courseName,
    year: student.year ? parseInt(student.year, 10) : 1,
    category: student.category || 'A',
    isActive: true,
  };
  const feeStructure =
    await FeeStructure.findOne({ ...baseQueryForFee, branch: student.branch }) ||
    await FeeStructure.findOne({ ...baseQueryForFee, branch: null }) ||
    await FeeStructure.findOne({ ...baseQueryForFee, branch: undefined });

  // Fetch temp password
  const tempStudent = await TempStudent.findOne({ mainStudentId: student._id });
  const finalPassword = tempStudent?.generatedPassword || null;

  const printLogo = await loadPrintLogoImage();
  const printQr = await loadPrintQrImage();

  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.width; // 210mm
  const pageHeight = doc.internal.pageSize.height; // 297mm
  const halfPageHeight = pageHeight / 2; // 148.5mm
  const margin = 10;
  const contentWidth = pageWidth - (margin * 2);

  const generateOneCopy = (startY, copyLabel, password) => {
    const studentGender = student.gender?.toLowerCase();
    const studentCourse = getCourseName(student.course)?.toLowerCase();
    const hostelName = studentGender === 'female' ? 'Girls Hostel' : 'Boys Hostel';

    const emergencyContacts = {
      'b.tech': '+91-9490484418',
      'diploma': '+91-8688553555',
      'pharmacy': '+91-8886728886',
      'degree': '+91-9490484418',
      default: '+91-9490484418'
    };

    const wardenNumbers = {
      male: '+91-9493994233',
      female: '+91-8333068321',
      default: '+91-9493994233'
    };

    const securityNumber = '+91-8317612655';
    const aoPhone = emergencyContacts[studentCourse] || emergencyContacts.default;
    const wardenPhone = wardenNumbers[studentGender] || wardenNumbers.default;

    // Draw border
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.rect(margin, startY, contentWidth, halfPageHeight - (margin * 2));

    // Copy label
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(copyLabel, margin + 5, startY + 5);

    let yPos = startY + 8;

    addPrintLogoToDoc(doc, printLogo, margin + 4, yPos, 22, 12);

    // Main title
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Pydah Group Of Institutions', pageWidth / 2, yPos + 8, { align: 'center' });

    // Right side
    doc.setFontSize(8);
    doc.text('HOSTEL ADMIT CARD', pageWidth - margin - 5, yPos + 4, { align: 'right' });
    doc.setFontSize(6);
    doc.text(`${studentAcademicYear} AY`, pageWidth - margin - 5, yPos + 8, { align: 'right' });

    // Divider line
    yPos = startY + 24;
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.3);
    doc.line(margin + 5, yPos, pageWidth - margin - 5, yPos);

    yPos += 6;
    const centerX = pageWidth / 2;
    const photoWidth = 30;
    const photoHeight = 35;

    // QR Code
    const qrCodeX = margin + 15;
    const qrCodeY = yPos + 2;
    const qrCodeSize = 30;

    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.text('Visit our website', qrCodeX + qrCodeSize / 2, qrCodeY - 3, { align: 'center' });

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.rect(qrCodeX, qrCodeY, qrCodeSize, qrCodeSize);

    addPrintQrToDoc(doc, printQr, qrCodeX, qrCodeY, qrCodeSize, 'QR CODE');

    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');
    doc.text('www.hms.pydahsoft.in', qrCodeX + qrCodeSize / 2, qrCodeY + qrCodeSize + 4, { align: 'center' });

    // Emergency Contacts
    const emergencyY = qrCodeY + qrCodeSize + 18;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('EMERGENCY CONTACTS:', qrCodeX, emergencyY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`1. Warden (${studentGender === 'female' ? 'Girls' : 'Boys'}): ${wardenPhone}`, qrCodeX, emergencyY + 5);
    doc.text(`2. AO (${getCourseName(student.course)}): ${aoPhone}`, qrCodeX, emergencyY + 10);
    doc.text(`3. Security: ${securityNumber}`, qrCodeX, emergencyY + 15);

    // Photo Box
    const photoX = centerX + 35;
    const photoY = yPos + 4;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('STUDENT PHOTO', photoX + photoWidth / 2, photoY - 4, { align: 'center' });

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    doc.rect(photoX, photoY, photoWidth, photoHeight);

    if (student.studentPhoto) {
      try {
        const decodedImg = getBase64ImageUint8Array(student.studentPhoto);
        if (decodedImg) {
          doc.addImage(decodedImg.data, decodedImg.format, photoX, photoY, photoWidth, photoHeight);
        } else if (student.studentPhoto.startsWith('data:image')) {
          doc.addImage(student.studentPhoto, 'JPEG', photoX, photoY, photoWidth, photoHeight);
        } else {
          doc.setFontSize(4);
          doc.text('Photo', photoX + photoWidth / 2, photoY + photoHeight / 2, { align: 'center' });
        }
      } catch (error) {
        console.error('Error rendering student photo:', error);
        doc.setFontSize(4);
        doc.text('Photo', photoX + photoWidth / 2, photoY + photoHeight / 2, { align: 'center' });
      }
    } else {
      doc.setFontSize(4);
      doc.text('Photo', photoX + photoWidth / 2, photoY + photoHeight / 2, { align: 'center' });
    }

    // Student details
    const detailsX = qrCodeX + qrCodeSize + 15;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('STUDENT DETAILS', detailsX, yPos);
    yPos += 4;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);

    const studentDetails = [
      ['Name:', String(student.name || '')],
      ['Roll No:', String(student.rollNumber || '')],
      ['Course:', String(getCourseName(student.course))],
      ['Year:', String(student.year || '')],
      ['Hostel:', String(hostelName)],
      ['Mobile No:', String(student.studentPhone || '')],
      ['Parent No:', String(student.parentPhone || '')],
      ['Address:', String(student.address || '')],
      ['Hostel ID:', String(student.hostelId || '')],
      ['Category:', String(student.category || '')],
      ['Room:', String(student.room?.roomNumber || student.roomNumber || '')]
    ];

    studentDetails.forEach(([label, value]) => {
      doc.setFont('helvetica', 'bold');
      doc.text(label, detailsX, yPos);
      doc.setFont('helvetica', 'normal');
      doc.text(value || '', detailsX + 25, yPos);
      yPos += 3.0;
    });

    // Fee structure table
    yPos = startY + 71;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('FEE STRUCTURE', centerX - 35, yPos);
    yPos += 3;

    const actualFeeStructure = feeStructure;
    const feeData = [
      ['Term', 'Original Amount', 'After Concession', 'Remarks'],
      ['1st Term', `Rs : ${actualFeeStructure?.term1Fee || 0}`, `Rs : ${student.calculatedTerm1Fee || actualFeeStructure?.term1Fee || 0}`, ''],
      ['2nd Term', `Rs : ${actualFeeStructure?.term2Fee || 0}`, `Rs : ${student.calculatedTerm2Fee || actualFeeStructure?.term2Fee || 0}`, 'Before 2nd MID Term'],
      ['3rd Term', `Rs : ${actualFeeStructure?.term3Fee || 0}`, `Rs : ${student.calculatedTerm3Fee || actualFeeStructure?.term3Fee || 0}`, 'Before 2nd Sem Start']
    ];

    const totalOriginalFee = (actualFeeStructure?.term1Fee || 0) + (actualFeeStructure?.term2Fee || 0) + (actualFeeStructure?.term3Fee || 0);
    const totalAfterConcession = (student.calculatedTerm1Fee || actualFeeStructure?.term1Fee || 0) +
      (student.calculatedTerm2Fee || actualFeeStructure?.term2Fee || 0) +
      (student.calculatedTerm3Fee || actualFeeStructure?.term3Fee || 0);

    feeData.push(['TOTAL', `Rs : ${totalOriginalFee.toLocaleString()}`, `Rs : ${totalAfterConcession.toLocaleString()}`, '']);

    try {
      autoTable(doc, {
        startY: yPos + 4,
        head: [feeData[0]],
        body: feeData.slice(1),
        theme: 'grid',
        styles: {
          fontSize: 5,
          cellPadding: 1.5,
          lineColor: [0, 0, 0],
          lineWidth: 0.2,
          halign: 'center',
          valign: 'middle'
        },
        headStyles: {
          fillColor: [70, 70, 70],
          textColor: 255,
          fontStyle: 'bold',
          fontSize: 6,
          lineColor: [0, 0, 0],
          lineWidth: 0.2,
          halign: 'center',
          valign: 'middle'
        },
        columnStyles: {
          0: { cellWidth: 20, fontSize: 6, lineColor: [0, 0, 0], lineWidth: 0.2, halign: 'center' },
          1: { cellWidth: 24, fontSize: 6, lineColor: [0, 0, 0], lineWidth: 0.2, halign: 'center' },
          2: { cellWidth: 24, fontSize: 6, lineColor: [0, 0, 0], lineWidth: 0.2, halign: 'center' },
          3: { cellWidth: 20, fontSize: 4, lineColor: [0, 0, 0], lineWidth: 0.2, halign: 'center' }
        },
        margin: { left: centerX - 35 },
        tableWidth: 'auto',
        showFoot: 'lastPage'
      });
    } catch (autoTableError) {
      console.error('autoTable error in printService:', autoTableError);
    }

    const tableEndY = doc.lastAutoTable ? doc.lastAutoTable.finalY : (yPos + 4);
    yPos = tableEndY + 12;

    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.text('IMPORTANT NOTES:', centerX - 35, yPos);
    yPos += 3;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5);
    doc.text('1. Late fee Rs.500/- per term if not paid on time', centerX - 35, yPos);
    yPos += 2.5;
    doc.text('2. Electricity bill extra monthly as per room sharing', centerX - 35, yPos);
    yPos += 2.5;
    doc.text('3. Present this card at hostel entrance for verification', centerX - 35, yPos);
  };

  // Generate Student Copy (top half)
  generateOneCopy(margin, 'STUDENT COPY', finalPassword);

  // Add divider line
  doc.setDrawColor(100, 100, 100);
  doc.setLineWidth(0.3);
  doc.line(margin + 5, halfPageHeight, pageWidth - margin - 5, halfPageHeight);

  // Generate Warden Copy (bottom half)
  generateOneCopy(halfPageHeight + 2, 'WARDEN COPY', null);

  doc.autoPrint();
  return Buffer.from(doc.output('arraybuffer'));
};

/**
 * STAFF/GUEST ADMIT CARD GENERATOR
 */
export const generateStaffGuestAdmit = async (staffGuestId) => {
  const staffGuest = await StaffGuest.findById(staffGuestId)
    .populate('hostelId')
    .populate('categoryId')
    .populate('roomId');
  
  if (!staffGuest) {
    throw new Error('Staff/Guest record not found');
  }

  if (staffGuest.photo && !staffGuest.photo.startsWith('data:image')) {
    const photoBase64 = await photoToBase64ForExport(staffGuest.photo, fetchImageAsBase64);
    if (photoBase64) {
      staffGuest.photo = photoBase64;
    }
  }

  const printLogo = await loadPrintLogoImage();
  const printQr = await loadPrintQrImage();

  // For guests, charges are always 0
  const isGuest = staffGuest.type === 'guest';
  const dailyRate = isGuest ? 0 : (staffGuest.dailyRate || 100);

  const dayCount = !isGuest ? staffGuest.getDayCount() : 0;

  const totalCharges = isGuest ? 0 : (dailyRate * dayCount);
  const actualCharges = isGuest ? 0 : (staffGuest.calculatedCharges || totalCharges);
  const staffGender = staffGuest.gender?.toLowerCase();
  const hostelName = staffGender === 'female' ? 'Girls Hostel' : 'Boys Hostel';

  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  const halfPageHeight = pageHeight / 2;
  const margin = 10;
  const contentWidth = pageWidth - (margin * 2);

  const generateOneCopy = async (startY, copyLabel) => {
    const wardenNumbers = {
      male: '+91-9493994233',
      female: '+91-8333068321',
      default: '+91-9493994233'
    };
    const securityNumber = '+91-8317612655';
    const adminNumber = '+91-9490484418';
    const wardenPhone = wardenNumbers[staffGender] || wardenNumbers.default;

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.rect(margin, startY, contentWidth, halfPageHeight - (margin * 2));

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(copyLabel, margin + 5, startY + 5);

    let yPos = startY + 8;
    addPrintLogoToDoc(doc, printLogo, margin + 4, yPos, 22, 12);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Pydah Group Of Institutions', pageWidth / 2, yPos + 8, { align: 'center' });

    doc.setFontSize(8);
    doc.text('HOSTEL ADMIT CARD', pageWidth - margin - 5, yPos + 4, { align: 'right' });
    doc.setFontSize(6);
    doc.text(`${staffGuest.type.toUpperCase()} - ${new Date().getFullYear()}`, pageWidth - margin - 5, yPos + 8, { align: 'right' });

    yPos = startY + 24;
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.3);
    doc.line(margin + 5, yPos, pageWidth - margin - 5, yPos);

    yPos += 6;
    const centerX = pageWidth / 2;
    const photoWidth = 30;
    const photoHeight = 35;
    const qrCodeX = margin + 15;
    const qrCodeY = yPos + 2;
    const qrCodeSize = 30;

    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.text('Visit our website', qrCodeX + qrCodeSize / 2, qrCodeY - 3, { align: 'center' });

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.rect(qrCodeX, qrCodeY, qrCodeSize, qrCodeSize);

    addPrintQrToDoc(doc, printQr, qrCodeX, qrCodeY, qrCodeSize, 'QR CODE');

    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');
    doc.text('www.hms.pydahsoft.in', qrCodeX + qrCodeSize / 2, qrCodeY + qrCodeSize + 4, { align: 'center' });

    const emergencyY = qrCodeY + qrCodeSize + 18;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('EMERGENCY CONTACTS:', qrCodeX, emergencyY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`1. Warden (${staffGender === 'female' ? 'Girls' : 'Boys'}): ${wardenPhone}`, qrCodeX, emergencyY + 5);
    doc.text(`2. Admin: ${adminNumber}`, qrCodeX, emergencyY + 10);
    doc.text(`3. Security: ${securityNumber}`, qrCodeX, emergencyY + 15);

    const chargesSummaryX = centerX + 20;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('CHARGES SUMMARY:', chargesSummaryX, emergencyY);

    if (isGuest) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(`No charges for guests`, chargesSummaryX, emergencyY + 5);
      doc.setFont('helvetica', 'bold');
      doc.text(`Total Payable: Rs.0`, chargesSummaryX, emergencyY + 10);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(`Daily Rate: Rs.${dailyRate} per day`, chargesSummaryX, emergencyY + 5);

      if (staffGuest.stayType === 'monthly' && staffGuest.selectedMonth) {
        const monthName = new Date(staffGuest.selectedMonth + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        doc.text(`Stay Type: Monthly Basis`, chargesSummaryX, emergencyY + 10);
        doc.text(`Valid Month: ${monthName}`, chargesSummaryX, emergencyY + 15);
        doc.text(`Days in Month: ${dayCount} days`, chargesSummaryX, emergencyY + 20);
      } else {
        doc.text(`Stay Duration: ${dayCount} days`, chargesSummaryX, emergencyY + 10);
      }

      let baseAmountY = staffGuest.stayType === 'monthly' && staffGuest.selectedMonth ? (emergencyY + 25) : (emergencyY + 15);
      doc.text(`Base Amount: Rs.${totalCharges}`, chargesSummaryX, baseAmountY);

      const totalPayableY = baseAmountY + 5;
      if (actualCharges !== totalCharges) {
        doc.text(`- Adjustment: Rs.${totalCharges - actualCharges}`, chargesSummaryX, totalPayableY);
        doc.setFont('helvetica', 'bold');
        doc.text(`- Total Payable: Rs.${actualCharges}`, chargesSummaryX, totalPayableY + 5);
      } else {
        doc.setFont('helvetica', 'bold');
        doc.text(`- Total Payable: Rs.${actualCharges}`, chargesSummaryX, totalPayableY);
      }
    }

    doc.setFont('helvetica', 'normal');

    const photoX = centerX + 35;
    const photoY = yPos + 4;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('PHOTO', photoX + photoWidth / 2, photoY - 4, { align: 'center' });
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    doc.rect(photoX, photoY, photoWidth, photoHeight);

    if (staffGuest.photo) {
      try {
        const decodedImg = getBase64ImageUint8Array(staffGuest.photo);
        if (decodedImg) {
          doc.addImage(decodedImg.data, decodedImg.format, photoX, photoY, photoWidth, photoHeight);
        } else if (staffGuest.photo.startsWith('data:image')) {
          doc.addImage(staffGuest.photo, 'JPEG', photoX, photoY, photoWidth, photoHeight);
        } else {
          doc.setFontSize(4);
          doc.text('Photo', photoX + photoWidth / 2, photoY + photoHeight / 2, { align: 'center' });
        }
      } catch (error) {
        console.error('Error rendering staff/guest photo:', error);
        doc.setFontSize(4);
        doc.text('Photo', photoX + photoWidth / 2, photoY + photoHeight / 2, { align: 'center' });
      }
    } else {
      doc.setFontSize(4);
      doc.text('Photo', photoX + photoWidth / 2, photoY + photoHeight / 2, { align: 'center' });
    }

    const detailsX = qrCodeX + qrCodeSize + 15;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('STAFF/GUEST DETAILS', detailsX, yPos);
    yPos += 4;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);

    const staffDetails = [
      ['Name:', String(staffGuest.name || '')],
      ['Type:', String(staffGuest.type || '')],
      ['Gender:', String(staffGuest.gender || '')],
      ['Profession:', String(staffGuest.profession || '')],
      ['Phone:', String(staffGuest.phoneNumber || '')],
      ['Email:', String(staffGuest.email || 'N/A')],
      ['Department:', String(staffGuest.department || 'N/A')],
      ['Purpose:', String(staffGuest.purpose || 'N/A')],
      ['Hostel:', String(hostelName)],
      ...(staffGuest.roomNumber ? [['Room:', String(staffGuest.roomNumber)]] : []),
      ...(staffGuest.bedNumber ? [['Bed:', String(staffGuest.bedNumber)]] : []),
      ...(staffGuest.stayType === 'monthly' && staffGuest.selectedMonth ? [
        ['Stay Type:', 'Monthly Basis'],
        ['Valid Month:', String(new Date(staffGuest.selectedMonth + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))]
      ] : [
        ['Check-in:', formatDateDDMMYYYY(staffGuest.checkinDate)],
        ['Check-out:', formatDateDDMMYYYY(staffGuest.checkoutDate)]
      ]),
      ['Status:', String(staffGuest.checkinDate && !staffGuest.checkoutDate ? 'Checked In' : 'Checked Out')]
    ];

    staffDetails.forEach(([label, value]) => {
      doc.setFont('helvetica', 'bold');
      doc.text(label, detailsX, yPos);
      doc.setFont('helvetica', 'normal');
      doc.text(value || '', detailsX + 25, yPos);
      yPos += 3.5;
    });
  };

  await generateOneCopy(margin, 'STAFF/GUEST COPY');

  doc.setDrawColor(100, 100, 100);
  doc.setLineWidth(0.3);
  doc.line(margin + 5, halfPageHeight, pageWidth - margin - 5, halfPageHeight);

  await generateOneCopy(halfPageHeight + 2, 'WARDEN COPY');

  doc.autoPrint();
  return Buffer.from(doc.output('arraybuffer'));
};

/**
 * TRANSPORT ADMIT CARD GENERATOR (MOCK)
 */
export const generateTransportAdmit = async (studentId) => {
  // Query student
  let student = await User.findById(studentId);
  if (!student) {
    // If not found, try by rollNumber or default placeholder
    student = await User.findOne({ rollNumber: studentId }) || {
      name: "Student Placeholder",
      rollNumber: studentId || "N/A",
      course: "B.Tech",
      branch: "CSE",
      year: "1",
      gender: "Male"
    };
  }

  const printLogo = await loadPrintLogoImage();
  const printQr = await loadPrintQrImage();

  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  const halfPageHeight = pageHeight / 2;
  const margin = 10;
  const contentWidth = pageWidth - (margin * 2);

  const generateOneCopy = (startY, copyLabel) => {
    const studentCourse = getCourseName(student.course);
    const busRoute = "Route No 15 (Admissions Special)";
    const busStop = "Main Junction";
    const validity = `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;

    doc.setDrawColor(0, 128, 0); // Green theme for transport
    doc.setLineWidth(0.5);
    doc.rect(margin, startY, contentWidth, halfPageHeight - (margin * 2));

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 128, 0);
    doc.text(copyLabel, margin + 5, startY + 5);

    let yPos = startY + 8;
    addPrintLogoToDoc(doc, printLogo, margin + 4, yPos, 22, 12);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Pydah Group Of Institutions', pageWidth / 2, yPos + 8, { align: 'center' });

    doc.setFontSize(8);
    doc.text('TRANSPORT BUS PASS / ADMIT', pageWidth - margin - 5, yPos + 4, { align: 'right' });
    doc.setFontSize(6);
    doc.text(`${validity} AY`, pageWidth - margin - 5, yPos + 8, { align: 'right' });

    yPos = startY + 24;
    doc.setDrawColor(0, 128, 0);
    doc.setLineWidth(0.3);
    doc.line(margin + 5, yPos, pageWidth - margin - 5, yPos);

    yPos += 6;
    const centerX = pageWidth / 2;
    const photoWidth = 30;
    const photoHeight = 35;
    const qrCodeX = margin + 15;
    const qrCodeY = yPos + 2;
    const qrCodeSize = 30;

    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.text('Scan for validity', qrCodeX + qrCodeSize / 2, qrCodeY - 3, { align: 'center' });

    doc.setDrawColor(0, 128, 0);
    doc.setLineWidth(0.3);
    doc.rect(qrCodeX, qrCodeY, qrCodeSize, qrCodeSize);

    addPrintQrToDoc(doc, printQr, qrCodeX, qrCodeY, qrCodeSize, 'QR Pass');

    const detailsX = qrCodeX + qrCodeSize + 15;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('PASS HOLDER DETAILS', detailsX, yPos);
    yPos += 4;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);

    const passDetails = [
      ['Name:', String(student.name || '')],
      ['Roll No:', String(student.rollNumber || '')],
      ['Course:', String(studentCourse)],
      ['Year of Study:', String(student.year || '1')],
      ['Bus Route:', String(busRoute)],
      ['Bus Boarding:', String(busStop)],
      ['Validity Period:', String(validity)],
      ['Pass Status:', 'ACTIVE / APPROVED']
    ];

    passDetails.forEach(([label, value]) => {
      doc.setFont('helvetica', 'bold');
      doc.text(label, detailsX, yPos);
      doc.setFont('helvetica', 'normal');
      doc.text(value || '', detailsX + 25, yPos);
      yPos += 3.5;
    });

    const photoX = centerX + 35;
    const photoY = startY + 30;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('PHOTO', photoX + photoWidth / 2, photoY - 4, { align: 'center' });
    doc.setDrawColor(0, 128, 0);
    doc.setLineWidth(0.4);
    doc.rect(photoX, photoY, photoWidth, photoHeight);

    doc.setFontSize(4);
    doc.text('Student Pass Photo', photoX + photoWidth / 2, photoY + photoHeight / 2, { align: 'center' });

    // Rules
    const rulesY = startY + 80;
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 128, 0);
    doc.text('IMPORTANT BUS INSTRUCTIONS:', margin + 5, rulesY);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(0, 0, 0);
    doc.text('1. Present this bus admit card/pass to the driver upon boarding every day.', margin + 5, rulesY + 4);
    doc.text('2. Pass is non-transferable and valid only for specified route and stop.', margin + 5, rulesY + 7);
    doc.text('3. Maintain discipline while travelling in the institutional transport.', margin + 5, rulesY + 10);
  };

  generateOneCopy(margin, 'STUDENT BUS PASS COPY');
  
  doc.setDrawColor(0, 128, 0);
  doc.setLineWidth(0.3);
  doc.line(margin + 5, halfPageHeight, pageWidth - margin - 5, halfPageHeight);
  
  generateOneCopy(halfPageHeight + 2, 'OFFICE TRANSPORT COPY');

  doc.autoPrint();
  return Buffer.from(doc.output('arraybuffer'));
};

/**
 * LIVE OCCUPANCY REPORT GENERATOR (HTML output)
 */
export const generateLiveOccupancyReport = async (passedStudents, filters, isLiveMode, printOptions = {}) => {
  let students = passedStudents;
  const includeSummary = printOptions.includeSummary !== undefined ? printOptions.includeSummary : true;
  const includeDetails = printOptions.includeDetails !== undefined ? printOptions.includeDetails : true;
  
  // If no students passed, fetch from DB
  if (!students || !Array.isArray(students) || students.length === 0) {
    const query = { role: 'student' };
    if (isLiveMode) {
      query.hostelStatus = 'Active';
    }
    if (filters) {
      if (filters.search) {
        const searchRegex = new RegExp(filters.search, 'i');
        query.$or = [{ name: searchRegex }, { rollNumber: searchRegex }];
      }
      if (filters.course) query.course = filters.course;
      if (filters.branch) query.branch = filters.branch;
      if (filters.hostel) query.hostel = filters.hostel;
      if (filters.category) query.hostelCategory = filters.category;
      if (filters.academicYear) query.academicYear = filters.academicYear;
    }

    students = await User.find(query)
      .populate('hostel')
      .populate('hostelCategory')
      .populate('room')
      .sort({ name: 1 });
  }

  // 1. Group students for detail report: Hostel -> Category -> Room Number
  const grouped = {};
  const hostelSummaries = {};
  let grandTotal = 0;

  // Colleges map for Pivot Matrix Table
  const collegesMap = {};

  students.forEach(student => {
    const hostelName = student.hostel?.name || 'Unassigned Hostel';
    const categoryName = student.hostelCategory?.name || student.category || 'Unassigned Category';
    const roomNo = student.room?.roomNumber || student.roomNumber || 'Unassigned Room';
    const collegeName = student.college?.name || 'Unassigned College';
    const courseName = student.course || 'Unassigned Course';
    const yearVal = student.year ? `${student.year} Year` : 'Unassigned Year';

    // Detail grouping
    if (!grouped[hostelName]) grouped[hostelName] = {};
    if (!grouped[hostelName][categoryName]) grouped[hostelName][categoryName] = {};
    if (!grouped[hostelName][categoryName][roomNo]) grouped[hostelName][categoryName][roomNo] = [];
    grouped[hostelName][categoryName][roomNo].push(student);

    // Summary calculations (total and category)
    if (!hostelSummaries[hostelName]) {
      hostelSummaries[hostelName] = {
        total: 0,
        categories: {}
      };
    }
    hostelSummaries[hostelName].total++;
    grandTotal++;

    if (!hostelSummaries[hostelName].categories[categoryName]) {
      hostelSummaries[hostelName].categories[categoryName] = 0;
    }
    hostelSummaries[hostelName].categories[categoryName]++;

    // Pivot Matrix Table grouping
    if (!collegesMap[collegeName]) {
      collegesMap[collegeName] = { name: collegeName, count: 0, courses: {} };
    }
    collegesMap[collegeName].count++;

    if (!collegesMap[collegeName].courses[courseName]) {
      collegesMap[collegeName].courses[courseName] = { name: courseName, count: 0, hostels: {} };
    }
    collegesMap[collegeName].courses[courseName].count++;

    const courseObj = collegesMap[collegeName].courses[courseName];
    if (!courseObj.hostels[hostelName]) {
      courseObj.hostels[hostelName] = { name: hostelName, count: 0, categories: {} };
    }
    courseObj.hostels[hostelName].count++;

    const hostelObj = courseObj.hostels[hostelName];
    if (!hostelObj.categories[categoryName]) {
      hostelObj.categories[categoryName] = { name: categoryName, count: 0, years: {} };
    }
    hostelObj.categories[categoryName].count++;

    const categoryObj = hostelObj.categories[categoryName];
    if (!categoryObj.years[yearVal]) {
      categoryObj.years[yearVal] = 0;
    }
    categoryObj.years[yearVal]++;
  });

  // Pivot Matrix helpers
  const getCollegeColumnCount = (college, hostelName, categoryName) => {
    let count = 0;
    Object.values(college.courses).forEach(course => {
      if (course.hostels[hostelName]) {
        const hostelObj = course.hostels[hostelName];
        if (hostelObj.categories[categoryName]) {
          count += hostelObj.categories[categoryName].count;
        }
      }
    });
    return count;
  };

  const getCourseColumnCount = (course, hostelName, categoryName) => {
    let count = 0;
    if (course.hostels[hostelName]) {
      const hostelObj = course.hostels[hostelName];
      if (hostelObj.categories[categoryName]) {
        count += hostelObj.categories[categoryName].count;
      }
    }
    return count;
  };

  const getYearColumnCount = (course, yearName, hostelName, categoryName) => {
    if (course.hostels[hostelName]) {
      const hostelObj = course.hostels[hostelName];
      if (hostelObj.categories[categoryName]) {
        return hostelObj.categories[categoryName].years[yearName] || 0;
      }
    }
    return 0;
  };

  const getYearTotalCount = (course, yearName) => {
    let total = 0;
    Object.values(course.hostels).forEach(hostelObj => {
      Object.values(hostelObj.categories).forEach(catObj => {
        total += (catObj.years[yearName] || 0);
      });
    });
    return total;
  };

  const getCourseYears = (course) => {
    const years = new Set();
    Object.values(course.hostels).forEach(hostelObj => {
      Object.values(hostelObj.categories).forEach(catObj => {
        Object.keys(catObj.years).forEach(yr => years.add(yr));
      });
    });
    return Array.from(years).sort();
  };

  // Derive unique Hostel + Category combinations for Pivot Matrix columns
  const groupsForPivot = {};
  students.forEach(student => {
    const hostelName = student.hostel?.name || 'Unassigned Hostel';
    const categoryName = student.hostelCategory?.name || student.category || 'Unassigned Category';
    if (!groupsForPivot[hostelName]) {
      groupsForPivot[hostelName] = new Set();
    }
    groupsForPivot[hostelName].add(categoryName);
  });

  const hostelGroups = [];
  Object.keys(groupsForPivot).sort().forEach(hostelName => {
    const categories = Array.from(groupsForPivot[hostelName]).sort();
    hostelGroups.push({
      hostelName,
      categories: categories.map(catName => ({
        categoryName: catName,
        key: `${hostelName} - ${catName}`
      }))
    });
  });

  const columns = [];
  hostelGroups.forEach(group => {
    group.categories.forEach(cat => {
      columns.push({
        hostelName: group.hostelName,
        categoryName: cat.categoryName,
        key: cat.key
      });
    });
  });

  const sortedHostels = Object.keys(grouped).sort();
  const uniqueYears = Array.from(new Set(students.map(s => s.academicYear).filter(Boolean)));
  const resolvedYear = filters?.academicYear || (uniqueYears.length === 1 ? uniqueYears[0] : (uniqueYears.length > 1 ? 'All Years' : ''));
  
  const getDefaultAcademicYear = () => {
    const date = new Date();
    const currentMonth = date.getMonth();
    const currentYear = date.getFullYear();
    if (currentMonth >= 5) {
      return `${currentYear}-${currentYear + 1}`;
    }
    return `${currentYear - 1}-${currentYear}`;
  };
  const displayYear = resolvedYear || getDefaultAcademicYear();
  const reportTitle = isLiveMode ? 'Live Hostel Occupancy Report' : `Hostel Occupancy Report (${displayYear})`;
  const reportSubtitle = isLiveMode ? 'Live Overall Abstract & Summary' : 'Overall Abstract & Summary';
  const detailSubtitle = isLiveMode ? 'Detailed Room-Wise Active List' : 'Detailed Room-Wise Student List';
  const generatedDate = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  // Build HTML table for breakdown
  let breakdownRows = '';
  sortedHostels.forEach((hostelName) => {
    const categories = hostelSummaries[hostelName].categories;
    const sortedCats = Object.keys(categories).sort();
    
    sortedCats.forEach((catName, idx) => {
      breakdownRows += `<tr>`;
      if (idx === 0) {
        breakdownRows += `<td rowspan="${sortedCats.length}" style="font-weight: bold; vertical-align: middle;">${hostelName}</td>`;
      }
      breakdownRows += `
        <td>${catName}</td>
        <td style="text-align: right; font-weight: bold;">${categories[catName]}</td>
      </tr>`;
    });
  });

  // Build HTML for details and summaries
  let hostelSummariesHtml = '';
  let roomDetailsHtml = '';

  sortedHostels.forEach((hostelName) => {
    const categories = grouped[hostelName];
    const sortedCategories = Object.keys(categories).sort();

    // Group counts by Course and Category for this hostel
    const hostelStudents = students.filter(s => (s.hostel?.name || 'Unassigned Hostel') === hostelName);
    const hostelCourses = Array.from(new Set(hostelStudents.map(s => s.course || 'Unassigned Course'))).sort();
    const hostelCats = Array.from(new Set(hostelStudents.map(s => s.hostelCategory?.name || s.category || 'Unassigned Category'))).sort();

    const matrix = {};
    const courseTotals = {};
    const catTotals = {};
    let hostelGrandTotal = 0;

    hostelStudents.forEach(s => {
      const cName = s.course || 'Unassigned Course';
      const catName = s.hostelCategory?.name || s.category || 'Unassigned Category';

      if (!matrix[cName]) matrix[cName] = {};
      if (!matrix[cName][catName]) matrix[cName][catName] = 0;
      matrix[cName][catName]++;

      courseTotals[cName] = (courseTotals[cName] || 0) + 1;
      catTotals[catName] = (catTotals[catName] || 0) + 1;
      hostelGrandTotal++;
    });

    let hostelMatrixHtml = `
      <div style="margin-bottom: 25px; page-break-inside: avoid;">
        <table class="summary-table" style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 11px;">
          <thead>
            <tr style="background-color: #f1f5f9;">
              <th style="border: 1px solid #cbd5e1; padding: 6px 8px; font-weight: bold; text-align: left; background-color: #e2e8f0; color: #0f172a;">Course</th>
              ${hostelCats.map(cat => `
                <th style="border: 1px solid #cbd5e1; padding: 6px 8px; font-weight: bold; text-align: center; background-color: #e2e8f0; color: #0f172a;">${cat}</th>
              `).join('')}
              <th style="border: 1px solid #cbd5e1; padding: 6px 8px; font-weight: bold; text-align: right; width: 80px; background-color: #e2e8f0; color: #0f172a;">Total</th>
            </tr>
          </thead>
          <tbody>
    `;

    hostelCourses.forEach(course => {
      hostelMatrixHtml += `
        <tr>
          <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-weight: 500;">${course}</td>
          ${hostelCats.map(cat => {
            const count = matrix[course]?.[cat] || 0;
            return `<td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center; ${count === 0 ? 'color: #cbd5e1;' : 'font-weight: bold;'}">${count === 0 ? '-' : count}</td>`;
          }).join('')}
          <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; font-weight: bold; background-color: #f8fafc;">${courseTotals[course] || 0}</td>
        </tr>
      `;
    });

    hostelMatrixHtml += `
            <tr style="background-color: #eff6ff; font-weight: bold; color: #0f172a; border-top: 2px solid #cbd5e1;">
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-weight: bold;">Total</td>
              ${hostelCats.map(cat => `
                <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center; font-weight: bold;">${catTotals[cat] || 0}</td>
              `).join('')}
              <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; background-color: #dbeafe; font-weight: bold; color: #1d4ed8;">${hostelGrandTotal}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    hostelSummariesHtml += `
      <div class="hostel-section" style="page-break-inside: avoid; margin-bottom: 30px;">
        <div class="hostel-title">${hostelName} Abstract</div>
        ${hostelMatrixHtml}
      </div>
    `;

    let hostelRoomDetails = `
      <div class="hostel-section">
        <div class="hostel-title">${hostelName} - Detailed Room-Wise Active List</div>
    `;

    sortedCategories.forEach((categoryName) => {
      const rooms = categories[categoryName];
      const sortedRooms = Object.keys(rooms).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

      hostelRoomDetails += `
        <div class="category-section">
          <div class="category-title">Category: ${categoryName}</div>`;

      sortedRooms.forEach((roomNo) => {
        const roomStudentsList = rooms[roomNo];
        
        hostelRoomDetails += `
          <div class="room-section">
            <div class="room-title">Room ${roomNo} (${roomStudentsList.length} ${isLiveMode ? 'Residents' : 'Students'})</div>
            <table class="detail-table">
              <thead>
                <tr>
                  <th style="width: 8%">#</th>
                  <th style="width: 30%">Roll Number</th>
                  <th style="width: 35%">Student Name</th>
                  <th style="width: 27%">Course & Branch</th>
                </tr>
              </thead>
              <tbody>`;

        roomStudentsList.forEach((student, index) => {
          const courseBranch = `${student.course || ''} - ${student.branch || ''}`;
          hostelRoomDetails += `
            <tr>
              <td>${index + 1}</td>
              <td><strong>${student.rollNumber || 'N/A'}</strong></td>
              <td>${student.name || 'N/A'}</td>
              <td>${courseBranch}</td>
            </tr>`;
        });

        hostelRoomDetails += `
              </tbody>
            </table>
          </div>`;
      });

      hostelRoomDetails += `</div>`; // category-section
    });

    hostelRoomDetails += `</div>`; // hostel-section
    roomDetailsHtml += hostelRoomDetails;
  });

  // Build Pivot Matrix Table HTML
  let pivotMatrixHtml = `
    <table class="pivot-table">
      <thead>
        <tr class="header-row-1">
          <th rowspan="2">Institution / Course / Year</th>
          ${hostelGroups.map(group => `
            <th colspan="${group.categories.length}" class="text-center" style="border-bottom: 1px solid #cbd5e1;">
              ${group.hostelName}
            </th>
          `).join('')}
          <th rowspan="2" class="text-right" style="width: 100px;">Total</th>
        </tr>
        <tr class="header-row-2">
          ${hostelGroups.map(group => 
            group.categories.map(cat => `
              <th class="text-center">
                ${cat.categoryName}
              </th>
            `).join('')
          ).join('')}
        </tr>
      </thead>
      <tbody>
  `;

  const normalizeCourseName = (courseName) => {
    if (!courseName) return '';
    return courseName.trim().toUpperCase().replace(/\s+/g, ' ');
  };

  Object.values(collegesMap).sort((a, b) => a.name.localeCompare(b.name)).forEach(college => {
    pivotMatrixHtml += `
      <tr class="level-0">
        <td>${college.name}</td>
        ${columns.map(col => {
          const val = getCollegeColumnCount(college, col.hostelName, col.categoryName);
          return `<td class="text-center ${val === 0 ? 'cell-zero' : 'text-bold'}">${val === 0 ? '-' : val}</td>`;
        }).join('')}
        <td class="text-right text-bold">${college.count}</td>
      </tr>
    `;

    Object.values(college.courses).sort((a, b) => a.name.localeCompare(b.name)).forEach(course => {
      pivotMatrixHtml += `
        <tr class="level-1">
          <td style="padding-left: 15px;"><span class="hierarchy-arrow">↳</span> ${course.name}</td>
          ${columns.map(col => {
            const val = getCourseColumnCount(course, col.hostelName, col.categoryName);
            return `<td class="text-center ${val === 0 ? 'cell-zero' : 'text-bold'}">${val === 0 ? '-' : val}</td>`;
          }).join('')}
          <td class="text-right text-bold">${course.count}</td>
        </tr>
      `;
    });
  });

  // Calculate column totals across all colleges
  let totalRowHtml = `
      <tr style="background-color: #eff6ff; font-weight: bold; border-top: 2.5px double #1e3a8a;">
        <td style="font-weight: bold; color: #1e3a8a;">Total</td>
  `;
  
  let grandSum = 0;
  columns.forEach(col => {
    let colSum = 0;
    Object.values(collegesMap).forEach(college => {
      colSum += getCollegeColumnCount(college, col.hostelName, col.categoryName);
    });
    grandSum += colSum;
    totalRowHtml += `<td class="text-center text-bold" style="color: #1e3a8a;">${colSum === 0 ? '-' : colSum}</td>`;
  });

  totalRowHtml += `
        <td class="text-right text-bold" style="background-color: #dbeafe; color: #1d4ed8;">${grandSum}</td>
      </tr>
  `;

  pivotMatrixHtml += totalRowHtml + `
      </tbody>
    </table>
  `;

  // Construct complete HTML page
  return `<!DOCTYPE html>
<html>
<head>
  <title>${reportTitle}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      margin: 1.5cm;
      padding: 0;
      background-color: #ffffff;
    }
    .page-break {
      page-break-after: always;
      break-after: page;
    }
    .header-container {
      text-align: center;
      margin-bottom: 25px;
      border-bottom: 2px solid #1e3a8a;
      padding-bottom: 12px;
    }
    h1 {
      font-size: 24px;
      color: #1e3a8a;
      margin: 0 0 5px 0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .report-subtitle {
      font-size: 13px;
      color: #475569;
      margin: 5px 0;
      font-weight: 500;
    }
    .report-date {
      font-size: 11px;
      color: #64748b;
      margin: 0;
    }
    .abstract-section {
      margin-top: 15px;
    }
    .abstract-title {
      font-size: 16px;
      font-weight: 700;
      color: #1e3a8a;
      margin: 20px 0 10px 0;
      text-transform: uppercase;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 4px;
    }
    .summary-row {
      display: flex;
      justify-content: space-around;
      align-items: center;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 12px 10px;
      background-color: #f8fafc;
      margin-bottom: 25px;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    }
    .summary-item {
      font-size: 13px;
      color: #334155;
      font-weight: 500;
      display: inline-block;
      margin-right: 15px;
    }
    .summary-item strong {
      color: #1d4ed8;
      font-size: 16px;
      margin-left: 5px;
    }
    .pivot-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 25px;
      font-size: 10px;
    }
    .pivot-table th, .pivot-table td {
      border: 1px solid #cbd5e1;
      padding: 6px 8px;
      text-align: left;
    }
    .pivot-table th {
      background-color: #e2e8f0;
      color: #0f172a;
      font-weight: bold;
      font-size: 11px;
      border: 1px solid #cbd5e1;
    }
    .pivot-table .header-row-2 th {
      background-color: #f1f5f9;
      color: #1e293b;
      font-size: 10px;
      padding: 6px 8px;
      font-weight: bold;
      border: 1px solid #cbd5e1;
    }
    .pivot-table .text-center {
      text-align: center;
    }
    .pivot-table .text-right {
      text-align: right;
    }
    .pivot-table .text-bold {
      font-weight: bold;
    }
    .pivot-table .cell-zero {
      color: #cbd5e1;
    }
    .pivot-table .level-0 {
      background-color: #f1f5f9;
      font-weight: bold;
      font-size: 11px;
      color: #0f172a;
    }
    .pivot-table .level-1 {
      background-color: #f8fafc;
      font-weight: bold;
      color: #1e293b;
    }
    .pivot-table .level-2 {
      font-weight: 400;
      color: #475569;
    }
    .hierarchy-arrow {
      color: #94a3b8;
      font-weight: normal;
      margin-right: 5px;
      font-size: 12px;
    }
    .hostel-section {
      margin-bottom: 30px;
    }
    .hostel-title {
      font-size: 18px;
      font-weight: bold;
      color: #1e3a8a;
      border-bottom: 1.5px solid #1e3a8a;
      padding-bottom: 4px;
      margin-bottom: 15px;
    }
    .category-section {
      margin-bottom: 20px;
    }
    .category-title {
      font-size: 13px;
      font-weight: bold;
      color: #1e3a8a;
      background-color: #eff6ff;
      padding: 6px 12px;
      border-radius: 4px;
      margin-bottom: 10px;
      border-left: 3px solid #3b82f6;
    }
    .room-section {
      margin-bottom: 15px;
      page-break-inside: avoid;
    }
    .room-title {
      font-size: 12px;
      font-weight: bold;
      color: #334155;
      margin-bottom: 5px;
    }
    .detail-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
    }
    .detail-table th, .detail-table td {
      border: 1px solid #cbd5e1;
      padding: 5px 8px;
      font-size: 11px;
      text-align: left;
    }
    .detail-table th {
      background-color: #e2e8f0;
      color: #0f172a;
      font-weight: bold;
    }
    .detail-table tr:nth-child(even) {
      background-color: #f8fafc;
    }
  </style>
</head>
<body>
  ${includeSummary ? `
  <!-- PAGE 1: ABSTRACT & SUMMARY -->
  <div class="abstract-page page-break">
    <div class="header-container">
      <h1>${reportTitle}</h1>
      <div class="report-subtitle">${reportSubtitle}</div>
      <div class="report-date">Generated on: ${generatedDate}</div>
    </div>

    <div class="abstract-section">
      <div class="abstract-title">Overall Abstract</div>
      
      <div class="summary-row">
        <span class="summary-item">
          ${isLiveMode ? 'Total Active Residents' : 'Total Registered Students'}: <strong>${grandTotal}</strong>
        </span>
        ${sortedHostels.map(h => `<span class="summary-item">${h}: <strong>${hostelSummaries[h].total}</strong></span>`).join('')}
      </div>

      <div class="abstract-title">Breakdown Matrix</div>
      ${pivotMatrixHtml}
    </div>
  </div>

  <!-- PAGE 1.5: HOSTEL ABSTRACT SUMMARY MATRICES -->
  <div class="abstract-page ${includeDetails ? 'page-break' : ''}">
    <div class="header-container">
      <h1>${reportTitle}</h1>
      <div class="report-subtitle">Hostel-wise Abstract Matrix Summaries</div>
    </div>
    ${hostelSummariesHtml}
  </div>
  ` : ''}

  ${includeDetails ? `
  <!-- PAGE 2+: DETAIL LISTS -->
  <div class="detail-pages">
    <div class="header-container">
      <h1>${reportTitle}</h1>
      <div class="report-subtitle">${detailSubtitle}</div>
    </div>
    ${roomDetailsHtml}
  </div>
  ` : ''}
</body>
</html>`;
};
