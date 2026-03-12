import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class SyncClerkMetadataService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sync user role from database to Clerk metadata
   * This helps prevent metadata issues where Clerk users have empty public_metadata
   */
  async syncUserRoleToClerk(userId: string, role: string) {
    console.log(`[SyncClerk] Syncing role ${role} for user ${userId}`);
    
    // In a real implementation, you would use Clerk Backend API to update metadata
    // For now, we'll log what should be synced
    
    const user = await this.prisma.users.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error('User not found');
    }

    console.log(`[SyncClerk] User ${userId} current role: ${user.role}`);
    console.log(`[SyncClerk] Should update Clerk metadata to: ${role}`);
    
    // TODO: Implement actual Clerk Backend API call to update public_metadata
    // This requires Clerk Backend SDK and proper API keys
    
    return {
      message: 'Role sync logged',
      currentRole: user.role,
      targetRole: role,
      requiresClerkUpdate: user.role !== role
    };
  }

  /**
   * Check all users with role mismatches between database and expected Clerk metadata
   */
  async findRoleMismatches() {
    console.log('[SyncClerk] Checking for role mismatches...');
    
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
    console.log(`[SyncClerk] Found ${users.length} admin users:`, adminEmails);
    
    return {
      adminUsers: users,
      adminEmails,
      totalAdmins: users.length
    };
  }
}
