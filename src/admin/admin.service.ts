import {
    Injectable,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from '../email/email.service';
import { hash } from 'bcrypt';
import { Prisma, bookings, users } from '../../generated/prisma/client';
import * as crypto from 'crypto';

// Define a type for skills structure
interface TutorSkills {
    subjects?: string[];
}

@Injectable()
export class AdminService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwt: JwtService,
        private readonly email: EmailService,
    ) { }

    async getStats() {
        console.log('[AdminService] 🟡 Fetching stats... checking connection and raw data');

        try {
            // DIAGNOSTICS: Check if we can see ANY users at all
            const allUsers = await this.prisma.users.findMany({
                select: { id: true, email: true, role: true, is_active: true },
                take: 10
            });
            console.log(`[AdminService] 🔍 Raw User Samples (${allUsers.length} found):`, JSON.stringify(allUsers, null, 2));

            const [studentsCount, parentsCount, tutorsCount, upcomingSessionsCount] =
                await Promise.all([
                    this.prisma.users.count({
                        where: { role: 'student' },
                    }),
                    this.prisma.users.count({
                        where: { role: 'parent' },
                    }),
                    this.prisma.users.count({
                        where: { role: 'tutor' },
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

            console.log('[AdminService] ✅ Stats Calculated:', {
                students: studentsCount,
                parents: parentsCount,
                tutors: tutorsCount,
                upcomingSessions: upcomingSessionsCount,
            });

            return {
                students: studentsCount,
                parents: parentsCount,
                tutors: tutorsCount,
                upcomingSessions: upcomingSessionsCount,
            };
        } catch (error) {
            console.error('[AdminService] ❌ Failed to fetch stats:', error);
            throw error;
        }
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
        const formattedTutors = tutors.map((tutor) => {
            const skills = tutor.skills as unknown as TutorSkills; // Safe cast after type unknown
            return {
                id: tutor.id,
                user_id: tutor.user_id,
                bio: tutor.bio,
                qualifications: tutor.qualifications,
                skills: tutor.skills,
                hourly_rate_cents: tutor.hourly_rate_cents,
                employment_type: tutor.employment_type,
                is_active: tutor.is_active,
                created_at: this.safeIso(tutor.created_at),
                email: tutor.users.email,
                first_name: tutor.users.first_name,
                last_name: tutor.users.last_name,
                subjects: skills?.subjects || [],
            };
        });

        return {
            data: formattedTutors,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async createTutor(
        actor: { role: string },
        dto: {
            email: string;
            first_name?: string;
            last_name?: string;
            password?: string;
            subjects?: string[];
        },
    ) {
        // Only admin allowed
        if (!actor || actor.role !== 'admin') {
            throw new ForbiddenException('Only admin can create tutor accounts');
        }

        const { email, first_name, last_name, password, subjects } = dto;

        if (!email) throw new BadRequestException('Email is required');
        if (!email.includes('@'))
            throw new BadRequestException('Invalid email format');

        // check if exists
        const existing = await this.prisma.users.findUnique({ where: { email } });
        if (existing) {
            throw new BadRequestException('User with this email already exists');
        }

        // Admin creation logic adjustment:
        // "Admin still shares credentials — but only once."
        // "Set force_password_change = true"
        // "Set email_verified = false"
        // "Set passwordHash (temporary password)"

        // Use provided password or generate a temporary one
        const finalPassword =
            password ||
            Math.random().toString(36).slice(2, 10) +
            Math.random().toString(36).slice(2, 6).toUpperCase() +
            '123!';

        const password_hash = await hash(finalPassword, 10);

        let result: users;
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
                        email_verified: false,
                        force_password_change: true, // Enforce change
                    },
                });

                // Create tutor profile
                const skillsJson = (
                    subjects && subjects.length > 0 ? { subjects } : {}
                ) as Prisma.InputJsonObject;

                await tx.tutors.create({
                    data: {
                        user_id: createdUser.id,
                        skills: skillsJson,
                        is_active: true,
                        tutor_approved: true, // Admin created = Approved
                    },
                });

                return createdUser;
            });
        } catch (error) {
            const err = error as Error;
            console.error('Failed to create tutor:', err);
            throw new BadRequestException(
                `Failed to create tutor: ${err.message || 'Unknown error'}`,
            );
        }

        // Email logic: User said "Admin shares credentials".
        // Does admin get the password in response? Yes.
        // Should we send email?
        // "Admin still shares credentials".
        // If I assume Manual Sharing, I return the password.
        // If I send email, I send the temp password.
        // Let's send the email with temp password for convenience, BUT return it too.

        // build the frontend login URL
        const frontend = process.env.FRONTEND_URL || 'https://vaidiktutoring.vercel.app';
        const loginUrl = `${frontend.replace(/\/$/, '')}/login`;

        const html = `
      <p>Hi ${first_name ?? ''},</p>
      <p>Your tutor account has been created by an administrator.</p>
      <p><strong>Temporary Password:</strong> ${finalPassword}</p>
      <p>Please login immediately and change your password:</p>
      <p><a href="${loginUrl}">Login</a></p>
    `;

        try {
            await this.email.sendMail({
                to: email,
                subject: 'K12 Tutoring — Account Credentials',
                text: `Temp Password: ${finalPassword}`,
                html,
                from: process.env.EMAIL_FROM || 'K12 Tutoring <no-reply@k12.com>',
            });
        } catch (e) {
            console.error('Failed to send credentials email', e);
        }

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password_hash: _ph, ...userSafe } = result;
        // Return generated password so admin can see/share it manually if needed
        return { user: userSafe, temporaryPassword: finalPassword };
    }

    async getStudents(page: number = 1, limit: number = 1000) {
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
                            first_name: true,
                            last_name: true,
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
        const formattedStudents = students.map((student) => ({
            id: student.id,
            first_name:
                student.first_name ||
                (student.users_students_user_idTousers
                    ? student.users_students_user_idTousers.first_name
                    : null),
            last_name:
                student.last_name ||
                (student.users_students_user_idTousers
                    ? student.users_students_user_idTousers.last_name
                    : null),
            grade: student.grade,
            school: student.school,
            birth_date: this.safeIso(student.birth_date),
            curriculum: student.curricula?.name || null,
            created_at: this.safeIso(student.created_at),
            parent: student.users_students_parent_user_idTousers
                ? {
                    id: student.users_students_parent_user_idTousers.id,
                    email: student.users_students_parent_user_idTousers.email,
                    first_name: student.users_students_parent_user_idTousers.first_name,
                    last_name: student.users_students_parent_user_idTousers.last_name,
                }
                : null,
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

    async getBookings(page: number = 1, limit: number = 50) {
        const skip = (page - 1) * limit;

        const [bookings, total] = await Promise.all([
            this.prisma.bookings.findMany({
                skip,
                take: limit,
                include: {
                    students: {
                        include: {
                            users_students_parent_user_idTousers: {
                                select: {
                                    email: true,
                                    first_name: true,
                                    last_name: true,
                                },
                            },
                            users_students_user_idTousers: {
                                select: {
                                    first_name: true,
                                    last_name: true,
                                    email: true,
                                },
                            },
                        },
                    },
                    tutors: {
                        include: {
                            users: {
                                select: {
                                    id: true,
                                    first_name: true,
                                    last_name: true,
                                    email: true,
                                },
                            },
                        },
                    },
                    subjects: true,
                    curricula: true,
                    packages: true,
                    sessions: {
                        orderBy: { start_time: 'desc' },
                        take: 1,
                    },
                },
                orderBy: {
                    created_at: 'desc',
                },
            }),
            this.prisma.bookings.count(),
        ]);

        // Sanitize and format bookings to prevent "Invalid time value" frontend crashes
        const formattedBookings = bookings.map((b) => ({
            ...b,
            // Map relations to what frontend likely expects & ensure names are populated
            student: b.students
                ? {
                    id: b.students.id,
                    first_name:
                        b.students.first_name ||
                        b.students.users_students_user_idTousers?.first_name ||
                        'Student',
                    last_name:
                        b.students.last_name ||
                        b.students.users_students_user_idTousers?.last_name ||
                        (b.students.first_name || b.students.users_students_user_idTousers?.first_name ? '' : 'User'),
                    grade: b.students.grade,
                    school: b.students.school,
                    // Serialize dates properly
                    birth_date: this.safeIso(b.students.birth_date),
                    created_at: this.safeIso(b.students.created_at),
                    // Correctly place user inside student object
                    user: b.students.users_students_user_idTousers,
                }
                : null,
            subject: b.subjects, // Alias plural 'subjects' to singular 'subject'
            tutor: b.tutors, // Ensure tutor is accessible via 'tutor' if needed
            requested_start: this.safeIso(b.requested_start),
            requested_end: this.safeIso(b.requested_end),
            created_at: this.safeIso(b.created_at),
            sessions: b.sessions.map((s) => ({
                ...s,
                start_time: this.safeIso(s.start_time),
                end_time: this.safeIso(s.end_time),
            })),
        }));
        return {
            data: formattedBookings,
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
        // FIX: Admin might send User ID instead of Tutor ID. We check both.
        let tutor = await this.prisma.tutors.findUnique({
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

        if (!tutor) {
            console.log('[allocateTutor] Tutor not found by ID, checking by User ID:', tutorId);
            tutor = await this.prisma.tutors.findFirst({
                where: { user_id: tutorId },
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
        }

        if (!tutor || !tutor.is_active) {
            throw new BadRequestException('Tutor not found or inactive');
        }

        // Program Integrity Check & Auto-Healing
        if (tutor.program_id && student.program_id !== tutor.program_id) {
            throw new BadRequestException(
                `Program mismatch: Student is in Program ${student.program_id} but Tutor is in ${tutor.program_id}`
            );
        }

        // If tutor has no program, assign them to the student's program upon allocation
        if (!tutor.program_id && student.program_id) {
            console.log(`[allocateTutor] Auto-assigning Tutor ${tutor.id} to Program ${student.program_id}`);
            await this.prisma.tutors.update({
                where: { id: tutor.id },
                data: { program_id: student.program_id }
            });
        }

        // Verify subject exists (by ID or name)
        let subject = await this.prisma.subjects.findUnique({
            where: { id: subjectId },
        });

        // If not found by ID, try by name (case-insensitive)
        if (!subject) {
            subject = await this.prisma.subjects.findFirst({
                where: {
                    name: {
                        equals: subjectId,
                        mode: 'insensitive',
                    },
                },
            });
        }

        // If still not found, try partial match
        if (!subject) {
            subject = await this.prisma.subjects.findFirst({
                where: {
                    name: {
                        contains: subjectId,
                        mode: 'insensitive',
                    },
                },
            });
        }

        if (!subject) {
            throw new BadRequestException('Subject not found');
        }

        // Find an existing unassigned booking for this student and subject
        const existingBooking = await this.prisma.bookings.findFirst({
            where: {
                student_id: studentId,
                subject_id: subject.id,
                assigned_tutor_id: null,
                status: { in: ['requested', 'pending', 'open'] },
            },
            orderBy: { created_at: 'desc' },
        });

        let allocation: bookings;
        if (existingBooking) {
            // Update the existing booking
            allocation = await this.prisma.bookings.update({
                where: { id: existingBooking.id },
                data: {
                    assigned_tutor_id: tutor.id, // Use the Tutor ID (UUID)
                    program_id: student.program_id, // Ensure Program ID is set/synced
                    status: 'confirmed',
                    note: existingBooking.note
                        ? `${existingBooking.note}\n\nAllocated by admin to ${tutor.users.first_name} ${tutor.users.last_name || ''}`
                        : 'Allocated by admin',
                },
            });

            // Create or update session record
            const existingSession = await this.prisma.sessions.findFirst({
                where: { booking_id: allocation.id },
            });

            if (
                !existingSession &&
                allocation.requested_start &&
                allocation.requested_end
            ) {
                await this.prisma.sessions.create({
                    data: {
                        booking_id: allocation.id,
                        program_id: student.program_id, // Set Program ID
                        start_time: allocation.requested_start,
                        end_time: allocation.requested_end,
                        status: 'scheduled',
                        meet_link: `daily-room-${allocation.id}`, // Room will be generated by Daily.co service
                    },
                });
            }
        } else {
            // No existing booking found - create one for the admin
            console.log(
                '[allocateTutor] No existing booking found, creating new booking...',
            );

            // Set default times: tomorrow at 10 AM for 1 hour
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(10, 0, 0, 0);
            const endTime = new Date(tomorrow);
            endTime.setHours(11, 0, 0, 0);

            allocation = await this.prisma.bookings.create({
                data: {
                    student_id: studentId,
                    assigned_tutor_id: tutor.id,
                    subject_id: subject.id,
                    program_id: student.program_id, // Set Program ID
                    status: 'confirmed',
                    requested_start: tomorrow,
                    requested_end: endTime,
                    note: 'Created and allocated by admin',
                },
            });

            // Create session record
            await this.prisma.sessions.create({
                data: {
                    booking_id: allocation.id,
                    program_id: student.program_id, // Set Program ID
                    start_time: allocation.requested_start,
                    end_time: allocation.requested_end,
                    status: 'scheduled',
                    meet_link: `daily-room-${allocation.id}`, // Room will be generated by Daily.co service
                },
            });
        }

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


    async removeTutor(tutorId: string) {
        const tutor = await this.prisma.tutors.findUnique({
            where: { id: tutorId },
        });

        if (!tutor) {
            throw new BadRequestException('Tutor not found');
        }

        // 1. Unassign all bookings
        // We set them back to 'requested' so they can be re-allocated
        await this.prisma.bookings.updateMany({
            where: { assigned_tutor_id: tutorId },
            data: {
                assigned_tutor_id: null,
                status: 'requested',
                note: 'Tutor was removed by admin. Please re-assign.',
            },
        });

        // 2. Delete the User (Cascades to Tutor profile, Shifts, etc.)
        // We delete the USER record to fully remove credentials
        await this.prisma.users.delete({
            where: { id: tutor.user_id },
        });

        return { success: true, message: 'Tutor deleted successfully' };
    }

    async suspendTutor(tutorId: string, reason?: string) {
        const tutor = await this.prisma.tutors.findUnique({ where: { id: tutorId } });
        if (!tutor) throw new BadRequestException('Tutor not found');

        await this.prisma.users.update({
            where: { id: tutor.user_id },
            data: {
                tutor_status: 'SUSPENDED'
            }
        });

        // Log the reason
        await this.prisma.audit_logs.create({
            data: {
                actor_user_id: null, // Should ideally pass admin ID
                action: 'TUTOR_SUSPENDED',
                object_id: tutorId,
                details: { reason }
            }
        });

        return { success: true, message: 'Tutor suspended' };
    }

    async activateTutor(tutorId: string) {
        const tutor = await this.prisma.tutors.findUnique({ where: { id: tutorId } });
        if (!tutor) throw new BadRequestException('Tutor not found');

        await this.prisma.users.update({
            where: { id: tutor.user_id },
            data: {
                tutor_status: 'ACTIVE'
            }
        });

        await this.prisma.audit_logs.create({
            data: {
                actor_user_id: null,
                action: 'TUTOR_ACTIVATED',
                object_id: tutorId,
                details: {}
            }
        });

        return { success: true, message: 'Tutor activated' };
    }

    private safeIso(d: Date | null | undefined): string | null {
        if (!d || !(d instanceof Date) || isNaN(d.getTime())) return null;
        return d.toISOString();
    }
}
