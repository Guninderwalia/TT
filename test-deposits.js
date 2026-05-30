const sqlite3 = require('sqlite3');
const path = require('path');
const dbPath = path.join(process.env.APPDATA, 'TaskTango', 'tasktango.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database error:', err.message);
    process.exit(1);
  }
  
  // Check existing deposits
  db.all("SELECT * FROM probation_deposits", (err, deposits) => {
    if (err) {
      console.error('Deposits error:', err.message);
    } else {
      console.log('Existing deposits:', deposits.length);
      deposits.forEach(d => {
        console.log(`  - User ${d.user_id}: ${d.deposit_amount} (Status: ${d.status})`);
      });
    }
    
    // Now get employee info with joining dates to test
    db.all(`
      SELECT u.id, u.full_name, er.start_date, 
             date('now') as today,
             date(er.start_date, '+2 years') as eligibility_date
      FROM users u
      LEFT JOIN employment_records er ON u.id = er.user_id
      WHERE u.role_id != 'Admin'
      LIMIT 5
    `, (err, employees) => {
      if (err) {
        console.error('Employee error:', err.message);
      } else {
        console.log('\nEmployees with eligibility dates:');
        employees.forEach(e => {
          const days = e.eligibility_date ? Math.ceil((new Date(e.eligibility_date) - new Date(e.today)) / (1000 * 60 * 60 * 24)) : null;
          const status = days === null ? 'No joining date' : days <= 0 ? 'ELIGIBLE NOW' : `${days} days`;
          console.log(`  - ${e.full_name} (joined: ${e.start_date}, eligible: ${e.eligibility_date} = ${status})`);
        });
      }
      db.close();
    });
  });
});
