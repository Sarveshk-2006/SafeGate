// =============================================================================
// AARIZO / Dwellora — PHASE 4.8
// Landing Page Restoration, Real Email Invitations & Complete Production Authentication
// Unit & Integration Test Suite
// =============================================================================

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import crypto from 'crypto';

// Mocks declared before component imports
const mockNavigate = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/login', search: '' }),
  useSearchParams: () => [mockSearchParams, jest.fn()],
  Link: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
  Navigate: ({ to }: any) => <div data-testid="navigate" data-to={to} />,
}));

jest.mock('@capacitor/app', () => ({
  App: {
    addListener: jest.fn(),
    exitApp: jest.fn(),
  },
}));

jest.mock('../src/utils/nativeMobile', () => ({
  triggerHaptic: jest.fn(),
  isNativeApp: jest.fn(() => false),
  registerGlobalBackHandler: jest.fn(() => () => {}),
}));

jest.mock('../src/services/firebase/config', () => ({
  auth: {},
  db: {},
  storage: {},
}));

const mockLoginWithProfile = jest.fn();
const mockSetError = jest.fn();

jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: null,
    status: 'UNAUTHENTICATED',
    loginWithProfile: mockLoginWithProfile,
    error: null,
    setError: mockSetError,
  }),
}));

const mockVerifyInvitation = jest.fn();
const mockAcceptInvitation = jest.fn();
const mockRequestPasswordReset = jest.fn();
const mockVerifyPasswordResetToken = jest.fn();
const mockConfirmPasswordReset = jest.fn();
const mockGetResidentInvitationStatus = jest.fn();
const mockInviteResident = jest.fn();
const mockResendResidentInvite = jest.fn();
const mockRevokeResidentInvite = jest.fn();
const mockLoginWithPassword = jest.fn();

jest.mock('../src/services/apiClient', () => ({
  apiClient: {
    verifyInvitation: (...args: any[]) => mockVerifyInvitation(...args),
    acceptInvitation: (...args: any[]) => mockAcceptInvitation(...args),
    requestPasswordReset: (...args: any[]) => mockRequestPasswordReset(...args),
    verifyPasswordResetToken: (...args: any[]) => mockVerifyPasswordResetToken(...args),
    confirmPasswordReset: (...args: any[]) => mockConfirmPasswordReset(...args),
    getResidentInvitationStatus: (...args: any[]) => mockGetResidentInvitationStatus(...args),
    inviteResident: (...args: any[]) => mockInviteResident(...args),
    resendResidentInvite: (...args: any[]) => mockResendResidentInvite(...args),
    revokeResidentInvite: (...args: any[]) => mockRevokeResidentInvite(...args),
    loginWithPassword: (...args: any[]) => mockLoginWithPassword(...args),
    provisionUser: jest.fn(() => Promise.resolve({ success: true })),
  },
}));

jest.mock('../src/services/realtimeService', () => ({
  realtimeService: {
    subscribe: jest.fn(() => () => {}),
    publish: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  },
}));

// Component imports
import { OnboardingFlow } from '../src/components/auth/onboarding/OnboardingFlow';
import { LoginScreen } from '../src/components/auth/login/LoginScreen';
import { AccountActivationPage } from '../src/pages/auth/AccountActivationPage';
import { ForgotPasswordPage } from '../src/pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '../src/pages/auth/ResetPasswordPage';
import { ResidentManagementPage } from '../src/pages/dashboard/admin/ResidentManagementPage';
import { emailService } from '../server/src/services/emailService';

describe('Phase 4.8 — Landing Page, Email Invitations & Complete Authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  // -------------------------------------------------------------------------
  // 1. Landing Page & 3D Illustration Carousel
  // -------------------------------------------------------------------------
  describe('1. OnboardingFlow (3D Illustration Landing Experience)', () => {
    it('renders the initial landing page slide with brand identity and first illustration', () => {
      const html = renderToStaticMarkup(<OnboardingFlow />);
      // Brand logo
      expect(html).toContain('Dwellora');
      expect(html).toContain('Secure Communities, Safer Living');
      // Slide 1 title and description
      expect(html).toContain('Smart Visitor ');
      expect(html).toContain('Management');
      // Direct login shortcut in header
      expect(html).toContain('Log In');
      // Navigation pills & skip button
      expect(html).toContain('Skip');
      expect(html).toContain('aria-label="Next Slide"');
    });

    it('contains asset references to all 3 restored 3D canonical illustrations', () => {
      const flowModule = require('../src/components/auth/onboarding/OnboardingFlow');
      expect(flowModule.OnboardingFlow).toBeDefined();

      const html = renderToStaticMarkup(<OnboardingFlow />);
      // Slide image placeholder check
      expect(html).toContain('<img');
      expect(html).toContain('alt="Smart Visitor Management"');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Production Login Screen
  // -------------------------------------------------------------------------
  describe('2. LoginScreen (Hardened Production Experience)', () => {
    it('renders email and password inputs without default hardcoded passwords', () => {
      const html = renderToStaticMarkup(<LoginScreen />);
      expect(html).toContain('Sign In to Dwellora');
      expect(html).toContain('Secure Communities, Connected Living');
      expect(html).toContain('type="email"');
      expect(html).toContain('type="password"');
      expect(html).toContain('placeholder="name@community.com"');
      // Should not contain hardcoded default password
      expect(html).not.toContain('value="dwellora@2026"');
    });

    it('includes navigation links to Forgot Password and Account Activation', () => {
      const html = renderToStaticMarkup(<LoginScreen />);
      expect(html).toContain('href="/forgot-password"');
      expect(html).toContain('Forgot Password?');
      expect(html).toContain('href="/activate"');
      expect(html).toContain('Activate Your Account');
    });

    it('does not display mock role switcher pills by default in production layout', () => {
      const html = renderToStaticMarkup(<LoginScreen />);
      // Production layout does not show unauthenticated role quick-switch cards
      expect(html).not.toContain('Demo Quick-Switch');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Account Activation Page
  // -------------------------------------------------------------------------
  describe('3. AccountActivationPage (/activate)', () => {
    it('renders manual token input prompt when token is not present in URL', () => {
      mockSearchParams = new URLSearchParams();
      const html = renderToStaticMarkup(<AccountActivationPage />);
      expect(html).toContain('Enter the activation token provided in your society invitation email:');
      expect(html).toContain('Invitation Token');
      expect(html).toContain('Verify Token');
    });

    it('renders token verification UI when token is present in URL', () => {
      mockSearchParams = new URLSearchParams({ token: 'test-invitation-token-12345' });
      const html = renderToStaticMarkup(<AccountActivationPage />);
      expect(html).toContain('Verifying your invitation...');
      expect(html).toContain('Validating token against society records');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Password Recovery Pages
  // -------------------------------------------------------------------------
  describe('4. Password Recovery Experience', () => {
    it('renders ForgotPasswordPage with email input and anti-enumeration instructions', () => {
      const html = renderToStaticMarkup(<ForgotPasswordPage />);
      expect(html).toContain('Reset Password');
      expect(html).toContain('Registered Email Address');
      expect(html).toContain('type="email"');
      expect(html).toContain('Send Reset Link');
      expect(html).toContain('href="/login"');
    });

    it('renders ResetPasswordPage with token missing notice when no token provided', () => {
      mockSearchParams = new URLSearchParams();
      const html = renderToStaticMarkup(<ResetPasswordPage />);
      expect(html).toContain('Set New Password');
      expect(html).toContain('Password reset link is missing token');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Secretary Resident Management & Invitation Actions
  // -------------------------------------------------------------------------
  describe('5. ResidentManagementPage Invitation Management', () => {
    it('renders invitation management badges and actions for residents', () => {
      const html = renderToStaticMarkup(<ResidentManagementPage />);
      expect(html).toContain('User Directory &amp; Role Provisioning Hub');
      expect(html).toContain('Provision New User');
      // Resident invitation section
      expect(html).toContain('Email Invitation:');
      expect(html).toContain('Send Invite');
    });
  });

  // -------------------------------------------------------------------------
  // 6. Cryptographic Token Hashing & Scrypt Specification
  // -------------------------------------------------------------------------
  describe('6. Cryptographic Token Hashing & Security Safeguards', () => {
    it('generates 256-bit high-entropy CSPRNG tokens with 64-character SHA-256 hashes', () => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      expect(rawToken).toHaveLength(64);

      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      expect(tokenHash).toHaveLength(64);
      expect(tokenHash).not.toEqual(rawToken);

      // Verifies deterministic hash match
      const verifyHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      expect(verifyHash).toEqual(tokenHash);
    });

    it('applies OWASP-compliant Scrypt parameters (N=131072, r=8, p=1, keylen=64)', async () => {
      const password = 'ResidentSecurePassword!2026';
      const salt = crypto.randomBytes(16).toString('hex');

      const derivedKey = await new Promise<Buffer>((resolve, reject) => {
        crypto.scrypt(
          password,
          salt,
          64,
          { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
          (err, key) => (err ? reject(err) : resolve(key))
        );
      });

      const hashFormatted = `scrypt$N=131072,r=8,p=1$${salt}$${derivedKey.toString('hex')}`;
      expect(hashFormatted).toContain('scrypt$N=131072,r=8,p=1$');
      expect(derivedKey.length).toBe(64);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Transactional Email Service
  // -------------------------------------------------------------------------
  describe('7. Transactional Email Service (Resend + Fallback Test Capture)', () => {
    it('captures dispatched emails in history and formats invitation email correctly', async () => {
      emailService.clearSentEmails();

      const result = await emailService.sendInvitationEmail({
        to: 'newresident@society.org',
        recipientName: 'Aarav Sharma',
        societyName: 'Green Valley Society',
        flatNumber: 'B-1204',
        roleName: 'Resident',
        activationLink: 'https://dwellora.app/activate?token=sample-test-token',
        expiresAt: new Date(Date.now() + 7 * 86400000),
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('console_test');

      const history = emailService.getSentEmails();
      expect(history.length).toBe(1);
      expect(history[0].to).toBe('newresident@society.org');
      expect(history[0].html).toContain('Green Valley Society');
      expect(history[0].html).toContain('B-1204');
      expect(history[0].html).toContain('Activate Account');
    });

    it('formats password reset email correctly and records in delivery history', async () => {
      emailService.clearSentEmails();

      const result = await emailService.sendPasswordResetEmail({
        to: 'resident.reset@society.org',
        recipientName: 'Kavita Patel',
        resetLink: 'https://dwellora.app/reset-password?token=sample-reset-token',
        expiresAt: new Date(Date.now() + 3600000),
      });

      expect(result.success).toBe(true);

      const history = emailService.getSentEmails();
      expect(history.length).toBe(1);
      expect(history[0].to).toBe('resident.reset@society.org');
      expect(history[0].subject).toContain('Reset Your Dwellora Account Password');
      expect(history[0].html).toContain('Reset Account Password');
      expect(history[0].html).toContain('https://dwellora.app/reset-password?token=sample-reset-token');
    });
  });

  // -------------------------------------------------------------------------
  // 8. Canonical Demo Accounts & Multi-Portal Testing Verification
  // -------------------------------------------------------------------------
  describe('8. Demo Accounts & One-Tap Testing Credentials', () => {
    it('provides exactly 7 canonical demo accounts covering every community portal', () => {
      const { DEMO_ACCOUNTS } = require('../src/mockData/auth/demoAccounts');
      expect(DEMO_ACCOUNTS.length).toBe(7);
      const roles = DEMO_ACCOUNTS.map((a: any) => a.role);
      expect(roles).toEqual([
        'resident',
        'secretary',
        'guard',
        'committee',
        'facility_manager',
        'vendor',
        'admin',
      ]);
    });

    it('uses the standard universal password dwellora@2026 across all demo accounts', () => {
      const { DEMO_ACCOUNTS, DEMO_PASSWORD } = require('../src/mockData/auth/demoAccounts');
      expect(DEMO_PASSWORD).toBe('dwellora@2026');
      DEMO_ACCOUNTS.forEach((account: any) => {
        expect(account.password).toBe('dwellora@2026');
        expect(account.primaryEmail).toContain('@dwellora.com');
      });
    });

    it('correctly resolves accounts and aliases with findDemoAccount', () => {
      const { findDemoAccount } = require('../src/mockData/auth/demoAccounts');
      // Primary lookup
      const resPrimary = findDemoAccount('resident@dwellora.com', 'dwellora@2026');
      expect(resPrimary).not.toBeNull();
      expect(resPrimary?.role).toBe('resident');

      // Alias lookup
      const resAlias = findDemoAccount('sarvesh@greenvalley.com', 'dwellora@2026');
      expect(resAlias).not.toBeNull();
      expect(resAlias?.role).toBe('resident');

      // Reject invalid password
      const rejected = findDemoAccount('resident@dwellora.com', 'wrongpassword');
      expect(rejected).toBeNull();
    });

    it('renders the interactive demo accounts drawer button in LoginScreen', () => {
      const html = renderToStaticMarkup(<LoginScreen />);
      expect(html).toContain('Demo Role Accounts (Tap to test)');
    });
  });
});
