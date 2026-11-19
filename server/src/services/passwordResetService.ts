import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { emailService } from './emailService.js';
import { generateSalt, hashPasswordScryptAsync } from '../crypto.js';

export class PasswordResetService {
  private static instance: PasswordResetService;

  private constructor() {}

  public static getInstance(): PasswordResetService {
    if (!PasswordResetService.instance) {
      PasswordResetService.instance = new PasswordResetService();
    }
    return PasswordResetService.instance;
  }

  public hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
  }

  /**
   * Dispatches a password reset link.
   * Returns a generic message to prevent account enumeration (CWE-204).
   */
  public async requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
    const genericResponse = {
      success: true,
      message: 'If an active account exists with this email address, a password reset link has been dispatched.',
    };

    if (!email || !email.includes('@')) {
      return genericResponse;
    }

    const normalizedEmail = email.toLowerCase().trim();

    try {
      const user = await prisma.user.findFirst({
        where: { email: normalizedEmail },
        include: { society: true },
      });

      // Silently exit if user not found or not active
      if (!user || user.status !== 'ACTIVE') {
        return genericResponse;
      }

      // Invalidate existing active tokens
      await prisma.passwordResetToken.deleteMany({
        where: { userId: user.id },
      });

      // Generate 256-bit token & SHA-256 hash
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = this.hashToken(rawToken);

      const expiryHours = parseInt(process.env.RESET_EXPIRY_HOURS || '1', 10);
      const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

      // Persist token hash
      await prisma.passwordResetToken.create({
        data: {
          id: crypto.randomUUID(),
          userId: user.id,
          email: normalizedEmail,
          tokenHash,
          expiresAt,
        },
      });

      // Dispatch Email
      const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const resetLink = `${frontendBaseUrl.replace(/\/$/, '')}/reset-password?token=${rawToken}`;

      await emailService.sendPasswordResetEmail({
        to: normalizedEmail,
        recipientName: user.name,
        resetLink,
        expiresAt,
      });
    } catch (err: any) {
      console.error('[PasswordResetService] Unexpected error during reset request:', err);
    }

    return genericResponse;
  }

  /**
   * Validates a password reset token without consuming it.
   */
  public async verifyResetToken(rawToken: string): Promise<{ valid: boolean; email?: string; message?: string }> {
    if (!rawToken || typeof rawToken !== 'string') {
      return { valid: false, message: 'Invalid or missing reset token.' };
    }

    const tokenHash = this.hashToken(rawToken);
    const tokenRecord = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!tokenRecord) {
      return { valid: false, message: 'Invalid password reset link.' };
    }

    if (tokenRecord.usedAt) {
      return { valid: false, message: 'This password reset link has already been used.' };
    }

    if (new Date() > tokenRecord.expiresAt) {
      return { valid: false, message: 'This password reset link has expired. Please request a new one.' };
    }

    return {
      valid: true,
      email: tokenRecord.email,
    };
  }

  /**
   * Resets the user's password using a verified token.
   */
  public async resetPassword(rawToken: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    if (!newPassword || newPassword.trim().length < 8) {
      throw new Error('New password must be at least 8 characters long.');
    }

    const tokenHash = this.hashToken(rawToken);

    await prisma.$transaction(async (tx) => {
      const tokenRecord = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
      });

      if (!tokenRecord || tokenRecord.usedAt || new Date() > tokenRecord.expiresAt) {
        throw new Error('Password reset link is invalid or has expired.');
      }

      // Mark token consumed
      await tx.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { usedAt: new Date() },
      });

      // Scrypt hash derivation
      const salt = generateSalt(16);
      const passwordHash = await hashPasswordScryptAsync(newPassword.trim(), salt);

      // Update User credentials
      await tx.user.update({
        where: { id: tokenRecord.userId },
        data: {
          passwordHash,
          salt,
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          societyId: 'soc-platform',
          actorId: tokenRecord.userId,
          actorName: tokenRecord.email,
          role: 'resident',
          action: 'PASSWORD_RESET_COMPLETED',
          entityName: 'USER',
          entityId: tokenRecord.userId,
          metadata: {
            email: tokenRecord.email,
            resetAt: new Date().toISOString(),
          },
        },
      });
    });

    return {
      success: true,
      message: 'Your password has been successfully updated. You may now log in.',
    };
  }
}

export const passwordResetService = PasswordResetService.getInstance();
