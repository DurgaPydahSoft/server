# Migrate Additional Fees to Map Format

This script migrates the `additionalFees` field in the `FeeStructure` collection from the old format to the new Map format.

## Problem

The `additionalFees` field was previously stored as:
```javascript
additionalFees: {
  cautionDeposit: 7000  // Primitive number
}
```

The new format uses a Map structure:
```javascript
additionalFees: Map {
  'cautionDeposit' => {
    amount: 7000,
    description: '',
    isActive: true
  }
}
```

## When to Run

Run this migration script **before** using the new Additional Fees Setup feature in the admin panel. This ensures all existing data is in the correct format.

## How to Run

1. Make sure your MongoDB connection string is set in `.env`:
   ```
   MONGODB_URI=your_mongodb_connection_string
   ```

2. Run the migration script:
   ```bash
   node server/src/scripts/migrateAdditionalFeesToMapFormat.js
   ```

## What It Does

1. Connects to MongoDB
2. Finds all `FeeStructure` documents with `additionalFees` field
3. Checks if any have the old format (primitive numbers)
4. Converts old format to new format:
   - `cautionDeposit: 7000` → `cautionDeposit: {amount: 7000, description: '', isActive: true}`
5. Updates all affected documents
6. Provides a summary of migrated, skipped, and error counts

## Output Example

```
🚀 Starting additional fees migration to Map format...
✅ Connected to MongoDB
📊 Found 5 fee structures with additionalFees
🔄 Migrating fee structure 507f1f77bcf86cd799439011...
   ✓ Migrated cautionDeposit: 7000 -> {amount: 7000, description: '', isActive: true}
✅ Successfully migrated fee structure 507f1f77bcf86cd799439011

📊 Migration Summary:
   ✅ Migrated: 3
   ⏭️  Skipped: 2
   ❌ Errors: 0
   📝 Total processed: 5

✅ Migration completed successfully!
💡 The additionalFees field has been migrated to the new Map format.
💡 You can now use the new Additional Fees Setup tab in the admin panel.
```

## Safety

- The script uses raw MongoDB queries to avoid validation issues
- It only updates documents that need migration
- Documents already in the new format are skipped
- The script is idempotent - safe to run multiple times

## After Migration

After running this script, you can:
1. Use the new "Additional Fees Setup" tab in the admin panel
2. Create, edit, and manage additional fees dynamically
3. Add new fee types like diesel charges, electricity bills, etc.

## Troubleshooting

If you encounter errors:
1. Check your MongoDB connection string
2. Ensure you have write permissions to the database
3. Check the error messages for specific document IDs that failed
4. You can re-run the script - it's safe to run multiple times

