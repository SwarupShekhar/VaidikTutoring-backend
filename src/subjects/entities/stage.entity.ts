export class CurriculumFramework {
    region: 'US' | 'UK' | 'International';
    frameworks: string[];
}

export class Stage {
    key: 'foundation' | 'core' | 'advanced';
    label: string;
    ageRange: string;
    focus: string;
    outcome: string;
    curriculumFrameworks: CurriculumFramework[];
}
