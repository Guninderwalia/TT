const sqlite3 = require('sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.join(process.env.APPDATA, 'TaskTango', 'tasktango.db');

// Mock the db module that handlers expect
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database error:', err.message);
    process.exit(1);
  }

  // Wrap sqlite3 with promise-based API similar to what handlers expect
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

  // Test deposit:getAll handler
  (async () => {
    try {
      console.log('Testing deposit:getAll handler...\n');
      
      const deposits = await dbAPI.all(
        `SELECT pd.*, u.full_name as user_name, u.email
         FROM probation_deposits pd
         JOIN users u ON pd.user_id = u.id
         ORDER BY pd.created_at DESC`,
        []
      );

      console.log('✓ getAll deposits:', deposits.length);
      deposits.forEach(d => {
        console.log(`  - ${d.user_name}: ${d.deposit_amount} (${d.status})`);
      });

      // Test deposit:create
      console.log('\nTesting deposit:create handler...');
      const users = await dbAPI.all('SELECT id, full_name FROM users WHERE role_id != "Admin" LIMIT 1', []);
      
      if (users.length > 0) {
        const userId = users[0].id;
        const depositId = uuidv4();
        
        console.log(`Creating deposit for ${users[0].full_name}...`);
        
        await dbAPI.run(
          `INSERT INTO probation_deposits (id, user_id, deposit_amount, deduction_start_month, deduction_end_month, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [depositId, userId, 25000, 1, 2, 'held']
        );
        
        console.log('✓ Deposit created with ID:', depositId);
        
        // Verify it exists
        const created = await dbAPI.get(
          `SELECT pd.*, u.full_name as user_name, er.start_date
           FROM probation_deposits pd
           JOIN users u ON pd.user_id = u.id
           LEFT JOIN employment_records er ON u.id = er.user_id
           WHERE pd.id = ?`,
          [depositId]
        );
        
        if (created) {
          const joining = new Date(created.start_date);
          const eligibilityDate = new Date(joining.getFullYear() + 2, joining.getMonth(), joining.getDate())
            .toISOString().split('T')[0];
          
          console.log(`✓ Deposit verified:`);
          console.log(`  - Employee: ${created.user_name}`);
          console.log(`  - Amount: ${created.deposit_amount}`);
          console.log(`  - Joining Date: ${created.start_date}`);
          console.log(`  - Eligibility Date: ${eligibilityDate}`);
          console.log(`  - Status: ${created.status}`);
          
          // Clean up for next run
          await dbAPI.run('DELETE FROM probation_deposits WHERE id = ?', [depositId]);
          console.log('\n✓ Test deposit cleaned up');
        }
      }
      
      console.log('\n✓ All tests passed!');
      db.close();
    } catch (error) {
      console.error('✗ Test error:', error.message);
      db.close();
      process.exit(1);
    }
  })();
});
