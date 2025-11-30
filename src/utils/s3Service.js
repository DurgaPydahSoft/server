import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';

// Validate S3 configuration
const validateS3Config = () => {
  const missing = [];
  const empty = [];
  
  // Check if variables exist
  if (!process.env.AWS_ACCESS_KEY || process.env.AWS_ACCESS_KEY.trim() === '') {
    missing.push('AWS_ACCESS_KEY');
  } else if (process.env.AWS_ACCESS_KEY.trim() === '') {
    empty.push('AWS_ACCESS_KEY');
  }
  
  if (!process.env.AWS_SECRET_KEY || process.env.AWS_SECRET_KEY.trim() === '') {
    missing.push('AWS_SECRET_KEY');
  } else if (process.env.AWS_SECRET_KEY.trim() === '') {
    empty.push('AWS_SECRET_KEY');
  }
  
  if (!process.env.AWS_S3_BUCKET || process.env.AWS_S3_BUCKET.trim() === '') {
    missing.push('AWS_S3_BUCKET');
  } else if (process.env.AWS_S3_BUCKET.trim() === '') {
    empty.push('AWS_S3_BUCKET');
  }
  
  if (!process.env.AWS_REGION || process.env.AWS_REGION.trim() === '') {
    missing.push('AWS_REGION');
  } else if (process.env.AWS_REGION.trim() === '') {
    empty.push('AWS_REGION');
  }
  
  if (missing.length > 0) {
    throw new Error(`S3 configuration is incomplete. Missing environment variables: ${missing.join(', ')}. Please set these in your .env file.`);
  }
  
  if (empty.length > 0) {
    throw new Error(`S3 configuration has empty values: ${empty.join(', ')}. Please provide valid values in your .env file.`);
  }
  
  // Validate credential format (basic checks)
  const accessKey = process.env.AWS_ACCESS_KEY.trim();
  const secretKey = process.env.AWS_SECRET_KEY.trim();
  
  if (accessKey.length < 16) {
    throw new Error('AWS_ACCESS_KEY appears to be invalid (too short). Please check your credentials.');
  }
  
  if (secretKey.length < 20) {
    throw new Error('AWS_SECRET_KEY appears to be invalid (too short). Please check your credentials.');
  }
};

// Initialize S3 client with proper error handling
let s3Client;
let bucketName;

// Function to mask credentials for logging
const maskCredential = (value, showStart = 4, showEnd = 4) => {
  if (!value || value.length === 0) return '[EMPTY]';
  if (value.length <= showStart + showEnd) return '[TOO_SHORT]';
  return value.substring(0, showStart) + '...' + value.substring(value.length - showEnd);
};

console.log('🔍 Checking S3 Configuration...');
console.log('📁 Environment variables status:');
console.log('   AWS_ACCESS_KEY:', process.env.AWS_ACCESS_KEY ? `[SET - Length: ${process.env.AWS_ACCESS_KEY.length}]` : '[NOT SET]');
console.log('   AWS_SECRET_KEY:', process.env.AWS_SECRET_KEY ? `[SET - Length: ${process.env.AWS_SECRET_KEY.length}]` : '[NOT SET]');
console.log('   AWS_S3_BUCKET:', process.env.AWS_S3_BUCKET ? `[SET - Value: ${process.env.AWS_S3_BUCKET}]` : '[NOT SET]');
console.log('   AWS_REGION:', process.env.AWS_REGION ? `[SET - Value: ${process.env.AWS_REGION}]` : '[NOT SET]');

try {
  validateS3Config();
  
  const accessKey = process.env.AWS_ACCESS_KEY.trim();
  const secretKey = process.env.AWS_SECRET_KEY.trim();
  const region = process.env.AWS_REGION.trim();
  bucketName = process.env.AWS_S3_BUCKET.trim();
  
  // Log configuration (mask sensitive data)
  console.log('🔧 S3 Configuration Details:');
  console.log('   Access Key:', maskCredential(accessKey, 8, 4), `(Length: ${accessKey.length})`);
  console.log('   Secret Key:', maskCredential(secretKey, 4, 4), `(Length: ${secretKey.length})`);
  console.log('   Bucket:', bucketName);
  console.log('   Region:', region);
  
  // Check for common issues
  if (accessKey.includes('your_') || accessKey.includes('EXAMPLE') || accessKey.includes('placeholder')) {
    console.warn('⚠️  AWS_ACCESS_KEY appears to be a placeholder value');
    throw new Error('AWS_ACCESS_KEY appears to be a placeholder. Please provide a valid access key.');
  }
  
  if (secretKey.includes('your_') || secretKey.includes('EXAMPLE') || secretKey.includes('placeholder')) {
    console.warn('⚠️  AWS_SECRET_KEY appears to be a placeholder value');
    throw new Error('AWS_SECRET_KEY appears to be a placeholder. Please provide a valid secret key.');
  }
  
  if (accessKey.length < 16) {
    console.warn('⚠️  AWS_ACCESS_KEY is too short (should be at least 16 characters)');
    throw new Error('AWS_ACCESS_KEY appears to be invalid (too short). Please check your credentials.');
  }
  
  if (secretKey.length < 20) {
    console.warn('⚠️  AWS_SECRET_KEY is too short (should be at least 20 characters)');
    throw new Error('AWS_SECRET_KEY appears to be invalid (too short). Please check your credentials.');
  }
  
  // Check for whitespace issues
  if (process.env.AWS_ACCESS_KEY !== process.env.AWS_ACCESS_KEY.trim()) {
    console.warn('⚠️  AWS_ACCESS_KEY has leading/trailing whitespace');
  }
  
  if (process.env.AWS_SECRET_KEY !== process.env.AWS_SECRET_KEY.trim()) {
    console.warn('⚠️  AWS_SECRET_KEY has leading/trailing whitespace');
  }
  
  console.log('🔐 Creating S3 client...');
  s3Client = new S3Client({
    region: region,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
  });
  
  console.log('✅ S3 client initialized successfully');
  console.log('📦 Ready to upload to bucket:', bucketName, 'in region:', region);
} catch (error) {
  console.error('❌ Failed to initialize S3 client:', error.message);
  console.error('💡 Troubleshooting steps:');
  console.error('   1. Make sure your .env file is in the server/ folder (not client/)');
  console.error('   2. Check that all AWS environment variables are set');
  console.error('   3. Verify no extra spaces or quotes around values in .env');
  console.error('   4. Restart your server after updating .env file');
  console.error('   5. For PM2: Use "pm2 restart all" or "pm2 restart my-backend"');
  // Don't throw here - let individual functions handle it
  s3Client = null;
  bucketName = null;
}

export const uploadToS3 = async (file, folder = 'announcements') => {
  try {
    // Validate S3 configuration first
    validateS3Config();
    
    // Check if S3 client was initialized
    if (!s3Client || !bucketName) {
      throw new Error('S3 client is not initialized. Please check your AWS credentials in the .env file.');
    }
    
    if (!file || !file.buffer) {
      throw new Error('Invalid file object. File must have a buffer property.');
    }

    if (!file.originalname) {
      throw new Error('Invalid file object. File must have an originalname property.');
    }

    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${crypto.randomBytes(16).toString('hex')}.${fileExtension}`;
    const key = `${folder}/${fileName}`;

    console.log(`📤 Uploading to S3: ${key}`);
    console.log(`📦 Bucket: ${bucketName}, Region: ${process.env.AWS_REGION}`);

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype || 'application/octet-stream',
      // Removed ACL since bucket doesn't support ACLs
    });

    await s3Client.send(command);
    
    const imageUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    console.log(`✅ Successfully uploaded to S3: ${imageUrl}`);
    
    return imageUrl;
  } catch (error) {
    console.error('❌ Error uploading to S3:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    
    // Provide more specific error messages
    if (error.message.includes('configuration is incomplete') || error.message.includes('Missing')) {
      throw error;
    }
    if (error.message.includes('Resolved credential object is not valid') || 
        error.message.includes('credentials') || 
        error.name === 'CredentialsProviderError' ||
        error.code === 'InvalidAccessKeyId' ||
        error.code === 'SignatureDoesNotMatch') {
      throw new Error('AWS credentials are invalid or not properly configured. Please check:\n' +
        '1. AWS_ACCESS_KEY is set correctly in your .env file\n' +
        '2. AWS_SECRET_KEY is set correctly in your .env file\n' +
        '3. Credentials have proper S3 permissions\n' +
        '4. No extra spaces or quotes around the values\n' +
        `Current error: ${error.message}`);
    }
    if (error.name === 'NoSuchBucket' || error.message.includes('bucket') || error.code === 'NoSuchBucket') {
      throw new Error(`S3 bucket "${bucketName}" not found or not accessible. Please check:\n` +
        '1. AWS_S3_BUCKET is set correctly in your .env file\n' +
        '2. The bucket exists in your AWS account\n' +
        '3. Your credentials have access to this bucket\n' +
        `Current error: ${error.message}`);
    }
    if (error.code === 'InvalidRequest' || error.message.includes('region')) {
      throw new Error(`AWS region configuration error. Please check:\n` +
        '1. AWS_REGION is set correctly (e.g., us-east-1, ap-south-1)\n' +
        '2. The region matches where your S3 bucket is located\n' +
        `Current error: ${error.message}`);
    }
    throw new Error(`Failed to upload file to S3: ${error.message}`);
  }
};

export const deleteFromS3 = async (imageUrl) => {
  try {
    if (!imageUrl) return;
    
    // Extract the key from the URL
    const key = imageUrl.split('.com/')[1];
    if (!key) {
      throw new Error('Invalid image URL format');
    }

    console.log(`🗑️ Attempting to delete from S3: ${key}`);

    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const response = await s3Client.send(command);
    
    if (response.$metadata.httpStatusCode !== 204) {
      throw new Error('Failed to delete file from S3');
    }

    console.log(`✅ Successfully deleted image from S3: ${key}`);
  } catch (error) {
    console.error('❌ Error deleting from S3:', error);
    throw new Error(`Failed to delete file from S3: ${error.message}`);
  }
}; 