const sqlite3 = require('sqlite3');
const path = require('path');
const dbPath = path.join(process.env.APPDATA, 'TaskTango', 'tasktango.db');
console.log('Connecting to:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
  
  db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;", (err, rows) => {
    if (err) {
      console.error('Query error:', err.message);
    } else {
      console.log('Tables:');
      rows.forEach(r => console.log('  ' + r.name));
    }
    
    // Check employees
    db.all("SELECT id, full_name, email FROM users LIMIT 3", (err, users) => {
      if (err) {
        console.log('Users error:', err.message);
      } else {
        console.log('\nEmployees:', users.length);
        users.forEach(u => console.log(`  - ${u.full_name} (${u.email})`));
      }
      
      // Check employment records
      db.all("SELECT user_id, start_date FROM employment_records LIMIT 3", (err, emps) => {
        if (err) {
          console.log('Employment records error:', err.message);
        } else {
          console.log('\nEmployment records:', emps.length);
          emps.forEach(e => console.log(`  - ${e.user_id}: ${e.start_date}`));
        }
        db.close();
      });
    });
  });
});
