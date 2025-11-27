import axios from 'axios';
import { createError } from './error.js';

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL;
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const loginUrl = 'https://hms.pydahsoft.in';

// Email templates
const EMAIL_TEMPLATES = {
  studentRegistration: {
    subject: 'Welcome to Pydah Hostel - Your Login Credentials',
    html: (studentName, rollNumber, generatedPassword, loginUrl) => `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Pydah Hostel</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #2c3e50;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
          }
          
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            overflow: hidden;
          }
          
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px 30px;
            text-align: center;
            position: relative;
          }
          
          .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grain" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="25" cy="25" r="1" fill="white" opacity="0.1"/><circle cx="75" cy="75" r="1" fill="white" opacity="0.1"/><circle cx="50" cy="10" r="0.5" fill="white" opacity="0.1"/><circle cx="10" cy="60" r="0.5" fill="white" opacity="0.1"/><circle cx="90" cy="40" r="0.5" fill="white" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grain)"/></svg>');
            opacity: 0.3;
          }
          
          .logo {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 10px;
            position: relative;
            z-index: 1;
          }
          
          .subtitle {
            font-size: 16px;
            opacity: 0.9;
            position: relative;
            z-index: 1;
          }
          
          .content {
            padding: 40px 30px;
          }
          
          .greeting {
            font-size: 18px;
            color: #2c3e50;
            margin-bottom: 25px;
            font-weight: 500;
          }
          
          .message {
            color: #5a6c7d;
            margin-bottom: 30px;
            font-size: 16px;
          }
          
          .credentials-card {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            border-radius: 15px;
            padding: 30px;
            margin: 30px 0;
            border: 2px solid #e3f2fd;
            position: relative;
            overflow: hidden;
          }
          
          .credentials-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #667eea, #764ba2);
          }
          
          .credentials-title {
            font-size: 20px;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 25px;
            text-align: center;
          }
          
          .credential-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 0;
            border-bottom: 1px solid #e9ecef;
          }
          
          .credential-row:last-child {
            border-bottom: none;
          }
          
          .credential-label {
            font-weight: 600;
            color: #495057;
            font-size: 16px;
          }
          
          .credential-value {
            background: #ffffff;
            padding: 12px 20px;
            border-radius: 10px;
            font-family: 'Courier New', monospace;
            font-weight: 600;
            font-size: 16px;
            border: 2px solid #e9ecef;
            color: #2c3e50;
            min-width: 200px;
            text-align: center;
          }
          
          .password-value {
            color: #e74c3c;
            letter-spacing: 2px;
            font-size: 18px;
          }
          
          .warning-box {
            background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
            border-left: 5px solid #f39c12;
            padding: 20px;
            border-radius: 10px;
            margin: 30px 0;
          }
          
          .warning-icon {
            font-size: 20px;
            margin-right: 10px;
          }
          
          .warning-text {
            color: #856404;
            font-weight: 500;
            font-size: 16px;
          }
          
          .login-section {
            text-align: center;
            margin: 40px 0;
          }
          
          .login-button {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 18px 40px;
            text-decoration: none;
            border-radius: 50px;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.3s ease;
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
          }
          
          .login-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 15px 30px rgba(102, 126, 234, 0.4);
          }
          
          .security-section {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            border-radius: 15px;
            padding: 25px;
            margin: 30px 0;
          }
          
          .security-title {
            font-size: 18px;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
          }
          
          .security-icon {
            margin-right: 10px;
            font-size: 20px;
          }
          
          .security-list {
            list-style: none;
            padding: 0;
          }
          
          .security-list li {
            padding: 8px 0;
            color: #5a6c7d;
            position: relative;
            padding-left: 25px;
          }
          
          .security-list li::before {
            content: '✓';
            position: absolute;
            left: 0;
            color: #27ae60;
            font-weight: bold;
            font-size: 16px;
          }
          
          .footer {
            background: #f8f9fa;
            padding: 30px;
            text-align: center;
            border-top: 1px solid #e9ecef;
          }
          
          .footer-text {
            color: #6c757d;
            font-size: 14px;
            margin-bottom: 10px;
          }
          
          .footer-copyright {
            color: #adb5bd;
            font-size: 12px;
          }
          
          @media (max-width: 600px) {
            .credential-row {
              flex-direction: column;
              align-items: flex-start;
              gap: 10px;
            }
            
            .credential-value {
              min-width: auto;
              width: 100%;
            }
            
            .content {
              padding: 20px;
            }
            
            .header {
              padding: 30px 20px;
            }
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <div class="logo">🏠 Pydah Hostel</div>
            <div class="subtitle">Welcome, ${studentName}!</div>
          </div>
          
          <div class="content">
            <div class="greeting">
              Dear <strong>${studentName}</strong>,
            </div>
            
            <div class="message">
              Welcome to Pydah Hostel! Your account has been successfully created and you can now access the system using the credentials provided below.
            </div>
            
            <div class="credentials-card">
              <div class="credentials-title">🔐 Your Login Credentials</div>
              <div class="credential-row">
                <span class="credential-label">Roll Number:</span>
                <span class="credential-value">${rollNumber}</span>
              </div>
              <div class="credential-row">
                <span class="credential-label">Password:</span>
                <span class="credential-value password-value">${generatedPassword}</span>
              </div>
            </div>
            
            <div class="warning-box">
              <span class="warning-icon">⚠️</span>
              <span class="warning-text">
                <strong>Important:</strong> Please change your password immediately after your first login for security purposes.
              </span>
            </div>
            
            <div class="login-section">
              <a href="${loginUrl}" class="login-button">
                🚀 Login to System
              </a>
            </div>
            
            <div class="security-section">
              <div class="security-title">
                <span class="security-icon">🔒</span>
                Security Best Practices
              </div>
              <ul class="security-list">
                <li>Change your password immediately after first login</li>
                <li>Use a strong password with letters, numbers, and special characters</li>
                <li>Never share your login credentials with anyone</li>
                <li>Log out when using shared computers</li>
                <li>Keep your contact information updated</li>
                <li>Enable two-factor authentication if available</li>
              </ul>
            </div>
            
            <div style="margin-top: 30px; color: #5a6c7d; font-size: 16px;">
              If you have any questions or need assistance, please contact the hostel administration.
            </div>
            
            <div style="margin-top: 20px; color: #5a6c7d; font-size: 16px;">
              Best regards,<br>
              <strong style="color: #2c3e50;">Pydah Hostel Team</strong>
            </div>
          </div>
          
          <div class="footer">
            <div class="footer-text">
              This is an automated message. Please do not reply to this email.
            </div>
            <div class="footer-copyright">
              © ${new Date().getFullYear()} Pydah Hostel. All rights reserved.
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
    text: (studentName, rollNumber, generatedPassword, loginUrl) => `
Welcome to Pydah Hostel!

Dear ${studentName},

Welcome to Pydah Hostel! Your account has been successfully created and you can now access the system using the credentials provided below.

Your Login Credentials:
- Roll Number: ${rollNumber}
- Password: ${generatedPassword}

IMPORTANT: Please change your password immediately after your first login for security purposes.

Login URL: ${loginUrl}

Security Best Practices:
- Change your password immediately after first login
- Use a strong password with letters, numbers, and special characters
- Never share your login credentials with anyone
- Log out when using shared computers
- Keep your contact information updated
- Enable two-factor authentication if available

If you have any questions or need assistance, please contact the hostel administration.

Best regards,
Pydah Hostel Team

---
This is an automated message. Please do not reply to this email.
© ${new Date().getFullYear()} Pydah Hostel. All rights reserved.
    `
  },
  
  passwordReset: {
    subject: 'Password Reset - Hostel Management System',
    html: (studentName, rollNumber, newPassword, loginUrl) => `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset - Hostel Management System</title>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f4f4f4;
          }
          .container {
            background-color: #ffffff;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #e3f2fd;
          }
          .logo {
            font-size: 24px;
            font-weight: bold;
            color: #1976d2;
            margin-bottom: 10px;
          }
          .credentials-box {
            background-color: #e3f2fd;
            border: 2px solid #1976d2;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
          }
          .credential-item {
            margin: 10px 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .label {
            font-weight: bold;
            color: #1976d2;
          }
          .value {
            font-family: 'Courier New', monospace;
            background-color: #ffffff;
            padding: 5px 10px;
            border-radius: 4px;
            border: 1px solid #ccc;
            font-weight: bold;
          }
          .password {
            color: #d32f2f;
            font-size: 18px;
            letter-spacing: 2px;
          }
          .login-button {
            display: inline-block;
            background-color: #1976d2;
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
            font-weight: bold;
            text-align: center;
          }
          .login-button:hover {
            background-color: #1565c0;
          }
          .important-note {
            background-color: #fff3e0;
            border-left: 4px solid #ff9800;
            padding: 15px;
            margin: 20px 0;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #e0e0e0;
            color: #666;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🏠 Hostel Management System</div>
            <div style="font-size: 18px; color: #424242;">Password Reset</div>
          </div>
          
          <p>Dear <strong>${studentName}</strong>,</p>
          
          <p>Your password has been reset by the administrator. Here are your new login credentials:</p>
          
          <div class="credentials-box">
            <h3 style="color: #1976d2; margin-top: 0;">Your New Login Credentials</h3>
            <div class="credential-item">
              <span class="label">Roll Number:</span>
              <span class="value">${rollNumber}</span>
            </div>
            <div class="credential-item">
              <span class="label">New Password:</span>
              <span class="value password">${newPassword}</span>
            </div>
          </div>
          
          <div class="important-note">
            <strong>⚠️ Important:</strong> Please change your password immediately after logging in for security purposes.
          </div>
          
          <div style="text-align: center;">
            <a href="${loginUrl}" class="login-button">Login to System</a>
          </div>
          
          <p>If you did not request this password reset, please contact the hostel administration immediately.</p>
          
          <p>Best regards,<br>
          <strong>Hostel Management Team</strong></p>
          
          <div class="footer">
            <p>This is an automated message. Please do not reply to this email.</p>
            <p>© ${new Date().getFullYear()} Hostel Management System. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: (studentName, rollNumber, newPassword, loginUrl) => `
Password Reset - Hostel Management System

Dear ${studentName},

Your password has been reset by the administrator. Here are your new login credentials:

Your New Login Credentials:
- Roll Number: ${rollNumber}
- New Password: ${newPassword}

IMPORTANT: Please change your password immediately after logging in for security purposes.

Login URL: ${loginUrl}

If you did not request this password reset, please contact the hostel administration immediately.

Best regards,
Hostel Management Team

---
This is an automated message. Please do not reply to this email.
© ${new Date().getFullYear()} Hostel Management System. All rights reserved.
    `
  },
  feeReminder1: {
    subject: 'First Fee Reminder - Pydah Hostel',
    html: (studentName, rollNumber, academicYear, feeAmounts, dueDates, loginUrl) => `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>First Fee Reminder - Pydah Hostel</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #2c3e50;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
          }
          
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            overflow: hidden;
          }
          
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px 30px;
            text-align: center;
            position: relative;
          }
          
          .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grain" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="25" cy="25" r="1" fill="white" opacity="0.1"/><circle cx="75" cy="75" r="1" fill="white" opacity="0.1"/><circle cx="50" cy="10" r="0.5" fill="white" opacity="0.1"/><circle cx="10" cy="60" r="0.5" fill="white" opacity="0.1"/><circle cx="90" cy="40" r="0.5" fill="white" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grain)"/></svg>');
            opacity: 0.3;
          }
          
          .logo {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 10px;
            position: relative;
            z-index: 1;
          }
          
          .subtitle {
            font-size: 16px;
            opacity: 0.9;
            position: relative;
            z-index: 1;
          }
          
          .content {
            padding: 40px 30px;
          }
          
          .greeting {
            font-size: 18px;
            color: #2c3e50;
            margin-bottom: 25px;
            font-weight: 500;
          }
          
          .message {
            color: #5a6c7d;
            margin-bottom: 30px;
            font-size: 16px;
          }
          
          .fee-card {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            border-radius: 15px;
            padding: 30px;
            margin: 30px 0;
            border: 2px solid #e3f2fd;
            position: relative;
            overflow: hidden;
          }
          
          .fee-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #667eea, #764ba2);
          }
          
          .fee-title {
            font-size: 20px;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 25px;
            text-align: center;
          }
          
          .fee-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 0;
            border-bottom: 1px solid #e9ecef;
          }
          
          .fee-row:last-child {
            border-bottom: none;
          }
          
          .fee-label {
            font-weight: 600;
            color: #495057;
            font-size: 16px;
          }
          
          .fee-value {
            background: #ffffff;
            padding: 12px 20px;
            border-radius: 10px;
            font-family: 'Courier New', monospace;
            font-weight: 600;
            font-size: 16px;
            border: 2px solid #e9ecef;
            color: #2c3e50;
            min-width: 120px;
            text-align: center;
          }
          
          .amount-value {
            color: #e74c3c;
            font-size: 18px;
          }
          
          .reminder-box {
            background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
            border-left: 5px solid #f39c12;
            padding: 20px;
            border-radius: 10px;
            margin: 30px 0;
          }
          
          .reminder-icon {
            font-size: 20px;
            margin-right: 10px;
          }
          
          .reminder-text {
            color: #856404;
            font-weight: 500;
            font-size: 16px;
          }
          
          .login-section {
            text-align: center;
            margin: 40px 0;
          }
          
          .login-button {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 18px 40px;
            text-decoration: none;
            border-radius: 50px;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.3s ease;
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
          }
          
          .login-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 15px 30px rgba(102, 126, 234, 0.4);
          }
          
          .footer {
            background: #f8f9fa;
            padding: 30px;
            text-align: center;
            border-top: 1px solid #e9ecef;
          }
          
          .footer-text {
            color: #6c757d;
            font-size: 14px;
            margin-bottom: 10px;
          }
          
          .footer-copyright {
            color: #adb5bd;
            font-size: 12px;
          }
          
          @media (max-width: 600px) {
            .fee-row {
              flex-direction: column;
              align-items: flex-start;
              gap: 10px;
            }
            
            .fee-value {
              min-width: auto;
              width: 100%;
            }
            
            .content {
              padding: 20px;
            }
            
            .header {
              padding: 30px 20px;
            }
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <div class="logo">🏠 Pydah Hostel</div>
            <div class="subtitle">First Fee Reminder - ${academicYear}</div>
          </div>
          
          <div class="content">
            <div class="greeting">
              Dear <strong>${studentName}</strong>,
            </div>
            
            <div class="message">
              We hope this message finds you well. This is a gentle reminder regarding your hostel fee payments for the academic year <strong>${academicYear}</strong>. 
              Please review the fee details below and ensure timely payment to avoid any inconvenience.
            </div>
            
            <div class="fee-card">
              <div class="fee-title">💰 Fee Payment Details</div>
              <div class="fee-row">
                <span class="fee-label">Roll Number:</span>
                <span class="fee-value">${rollNumber}</span>
              </div>
              <div class="fee-row">
                <span class="fee-label">Academic Year:</span>
                <span class="fee-value">${academicYear}</span>
              </div>
              <div class="fee-row">
                <span class="fee-label">Term 1 Amount:</span>
                <span class="fee-value amount-value">₹${feeAmounts.term1}</span>
              </div>
              <div class="fee-row">
                <span class="fee-label">Term 2 Amount:</span>
                <span class="fee-value amount-value">₹${feeAmounts.term2}</span>
              </div>
              <div class="fee-row">
                <span class="fee-label">Term 3 Amount:</span>
                <span class="fee-value amount-value">₹${feeAmounts.term3}</span>
              </div>
            </div>
            
            <div class="reminder-box">
              <span class="reminder-icon">💡</span>
              <span class="reminder-text">
                <strong>Friendly Reminder:</strong> This is your first fee reminder. Please ensure all payments are made on time to maintain your hostel accommodation.
              </span>
            </div>
            
            <div class="login-section">
              <a href="${loginUrl}" class="login-button">
                📱 Check Fee Status
              </a>
            </div>
            
            <div style="margin-top: 30px; color: #5a6c7d; font-size: 16px;">
              If you have already made the payment or have any questions regarding the fee structure, please contact the hostel administration.
            </div>
            
            <div style="margin-top: 20px; color: #5a6c7d; font-size: 16px;">
              Best regards,<br>
              <strong style="color: #2c3e50;">Pydah Hostel Management Team</strong>
            </div>
          </div>
          
          <div class="footer">
            <div class="footer-text">
              This is an automated reminder. Please do not reply to this email.
            </div>
            <div class="footer-copyright">
              © ${new Date().getFullYear()} Pydah Hostel. All rights reserved.
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
    text: (studentName, rollNumber, academicYear, feeAmounts, dueDates, loginUrl) => `
First Fee Reminder - Pydah Hostel

Dear ${studentName},

We hope this message finds you well. This is a gentle reminder regarding your hostel fee payments for the academic year ${academicYear}. 
Please review the fee details below and ensure timely payment to avoid any inconvenience.

Fee Payment Details:
- Roll Number: ${rollNumber}
- Academic Year: ${academicYear}
- Term 1 Amount: ₹${feeAmounts.term1}
- Term 2 Amount: ₹${feeAmounts.term2}
- Term 3 Amount: ₹${feeAmounts.term3}

Friendly Reminder: This is your first fee reminder. Please ensure all payments are made on time to maintain your hostel accommodation.

Check Fee Status: ${loginUrl}

If you have already made the payment or have any questions regarding the fee structure, please contact the hostel administration.

Best regards,
Pydah Hostel Management Team

---
This is an automated reminder. Please do not reply to this email.
© ${new Date().getFullYear()} Pydah Hostel. All rights reserved.
    `
  },

  feeReminder2: {
    subject: 'Second Fee Reminder - Pydah Hostel',
    html: (studentName, rollNumber, academicYear, feeAmounts, dueDates, loginUrl) => `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Second Fee Reminder - Pydah Hostel</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #2c3e50;
            background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
            min-height: 100vh;
            padding: 20px;
          }
          
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            overflow: hidden;
          }
          
          .header {
            background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
            color: white;
            padding: 40px 30px;
            text-align: center;
            position: relative;
          }
          
          .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grain" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="25" cy="25" r="1" fill="white" opacity="0.1"/><circle cx="75" cy="75" r="1" fill="white" opacity="0.1"/><circle cx="50" cy="10" r="0.5" fill="white" opacity="0.1"/><circle cx="10" cy="60" r="0.5" fill="white" opacity="0.1"/><circle cx="90" cy="40" r="0.5" fill="white" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grain)"/></svg>');
            opacity: 0.3;
          }
          
          .logo {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 10px;
            position: relative;
            z-index: 1;
          }
          
          .subtitle {
            font-size: 16px;
            opacity: 0.9;
            position: relative;
            z-index: 1;
          }
          
          .content {
            padding: 40px 30px;
          }
          
          .greeting {
            font-size: 18px;
            color: #2c3e50;
            margin-bottom: 25px;
            font-weight: 500;
          }
          
          .message {
            color: #5a6c7d;
            margin-bottom: 30px;
            font-size: 16px;
          }
          
          .fee-card {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            border-radius: 15px;
            padding: 30px;
            margin: 30px 0;
            border: 2px solid #e3f2fd;
            position: relative;
            overflow: hidden;
          }
          
          .fee-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #e74c3c, #c0392b);
          }
          
          .fee-title {
            font-size: 20px;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 25px;
            text-align: center;
          }
          
          .fee-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 0;
            border-bottom: 1px solid #e9ecef;
          }
          
          .fee-row:last-child {
            border-bottom: none;
          }
          
          .fee-label {
            font-weight: 600;
            color: #495057;
            font-size: 16px;
          }
          
          .fee-value {
            background: #ffffff;
            padding: 12px 20px;
            border-radius: 10px;
            font-family: 'Courier New', monospace;
            font-weight: 600;
            font-size: 16px;
            border: 2px solid #e9ecef;
            color: #2c3e50;
            min-width: 120px;
            text-align: center;
          }
          
          .amount-value {
            color: #e74c3c;
            font-size: 18px;
          }
          
          .reminder-box {
            background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%);
            border-left: 5px solid #dc3545;
            padding: 20px;
            border-radius: 10px;
            margin: 30px 0;
          }
          
          .reminder-icon {
            font-size: 20px;
            margin-right: 10px;
          }
          
          .reminder-text {
            color: #721c24;
            font-weight: 500;
            font-size: 16px;
          }
          
          .login-section {
            text-align: center;
            margin: 40px 0;
          }
          
          .login-button {
            display: inline-block;
            background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
            color: white;
            padding: 18px 40px;
            text-decoration: none;
            border-radius: 50px;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.3s ease;
            box-shadow: 0 10px 20px rgba(231, 76, 60, 0.3);
          }
          
          .login-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 15px 30px rgba(231, 76, 60, 0.4);
          }
          
          .footer {
            background: #f8f9fa;
            padding: 30px;
            text-align: center;
            border-top: 1px solid #e9ecef;
          }
          
          .footer-text {
            color: #6c757d;
            font-size: 14px;
            margin-bottom: 10px;
          }
          
          .footer-copyright {
            color: #adb5bd;
            font-size: 12px;
          }
          
          @media (max-width: 600px) {
            .fee-row {
              flex-direction: column;
              align-items: flex-start;
              gap: 10px;
            }
            
            .fee-value {
              min-width: auto;
              width: 100%;
            }
            
            .content {
              padding: 20px;
            }
            
            .header {
              padding: 30px 20px;
            }
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <div class="logo">🏠 Pydah Hostel</div>
            <div class="subtitle">Second Fee Reminder - ${academicYear}</div>
          </div>
          
          <div class="content">
            <div class="greeting">
              Dear <strong>${studentName}</strong>,
            </div>
            
            <div class="message">
              This is your second reminder regarding the outstanding hostel fee payments for the academic year <strong>${academicYear}</strong>. 
              We kindly request you to settle the pending amounts at your earliest convenience to avoid any service disruptions.
            </div>
            
            <div class="fee-card">
              <div class="fee-title">💰 Outstanding Fee Details</div>
              <div class="fee-row">
                <span class="fee-label">Roll Number:</span>
                <span class="fee-value">${rollNumber}</span>
              </div>
              <div class="fee-row">
                <span class="fee-label">Academic Year:</span>
                <span class="fee-value">${academicYear}</span>
              </div>
              <div class="fee-row">
                <span class="fee-label">Term 1 Amount:</span>
                <span class="fee-value amount-value">₹${feeAmounts.term1}</span>
              </div>
              <div class="fee-row">
                <span class="fee-label">Term 2 Amount:</span>
                <span class="fee-value amount-value">₹${feeAmounts.term2}</span>
              </div>
              <div class="fee-row">
                <span class="fee-label">Term 3 Amount:</span>
                <span class="fee-value amount-value">₹${feeAmounts.term3}</span>
              </div>
            </div>
            
            <div class="reminder-box">
              <span class="reminder-icon">⚠️</span>
              <span class="reminder-text">
                <strong>Important Notice:</strong> This is your second fee reminder. Please ensure all outstanding payments are cleared promptly to maintain uninterrupted hostel services.
              </span>
            </div>
            
            <div class="login-section">
              <a href="${loginUrl}" class="login-button">
                📱 Check Fee Status
              </a>
            </div>
            
            <div style="margin-top: 30px; color: #5a6c7d; font-size: 16px;">
              If you have any concerns or need assistance with the payment process, please contact the hostel administration immediately.
            </div>
            
            <div style="margin-top: 20px; color: #5a6c7d; font-size: 16px;">
              Best regards,<br>
              <strong style="color: #2c3e50;">Pydah Hostel Management Team</strong>
            </div>
          </div>
          
          <div class="footer">
            <div class="footer-text">
              This is an automated reminder. Please do not reply to this email.
            </div>
            <div class="footer-copyright">
              © ${new Date().getFullYear()} Pydah Hostel. All rights reserved.
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
    text: (studentName, rollNumber, academicYear, feeAmounts, dueDates, loginUrl) => `
Second Fee Reminder - Pydah Hostel

Dear ${studentName},

This is your second reminder regarding the outstanding hostel fee payments for the academic year ${academicYear}. 
We kindly request you to settle the pending amounts at your earliest convenience to avoid any service disruptions.

Outstanding Fee Details:
- Roll Number: ${rollNumber}
- Academic Year: ${academicYear}
- Term 1 Amount: ₹${feeAmounts.term1}
- Term 2 Amount: ₹${feeAmounts.term2}
- Term 3 Amount: ₹${feeAmounts.term3}

Important Notice: This is your second fee reminder. Please ensure all outstanding payments are cleared promptly to maintain uninterrupted hostel services.

Check Fee Status: ${loginUrl}

If you have any concerns or need assistance with the payment process, please contact the hostel administration immediately.

Best regards,
Pydah Hostel Management Team

---
This is an automated reminder. Please do not reply to this email.
© ${new Date().getFullYear()} Pydah Hostel. All rights reserved.
    `
  },

  feeReminder3: {
    subject: 'Final Fee Reminder - Pydah Hostel',
    html: (studentName, rollNumber, academicYear, feeAmounts, dueDates, loginUrl) => `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Final Fee Reminder - Pydah Hostel</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #2c3e50;
            background: linear-gradient(135deg, #8e44ad 0%, #9b59b6 100%);
            min-height: 100vh;
            padding: 20px;
          }
          
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            overflow: hidden;
          }
          
          .header {
            background: linear-gradient(135deg, #8e44ad 0%, #9b59b6 100%);
            color: white;
            padding: 40px 30px;
            text-align: center;
            position: relative;
          }
          
          .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grain" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="25" cy="25" r="1" fill="white" opacity="0.1"/><circle cx="75" cy="75" r="1" fill="white" opacity="0.1"/><circle cx="50" cy="10" r="0.5" fill="white" opacity="0.1"/><circle cx="10" cy="60" r="0.5" fill="white" opacity="0.1"/><circle cx="90" cy="40" r="0.5" fill="white" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grain)"/></svg>');
            opacity: 0.3;
          }
          
          .logo {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 10px;
            position: relative;
            z-index: 1;
          }
          
          .subtitle {
            font-size: 16px;
            opacity: 0.9;
            position: relative;
            z-index: 1;
          }
          
          .content {
            padding: 40px 30px;
          }
          
          .greeting {
            font-size: 18px;
            color: #2c3e50;
            margin-bottom: 25px;
            font-weight: 500;
          }
          
          .message {
            color: #5a6c7d;
            margin-bottom: 30px;
            font-size: 16px;
          }
          
          .fee-card {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            border-radius: 15px;
            padding: 30px;
            margin: 30px 0;
            border: 2px solid #e3f2fd;
            position: relative;
            overflow: hidden;
          }
          
          .fee-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #8e44ad, #9b59b6);
          }
          
          .fee-title {
            font-size: 20px;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 25px;
            text-align: center;
          }
          
          .fee-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 0;
            border-bottom: 1px solid #e9ecef;
          }
          
          .fee-row:last-child {
            border-bottom: none;
          }
          
          .fee-label {
            font-weight: 600;
            color: #495057;
            font-size: 16px;
          }
          
          .fee-value {
            background: #ffffff;
            padding: 12px 20px;
            border-radius: 10px;
            font-family: 'Courier New', monospace;
            font-weight: 600;
            font-size: 16px;
            border: 2px solid #e9ecef;
            color: #2c3e50;
            min-width: 120px;
            text-align: center;
          }
          
          .amount-value {
            color: #8e44ad;
            font-size: 18px;
          }
          
          .reminder-box {
            background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%);
            border-left: 5px solid #dc3545;
            padding: 20px;
            border-radius: 10px;
            margin: 30px 0;
          }
          
          .reminder-icon {
            font-size: 20px;
            margin-right: 10px;
          }
          
          .reminder-text {
            color: #721c24;
            font-weight: 500;
            font-size: 16px;
          }
          
          .login-section {
            text-align: center;
            margin: 40px 0;
          }
          
          .login-button {
            display: inline-block;
            background: linear-gradient(135deg, #8e44ad 0%, #9b59b6 100%);
            color: white;
            padding: 18px 40px;
            text-decoration: none;
            border-radius: 50px;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.3s ease;
            box-shadow: 0 10px 20px rgba(142, 68, 173, 0.3);
          }
          
          .login-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 15px 30px rgba(142, 68, 173, 0.4);
          }
          
          .footer {
            background: #f8f9fa;
            padding: 30px;
            text-align: center;
            border-top: 1px solid #e9ecef;
          }
          
          .footer-text {
            color: #6c757d;
            font-size: 14px;
            margin-bottom: 10px;
          }
          
          .footer-copyright {
            color: #adb5bd;
            font-size: 12px;
          }
          
          @media (max-width: 600px) {
            .fee-row {
              flex-direction: column;
              align-items: flex-start;
              gap: 10px;
            }
            
            .fee-value {
              min-width: auto;
              width: 100%;
            }
            
            .content {
              padding: 20px;
            }
            
            .header {
              padding: 30px 20px;
            }
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <div class="logo">🏠 Pydah Hostel</div>
            <div class="subtitle">Final Fee Reminder - ${academicYear}</div>
          </div>
          
          <div class="content">
            <div class="greeting">
              Dear <strong>${studentName}</strong>,
            </div>
            
            <div class="message">
              This is your final reminder regarding the outstanding hostel fee payments for the academic year <strong>${academicYear}</strong>. 
              Immediate action is required to settle all pending amounts to avoid any service restrictions.
            </div>
            
            <div class="fee-card">
              <div class="fee-title">💰 Final Fee Notice</div>
              <div class="fee-row">
                <span class="fee-label">Roll Number:</span>
                <span class="fee-value">${rollNumber}</span>
              </div>
              <div class="fee-row">
                <span class="fee-label">Academic Year:</span>
                <span class="fee-value">${academicYear}</span>
              </div>
              <div class="fee-row">
                <span class="fee-label">Term 1 Amount:</span>
                <span class="fee-value amount-value">₹${feeAmounts.term1}</span>
              </div>
              <div class="fee-row">
                <span class="fee-label">Term 2 Amount:</span>
                <span class="fee-value amount-value">₹${feeAmounts.term2}</span>
              </div>
              <div class="fee-row">
                <span class="fee-label">Term 3 Amount:</span>
                <span class="fee-value amount-value">₹${feeAmounts.term3}</span>
              </div>
            </div>
            
            <div class="reminder-box">
              <span class="reminder-icon">🚨</span>
              <span class="reminder-text">
                <strong>Final Notice:</strong> This is your final fee reminder. Please settle all outstanding payments immediately to avoid any service disruptions or administrative actions.
              </span>
            </div>
            
            <div class="login-section">
              <a href="${loginUrl}" class="login-button">
                📱 Check Fee Status
              </a>
            </div>
            
            <div style="margin-top: 30px; color: #5a6c7d; font-size: 16px;">
              For urgent assistance or to discuss payment arrangements, please contact the hostel administration immediately.
            </div>
            
            <div style="margin-top: 20px; color: #5a6c7d; font-size: 16px;">
              Best regards,<br>
              <strong style="color: #2c3e50;">Pydah Hostel Management Team</strong>
            </div>
          </div>
          
          <div class="footer">
            <div class="footer-text">
              This is an automated reminder. Please do not reply to this email.
            </div>
            <div class="footer-copyright">
              © ${new Date().getFullYear()} Pydah Hostel. All rights reserved.
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
    text: (studentName, rollNumber, academicYear, feeAmounts, dueDates, loginUrl) => `
Final Fee Reminder - Pydah Hostel

Dear ${studentName},

This is your final reminder regarding the outstanding hostel fee payments for the academic year ${academicYear}. 
Immediate action is required to settle all pending amounts to avoid any service restrictions.

Final Fee Notice:
- Roll Number: ${rollNumber}
- Academic Year: ${academicYear}
- Term 1 Amount: ₹${feeAmounts.term1}
- Term 2 Amount: ₹${feeAmounts.term2}
- Term 3 Amount: ₹${feeAmounts.term3}

Final Notice: This is your final fee reminder. Please settle all outstanding payments immediately to avoid any service disruptions or administrative actions.

Check Fee Status: ${loginUrl}

For urgent assistance or to discuss payment arrangements, please contact the hostel administration immediately.

Best regards,
Pydah Hostel Management Team

---
This is an automated reminder. Please do not reply to this email.
© ${new Date().getFullYear()} Pydah Hostel. All rights reserved.
    `
  },

  leaveRequestForwarded: {
    subject: 'Leave Request Forwarded for Approval - Pydah Hostel',
    html: (principalName, studentName, rollNumber, applicationType, leaveDetails, loginUrl) => `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Leave Request Forwarded - Pydah Hostel</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #2c3e50;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
          }
          
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            overflow: hidden;
          }
          
          .header {
            background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
            color: white;
            padding: 40px 30px;
            text-align: center;
            position: relative;
          }
          
          .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grain" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="25" cy="25" r="1" fill="white" opacity="0.1"/><circle cx="75" cy="75" r="1" fill="white" opacity="0.1"/><circle cx="50" cy="10" r="0.5" fill="white" opacity="0.1"/><circle cx="10" cy="60" r="0.5" fill="white" opacity="0.1"/><circle cx="90" cy="40" r="0.5" fill="white" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grain)"/></svg>');
            opacity: 0.3;
          }
          
          .logo {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 10px;
            position: relative;
            z-index: 1;
          }
          
          .subtitle {
            font-size: 16px;
            opacity: 0.9;
            position: relative;
            z-index: 1;
          }
          
          .content {
            padding: 40px 30px;
          }
          
          .greeting {
            font-size: 18px;
            color: #2c3e50;
            margin-bottom: 25px;
            font-weight: 500;
          }
          
          .message {
            color: #5a6c7d;
            margin-bottom: 30px;
            font-size: 16px;
          }
          
          .details-card {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            border-radius: 15px;
            padding: 30px;
            margin: 30px 0;
            border: 2px solid #e3f2fd;
            position: relative;
            overflow: hidden;
          }
          
          .details-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #3498db, #2980b9);
          }
          
          .details-title {
            font-size: 20px;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 25px;
            text-align: center;
          }
          
          .detail-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 0;
            border-bottom: 1px solid #e9ecef;
          }
          
          .detail-row:last-child {
            border-bottom: none;
          }
          
          .detail-label {
            font-weight: 600;
            color: #495057;
            font-size: 16px;
          }
          
          .detail-value {
            background: #ffffff;
            padding: 12px 20px;
            border-radius: 10px;
            font-weight: 600;
            font-size: 16px;
            border: 2px solid #e9ecef;
            color: #2c3e50;
            min-width: 150px;
            text-align: center;
          }
          
          .urgent-box {
            background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
            border-left: 5px solid #f39c12;
            padding: 20px;
            border-radius: 10px;
            margin: 30px 0;
          }
          
          .urgent-icon {
            font-size: 20px;
            margin-right: 10px;
          }
          
          .urgent-text {
            color: #856404;
            font-weight: 500;
            font-size: 16px;
          }
          
          .login-section {
            text-align: center;
            margin: 40px 0;
          }
          
          .login-button {
            display: inline-block;
            background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
            color: white;
            padding: 18px 40px;
            text-decoration: none;
            border-radius: 50px;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.3s ease;
            box-shadow: 0 10px 20px rgba(52, 152, 219, 0.3);
          }
          
          .login-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 15px 30px rgba(52, 152, 219, 0.4);
          }
          
          .footer {
            background: #f8f9fa;
            padding: 30px;
            text-align: center;
            border-top: 1px solid #e9ecef;
          }
          
          .footer-text {
            color: #6c757d;
            font-size: 14px;
            margin-bottom: 10px;
          }
          
          .footer-copyright {
            color: #adb5bd;
            font-size: 12px;
          }
          
          @media (max-width: 600px) {
            .detail-row {
              flex-direction: column;
              align-items: flex-start;
              gap: 10px;
            }
            
            .detail-value {
              min-width: auto;
              width: 100%;
            }
            
            .content {
              padding: 20px;
            }
            
            .header {
              padding: 30px 20px;
            }
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <div class="logo">🏠 Pydah Hostel</div>
            <div class="subtitle">Leave Request Awaiting Your Approval</div>
          </div>
          
          <div class="content">
            <div class="greeting">
              Dear <strong>${principalName}</strong>,
            </div>
            
            <div class="message">
              A ${applicationType} request has been verified by the warden and is now awaiting your approval. 
              Please review the details below and take appropriate action.
            </div>
            
            <div class="details-card">
              <div class="details-title">📋 ${applicationType} Request Details</div>
              <div class="detail-row">
                <span class="detail-label">Student Name:</span>
                <span class="detail-value">${studentName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Roll Number:</span>
                <span class="detail-value">${rollNumber}</span>
              </div>
              ${leaveDetails}
            </div>
            
            <div class="urgent-box">
              <span class="urgent-icon">⏰</span>
              <span class="urgent-text">
                <strong>Action Required:</strong> Please review and approve/reject this request at your earliest convenience.
              </span>
            </div>
            
            <div class="login-section">
              <a href="${loginUrl}" class="login-button">
                📱 Review Request
              </a>
            </div>
            
            <div style="margin-top: 30px; color: #5a6c7d; font-size: 16px;">
              You can approve or reject this request from your principal dashboard.
            </div>
            
            <div style="margin-top: 20px; color: #5a6c7d; font-size: 16px;">
              Best regards,<br>
              <strong style="color: #2c3e50;">Pydah Hostel Management System</strong>
            </div>
          </div>
          
          <div class="footer">
            <div class="footer-text">
              This is an automated notification. Please do not reply to this email.
            </div>
            <div class="footer-copyright">
              © ${new Date().getFullYear()} Pydah Hostel. All rights reserved.
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
    text: (principalName, studentName, rollNumber, applicationType, leaveDetailsText, loginUrl) => `
Leave Request Forwarded for Approval - Pydah Hostel

Dear ${principalName},

A ${applicationType} request has been verified by the warden and is now awaiting your approval.

${applicationType} Request Details:
- Student Name: ${studentName}
- Roll Number: ${rollNumber}
${leaveDetailsText}

ACTION REQUIRED: Please review and approve/reject this request at your earliest convenience.

Review Request: ${loginUrl}

You can approve or reject this request from your principal dashboard.

Best regards,
Pydah Hostel Management System

---
This is an automated notification. Please do not reply to this email.
© ${new Date().getFullYear()} Pydah Hostel. All rights reserved.
    `
  },

  subAdminRegistration: {
    subject: 'Sub-Admin Account Created - Hostel Management System',
    html: (adminName, username, generatedPassword, loginUrl) => `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Sub-Admin Account Created</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #2c3e50;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
          }
          
          .email-container {
            max-width: 600px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            overflow: hidden;
          }
          
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px 30px;
            text-align: center;
            position: relative;
          }
          
          .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grain" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="25" cy="25" r="1" fill="white" opacity="0.1"/><circle cx="75" cy="75" r="1" fill="white" opacity="0.1"/><circle cx="50" cy="10" r="0.5" fill="white" opacity="0.1"/><circle cx="10" cy="60" r="0.5" fill="white" opacity="0.1"/><circle cx="90" cy="40" r="0.5" fill="white" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grain)"/></svg>');
            opacity: 0.3;
          }
          
          .logo {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 10px;
            position: relative;
            z-index: 1;
          }
          
          .subtitle {
            font-size: 16px;
            opacity: 0.9;
            position: relative;
            z-index: 1;
          }
          
          .content {
            padding: 40px 30px;
          }
          
          .greeting {
            font-size: 18px;
            color: #2c3e50;
            margin-bottom: 25px;
            font-weight: 500;
          }
          
          .message {
            color: #5a6c7d;
            margin-bottom: 30px;
            font-size: 16px;
          }
          
          .credentials-card {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            border-radius: 15px;
            padding: 30px;
            margin: 30px 0;
            border: 2px solid #e3f2fd;
            position: relative;
            overflow: hidden;
          }
          
          .credentials-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #667eea, #764ba2);
          }
          
          .credentials-title {
            font-size: 20px;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 25px;
            text-align: center;
          }
          
          .credential-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 0;
            border-bottom: 1px solid #e9ecef;
          }
          
          .credential-row:last-child {
            border-bottom: none;
          }
          
          .credential-label {
            font-weight: 600;
            color: #495057;
            font-size: 16px;
          }
          
          .credential-value {
            background: #ffffff;
            padding: 12px 20px;
            border-radius: 10px;
            font-family: 'Courier New', monospace;
            font-weight: 600;
            font-size: 16px;
            border: 2px solid #e9ecef;
            color: #2c3e50;
            min-width: 200px;
            text-align: center;
          }
          
          .password-value {
            color: #e74c3c;
            letter-spacing: 2px;
            font-size: 18px;
          }
          
          .warning-box {
            background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
            border-left: 5px solid #f39c12;
            padding: 20px;
            border-radius: 10px;
            margin: 30px 0;
          }
          
          .warning-icon {
            font-size: 20px;
            margin-right: 10px;
          }
          
          .warning-text {
            color: #856404;
            font-weight: 500;
            font-size: 16px;
          }
          
          .login-section {
            text-align: center;
            margin: 40px 0;
          }
          
          .login-button {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 18px 40px;
            text-decoration: none;
            border-radius: 50px;
            font-weight: 600;
            font-size: 16px;
            transition: all 0.3s ease;
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
          }
          
          .login-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 15px 30px rgba(102, 126, 234, 0.4);
          }
          
          .security-section {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            border-radius: 15px;
            padding: 25px;
            margin: 30px 0;
          }
          
          .security-title {
            font-size: 18px;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
          }
          
          .security-icon {
            margin-right: 10px;
            font-size: 20px;
          }
          
          .security-list {
            list-style: none;
            padding: 0;
          }
          
          .security-list li {
            padding: 8px 0;
            color: #5a6c7d;
            position: relative;
            padding-left: 25px;
          }
          
          .security-list li::before {
            content: '✓';
            position: absolute;
            left: 0;
            color: #27ae60;
            font-weight: bold;
            font-size: 16px;
          }
          
          .footer {
            background: #f8f9fa;
            padding: 30px;
            text-align: center;
            border-top: 1px solid #e9ecef;
          }
          
          .footer-text {
            color: #6c757d;
            font-size: 14px;
            margin-bottom: 10px;
          }
          
          .footer-copyright {
            color: #adb5bd;
            font-size: 12px;
          }
          
          @media (max-width: 600px) {
            .credential-row {
              flex-direction: column;
              align-items: flex-start;
              gap: 10px;
            }
            
            .credential-value {
              min-width: auto;
              width: 100%;
            }
            
            .content {
              padding: 20px;
            }
            
            .header {
              padding: 30px 20px;
            }
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
                      <div class="logo">🏠 Pydah Hostel</div>
          <div class="subtitle">Sub-Admin Account Created Successfully</div>
          </div>
          
          <div class="content">
            <div class="greeting">
              Dear <strong>${adminName}</strong>,
            </div>
            
            <div class="message">
              Your sub-admin account has been successfully created in the Hostel Management System. 
              You can now access the system using the credentials provided below.
            </div>
            
            <div class="credentials-card">
              <div class="credentials-title">🔐 Your Login Credentials</div>
              <div class="credential-row">
                <span class="credential-label">Username:</span>
                <span class="credential-value">${username}</span>
              </div>
              <div class="credential-row">
                <span class="credential-label">Password:</span>
                <span class="credential-value password-value">${generatedPassword}</span>
              </div>
            </div>
            
            <div class="warning-box">
              <span class="warning-icon">⚠️</span>
              <span class="warning-text">
                <strong>Important:</strong> Please change your password immediately after your first login for security purposes.
              </span>
            </div>
            
            <div class="login-section">
              <a href="${loginUrl}" class="login-button">
                🚀 Login to System
              </a>
            </div>
            
            <div class="security-section">
              <div class="security-title">
                <span class="security-icon">🔒</span>
                Security Best Practices
              </div>
              <ul class="security-list">
                <li>Change your password immediately after first login</li>
                <li>Use a strong password with letters, numbers, and special characters</li>
                <li>Never share your login credentials with anyone</li>
                <li>Log out when using shared computers</li>
                <li>Keep your contact information updated</li>
                <li>Enable two-factor authentication if available</li>
              </ul>
            </div>
            
            <div style="margin-top: 30px; color: #5a6c7d; font-size: 16px;">
              If you have any questions or need assistance, please contact the system administrator.
            </div>
            
                          <div style="margin-top: 20px; color: #5a6c7d; font-size: 16px;">
                Best regards,<br>
                <strong style="color: #2c3e50;">Pydah Hostel Team</strong>
              </div>
          </div>
          
          <div class="footer">
            <div class="footer-text">
              This is an automated message. Please do not reply to this email.
            </div>
            <div class="footer-copyright">
              © ${new Date().getFullYear()} Pydah Hostel. All rights reserved.
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
    text: (adminName, username, generatedPassword, loginUrl) => `
Sub-Admin Account Created - Hostel Management System

Dear ${adminName},

Your sub-admin account has been successfully created in the Hostel Management System. You can now access the system using the credentials provided below.

Your Login Credentials:
- Username: ${username}
- Password: ${generatedPassword}

IMPORTANT: Please change your password immediately after your first login for security purposes.

Login URL: ${loginUrl}

Security Tips:
- Change your password immediately after first login
- Use a strong password with letters, numbers, and special characters
- Never share your login credentials with anyone
- Log out when using shared computers
- Keep your contact information updated

If you have any questions or need assistance, please contact the system administrator.

Best regards,
Hostel Management Team

---
This is an automated message. Please do not reply to this email.
© ${new Date().getFullYear()} Hostel Management System. All rights reserved.
    `
  }
};

/**
 * Send email using Brevo API
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} htmlContent - HTML content of the email
 * @param {string} textContent - Plain text content of the email
 * @returns {Promise<Object>} - Response from Brevo API
 */
export const sendEmail = async (to, subject, htmlContent, textContent) => {
  try {
    if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
      throw createError(500, 'Email service configuration missing. Please check BREVO_API_KEY and BREVO_SENDER_EMAIL environment variables.');
    }

    if (!to || !subject || !htmlContent || !textContent) {
      throw createError(400, 'Missing required email parameters: to, subject, htmlContent, textContent');
    }

    const emailData = {
      sender: {
        name: 'Hostel Management System',
        email: BREVO_SENDER_EMAIL
      },
      to: [
        {
          email: to,
          name: to.split('@')[0] // Use email prefix as name
        }
      ],
      subject: subject,
      htmlContent: htmlContent,
      textContent: textContent
    };

    console.log('📧 Sending email to:', to);
    console.log('📧 Email subject:', subject);

    const response = await axios.post(BREVO_API_URL, emailData, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'api-key': BREVO_API_KEY
      },
      timeout: 30000 // 30 second timeout
    });

    console.log('📧 Email sent successfully. Message ID:', response.data.messageId);
    
    return {
      success: true,
      messageId: response.data.messageId,
      message: 'Email sent successfully'
    };

  } catch (error) {
    console.error('📧 Email sending error:', error);
    
    if (error.response) {
      console.error('📧 Brevo API error response:', error.response.data);
      throw createError(500, `Email service error: ${error.response.data.message || 'Unknown error'}`);
    }
    
    if (error.code === 'ECONNABORTED') {
      throw createError(500, 'Email service timeout. Please try again.');
    }
    
    throw createError(500, 'Failed to send email. Please try again later.');
  }
};

/**
 * Send student registration email with credentials
 * @param {string} studentEmail - Student's email address
 * @param {string} studentName - Student's name
 * @param {string} rollNumber - Student's roll number
 * @param {string} generatedPassword - Generated password
 * @returns {Promise<Object>} - Response from email service
 */
export const sendStudentRegistrationEmail = async (studentEmail, studentName, rollNumber, generatedPassword) => {
  try {
    const template = EMAIL_TEMPLATES.studentRegistration;
    const subject = template.subject;
    const htmlContent = template.html(studentName, rollNumber, generatedPassword, loginUrl);
    const textContent = template.text(studentName, rollNumber, generatedPassword, loginUrl);

    return await sendEmail(studentEmail, subject, htmlContent, textContent);
  } catch (error) {
    console.error('📧 Error sending student registration email:', error);
    throw error;
  }
};

/**
 * Send password reset email
 * @param {string} studentEmail - Student's email address
 * @param {string} studentName - Student's name
 * @param {string} rollNumber - Student's roll number
 * @param {string} newPassword - New password
 * @returns {Promise<Object>} - Response from email service
 */
export const sendPasswordResetEmail = async (studentEmail, studentName, rollNumber, newPassword) => {
  try {
    const template = EMAIL_TEMPLATES.passwordReset;
    const subject = template.subject;
    const htmlContent = template.html(studentName, rollNumber, newPassword, loginUrl);
    const textContent = template.text(studentName, rollNumber, newPassword, loginUrl);

    return await sendEmail(studentEmail, subject, htmlContent, textContent);
  } catch (error) {
    console.error('📧 Error sending password reset email:', error);
    throw error;
  }
};

/**
 * Send sub-admin registration email
 * @param {string} adminEmail - Admin's email address
 * @param {string} adminName - Admin's name
 * @param {string} username - Admin's username
 * @param {string} generatedPassword - Generated password
 * @returns {Promise<Object>} - Response from email service
 */
export const sendSubAdminRegistrationEmail = async (adminEmail, adminName, username, generatedPassword) => {
  try {
    const template = EMAIL_TEMPLATES.subAdminRegistration;
    const subject = template.subject;
    const htmlContent = template.html(adminName, username, generatedPassword, loginUrl);
    const textContent = template.text(adminName, username, generatedPassword, loginUrl);

    return await sendEmail(adminEmail, subject, htmlContent, textContent);
  } catch (error) {
    console.error('📧 Error sending sub-admin registration email:', error);
    throw error;
  }
};

/**
 * Test email service configuration
 * @param {string} testEmail - Email address to send test to
 * @returns {Promise<Object>} - Test result
 */
export const testEmailService = async (testEmail) => {
  try {
    if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
      return {
        success: false,
        error: 'Email service not configured. Please check BREVO_API_KEY and BREVO_SENDER_EMAIL environment variables.'
      };
    }

    const testSubject = 'Test Email - Hostel Management System';
    const testHtmlContent = `
      <h2>Test Email</h2>
      <p>This is a test email from the Hostel Management System email service.</p>
      <p>If you received this email, the email service is working correctly.</p>
      <p>Timestamp: ${new Date().toISOString()}</p>
    `;
    const testTextContent = `
Test Email

This is a test email from the Hostel Management System email service.

If you received this email, the email service is working correctly.

Timestamp: ${new Date().toISOString()}
    `;

    const result = await sendEmail(testEmail, testSubject, testHtmlContent, testTextContent);
    
    return {
      success: true,
      message: 'Test email sent successfully',
      messageId: result.messageId
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Send fee reminder email (first reminder)
 * @param {string} studentEmail - Student's email address
 * @param {string} studentName - Student's name
 * @param {string} rollNumber - Student's roll number
 * @param {string} academicYear - Academic year
 * @param {Object} feeAmounts - Fee amounts for each term
 * @param {Object} dueDates - Due dates for each term
 * @returns {Promise<Object>} - Response from email service
 */
export const sendFeeReminder1Email = async (studentEmail, studentName, rollNumber, academicYear, feeAmounts, dueDates) => {
  try {
    const template = EMAIL_TEMPLATES.feeReminder1;
    const subject = template.subject;
    const htmlContent = template.html(studentName, rollNumber, academicYear, feeAmounts, dueDates, loginUrl);
    const textContent = template.text(studentName, rollNumber, academicYear, feeAmounts, dueDates, loginUrl);

    return await sendEmail(studentEmail, subject, htmlContent, textContent);
  } catch (error) {
    console.error('📧 Error sending fee reminder 1 email:', error);
    throw error;
  }
};

/**
 * Send fee reminder email (second reminder)
 * @param {string} studentEmail - Student's email address
 * @param {string} studentName - Student's name
 * @param {string} rollNumber - Student's roll number
 * @param {string} academicYear - Academic year
 * @param {Object} feeAmounts - Fee amounts for each term
 * @param {Object} dueDates - Due dates for each term
 * @returns {Promise<Object>} - Response from email service
 */
export const sendFeeReminder2Email = async (studentEmail, studentName, rollNumber, academicYear, feeAmounts, dueDates) => {
  try {
    const template = EMAIL_TEMPLATES.feeReminder2;
    const subject = template.subject;
    const htmlContent = template.html(studentName, rollNumber, academicYear, feeAmounts, dueDates, loginUrl);
    const textContent = template.text(studentName, rollNumber, academicYear, feeAmounts, dueDates, loginUrl);

    return await sendEmail(studentEmail, subject, htmlContent, textContent);
  } catch (error) {
    console.error('📧 Error sending fee reminder 2 email:', error);
    throw error;
  }
};

/**
 * Send fee reminder email (final reminder)
 * @param {string} studentEmail - Student's email address
 * @param {string} studentName - Student's name
 * @param {string} rollNumber - Student's roll number
 * @param {string} academicYear - Academic year
 * @param {Object} feeAmounts - Fee amounts for each term
 * @param {Object} dueDates - Due dates for each term
 * @returns {Promise<Object>} - Response from email service
 */
export const sendFeeReminder3Email = async (studentEmail, studentName, rollNumber, academicYear, feeAmounts, dueDates) => {
  try {
    const template = EMAIL_TEMPLATES.feeReminder3;
    const subject = template.subject;
    const htmlContent = template.html(studentName, rollNumber, academicYear, feeAmounts, dueDates, loginUrl);
    const textContent = template.text(studentName, rollNumber, academicYear, feeAmounts, dueDates, loginUrl);

    return await sendEmail(studentEmail, subject, htmlContent, textContent);
  } catch (error) {
    console.error('📧 Error sending fee reminder 3 email:', error);
    throw error;
  }
};

/**
 * Send fee reminder email based on reminder number
 * @param {number} reminderNumber - Reminder number (1, 2, or 3)
 * @param {string} studentEmail - Student's email address
 * @param {string} studentName - Student's name
 * @param {string} rollNumber - Student's roll number
 * @param {string} academicYear - Academic year
 * @param {Object} feeAmounts - Fee amounts for each term
 * @param {Object} dueDates - Due dates for each term
 * @returns {Promise<Object>} - Response from email service
 */
export const sendFeeReminderEmail = async (reminderNumber, studentEmail, studentName, rollNumber, academicYear, feeAmounts, dueDates) => {
  try {
    console.log(`📧 Sending fee reminder ${reminderNumber} email to:`, studentEmail);
    
    switch (reminderNumber) {
      case 1:
        return await sendFeeReminder1Email(studentEmail, studentName, rollNumber, academicYear, feeAmounts, dueDates);
      case 2:
        return await sendFeeReminder2Email(studentEmail, studentName, rollNumber, academicYear, feeAmounts, dueDates);
      case 3:
        return await sendFeeReminder3Email(studentEmail, studentName, rollNumber, academicYear, feeAmounts, dueDates);
      default:
        throw new Error(`Invalid reminder number: ${reminderNumber}. Must be 1, 2, or 3.`);
    }
  } catch (error) {
    console.error(`📧 Error sending fee reminder ${reminderNumber} email:`, error);
    throw error;
  }
};

/**
 * Get email service status
 * @returns {Object} - Service status
 */
export const getEmailServiceStatus = () => {
  return {
    configured: !!(BREVO_API_KEY && BREVO_SENDER_EMAIL),
    apiKey: BREVO_API_KEY ? 'Configured' : 'Missing',
    senderEmail: BREVO_SENDER_EMAIL || 'Missing',
    service: 'Brevo'
  };
};

/**
 * Send leave request forwarded email to principal
 * @param {string} principalEmail - Principal's email address
 * @param {string} principalName - Principal's name (username)
 * @param {string} studentName - Student's name
 * @param {string} rollNumber - Student's roll number
 * @param {string} applicationType - Type of leave application (Leave, Permission)
 * @param {Object} leaveData - Leave request data containing dates, times, reason
 * @returns {Promise<Object>} - Response from email service
 */
export const sendLeaveForwardedEmail = async (principalEmail, principalName, studentName, rollNumber, applicationType, leaveData) => {
  try {
    // Safety check - skip if no email provided
    if (!principalEmail || !principalEmail.trim()) {
      console.log('⚠️ No email provided for principal, skipping email notification');
      return { success: false, skipped: true, message: 'No email provided' };
    }
    
    console.log(`📧 Sending leave forwarded email to principal: ${principalEmail}`);
    
    // Build leave details HTML based on application type
    let leaveDetailsHtml = '';
    let leaveDetailsText = '';
    
    if (applicationType === 'Leave') {
      const startDate = new Date(leaveData.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const endDate = new Date(leaveData.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const gatePassDate = leaveData.gatePassDateTime ? new Date(leaveData.gatePassDateTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';
      
      leaveDetailsHtml = `
        <div class="detail-row">
          <span class="detail-label">Leave Type:</span>
          <span class="detail-value">Leave</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Start Date:</span>
          <span class="detail-value">${startDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">End Date:</span>
          <span class="detail-value">${endDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Gate Pass Time:</span>
          <span class="detail-value">${gatePassDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Reason:</span>
          <span class="detail-value">${leaveData.reason || 'Not specified'}</span>
        </div>
      `;
      
      leaveDetailsText = `- Leave Type: Leave
- Start Date: ${startDate}
- End Date: ${endDate}
- Gate Pass Time: ${gatePassDate}
- Reason: ${leaveData.reason || 'Not specified'}`;
      
    } else if (applicationType === 'Permission') {
      const permissionDate = new Date(leaveData.permissionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      
      leaveDetailsHtml = `
        <div class="detail-row">
          <span class="detail-label">Leave Type:</span>
          <span class="detail-value">Permission</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Permission Date:</span>
          <span class="detail-value">${permissionDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Out Time:</span>
          <span class="detail-value">${leaveData.outTime || 'N/A'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">In Time:</span>
          <span class="detail-value">${leaveData.inTime || 'N/A'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Reason:</span>
          <span class="detail-value">${leaveData.reason || 'Not specified'}</span>
        </div>
      `;
      
      leaveDetailsText = `- Leave Type: Permission
- Permission Date: ${permissionDate}
- Out Time: ${leaveData.outTime || 'N/A'}
- In Time: ${leaveData.inTime || 'N/A'}
- Reason: ${leaveData.reason || 'Not specified'}`;
    }
    
    const template = EMAIL_TEMPLATES.leaveRequestForwarded;
    const subject = template.subject;
    const htmlContent = template.html(principalName, studentName, rollNumber, applicationType, leaveDetailsHtml, loginUrl);
    const textContent = template.text(principalName, studentName, rollNumber, applicationType, leaveDetailsText, loginUrl);

    return await sendEmail(principalEmail, subject, htmlContent, textContent);
  } catch (error) {
    console.error('📧 Error sending leave forwarded email:', error);
    throw error;
  }
}; 