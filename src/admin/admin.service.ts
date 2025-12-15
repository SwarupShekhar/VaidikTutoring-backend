import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from '../email/email.service';
import { hash } from 'bcrypt';

@Injectable()
export class AdminService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwt: JwtService,
        private readonly email: EmailService,
    ) { }

    async getStats() {
        const [studentsCount, parentsCount, tutorsCount, upcomingSessionsCount] = await Promise.all([
            this.prisma.users.count({
                where: { role: 'student', is_active: true },
            }),
            this.prisma.users.count({
                where: { role: 'parent', is_active: true },
            }),
            this.prisma.users.count({
                where: { role: 'tutor', is_active: true },
            }),
            this.prisma.sessions.count({
                where: {
                    start_time: {
                        gt: new Date(),
                    },
                    status: 'scheduled',
                },
            }),
        ]);

        return {
            students: studentsCount,
            parents: parentsCount,
            tutors: tutorsCount,
            upcomingSessions: upcomingSessionsCount,
        };
    }

    async getTutors(page: number = 1, limit: number = 50) {
        const skip = (page - 1) * limit;

        const [tutors, total] = await Promise.all([
            this.prisma.tutors.findMany({
                skip,
                take: limit,
                include: {
                    users: {
                        select: {
                            id: true,
                            email: true,
                            first_name: true,
                            last_name: true,
                            is_active: true,
                            created_at: true,
                        },
                    },
                },
                orderBy: {
                    created_at: 'desc',
                },
            }),
            this.prisma.tutors.count(),
        ]);

        // Format tutors for frontend compatibility
        const formattedTutors = tutors.map(tutor => ({
            id: tutor.id,
            user_id: tutor.user_id,
            bio: tutor.bio,
            qualifications: tutor.qualifications,
            skills: tutor.skills,
            hourly_rate_cents: tutor.hourly_rate_cents,
            employment_type: tutor.employment_type,
            is_active: tutor.is_active,
            created_at: tutor.created_at,
            email: tutor.users.email,
            first_name: tutor.users.first_name,
            last_name: tutor.users.last_name,
            subjects: (tutor.skills as any)?.subjects || [],
        }));

        return {
            data: formattedTutors,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async createTutor(actor: any, dto: { email: string; first_name?: string; last_name?: string; password?: string; subjects?: string[] }) {
        // Only admin allowed
        if (!actor || actor.role !== 'admin') {
            throw new ForbiddenException('Only admin can create tutor accounts');
        }

        const { email, first_name, last_name, password, subjects } = dto;

        if (!email) throw new BadRequestException('Email is required');
        if (!email.includes('@')) throw new BadRequestException('Invalid email format');

        // check if exists
        const existing = await this.prisma.users.findUnique({ where: { email } });
        if (existing) {
            throw new BadRequestException('User with this email already exists');
        }

        // Use provided password or generate a random one
        const finalPassword = password || Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6).toUpperCase() + '123!';
        const password_hash = await hash(finalPassword, 10);

        let result;
        try {
            result = await this.prisma.$transaction(async (tx) => {
                const createdUser = await tx.users.create({
                    data: {
                        email,
                        password_hash,
                        role: 'tutor',
                        first_name: first_name || null,
                        last_name: last_name || null,
                        timezone: 'UTC',
                        is_active: true,
                    },
                });

                // Create tutor profile
                await tx.tutors.create({
                    data: {
                        user_id: createdUser.id,
                        skills: subjects && subjects.length > 0 ? { subjects } : {},
                        is_active: true
                    }
                });

                return createdUser;
            });
        } catch (error: any) {
            console.error('Failed to create tutor:', error);
            throw new BadRequestException(`Failed to create tutor: ${error.message || 'Unknown error'}`);
        }

        // generate invite token (short lived)
        const inviteToken = this.jwt.sign(
            { sub: result.id, email: result.email, purpose: 'tutor-invite' },
            { expiresIn: '48h' },
        );

        // build the frontend invite URL (FRONTEND_URL env required)
        const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
        const inviteUrl = `${frontend.replace(/\/$/, '')}/tutor/accept-invite?token=${inviteToken}`;

        // send email
        const html = `
      <p>Hi ${first_name ?? ''},</p>
      <p>You have been added as a tutor on K12 Tutoring.</p>
      ${password ? `<p>Your password is: <strong>${finalPassword}</strong></p>` : `<p>Click below to set your password and activate account:</p><p><a href="${inviteUrl}">Set Password</a></p>`}
      <p>Subjects: ${subjects?.join(', ') ?? 'General'}</p>
    `;

        try {
            await this.email.sendMail({
                to: email,
                subject: 'K12 Tutoring — Tutor Account Created',
                text: `Your tutor account has been created.`,
                html,
                from: process.env.EMAIL_FROM || 'K12 Tutoring <no-reply@k12.com>',
            });
        } catch (e) {
            console.error('Failed to send tutor invite email. User was created successfully.', e);
            // Do not throw, return success for user creation
        }

        const { password_hash: _ph, ...userSafe } = (result as any);
        return { user: userSafe, inviteToken: password ? null : inviteToken };
    }

    async getStudents(page: number = 1, limit: number = 50) {
        const skip = (page - 1) * limit;

        const [students, total] = await Promise.all([
            this.prisma.students.findMany({
                skip,
                take: limit,
                include: {
                    users_students_parent_user_idTousers: {
                        select: {
                            id: true,
                            email: true,
                            first_name: true,
                            last_name: true,
                        },
                    },
                    users_students_user_idTousers: {
                        select: {
                            id: true,
                            email: true,
                        },
                    },
                    curricula: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
                orderBy: {
                    created_at: 'desc',
                },
            }),
            this.prisma.students.count(),
        ]);

        // Format the response for better readability
        const formattedStudents = students.map(student => ({
            id: student.id,
            first_name: student.first_name,
            last_name: student.last_name,
            grade: student.grade,
            school: student.school,
            birth_date: student.birth_date,
            curriculum: student.curricula?.name || null,
            created_at: student.created_at,
            parent: student.users_students_parent_user_idTousers ? {
                id: student.users_students_parent_user_idTousers.id,
                email: student.users_students_parent_user_idTousers.email,
                first_name: student.users_students_parent_user_idTousers.first_name,
                last_name: student.users_students_parent_user_idTousers.last_name,
            } : null,
            student_email: student.users_students_user_idTousers?.email || null,
        }));

        return {
            data: formattedStudents,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async allocateTutor(studentId: string, tutorId: string, subjectId: string) {
        // Verify student exists
        const student = await this.prisma.students.findUnique({
            where: { id: studentId },
            include: {
                users_students_parent_user_idTousers: {
                    select: {
                        email: true,
                        first_name: true,
                    },
                },
            },
        });

        if (!student) {
            throw new BadRequestException('Student not found');
        }

        // Verify tutor exists
        const tutor = await this.prisma.tutors.findUnique({
            where: { id: tutorId },
            include: {
                users: {
                    select: {
                        id: true,
                        email: true,
                        first_name: true,
                        last_name: true,
                    },
                },
            },
        });

        if (!tutor || !tutor.is_active) {
            throw new BadRequestException('Tutor not found or inactive');
        }

        // Verify subject exists
        const subject = await this.prisma.subjects.findUnique({
            where: { id: subjectId },
        });

        if (!subject) {
            throw new BadRequestException('Subject not found');
        }

        // Create a booking/allocation
        const allocation = await this.prisma.bookings.create({
            data: {
                student_id: studentId,
                assigned_tutor_id: tutorId,
                subject_id: subjectId,
                status: 'pending',
                note: 'Allocated by admin',
            },
        });

        // Send notification email to tutor
        try {
            const html = `
                <p>Hi ${tutor.users.first_name},</p>
                <p>You have been allocated to a new student:</p>
                <ul>
                    <li><strong>Student:</strong> ${student.first_name} ${student.last_name || ''}</li>
                    <li><strong>Grade:</strong> ${student.grade || 'N/A'}</li>
                    <li><strong>Subject:</strong> ${subject.name}</li>
                </ul>
                <p>Please check your dashboard for more details.</p>
            `;

            await this.email.sendMail({
                to: tutor.users.email,
                subject: 'New Student Allocation - K12 Tutoring',
                text: `You have been allocated to student ${student.first_name} for ${subject.name}`,
                html,
            });
        } catch (e) {
            console.error('Failed to send tutor notification email:', e);
            // Don't fail the allocation if email fails
        }

        return {
            success: true,
            message: 'Tutor assigned successfully',
            allocation: {
                id: allocation.id,
                student: {
                    id: student.id,
                    name: `${student.first_name} ${student.last_name || ''}`.trim(),
                },
                tutor: {
                    id: tutor.id,
                    name: `${tutor.users.first_name} ${tutor.users.last_name || ''}`.trim(),
                },
                subject: {
                    id: subject.id,
                    name: subject.name,
                },
            },
        };
    }
}
