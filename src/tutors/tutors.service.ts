import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class TutorsService {
  constructor(private prisma: PrismaService) {}

  async createTutor(data: any) {
    // Check if user exists
    const exists = await this.prisma.users.findUnique({
      where: { email: data.email },
    });

    if (exists)
      throw new ConflictException('User with this email already exists');

    // Hash password
    const hash = await bcrypt.hash(data.password, 10);

    // Create User
    const user = await this.prisma.users.create({
      data: {
        email: data.email,
        password_hash: hash,
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone,
        timezone: data.timezone,
        role: 'tutor',
      },
    });

    // Create Tutor Profile
    const tutor = await this.prisma.tutors.create({
      data: {
        user_id: user.id,
        bio: data.bio,
        qualifications: data.qualifications, // assume JSON or compatible
        skills: data.skills, // assume JSON or compatible
        hourly_rate_cents: data.hourly_rate_cents,
        employment_type: data.employment_type,
      },
    });

    return {
      message: 'Tutor created successfully',
      user,
      tutor,
    };
  }
}
