import { Injectable, NotFoundException } from '@nestjs/common';
import { Subject } from './entities/subject.entity';

@Injectable()
export class SubjectsService {
    private subjects: Subject[] = [
        {
            id: 'math',
            name: 'Math',
            tagline: 'Logical thinking & problem solving',
            skillPillars: [
                'Numerical Fluency',
                'Logical Reasoning',
                'Problem Solving Speed',
                'Conceptual Understanding',
            ],
            stages: [
                {
                    key: 'foundation',
                    label: 'Foundations',
                    ageRange: '6–10',
                    focus: 'Number systems, patterns, operations',
                    outcome: 'Builds confidence and number sense',
                    curriculumFrameworks: [
                        { region: 'US', frameworks: ['Common Core Elementary Math'] },
                        { region: 'UK', frameworks: ['KS1–KS2 Mathematics'] },
                        { region: 'International', frameworks: ['IB PYP Mathematics'] },
                    ],
                },
                {
                    key: 'core',
                    label: 'Core Competency',
                    ageRange: '11–14',
                    focus: 'Algebra, Geometry basics, data analysis',
                    outcome: 'Develops abstract thinking and analytical skills',
                    curriculumFrameworks: [
                        { region: 'US', frameworks: ['Common Core Middle School Math'] },
                        { region: 'UK', frameworks: ['KS3 Mathematics'] },
                        { region: 'International', frameworks: ['IB MYP Mathematics'] },
                    ],
                },
                {
                    key: 'advanced',
                    label: 'Advanced Mastery',
                    ageRange: '15–18',
                    focus: 'Calculus, Advanced Statistics, Trigonometry',
                    outcome: 'Prepares for university-level STEM studies',
                    curriculumFrameworks: [
                        { region: 'US', frameworks: ['AP Calculus', 'AP Statistics'] },
                        { region: 'UK', frameworks: ['A-Level Mathematics', 'A-Level Further Math'] },
                        { region: 'International', frameworks: ['IB DP Mathematics HL/SL'] },
                    ],
                },
            ],
        },
        {
            id: 'science',
            name: 'Science',
            tagline: 'Concept clarity & scientific reasoning',
            skillPillars: [
                'Scientific Inquiry',
                'Data Analysis',
                'Conceptual Models',
                'Experimental Design',
            ],
            stages: [
                {
                    key: 'foundation',
                    label: 'Foundations',
                    ageRange: '6–10',
                    focus: 'Observation, Life Science, Physical properties',
                    outcome: 'Nurtures curiosity and understanding of the natural world',
                    curriculumFrameworks: [
                        { region: 'US', frameworks: ['NGSS Elementary'] },
                        { region: 'UK', frameworks: ['KS1–KS2 Science'] },
                        { region: 'International', frameworks: ['IB PYP Science'] },
                    ],
                },
                {
                    key: 'core',
                    label: 'Core Competency',
                    ageRange: '11–14',
                    focus: 'Biology, Chemistry, Physics basics',
                    outcome: 'Builds foundational knowledge across scientific disciplines',
                    curriculumFrameworks: [
                        { region: 'US', frameworks: ['NGSS Middle School'] },
                        { region: 'UK', frameworks: ['KS3 Science'] },
                        { region: 'International', frameworks: ['IB MYP Sciences'] },
                    ],
                },
                {
                    key: 'advanced',
                    label: 'Advanced Mastery',
                    ageRange: '15–18',
                    focus: 'Advanced Biology, Chemistry, Physics',
                    outcome: 'Deep conceptual mastery for medical or engineering paths',
                    curriculumFrameworks: [
                        { region: 'US', frameworks: ['AP Biology', 'AP Chemistry', 'AP Physics'] },
                        { region: 'UK', frameworks: ['A-Level Biology', 'A-Level Chemistry', 'A-Level Physics'] },
                        { region: 'International', frameworks: ['IB DP Sciences HL/SL'] },
                    ],
                },
            ],
        },
        {
            id: 'english',
            name: 'English Communication',
            tagline: 'Fluency & confidence',
            skillPillars: [
                'Reading Comprehension',
                'Written Expression',
                'Critical Analysis',
                'Verbal Fluency',
            ],
            stages: [
                {
                    key: 'foundation',
                    label: 'Foundations',
                    ageRange: '6–10',
                    focus: 'Phonics, basic grammar, reading fluency',
                    outcome: 'Establishes strong literacy and communication basics',
                    curriculumFrameworks: [
                        { region: 'US', frameworks: ['Common Core ELA Elementary'] },
                        { region: 'UK', frameworks: ['KS1–KS2 English'] },
                        { region: 'International', frameworks: ['IB PYP Language'] },
                    ],
                },
                {
                    key: 'core',
                    label: 'Core Competency',
                    ageRange: '11–14',
                    focus: 'Essay writing, literary analysis, debate',
                    outcome: 'Enhances critical thinking and structured argumentation',
                    curriculumFrameworks: [
                        { region: 'US', frameworks: ['Common Core ELA Middle School'] },
                        { region: 'UK', frameworks: ['KS3 English'] },
                        { region: 'International', frameworks: ['IB MYP Language and Literature'] },
                    ],
                },
                {
                    key: 'advanced',
                    label: 'Advanced Mastery',
                    ageRange: '15–18',
                    focus: 'Rhetoric, advanced literature, research papers',
                    outcome: 'Mastery of academic and professional communication',
                    curriculumFrameworks: [
                        { region: 'US', frameworks: ['AP English Language', 'AP English Literature'] },
                        { region: 'UK', frameworks: ['A-Level English Literature', 'A-Level English Language'] },
                        { region: 'International', frameworks: ['IB DP Language A'] },
                    ],
                },
            ],
        },
    ];

    findAll(): Subject[] {
        // Return a summary list (omit heavy details if needed, but for now returning full object is fine for this scale)
        return this.subjects;
    }

    findOne(id: string): Subject {
        const subject = this.subjects.find((s) => s.id === id);
        if (!subject) {
            throw new NotFoundException(`Subject with ID ${id} not found`);
        }
        return subject;
    }
}
