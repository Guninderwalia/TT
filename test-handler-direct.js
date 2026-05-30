const sqlite3 = require('sqlite3');
const path = require('path');
const dbPath = path.join(process.env.APPDATA, 'TaskTango', 'tasktango.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database error:', err.message);
    process.exit(1);
  }

  const dbAPI = {
    get: (sql, params) => new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    }),
    all: (sql, params) => new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    }),
    run: (sql, params) => new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    })
  };

  (async () => {
    try {
      console.log('Testing deposit:getAll handler logic...\n');
      
      // Simulate the handler
      const deposits = await dbAPI.all(
        `SELECT pd.*, u.full_name as user_name, u.email
         FROM probation_deposits pd
         JOIN users u ON pd.user_id = u.id
         ORDER BY pd.created_at DESC`,
        []
      );

      console.log('✓ Query successful');
      console.log('Deposits found:', deposits.length);
      console.log('Response would be:', { success: true, data: deposits });

      // Test employee:getAll logic
      console.log('\n\nTesting employee:getAll handler logic...\n');
      const employees = await dbAPI.all(
        `SELECT id, full_name as fullName, email, role_id as roleId FROM users`,
        []
      );

      console.log('✓ Query successful');
      console.log('Employees found:', employees.length);
      employees.slice(0, 3).forEach(e => {
        console.log(`  - ${e.fullName} (${e.email})`);
      });
      console.log('Response would be:', { success: true, data: employees });

      console.log('\n✓ Both handlers would work correctly!');
      db.close();
    } catch (error) {
      console.error('✗ Error:', error.message);
      db.close();
      process.exit(1);
    }
  })();
});
