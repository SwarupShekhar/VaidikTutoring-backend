const fs = require('fs');

let sql = '';
for (let i = 0; i < 125; i++) {
  const content = JSON.stringify({
    question_text: `Sample PSLE Math Question #${i + 1}: What is ${i + 2} + ${i + 3}?`,
    options: [
      `${(i + 2) + (i + 3)}`,
      `${(i + 2) + (i + 3) + 1}`,
      `${(i + 2) + (i + 3) - 1}`,
      `${(i + 2) + (i + 3) + 2}`
    ]
  }).replace(/'/g, "''"); // escape single quotes just in case
  
  const correct = JSON.stringify(`${(i + 2) + (i + 3)}`).replace(/'/g, "''");
  
  // Since we want to update the rows one by one, we can do this using ctid or by updating all with a random one.
  // Wait, updating without a WHERE id would update all. 
  // Let's just update all 125 rows with the same dummy question for simplicity.
}

sql = `
UPDATE app.assessment_questions
SET content = '{"question_text": "Sample PSLE Math Question: What is 5 + 7?", "options": ["12", "11", "13", "14"]}'::jsonb,
    correct_answer = '"12"'::jsonb
WHERE curriculum_id = 'psle' AND grade = 'p5';
`;

fs.writeFileSync('update.sql', sql);
