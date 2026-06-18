import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const run = async () => {
  let connection;
  try {
    const config = {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    };
    console.log('Connecting to SQL:', config.host, config.database);
    connection = await mysql.createConnection(config);

    // 1. Show indexes
    console.log('\n--- Indexes on students table ---');
    const [indexes] = await connection.execute('SHOW INDEX FROM students');
    console.table(indexes.map(idx => ({
      Table: idx.Table,
      Non_unique: idx.Non_unique,
      Key_name: idx.Key_name,
      Seq_in_index: idx.Seq_in_index,
      Column_name: idx.Column_name,
      Collation: idx.Collation,
      Cardinality: idx.Cardinality
    })));

    // 2. Explain query
    console.log('\n--- Explain plan for original OR query after indexing ---');
    const [explain] = await connection.execute(`
      EXPLAIN SELECT id, admission_number, pin_no
      FROM students
      WHERE pin_no IN ('TEST1', 'TEST2')
         OR admission_number IN ('TEST1', 'TEST2')
         OR admission_no IN ('TEST1', 'TEST2')
    `);
    console.table(explain);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (connection) await connection.end();
  }
};

run();
