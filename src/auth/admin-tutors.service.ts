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

    async createTutor(actor: any, dto: { email: string; first_name?: string; last_name?: string }) {
        // Only admin allowed
        if (!actor || actor.role !== 'admin') {
            throw new ForbiddenException('Only admin can create tutor accounts');
        }

        const { email, first_name, last_name } = dto;

        if (!email) throw new BadRequestException('Email is required');

        // check if exists
        const existing = await this.prisma.users.findUnique({ where: { email } });
        if (existing) {
            throw new BadRequestException('User with this email already exists');
        }

        // create a temporary random password and hash it (we will prefer invite token flow)
        const tempPassword = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
        const password_hash = await hash(tempPassword, 10);

        const created = await this.prisma.users.create({
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

        // generate invite token (short lived) - include user id and purpose
        const inviteToken = this.jwt.sign(
            { sub: created.id, email: created.email, purpose: 'tutor-invite' },
            { expiresIn: '48h' },
        );

        // build the frontend invite URL (FRONTEND_URL env required)
        const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
        const inviteUrl = `${frontend.replace(/\/$/, '')}/tutor/accept-invite?token=${inviteToken}`;

        // send email (EmailService abstracts nodemailer)
        const html = `
      <p>Hi ${first_name ?? ''},</p>
      <p>You have been added as a tutor on K12 Tutoring. Click below to set your password and complete your account:</p>
      <p><a href="${inviteUrl}">Set your password and activate account</a></p>
      <p>The link expires in 48 hours. If you did not expect this email, contact admin.</p>
    `;

        await this.email.sendMail({
            to: email,
            subject: 'K12 Tutoring — Complete your tutor account',
            text: `Open the link to set your password: ${inviteUrl}`,
            html,
            from: process.env.EMAIL_FROM || 'K12 Tutoring <no-reply@example.com>',
        });

        // Return created user (without password hash) and invite token for testing
        const { password_hash: _ph, ...userSafe } = (created as any);
        return { user: userSafe, inviteToken };
    }
}