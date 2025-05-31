const mysql = require('mysql2');

// Create a promise-based connection pool
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'Shreesha@oracle26', 
  database: 'disaster_assistace',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Export the promise-based pool
module.exports = pool.promise();
