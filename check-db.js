const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('./app.db', (err) => {
  if (err) {
    console.error('Database error:', err);
    process.exit(1);
  }
  
  db.all(`
    SELECT u.full_name, u.id, er.start_date, u.email 
    FROM users u 
    LEFT JOIN employment_records er ON u.id = er.user_id 
    WHERE u.role_id != 'admin'
    LIMIT 5
  `, (err, rows) => {
    if (err) {
      console.error('Query error:', err);
    } else {
      console.log('Employees with joining dates:');
      console.log(JSON.stringify(rows, null, 2));
    }
    
    // Also check probation_deposits
    db.all(`SELECT * FROM probation_deposits LIMIT 5`, (err, deposits) => {
      if (err) {
        console.log('Deposits table error (may not exist):', err.message);
      } else {
        console.log('\nExisting deposits:', deposits.length);
        console.log(JSON.stringify(deposits, null, 2));
      }
      db.close();
    });
  });
});
