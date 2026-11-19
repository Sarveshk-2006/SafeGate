import type { UserProfile, UserRole } from '../../domains/auth/types';
import { MOCK_USERS } from './mockUsers';

export interface DemoAccount {
  role: UserRole;
  title: string;
  name: string;
  primaryEmail: string;
  aliases: string[];
  password: string; // 'dwellora@2026'
  route: string;
  badge: string;
  description: string;
  profile: UserProfile;
}

export const DEMO_PASSWORD = 'dwellora@2026';

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    role: 'resident',
    title: 'Resident Portal',
    name: 'Sarvesh Kulkarni',
    primaryEmail: 'resident@dwellora.com',
    aliases: ['sarvesh@greenvalley.com', 'vikram.joshi@aarizo.com'],
    password: DEMO_PASSWORD,
    route: '/resident',
    badge: 'Resident / Owner',
    description: 'Tower B · Flat 1204',
    profile: {
      ...MOCK_USERS.resident,
      email: 'resident@dwellora.com',
    },
  },
  {
    role: 'secretary',
    title: 'Secretary Admin Portal',
    name: 'Mayuri Udar',
    primaryEmail: 'secretary@dwellora.com',
    aliases: ['secretary@greenvalley.com', 'mayuri.udar@aarizo.com'],
    password: DEMO_PASSWORD,
    route: '/admin',
    badge: 'Society Secretary',
    description: 'Managing Committee Secretary · Flat A-101',
    profile: {
      ...MOCK_USERS.secretary,
      email: 'secretary@dwellora.com',
    },
  },
  {
    role: 'guard',
    title: 'Security Guard Portal',
    name: 'Officer R. Singh',
    primaryEmail: 'guard@dwellora.com',
    aliases: ['guard1@greenvalley.com', 'guard.ramesh@aarizo.com'],
    password: DEMO_PASSWORD,
    route: '/security',
    badge: 'Security Officer',
    description: 'Main Gate #1 Terminal · Shift A',
    profile: {
      ...MOCK_USERS.guard,
      email: 'guard@dwellora.com',
    },
  },
  {
    role: 'committee',
    title: 'Committee Board Portal',
    name: 'Rajesh Mehta',
    primaryEmail: 'committee@dwellora.com',
    aliases: ['rajesh.committee@greenvalley.com', 'ashok.mehta@aarizo.com'],
    password: DEMO_PASSWORD,
    route: '/committee',
    badge: 'Board Member',
    description: 'Management Committee Member · Flat A-201',
    profile: {
      ...MOCK_USERS.committee,
      email: 'committee@dwellora.com',
    },
  },
  {
    role: 'facility_manager',
    title: 'Facility Operations Portal',
    name: 'Suresh Patil',
    primaryEmail: 'facility@dwellora.com',
    aliases: ['facility@greenvalley.com', 'rajesh.patil@aarizo.com'],
    password: DEMO_PASSWORD,
    route: '/facility',
    badge: 'Facility Manager',
    description: 'Operations & Maintenance Office',
    profile: {
      ...MOCK_USERS.facility_manager,
      email: 'facility@dwellora.com',
    },
  },
  {
    role: 'vendor',
    title: 'Vendor Partner Portal',
    name: 'Priya Cleaning Services',
    primaryEmail: 'vendor@dwellora.com',
    aliases: ['priya.vendor@greenvalley.com', 'ramesh.gupta@aquapure.com'],
    password: DEMO_PASSWORD,
    route: '/vendor',
    badge: 'Verified Vendor',
    description: 'AquaPure & Allied Cleaning Services',
    profile: {
      ...MOCK_USERS.vendor,
      email: 'vendor@dwellora.com',
    },
  },
  {
    role: 'admin',
    title: 'Platform Super Admin',
    name: 'Platform Admin',
    primaryEmail: 'admin@dwellora.com',
    aliases: ['superadmin@dwellora.com', 'admin@aarizo.com'],
    password: DEMO_PASSWORD,
    route: '/super-admin',
    badge: 'System Admin',
    description: 'Enterprise Multi-Society Platform Admin',
    profile: {
      ...MOCK_USERS.admin,
      email: 'admin@dwellora.com',
    },
  },
];

/**
 * Searches for a matching demo account by primary email or accepted alias.
 * If password is provided, verifies that it matches DEMO_PASSWORD.
 */
export function findDemoAccount(email: string, password?: string): DemoAccount | null {
  if (!email) return null;
  const norm = email.toLowerCase().trim();
  const match = DEMO_ACCOUNTS.find(
    (acc) =>
      acc.primaryEmail.toLowerCase() === norm ||
      acc.aliases.some((a) => a.toLowerCase() === norm)
  );

  if (!match) return null;

  if (password !== undefined) {
    if (password.trim() !== DEMO_PASSWORD) {
      return null;
    }
  }

  return match;
}
