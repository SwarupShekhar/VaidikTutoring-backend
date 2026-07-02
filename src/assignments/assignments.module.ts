import { Module } from '@nestjs/common';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AzureModule } from '../azure/azure.module';
import { StudentsModule } from '../students/students.module';

@Module({
  imports: [PrismaModule, AzureModule, StudentsModule],
  controllers: [AssignmentsController],
  providers: [AssignmentsService]
})
export class AssignmentsModule {}
