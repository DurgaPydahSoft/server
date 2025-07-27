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