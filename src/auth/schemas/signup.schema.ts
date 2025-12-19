import { z } from 'zod';

const BLOCKED_DOMAINS = [
    'mailinator.com',
    'tempmail.com',
    '10minutemail.com',
    'guerrillamail.com',
];

export const signupSchema = z
    .object({
        email: z
            .string()
            .email()
            .refine((email) => {
                const domain = email.split('@')[1];
                return !BLOCKED_DOMAINS.includes(domain);
            }, 'Disposable email addresses are not allowed'),

        password: z
            .string()
            .min(8)
            .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
            .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
            .regex(/[0-9]/, 'Password must contain at least one number')
            .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),

        first_name: z.string().min(2).max(50),
        last_name: z.string().min(2).max(50),

        role: z.enum(['student', 'parent', 'tutor']), // Prompt said STUDENT/TUTOR but codebase has lowercase 'parent'/'student'. I'll stick to codebase convention + 'tutor' as requested.

        grade: z.coerce.number().int().min(1).max(12).optional(), // 'grade' comes as number or string from form? Coerce is safer.
    })
    .superRefine((data, ctx) => {
        if (data.role === 'student' && data.grade == null) {
            ctx.addIssue({
                path: ['grade'],
                message: 'Grade is required for students',
                code: z.ZodIssueCode.custom,
            });
        }

        if (data.role === 'tutor' && data.grade != null) {
            ctx.addIssue({
                path: ['grade'],
                message: 'Tutors should not provide grade',
                code: z.ZodIssueCode.custom,
            });
        }
    });
