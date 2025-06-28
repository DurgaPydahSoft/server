import axios from 'axios';
import { createError } from './error.js';

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL;
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

// Email templates
const EMAIL_TEMPLATES = {
  studentRegistration: {
    subject: 'Welcome to Hostel Management System - Your Login Credentials',
    html: (studentName, rollNumber, generatedPassword, loginUrl) => `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Hostel Management System</title>
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
          .welcome-text {
            font-size: 18px;
            color: #424242;
            margin-bottom: 20px;
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
          .security-tips {
            background-color: #f3e5f5;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
          }
          .security-tips h4 {
            color: #7b1fa2;
            margin-top: 0;
          }
          .security-tips ul {
            margin: 10px 0;
            padding-left: 20px;
          }
          .security-tips li {
            margin: 5px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🏠 Hostel Management System</div>
            <div class="welcome-text">Welcome, ${studentName}!</div>
          </div>
          
          <p>Dear <strong>${studentName}</strong>,</p>
          
          <p>Welcome to the Hostel Management System! Your account has been successfully created and you can now access the system using the credentials provided below.</p>
          
          <div class="credentials-box">
            <h3 style="color: #1976d2; margin-top: 0;">Your Login Credentials</h3>
            <div class="credential-item">
              <span class="label">Roll Number:</span>
              <span class="value">${rollNumber}</span>
            </div>
            <div class="credential-item">
              <span class="label">Password:</span>
              <span class="value password">${generatedPassword}</span>
            </div>
          </div>
          
          <div class="important-note">
            <strong>⚠️ Important:</strong> Please change your password immediately after your first login for security purposes.
          </div>
          
          <div style="text-align: center;">
            <a href="${loginUrl}" class="login-button">Login to System</a>
          </div>
          
          <div class="security-tips">
            <h4>🔒 Security Tips:</h4>
            <ul>
              <li>Change your password immediately after first login</li>
              <li>Use a strong password with letters, numbers, and special characters</li>
              <li>Never share your login credentials with anyone</li>
              <li>Log out when using shared computers</li>
              <li>Keep your contact information updated</li>
            </ul>
          </div>
          
          <p>If you have any questions or need assistance, please contact the hostel administration.</p>
          
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
    text: (studentName, rollNumber, generatedPassword, loginUrl) => `
Welcome to Hostel Management System!

Dear ${studentName},

Welcome to the Hostel Management System! Your account has been successfully created and you can now access the system using the credentials provided below.

Your Login Credentials:
- Roll Number: ${rollNumber}
- Password: ${generatedPassword}

IMPORTANT: Please change your password immediately after your first login for security purposes.

Login URL: ${loginUrl}

Security Tips:
- Change your password immediately after first login
- Use a strong password with letters, numbers, and special characters
- Never share your login credentials with anyone
- Log out when using shared computers
- Keep your contact information updated

If you have any questions or need assistance, please contact the hostel administration.

Best regards,
Hostel Management Team

---
This is an automated message. Please do not reply to this email.
© ${new Date().getFullYear()} Hostel Management System. All rights reserved.
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
 * @param {string} loginUrl - Login URL for the system
 * @returns {Promise<Object>} - Response from email service
 */
export const sendStudentRegistrationEmail = async (studentEmail, studentName, rollNumber, generatedPassword, loginUrl) => {
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
 * @param {string} loginUrl - Login URL for the system
 * @returns {Promise<Object>} - Response from email service
 */
export const sendPasswordResetEmail = async (studentEmail, studentName, rollNumber, newPassword, loginUrl) => {
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