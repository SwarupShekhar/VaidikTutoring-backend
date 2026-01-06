import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';

@Injectable()
export class ProgramsService {
    constructor(private readonly prisma: PrismaService) { }

    create(createProgramDto: CreateProgramDto) {
        return this.prisma.program.create({
            data: {
                name: createProgramDto.name,
                status: createProgramDto.status,
                startDate: new Date(createProgramDto.startDate),
                endDate: new Date(createProgramDto.endDate),
                academic: createProgramDto.academic,
                operational: createProgramDto.operational,
                financial: createProgramDto.financial,
                staffing: createProgramDto.staffing,
                delivery: createProgramDto.delivery,
                reporting: createProgramDto.reporting,
            },
        });
    }

    findAll() {
        return this.prisma.program.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: { students: true, tutors: true, sessions: true },
                },
            },
        });
    }

    async findOne(id: string) {
        const program = await this.prisma.program.findUnique({
            where: { id },
            include: {
                _count: {
                    select: { students: true, tutors: true, sessions: true },
                }
            }
        });

        if (!program) return null;

        // Calculate total minutes delivered
        const sessions = await this.prisma.sessions.findMany({
            where: { program_id: id, status: 'completed' },
            select: { start_time: true, end_time: true },
        });

        const totalMinutesDelivered = sessions.reduce((acc, s) => {
            if (s.start_time && s.end_time) {
                const diff = (s.end_time.getTime() - s.start_time.getTime()) / 1000 / 60;
                return acc + diff;
            }
            return acc;
        }, 0);

        // Calculate credits used? (Not strictly defined in schema yet, assuming 1 min = 1 credit or something similar, or just placeholder)
        // For now returning placeholder or based on purchases if linked. 
        // Wait, purchases also have program_id now.

        return {
            ...program,
            stats: {
                studentsCount: program._count.students,
                tutorsCount: program._count.tutors,
                sessionsCount: program._count.sessions,
                totalMinutesDelivered: Math.floor(totalMinutesDelivered),
                creditsUsed: 0 // Placeholder until credit logic is defined
            }
        };
    }

    update(id: string, updateProgramDto: UpdateProgramDto) {
        const data: any = { ...updateProgramDto };
        if (data.startDate) data.startDate = new Date(data.startDate);
        if (data.endDate) data.endDate = new Date(data.endDate);

        return this.prisma.program.update({
            where: { id },
            data,
        });
    }

    async enrollStudent(programId: string, studentId: string) {
        return this.prisma.students.update({
            where: { id: studentId },
            data: { program_id: programId }
        });
    }

    async addTutor(programId: string, tutorId: string) {
        return this.prisma.tutors.update({
            where: { id: tutorId },
            data: { program_id: programId }
        });
    }

    async getStudents(programId: string) {
        return this.prisma.students.findMany({
            where: { program_id: programId },
            include: {
                users_students_user_idTousers: {
                    select: { first_name: true, last_name: true, email: true }
                }
            }
        });
    }

    async getTutors(programId: string) {
        return this.prisma.tutors.findMany({
            where: { program_id: programId },
            include: {
                users: {
                    select: { first_name: true, last_name: true, email: true }
                }
            }
        });
    }
    async getAttendanceReport(programId: string) {
        // Fetch all sessions for this program with attendance records
        const sessions = await this.prisma.sessions.findMany({
            where: { program_id: programId, status: 'completed' },
            include: {
                attendance: {
                    include: {
                        students: {
                            select: { first_name: true, last_name: true }
                        }
                    }
                }
            }
        });

        // Group by student or aggregate?
        // Let's aggregate: Total Sessions, Present Count, Attendance %
        const studentStats = new Map<string, { name: string, total: number, present: number, minutes: number }>();

        for (const s of sessions) {
            for (const a of s.attendance) {
                if (!studentStats.has(a.studentId)) {
                    studentStats.set(a.studentId, {
                        name: `${a.students.first_name} ${a.students.last_name || ''}`,
                        total: 0,
                        present: 0,
                        minutes: 0
                    });
                }
                const stat = studentStats.get(a.studentId)!;
                stat.total++;
                if (a.present) stat.present++;
                stat.minutes += a.minutesAttended || 0;
            }
        }

        return Array.from(studentStats.values()).map(s => ({
            ...s,
            attendancePercentage: s.total > 0 ? (s.present / s.total) * 100 : 0
        }));
    }

    async getComplianceReport(programId: string) {
        const sessions = await this.prisma.sessions.findMany({
            where: { program_id: programId, status: 'completed' },
        });

        const total = sessions.length;
        if (total === 0) return { total: 0, recordingPercentage: 0, reviewPercentage: 0, flaggedCount: 0 };

        const recorded = sessions.filter(s => s.recordingUploaded).length;
        const reviewed = sessions.filter(s => s.reviewedByAdmin).length;
        const flagged = sessions.filter(s => s.flagged).length;

        return {
            total,
            recordedCount: recorded,
            reviewedCount: reviewed,
            flaggedCount: flagged,
            recordingPercentage: (recorded / total) * 100,
            reviewPercentage: (reviewed / total) * 100
        };
    }
}
