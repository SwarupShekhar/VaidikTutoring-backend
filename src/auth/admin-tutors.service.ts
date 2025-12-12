// src/auth/admin-tutors.service.ts
import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { hash } from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from '../email/email.service.js';

@Injectable()
export class AdminTutorsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwt: JwtService,
        private readonly email: EmailService,
    ) { }

    async createTutor(actor: any, dto: { email: string; first_name?: string; last_name?: string; password?: string; subjects?: string[] }) {
        // Only admin allowed
        if (!actor || actor.role !== 'admin') {
            throw new ForbiddenException('Only admin can create tutor accounts');
        }

        const { email, first_name, last_name, password, subjects } = dto;

        if (!email) throw new BadRequestException('Email is required');

        // check if exists
        const existing = await this.prisma.users.findUnique({ where: { email } });
        if (existing) {
            throw new BadRequestException('User with this email already exists');
        }

        // Use provided password or generate a random one
        const finalPassword = password || Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
        const password_hash = await hash(finalPassword, 10);

        const result = await this.prisma.$transaction(async (tx) => {
            const createdUser = await tx.users.create({
                data: {
                    email,
                    password_hash,
                    role: 'tutor',
                    first_name: first_name ?? null,
                    last_name: last_name ?? null,
                    timezone: 'UTC',
                    is_active: true,
                },
            });

            // Create tutor profile
            await tx.tutors.create({
                data: {
                    user_id: createdUser.id,
                    skills: subjects ? { subjects } : {},
                    is_active: true
                }
            });

            return createdUser;
        });

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

        await this.email.sendMail({
            to: email,
            subject: 'K12 Tutoring — Tutor Account Created',
            text: `Your tutor account has been created.`,
            html,
            from: process.env.EMAIL_FROM || 'K12 Tutoring <no-reply@k12.com>',
        });

        const { password_hash: _ph, ...userSafe } = (result as any);
        return { user: userSafe, inviteToken: password ? null : inviteToken };
    }
}