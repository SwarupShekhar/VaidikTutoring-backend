import { Stage } from './stage.entity';

export class Subject {
    id: string;
    name: string;
    tagline: string;
    skillPillars: string[];
    stages: Stage[];
}
