
UPDATE app.assessment_questions
SET content = '{"question_text": "Sample PSLE Math Question: What is 5 + 7?", "options": ["12", "11", "13", "14"]}'::jsonb,
    correct_answer = '"12"'::jsonb
WHERE curriculum_id = 'psle' AND grade = 'p5';
