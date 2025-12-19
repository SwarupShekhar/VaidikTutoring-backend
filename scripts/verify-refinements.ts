import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from '../src/email/email.service';
import { Test, TestingModule } from '@nestjs/testing';

async function main() {
    console.log('Starting verification of refinements...');

    const module: TestingModule = await Test.createTestingModule({
        providers: [
            AuthService,
            PrismaService,
            JwtService,
            {
                provide: EmailService,
                useValue: { sendVerificationEmail: jest.fn() }, // Mock email service
            },
        ],
    }).compile();

    const authService = module.get<AuthService>(AuthService);
    const prisma = module.get<PrismaService>(PrismaService);
    await prisma.onModuleInit();

    const testIp = '127.0.0.1';
    const testEmailBase = `rate-limit-test-${Date.now()}`;

    // 1. Test Signup Rate Limit (Limit 5)
    console.log('\n--- Testing Signup Rate Limit ---');
    for (let i = 0; i < 6; i++) {
        try {
            await authService.signup({
                email: `${testEmailBase}-${i}@example.com`,
                password: 'Password1!',
                first_name: 'Test',
                last_name: 'User',
                role: 'student',
                grade: 5,
                ip: testIp,
            });
            console.log(`Signup ${i + 1}: Success`);
        } catch (e) {
            console.log(`Signup ${i + 1}: Failed - ${e.message}`);
        }
    }

    // 2. Test Idempotency
    console.log('\n--- Testing Idempotency ---');
    // Signup one user
    const email = `${testEmailBase}-idempotent@example.com`;
    await authService.signup({
        email,
        password: 'Password1!',
        first_name: 'Test',
        last_name: 'User',
        role: 'student',
        grade: 5,
        ip: '127.0.0.2' // Diff IP to avoid limit
    });

    const user = await prisma.users.findUnique({ where: { email } });
    if (!user) throw new Error('User not found');
    const token = user.email_verification_token;
    if (!token) throw new Error('Token not found');

    console.log('Verifying first time...');
    const res1 = await authService.verifyEmail(token);
    console.log('Result 1:', res1);

    console.log('Verifying second time (should succeed)...');
    try {
        const res2 = await authService.verifyEmail(token);
        console.log('Result 2:', res2);
    } catch (e) {
        console.log('Result 2 Failed:', e.message);
    }

    // 3. Test Resend Rate Limit (Limit 3)
    console.log('\n--- Testing Resend Rate Limit ---');
    for (let i = 0; i < 4; i++) {
        try {
            await authService.resendVerification(user.id);
            console.log(`Resend ${i + 1}: Success`);
        } catch (e) {
            console.log(`Resend ${i + 1}: Failed - ${e.message}`);
        }
    }

    await prisma.onModuleDestroy();
}

main().catch(console.error);
