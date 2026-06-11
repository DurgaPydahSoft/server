import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

let hrmsConnection = null;

export const getHrmsConnection = async () => {
  if (hrmsConnection && hrmsConnection.readyState === 1) {
    return hrmsConnection;
  }

  const uri = process.env.HRMS_MONGODB_URI;
  if (!uri) {
    throw new Error('HRMS_MONGODB_URI is not configured');
  }

  hrmsConnection = mongoose.createConnection(uri);
  await hrmsConnection.asPromise();
  console.log('Connected to HRMS MongoDB');
  return hrmsConnection;
};

export const getHrmsDb = async () => {
  const conn = await getHrmsConnection();
  return conn.db;
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toObjectId = (id) => {
  try {
    return new mongoose.Types.ObjectId(id);
  } catch {
    return null;
  }
};

export const findHrmsEmployeeByEmpNo = async (empNo) => {
  const db = await getHrmsDb();
  return db.collection('employees').findOne({ emp_no: empNo.toString().trim() });
};

export const findHrmsEmployeeByRef = async (hrmsEmployeeRef) => {
  if (!hrmsEmployeeRef) return null;
  const db = await getHrmsDb();
  const objectId = toObjectId(hrmsEmployeeRef);
  if (!objectId) return null;
  return db.collection('employees').findOne({ _id: objectId });
};

export const findHrmsUserById = async (hrmsUserId) => {
  if (!hrmsUserId) return null;
  const db = await getHrmsDb();
  const objectId = toObjectId(hrmsUserId);
  if (!objectId) return null;
  return db.collection('users').findOne({ _id: objectId, isActive: { $ne: false } });
};

export const findHrmsUserByEmployeeId = async (employeeId) => {
  const db = await getHrmsDb();
  const id = employeeId.toString().trim();

  let user = await db.collection('users').findOne({
    employeeId: id,
    isActive: { $ne: false }
  });

  if (!user) {
    const emp = await findHrmsEmployeeByEmpNo(id);
    if (emp) {
      user = await db.collection('users').findOne({
        $or: [
          { employeeRef: emp._id.toString() },
          { employeeRef: emp._id }
        ],
        isActive: { $ne: false }
      });
    }
  }

  return user;
};

const verifyEmployeeRecordPassword = async (employeeRecord, password) => {
  if (!employeeRecord) return false;
  if (employeeRecord.password) {
    return bcrypt.compare(password, employeeRecord.password);
  }
  if (employeeRecord.plain_password) {
    return password === employeeRecord.plain_password;
  }
  return false;
};

const verifyUserRecordPassword = async (userRecord, password) => {
  if (!userRecord?.password) return false;
  return bcrypt.compare(password, userRecord.password);
};

export const verifyHrmsPassword = async (admin, password) => {
  const linkType = admin.hrmsLinkType;

  if (linkType === 'user' && admin.hrmsUserId) {
    const user = await findHrmsUserById(admin.hrmsUserId);
    return verifyUserRecordPassword(user, password);
  }

  if (linkType === 'employee' && admin.hrmsEmployeeRef) {
    const employee = await findHrmsEmployeeByRef(admin.hrmsEmployeeRef);
    return verifyEmployeeRecordPassword(employee, password);
  }

  // Legacy fallback for admins linked before linkType existed
  if (admin.hrmsUserId) {
    const user = await findHrmsUserById(admin.hrmsUserId);
    if (await verifyUserRecordPassword(user, password)) return true;
  }

  if (admin.hrmsEmployeeRef) {
    const employee = await findHrmsEmployeeByRef(admin.hrmsEmployeeRef);
    if (await verifyEmployeeRecordPassword(employee, password)) return true;
  }

  const hrmsUser = await findHrmsUserByEmployeeId(admin.employeeId);
  return verifyUserRecordPassword(hrmsUser, password);
};

export const searchHrmsEmployees = async (query) => {
  if (!query || query.trim().length < 2) {
    return [];
  }

  const db = await getHrmsDb();
  const trimmed = query.trim();
  const regex = new RegExp(escapeRegex(trimmed), 'i');

  const [employees, users] = await Promise.all([
    db.collection('employees').find({
      $or: [
        { emp_no: regex },
        { employee_name: regex },
        { phone_number: regex },
        { email: regex }
      ]
    }).limit(25).toArray(),
    db.collection('users').find({
      $or: [
        { employeeId: regex },
        { name: regex },
        { email: regex },
        { phone_number: regex }
      ],
      isActive: { $ne: false }
    }).limit(25).toArray()
  ]);

  const results = [];

  for (const emp of employees) {
    results.push({
      linkType: 'employee',
      source: 'employees',
      recordId: emp._id.toString(),
      employeeId: emp.emp_no?.toString() || '',
      hrmsEmployeeRef: emp._id.toString(),
      hrmsUserId: null,
      name: emp.employee_name || '',
      email: emp.email || '',
      phone: emp.phone_number || '',
      department: emp.dynamicFields?.department_name || '',
      designation: emp.dynamicFields?.designation_name || '',
      hasPassword: !!(emp.password || emp.plain_password),
      label: 'Employee Record'
    });
  }

  for (const user of users) {
    results.push({
      linkType: 'user',
      source: 'users',
      recordId: user._id.toString(),
      employeeId: user.employeeId?.toString() || '',
      hrmsUserId: user._id.toString(),
      hrmsEmployeeRef: user.employeeRef?.toString() || '',
      name: user.name || '',
      email: user.email || '',
      phone: user.phone_number || '',
      department: '',
      designation: '',
      hasPassword: !!user.password,
      label: 'User Account'
    });
  }

  return results
    .sort((a, b) => {
      const idCompare = (a.employeeId || '').localeCompare(b.employeeId || '');
      if (idCompare !== 0) return idCompare;
      return a.linkType === 'employee' ? -1 : 1;
    })
    .slice(0, 40);
};

export const validateHrmsEmployeeLink = async ({ employeeId, hrmsUserId, hrmsEmployeeRef, linkType }) => {
  if (!employeeId && !hrmsUserId && !hrmsEmployeeRef) {
    return { valid: true };
  }

  if (linkType === 'user') {
    const user = await findHrmsUserById(hrmsUserId);
    if (!user) {
      return { valid: false, message: 'HRMS user account not found' };
    }

    return {
      valid: true,
      linkType: 'user',
      employeeId: user.employeeId?.toString() || employeeId?.toString().trim() || '',
      hrmsUserId: user._id.toString(),
      hrmsEmployeeRef: user.employeeRef?.toString() || hrmsEmployeeRef || null,
      name: user.name || '',
      email: user.email || '',
      phone: user.phone_number || ''
    };
  }

  if (linkType === 'employee') {
    const emp = hrmsEmployeeRef
      ? await findHrmsEmployeeByRef(hrmsEmployeeRef)
      : await findHrmsEmployeeByEmpNo(employeeId);

    if (!emp) {
      return { valid: false, message: 'HRMS employee record not found' };
    }

    return {
      valid: true,
      linkType: 'employee',
      employeeId: emp.emp_no?.toString() || employeeId?.toString().trim() || '',
      hrmsUserId: null,
      hrmsEmployeeRef: emp._id.toString(),
      name: emp.employee_name || '',
      email: emp.email || '',
      phone: emp.phone_number || ''
    };
  }

  const normalizedId = employeeId?.toString().trim();
  const emp = normalizedId ? await findHrmsEmployeeByEmpNo(normalizedId) : null;
  const user = hrmsUserId
    ? await findHrmsUserById(hrmsUserId)
    : (normalizedId ? await findHrmsUserByEmployeeId(normalizedId) : null);

  if (!emp && !user) {
    return { valid: false, message: `Employee ID ${normalizedId} not found in HRMS database` };
  }

  return {
    valid: true,
    linkType: user ? 'user' : 'employee',
    employeeId: normalizedId || emp?.emp_no?.toString() || user?.employeeId?.toString() || '',
    hrmsUserId: user?._id?.toString() || null,
    hrmsEmployeeRef: emp?._id?.toString() || hrmsEmployeeRef || user?.employeeRef?.toString() || null,
    name: user?.name || emp?.employee_name || '',
    email: user?.email || emp?.email || '',
    phone: user?.phone_number || emp?.phone_number || ''
  };
};
