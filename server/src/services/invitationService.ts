import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { emailService } from './emailService.js';
import { generateSalt, hashPasswordScryptAsync } from '../crypto.js';

export interface CreateInvitationInput {
  societyId: string;
  email: string;
  role?: string;
  residentId?: string;
  flatId?: string;
  actorId: string;
  actorRole: string;
}

export interface VerifyInvitationResult {
  valid: boolean;
  code?: 'INVALID_TOKEN' | 'EXPIRED' | 'ALREADY_ACCEPTED' | 'REVOKED';
  message?: string;
  invitation?: {
    id: string;
    email: string;
    role: string;
    societyId: string;
    societyName: string;
    residentName?: string;
    flatNumber?: string;
    expiresAt: Date;
  };
}

export class InvitationService {
  private static instance: InvitationService;

  private constructor() {}

  public static getInstance(): InvitationService {
    if (!InvitationService.instance) {
      InvitationService.instance = new InvitationService();
    }
    return InvitationService.instance;
  }

  /**
   * Generates a cryptographically secure 256-bit token and its SHA-256 hash.
   */
  public generateToken(): { rawToken: string; tokenHash: string } {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    return { rawToken, tokenHash };
  }

  /**
   * Hashes a raw token for constant-time DB lookup.
   */
  public hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
  }

  /**
   * Creates and dispatches a new account invitation.
   */
  public async createInvitation(input: CreateInvitationInput): Promise<{
    invitation: any;
    rawToken: string;
    delivery: any;
  }> {
    const { societyId, email, residentId, flatId, actorId, actorRole } = input;
    const normalizedEmail = email.toLowerCase().trim();
    const role = (input.role || 'resident').toLowerCase() as any;

    // 1. Authorization Gate
    if (actorRole !== 'secretary' && actorRole !== 'admin') {
      throw new Error('Unauthorized: Only society secretaries and platform administrators can issue invitations.');
    }

    // 2. Society Verification
    const society = await prisma.society.findUnique({
      where: { id: societyId },
      include: { towers: { include: { flats: true } } },
    });
    if (!society) {
      throw new Error(`Society with ID "${societyId}" does not exist.`);
    }

    // 3. Resident verification if residentId supplied
    let residentName = '';
    let flatNumber = '';
    let targetFlatId = flatId;

    if (residentId) {
      const resident = await prisma.resident.findUnique({
        where: { id: residentId },
        include: { flat: true },
      });
      if (!resident || resident.societyId !== societyId) {
        throw new Error('Resident record not found in the specified society.');
      }
      residentName = resident.name;
      if (resident.flat) {
        flatNumber = resident.flat.flatNumber;
        targetFlatId = resident.flat.id;
      }
    }

    // 4. Invalidate prior pending invitations for this email in this society
    await prisma.invitation.updateMany({
      where: {
        societyId,
        email: normalizedEmail,
        status: 'PENDING',
      },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
      },
    });

    // 5. Generate Secure Token & Expiration (Default 7 Days)
    const { rawToken, tokenHash } = this.generateToken();
    const expiryHours = parseInt(process.env.INVITATION_EXPIRY_HOURS || '168', 10);
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    // 6. Persist Invitation Record (Hash ONLY)
    const invitation = await prisma.invitation.create({
      data: {
        societyId,
        email: normalizedEmail,
        role: role as any,
        residentId: residentId || null,
        flatId: targetFlatId || null,
        tokenHash,
        status: 'PENDING',
        deliveryStatus: 'QUEUED',
        expiresAt,
        createdBy: actorId,
        sentAt: new Date(),
        metadata: {
          residentName,
          flatNumber,
        },
      },
    });

    // 7. Dispatch Branded Activation Email
    const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const activationLink = `${frontendBaseUrl.replace(/\/$/, '')}/activate?token=${rawToken}`;

    const delivery = await emailService.sendInvitationEmail({
      to: normalizedEmail,
      recipientName: residentName || normalizedEmail.split('@')[0],
      societyName: society.name,
      flatNumber,
      roleName: role.toUpperCase(),
      activationLink,
      expiresAt,
    });

    // 8. Update Delivery Status
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: {
        deliveryStatus: delivery.success ? 'SENT' : 'FAILED',
        deliveryError: delivery.error || null,
      },
    });

    return {
      invitation,
      rawToken,
      delivery,
    };
  }

  /**
   * Resends an existing invitation with a fresh token and rate limit cooldown.
   */
  public async resendInvitation(invitationId: string, actorId: string, actorRole: string): Promise<{
    invitation: any;
    rawToken: string;
    delivery: any;
  }> {
    if (actorRole !== 'secretary' && actorRole !== 'admin') {
      throw new Error('Unauthorized: Insufficient permissions to resend invitations.');
    }

    const invitation = await prisma.invitation.findUnique({
      where: { id: invitationId },
      include: { society: true, resident: { include: { flat: true } } },
    });

    if (!invitation) {
      throw new Error('Invitation record not found.');
    }

    if (invitation.status === 'ACCEPTED') {
      throw new Error('Cannot resend invitation: Account has already been activated.');
    }

    // Cooldown check: 60 seconds
    const now = Date.now();
    if (invitation.lastResentAt && now - invitation.lastResentAt.getTime() < 60000) {
      const waitSeconds = Math.ceil((60000 - (now - invitation.lastResentAt.getTime())) / 1000);
      throw new Error(`Resend cooldown active. Please wait ${waitSeconds}s before retrying.`);
    }

    const { rawToken, tokenHash } = this.generateToken();
    const expiryHours = parseInt(process.env.INVITATION_EXPIRY_HOURS || '168', 10);
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    const updated = await prisma.invitation.update({
      where: { id: invitationId },
      data: {
        tokenHash,
        status: 'PENDING',
        expiresAt,
        resendCount: { increment: 1 },
        lastResentAt: new Date(),
        sentAt: new Date(),
        deliveryStatus: 'QUEUED',
      },
    });

    const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const activationLink = `${frontendBaseUrl.replace(/\/$/, '')}/activate?token=${rawToken}`;
    const residentName = invitation.resident?.name || (invitation.metadata as any)?.residentName || invitation.email.split('@')[0];
    const flatNumber = invitation.resident?.flat?.flatNumber || (invitation.metadata as any)?.flatNumber;

    const delivery = await emailService.sendInvitationEmail({
      to: invitation.email,
      recipientName: residentName,
      societyName: invitation.society.name,
      flatNumber,
      roleName: invitation.role.toUpperCase(),
      activationLink,
      expiresAt,
    });

    await prisma.invitation.update({
      where: { id: invitationId },
      data: {
        deliveryStatus: delivery.success ? 'SENT' : 'FAILED',
        deliveryError: delivery.error || null,
      },
    });

    return {
      invitation: updated,
      rawToken,
      delivery,
    };
  }

  /**
   * Revokes a pending invitation.
   */
  public async revokeInvitation(invitationId: string, actorRole: string): Promise<any> {
    if (actorRole !== 'secretary' && actorRole !== 'admin') {
      throw new Error('Unauthorized: Insufficient permissions to revoke invitations.');
    }

    const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
    if (!invitation) throw new Error('Invitation record not found.');

    if (invitation.status === 'ACCEPTED') {
      throw new Error('Cannot revoke invitation: Account has already been activated.');
    }

    return prisma.invitation.update({
      where: { id: invitationId },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
      },
    });
  }

  /**
   * Verifies an invitation token without consuming it.
   */
  public async verifyInvitationToken(rawToken: string): Promise<VerifyInvitationResult> {
    if (!rawToken || typeof rawToken !== 'string') {
      return { valid: false, code: 'INVALID_TOKEN', message: 'Activation token is missing or malformed.' };
    }

    const tokenHash = this.hashToken(rawToken);
    const invitation = await prisma.invitation.findUnique({
      where: { tokenHash },
      include: {
        society: true,
        resident: { include: { flat: true } },
        flat: true,
      },
    });

    if (!invitation) {
      return { valid: false, code: 'INVALID_TOKEN', message: 'Invalid activation token or invitation does not exist.' };
    }

    if (invitation.status === 'ACCEPTED') {
      return { valid: false, code: 'ALREADY_ACCEPTED', message: 'This invitation has already been redeemed and activated.' };
    }

    if (invitation.status === 'REVOKED') {
      return { valid: false, code: 'REVOKED', message: 'This invitation was revoked by society administration.' };
    }

    if (new Date() > invitation.expiresAt) {
      return { valid: false, code: 'EXPIRED', message: 'This activation link has expired. Please contact your society office for a fresh invite.' };
    }

    const flatNumber = invitation.resident?.flat?.flatNumber || invitation.flat?.flatNumber || (invitation.metadata as any)?.flatNumber;
    const residentName = invitation.resident?.name || (invitation.metadata as any)?.residentName;

    return {
      valid: true,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        societyId: invitation.societyId,
        societyName: invitation.society.name,
        residentName,
        flatNumber,
        expiresAt: invitation.expiresAt,
      },
    };
  }

  /**
   * Atomically accepts an invitation, hashes the password with Scrypt, and creates/activates the User account.
   */
  public async acceptInvitation(input: {
    rawToken: string;
    password: string;
    name?: string;
  }): Promise<{ success: boolean; user: any; message: string }> {
    const { rawToken, password, name } = input;

    if (!password || password.trim().length < 8) {
      throw new Error('Password must be at least 8 characters in length.');
    }

    const tokenHash = this.hashToken(rawToken);

    // Atomic transaction ensuring zero concurrency replay
    const result = await prisma.$transaction(async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash },
        include: {
          society: true,
          resident: { include: { flat: true } },
          flat: true,
        },
      });

      if (!invitation) {
        throw new Error('Invalid or expired activation link.');
      }

      if (invitation.status !== 'PENDING') {
        throw new Error(`Invitation cannot be activated: Status is already ${invitation.status}.`);
      }

      if (new Date() > invitation.expiresAt) {
        throw new Error('Activation link has expired. Please request a new invitation.');
      }

      // Hash password using OWASP High-Assurance Scrypt
      const salt = generateSalt(16);
      const passwordHash = await hashPasswordScryptAsync(password.trim(), salt);

      const flatNumber =
        invitation.resident?.flat?.flatNumber ||
        invitation.flat?.flatNumber ||
        (invitation.metadata as any)?.flatNumber ||
        '';

      const userName = (name?.trim() || invitation.resident?.name || (invitation.metadata as any)?.residentName || invitation.email.split('@')[0]);

      // Check if user already exists
      let user = await tx.user.findFirst({
        where: { email: invitation.email.toLowerCase().trim() },
      });

      if (user) {
        user = await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash,
            salt,
            status: 'ACTIVE',
            societyId: invitation.societyId,
            flatId: invitation.flatId || user.flatId,
            flatNumber: flatNumber || user.flatNumber,
            name: userName,
          },
        });
      } else {
        user = await tx.user.create({
          data: {
            id: crypto.randomUUID(),
            email: invitation.email.toLowerCase().trim(),
            phone: invitation.resident?.phone || '9999999999',
            name: userName,
            role: invitation.role,
            societyId: invitation.societyId,
            flatId: invitation.flatId,
            flatNumber,
            passwordHash,
            salt,
            status: 'ACTIVE',
          },
        });
      }

      // Link Resident record to User and verify
      if (invitation.residentId) {
        await tx.resident.update({
          where: { id: invitation.residentId },
          data: {
            userId: user.id,
            isVerified: true,
            status: 'ACTIVE',
          },
        });
      }

      // Ensure Society Membership exists
      const existingMembership = await tx.societyMembership.findFirst({
        where: { societyId: invitation.societyId, userId: user.id },
      });

      if (!existingMembership) {
        await tx.societyMembership.create({
          data: {
            societyId: invitation.societyId,
            userId: user.id,
            role: invitation.role as any,
            status: 'ACTIVE',
          },
        });
      }

      // Consume invitation atomically
      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          status: 'ACCEPTED',
          acceptedAt: new Date(),
        },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          societyId: invitation.societyId,
          actorId: user.id,
          actorName: user.name,
          role: invitation.role,
          action: 'ACCOUNT_ACTIVATED',
          entityName: 'USER',
          entityId: user.id,
          metadata: {
            email: user.email,
            invitationId: invitation.id,
            activatedAt: new Date().toISOString(),
          },
        },
      });

      return user;
    });

    return {
      success: true,
      user: {
        id: result.id,
        email: result.email,
        name: result.name,
        role: result.role,
        societyId: result.societyId,
      },
      message: 'Account activated successfully. You may now log in with your credentials.',
    };
  }
}

export const invitationService = InvitationService.getInstance();

