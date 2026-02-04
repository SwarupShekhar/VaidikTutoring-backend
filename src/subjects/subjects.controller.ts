import { Controller, Get, Param } from '@nestjs/common';
import { SubjectsService } from './subjects.service';
import { Subject } from './entities/subject.entity';

@Controller('subjects')
export class SubjectsController {
    constructor(private readonly subjectsService: SubjectsService) { }

    @Get()
    findAll(): Subject[] {
        return this.subjectsService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string): Subject {
        return this.subjectsService.findOne(id);
    }
}
