# Add Monthly Staff for September 2025

This script allows you to bulk add staff members on a monthly basis for September 2025.

## Usage

1. **Edit the script** (`addMonthlyStaffSept2025.js`) and add your staff members to the `staffMembers` array:

```javascript
const staffMembers = [
  {
    name: 'John Doe',
    gender: 'Male',
    profession: 'Security Guard',
    phoneNumber: '9876543210',
    email: 'john.doe@example.com',
    department: 'Security',
    purpose: 'Monthly stay',
    roomNumber: null, // Optional: Set room number if needed
    bedNumber: null,  // Optional: Set bed number if needed
    dailyRate: null   // Optional: null will use default rate (₹100)
  },
  // Add more staff members here...
];
```

2. **Run the script**:

```bash
npm run add-monthly-staff-sept2025
```

Or directly:

```bash
node src/scripts/addMonthlyStaffSept2025.js
```

## Required Fields

- `name`: Staff member's full name
- `gender`: 'Male', 'Female', or 'Other'
- `profession`: Job title/profession
- `phoneNumber`: 10-digit phone number (required, must be unique)

## Optional Fields

- `email`: Email address (optional)
- `department`: Department name (optional)
- `purpose`: Purpose of stay (defaults to 'Monthly stay')
- `roomNumber`: Room number for allocation (optional)
- `bedNumber`: Bed number within the room (optional)
- `dailyRate`: Custom daily rate (null uses default ₹100)

## What the Script Does

1. Connects to MongoDB using your environment variables
2. Finds an admin user to use as `createdBy`
3. For each staff member:
   - Validates phone number format
   - Checks for duplicate phone numbers
   - Calculates charges for September 2025 (30 days × daily rate)
   - Creates the staff member with:
     - `type`: 'staff'
     - `stayType`: 'monthly'
     - `selectedMonth`: '2025-09'
     - `isActive`: true
     - `checkInTime`: Current date/time
4. Displays a summary of successful additions and errors

## Notes

- The script automatically calculates charges based on the number of days in September 2025 (30 days)
- If a staff member with the same phone number already exists, they will be skipped
- All staff members will be set to active and checked in automatically
- The script uses the default daily rate (₹100) unless specified

## Example Output

```
✅ Connected to MongoDB
📋 Using admin: superadmin (507f1f77bcf86cd799439011)
📅 Adding staff members for September 2025 (2025-09)
📊 Total staff members to add: 2

✅ Added: John Doe (9876543210) - Charges: ₹3000
✅ Added: Jane Smith (9876543211) - Charges: ₹3000

============================================================
📊 SUMMARY
============================================================
✅ Successfully added: 2
❌ Failed: 0

✅ Successfully Added:
   1. John Doe - ₹3000
   2. Jane Smith - ₹3000

✨ Script completed!
```

