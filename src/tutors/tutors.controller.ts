import { Controller, Post, Body, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TutorsService } from './tutors.service';

@Controller('tutors')
export class TutorsController {
    constructor(private tutorsService: TutorsService) { }

    @Post('create')
    @UseGuards(AuthGuard('jwt'))
    async create(@Req() req: any, @Body() body: any) {
        if (req.user.role !== 'admin') {
            throw new ForbiddenException('Only admins can create tutors');
        }
        return this.tutorsService.createTutor(body);
    }
}
