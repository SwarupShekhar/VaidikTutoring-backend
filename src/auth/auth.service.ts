import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) { }

  async signup(data: {
    email: string;
    password: string;
    first_name: string;
    last_name: string;
    role: string;
  }) {
    if (data.role !== 'parent' && data.role !== 'student') {
      throw new BadRequestException('Invalid role for public signup');
    }
    const exists = await this.prisma.users.findUnique({
      where: { email: data.email },
    });

    if (exists) throw new ConflictException('User already exists');

    const hash = await bcrypt.hash(data.password, 10);

    const user = await this.prisma.users.create({
      data: {
        email: data.email,
        password_hash: hash,
        first_name: data.first_name,
        last_name: data.last_name,
        role: data.role,
      },
    });

    return {
      message: 'Signup successful',
      user,
    };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.users.findUnique({ where: { email } });

    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (!user.password_hash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) throw new UnauthorizedException('Invalid password');

    const token = this.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      message: 'Login successful',
      token,
      user,
    };
  }
}
