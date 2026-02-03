import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { PrismaModule } from '../prisma/prisma.module'; // Import PrismaModule
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule], // Add this
  controllers: [StudentsController],
  providers: [StudentsService],
})
export class StudentsModule { }
