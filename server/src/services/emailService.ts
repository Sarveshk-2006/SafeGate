import crypto from 'crypto';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailDeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider: 'resend' | 'smtp' | 'console_test';
}

export interface SentEmailRecord {
  to: string;
  subject: string;
  html: string;
  text: string;
  sentAt: Date;
  messageId: string;
}

export class EmailService {
  private static instance: EmailService;
  private sentEmailsHistory: SentEmailRecord[] = [];

  private constructor() {}

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  /**
   * Retrieves history of captured emails (for testing and verification).
   */
  public getSentEmails(): SentEmailRecord[] {
    return [...this.sentEmailsHistory];
  }

  /**
   * Clears in-memory email history.
   */
  public clearSentEmails(): void {
    this.sentEmailsHistory = [];
  }

  /**
   * Core dispatcher that sends an email via the configured provider.
   */
  public async sendEmail(options: EmailOptions): Promise<EmailDeliveryResult> {
    const resendApiKey = process.env.RESEND_API_KEY;
    const emailFrom = process.env.EMAIL_FROM || 'Dwellora Communities <invites@dwellora.app>';
    const isTest = process.env.NODE_ENV === 'test';

    // In automated tests or when no external key is configured, use the high-fidelity mock/test transport
    if (isTest || !resendApiKey) {
      const messageId = `msg_test_${crypto.randomUUID()}`;
      const record: SentEmailRecord = {
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        sentAt: new Date(),
        messageId,
      };
      this.sentEmailsHistory.push(record);

      if (process.env.DEBUG_EMAIL === 'true' || process.env.NODE_ENV === 'development') {
        console.info(`[EmailService:Mock] To: ${options.to} | Subject: "${options.subject}" | MessageId: ${messageId}`);
      }

      return {
        success: true,
        messageId,
        provider: 'console_test',
      };
    }

    // Production Resend API Delivery via native HTTPS fetch
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [options.to],
          subject: options.subject,
          html: options.html,
          text: options.text,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({ message: response.statusText }))) as any;
        const errorMessage = errorData?.message || errorData?.error || `HTTP ${response.status}`;
        console.warn(`[EmailService:Resend] Delivery failed to ${options.to}:`, errorMessage);
        return {
          success: false,
          error: errorMessage,
          provider: 'resend',
        };
      }

      const data = (await response.json()) as { id?: string };
      const messageId = data.id || `msg_resend_${crypto.randomUUID()}`;
      
      this.sentEmailsHistory.push({
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        sentAt: new Date(),
        messageId,
      });

      return {
        success: true,
        messageId,
        provider: 'resend',
      };
    } catch (err: any) {
      console.error('[EmailService:Exception]', err?.message || err);
      return {
        success: false,
        error: err?.message || 'Network exception during email delivery',
        provider: 'resend',
      };
    }
  }

  /**
   * Generates and dispatches a branded Account Invitation Email.
   */
  public async sendInvitationEmail(params: {
    to: string;
    recipientName: string;
    societyName: string;
    flatNumber?: string;
    roleName: string;
    activationLink: string;
    expiresAt: Date | string;
  }): Promise<EmailDeliveryResult> {
    const { to, recipientName, societyName, flatNumber, roleName, activationLink, expiresAt } = params;
    const expiryDate = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;

    const formattedExpiry = expiryDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const flatInfo = flatNumber ? `for Unit / Flat ${flatNumber}` : '';

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Welcome to ${societyName} on Dwellora</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #FAF6F0; margin: 0; padding: 24px; color: #1E293B; }
    .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 20px; border: 1px solid #E2E8F0; box-shadow: 0 8px 30px rgba(8,59,86,0.06); overflow: hidden; }
    .header { background: #083B56; padding: 32px 24px; text-align: center; }
    .brand-title { color: #ffffff; font-size: 24px; font-weight: 800; margin: 0 0 6px 0; }
    .brand-subtitle { color: #94A3B8; font-size: 13px; font-weight: 500; margin: 0; }
    .body-content { padding: 32px 28px; line-height: 1.6; }
    .greeting { font-size: 18px; font-weight: 700; color: #083B56; margin: 0 0 16px 0; }
    .details-box { background: #EAF6FC; border: 1px solid #DCE8EF; border-radius: 14px; padding: 16px 20px; margin: 20px 0; }
    .details-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
    .details-label { color: #64748B; font-weight: 600; }
    .details-value { color: #083B56; font-weight: 700; }
    .cta-container { text-align: center; margin: 32px 0 24px; }
    .btn-cta { display: inline-block; background-color: #F06543; color: #ffffff !important; text-decoration: none; font-size: 15px; font-weight: 800; padding: 14px 32px; border-radius: 14px; box-shadow: 0 6px 18px rgba(240,101,67,0.35); }
    .security-note { font-size: 12px; color: #64748B; background: #FFF8E8; border-left: 3px solid #D99A2B; padding: 10px 14px; border-radius: 8px; margin-top: 24px; }
    .footer { text-align: center; padding: 20px; font-size: 12px; color: #94A3B8; border-top: 1px solid #F1F5F9; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1 class="brand-title">Dwellora</h1>
      <p class="brand-subtitle">Secure Communities, Connected Living</p>
    </div>
    <div class="body-content">
      <h2 class="greeting">Hello ${recipientName},</h2>
      <p>The managing committee of <strong>${societyName}</strong> has invited you to join the official society management portal ${flatInfo} as an authorized <strong>${roleName}</strong>.</p>
      
      <div class="details-box">
        <div class="details-row"><span class="details-label">Society:</span> <span class="details-value">${societyName}</span></div>
        ${flatNumber ? `<div class="details-row"><span class="details-label">Unit / Flat:</span> <span class="details-value">${flatNumber}</span></div>` : ''}
        <div class="details-row"><span class="details-label">Role:</span> <span class="details-value">${roleName}</span></div>
        <div class="details-row"><span class="details-label">Expires On:</span> <span class="details-value">${formattedExpiry}</span></div>
      </div>

      <p>To access community announcements, manage visitors, pay maintenance dues, and utilize digital gate passes, please activate your account and establish your secure password:</p>

      <div class="cta-container">
        <a href="${activationLink}" class="btn-cta" target="_blank">Activate Account & Set Password</a>
      </div>

      <div class="security-note">
        <strong>Security Notice:</strong> This activation link is unique to you and will expire on ${formattedExpiry}. Dwellora administrators will never ask for your password. If you did not request this invitation, please contact your society office.
      </div>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} Dwellora Smart Communities. All rights reserved.
    </div>
  </div>
</body>
</html>
`;

    const text = `
Welcome to ${societyName} on Dwellora!

Hello ${recipientName},

The managing committee of ${societyName} has invited you to activate your society account ${flatInfo} as an authorized ${roleName}.

To activate your account and choose your password, please open the following secure link:
${activationLink}

This activation link will expire on ${formattedExpiry}.

Security Note: Dwellora administrators will never ask for your password. If you did not expect this invitation, please contact your society office.

© ${new Date().getFullYear()} Dwellora Smart Communities.
`;

    return this.sendEmail({
      to,
      subject: `Welcome to ${societyName} on Dwellora — Activate Your Account`,
      html,
      text,
    });
  }

  /**
   * Generates and dispatches a Password Reset Email.
   */
  public async sendPasswordResetEmail(params: {
    to: string;
    recipientName: string;
    resetLink: string;
    expiresAt: Date | string;
  }): Promise<EmailDeliveryResult> {
    const { to, recipientName, resetLink } = params;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Reset Your Dwellora Password</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #FAF6F0; margin: 0; padding: 24px; color: #1E293B; }
    .card { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 20px; border: 1px solid #E2E8F0; box-shadow: 0 8px 30px rgba(8,59,86,0.06); overflow: hidden; }
    .header { background: #083B56; padding: 28px 24px; text-align: center; }
    .brand-title { color: #ffffff; font-size: 22px; font-weight: 800; margin: 0; }
    .body-content { padding: 32px 28px; line-height: 1.6; }
    .greeting { font-size: 18px; font-weight: 700; color: #083B56; margin: 0 0 16px 0; }
    .cta-container { text-align: center; margin: 30px 0 24px; }
    .btn-cta { display: inline-block; background-color: #F06543; color: #ffffff !important; text-decoration: none; font-size: 15px; font-weight: 800; padding: 14px 30px; border-radius: 14px; box-shadow: 0 6px 18px rgba(240,101,67,0.35); }
    .security-note { font-size: 12px; color: #64748B; background: #FFF8E8; border-left: 3px solid #D99A2B; padding: 10px 14px; border-radius: 8px; margin-top: 24px; }
    .footer { text-align: center; padding: 18px; font-size: 12px; color: #94A3B8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1 class="brand-title">Dwellora</h1>
    </div>
    <div class="body-content">
      <h2 class="greeting">Hello ${recipientName || 'Resident'},</h2>
      <p>We received a request to reset the password for your Dwellora account associated with <strong>${to}</strong>.</p>
      
      <div class="cta-container">
        <a href="${resetLink}" class="btn-cta" target="_blank">Reset Account Password</a>
      </div>

      <p style="font-size: 13px; color: #64748B;">This password reset link will expire in 1 hour. If you did not request a password reset, you can safely ignore this email; your account remains secure.</p>

      <div class="security-note">
        <strong>Security Tip:</strong> Never share your password reset link with anyone. Dwellora support will never contact you asking for this link.
      </div>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} Dwellora Smart Communities.
    </div>
  </div>
</body>
</html>
`;

    const text = `
Reset Your Dwellora Password

Hello ${recipientName || 'Resident'},

We received a request to reset the password for your Dwellora account (${to}).

To set a new password, please visit this link:
${resetLink}

This link is valid for 1 hour. If you did not request a password reset, you can safely ignore this email.

© ${new Date().getFullYear()} Dwellora Smart Communities.
`;

    return this.sendEmail({
      to,
      subject: 'Reset Your Dwellora Account Password',
      html,
      text,
    });
  }
}

export const emailService = EmailService.getInstance();
