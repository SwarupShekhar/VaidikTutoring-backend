import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import { createClerkClient } from '@clerk/clerk-sdk-node';

@Injectable()
export class SyncClerkMetadataService {
  private readonly logger = new Logger(SyncClerkMetadataService.name);
  private clerkClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {
    const secretKey = this.config.get<string>('CLERK_SECRET_KEY');
    this.clerkClient = createClerkClient({ secretKey });
  }

  /**
   * Sync user role from database to Clerk metadata
   * This helps prevent metadata issues where Clerk users have empty public_metadata
   */
  async syncUserRoleToClerk(userId: string, role: string) {
    this.logger.log(`[SyncClerk] Syncing role ${role} for user ${userId}`);

    const user = await this.prisma.users.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error('User not found');
    }

    try {
      // Find Clerk user by email since we use UUIDs internally
      const clerkUsers = await this.clerkClient.users.getUserList({
        emailAddress: [user.email],
      });

      if (clerkUsers.length === 0) {
        throw new Error(`Clerk user not found for email: ${user.email}`);
      }

      const clerkUser = clerkUsers[0];

      // Update Clerk public metadata
      await this.clerkClient.users.updateUserMetadata(clerkUser.id, {
        publicMetadata: {
          role: role
        }
      });

      // Update internal database role to match if different
      if (user.role !== role) {
        await this.prisma.users.update({
          where: { id: userId },
          data: { role }
        });
        
        // Log to audit trial
        await this.prisma.audit_logs.create({
          data: {
            actor_user_id: userId,
            action: 'CLERK_ROLE_SYNCED',
            details: {
              email: user.email,
              previousRole: user.role,
              newRole: role,
              clerkUserId: clerkUser.id
            }
          }
        });
      }

      this.logger.log(`[SyncClerk] Successfully synced role ${role} for ${user.email}`);

      return {
        success: true,
        message: 'Role synced to Clerk successfully',
        email: user.email,
        role: role
      };
    } catch (error) {
      this.logger.error(`[SyncClerk] Failed to sync role for ${user.email}:`, error);
      throw error;
    }
  }

  /**
   * Check all users with role mismatches between database and expected Clerk metadata
   */
  async findRoleMismatches() {
    this.logger.log('[SyncClerk] Checking for role mismatches...');

    const users = await this.prisma.users.findMany({
      where: {
        role: 'admin'
      },
      select: {
        id: true,
        email: true,
        role: true
      }
    });

    const adminEmails = users.map(u => u.email);
    this.logger.log(`[SyncClerk] Found ${users.length} admin users in DB:`, adminEmails);

    return {
      adminUsers: users,
      adminEmails,
      totalAdminsInDb: users.length
    };
  }
}
