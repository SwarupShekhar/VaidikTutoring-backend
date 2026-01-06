import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SchoolsService {
    constructor(private readonly prisma: PrismaService) { }

    async getSchoolDashboard(schoolId: string) {
        // 1. Verify School
        const school = await this.prisma.school.findUnique({
            where: { id: schoolId },
            include: { programs: true }
        });
        if (!school) throw new NotFoundException('School not found');

        // 2. Aggregate Data
        // Programs
        const programs = school.programs;
        const programIds = programs.map(p => p.id);

        // Students (in these programs)
        const studentsCount = await this.prisma.students.count({
            where: { program_id: { in: programIds } }
        });

        // Sessions
        const sessions = await this.prisma.sessions.findMany({
            where: { program_id: { in: programIds } },
            select: {
                id: true,
                status: true,
                start_time: true,
                end_time: true,
                attendance: true,
                recordingUploaded: true,
                reviewedByAdmin: true
            }
        });

        // Computed Stats
        const hoursDelivered = sessions.reduce((acc, s) => {
            if (s.start_time && s.end_time && s.status === 'completed') {
                return acc + (s.end_time.getTime() - s.start_time.getTime()) / 1000 / 60 / 60;
            }
            return acc;
        }, 0);

        // Attendance %
        let totalAttendanceRecords = 0;
        let presentRecords = 0;
        sessions.forEach(s => {
            if (s.attendance) {
                s.attendance.forEach((a: any) => {
                    totalAttendanceRecords++;
                    if (a.present) presentRecords++;
                });
            }
        });
        const attendancePercentage = totalAttendanceRecords > 0 ? (presentRecords / totalAttendanceRecords) * 100 : 0;

        // Compliance Score (Average of Recorded % and Reviewed %)
        const recordedCount = sessions.filter(s => s.recordingUploaded).length;
        const reviewedCount = sessions.filter(s => s.reviewedByAdmin).length;
        const totalSessions = sessions.length || 1; // Avoid div by zero

        const complianceScore = ((recordedCount / totalSessions) + (reviewedCount / totalSessions)) / 2 * 100;

        return {
            schoolName: school.name,
            programsCount: programs.length,
            studentsCount,
            sessionsCount: sessions.length,
            hoursDelivered: Math.floor(hoursDelivered),
            attendancePercentage: Math.round(attendancePercentage),
            complianceScore: Math.round(complianceScore),
            programs: programs.map(p => ({ id: p.id, name: p.name, status: p.status }))
        };
    }
}
