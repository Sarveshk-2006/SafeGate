import { prisma } from './prisma.js';
import { generateSalt, hashPasswordScrypt } from './crypto.js';

/**
 * Determines whether the current process is running in an explicitly authorized local development or test environment.
 * Any other environment (production, staging, preview, CI, cloud hosting, or missing/unknown NODE_ENV)
 * is classified as non-development and MUST supply explicit credentials.
 */
export function isExplicitLocalDevOrTestEnv(): boolean {
  // Check common deployment / CI platform indicators
  if (
    process.env.CI === 'true' ||
    process.env.CI === '1' ||
    Boolean(process.env.VERCEL) ||
    Boolean(process.env.RENDER) ||
    Boolean(process.env.RAILWAY_ENVIRONMENT) ||
    Boolean(process.env.FLY_APP_NAME) ||
    Boolean(process.env.KUBERNETES_SERVICE_HOST) ||
    Boolean(process.env.AWS_EXECUTION_ENV)
  ) {
    return false;
  }

  const rawNodeEnv = (process.env.NODE_ENV || '').toLowerCase().trim();

  // If NODE_ENV indicates production, staging, preview, or is empty/missing/unknown -> NOT authorized for dev fallback
  if (
    !rawNodeEnv ||
    rawNodeEnv === 'production' ||
    rawNodeEnv === 'prod' ||
    rawNodeEnv === 'staging' ||
    rawNodeEnv === 'preview' ||
    rawNodeEnv === 'live' ||
    rawNodeEnv === 'qa'
  ) {
    return false;
  }

  // ONLY explicitly 'development' or 'test' (or 'dev') without CI/deployment markers
  return rawNodeEnv === 'development' || rawNodeEnv === 'dev' || rawNodeEnv === 'test';
}

/**
 * Validates whether destructive database operations are explicitly authorized.
 * Refuses destructive cleaning in all production, staging, preview, CI, and unknown environments.
 * Even in local development, requires explicit dual confirmation.
 */
export function isDestructiveCleanAuthorized(argv: string[] = process.argv): boolean {
  const hasCleanFlag = argv.includes('--force-clean') || process.env.SEED_FORCE_CLEAN === 'true';
  if (!hasCleanFlag) {
    return false;
  }

  // Destructive cleaning is strictly forbidden outside an authorized local dev/test context
  if (!isExplicitLocalDevOrTestEnv()) {
    const rawEnv = (process.env.NODE_ENV || 'UNKNOWN').trim();
    throw new Error(
      `[CRITICAL] Destructive database purge rejected: Environment "${rawEnv}" is not an authorized local development environment. ` +
      `Destructive operations (--force-clean / SEED_FORCE_CLEAN) cannot be executed in production-like, staging, CI, or unknown environments.`
    );
  }

  // Even in local development, require an explicit affirmative confirmation token to prevent accidental wipe
  const confirmClean =
    argv.includes('--confirm-delete-all-data') ||
    process.env.CONFIRM_DESTRUCTIVE_CLEAN === 'YES_I_AM_SURE';

  if (!confirmClean) {
    throw new Error(
      `[SECURITY] Destructive database purge requested but unconfirmed. ` +
      `To prevent accidental data loss in local development, you must also pass --confirm-delete-all-data ` +
      `or set CONFIRM_DESTRUCTIVE_CLEAN=YES_I_AM_SURE.`
    );
  }

  return true;
}

/**
 * Resolves seed password for a canonical role using explicit, secure configuration.
 * Fails closed in production, staging, CI, preview, and unknown environments.
 */
export function getSeedPasswordForRole(role: string): string {
  // 1. Role-specific explicit credential override (highest priority)
  const roleEnvKey = `SEED_${role.toUpperCase()}_PASSWORD`;
  const rolePassword = process.env[roleEnvKey];
  if (rolePassword && rolePassword.trim().length >= 8) {
    return rolePassword.trim();
  }

  // 2. Global seed default credential override
  const defaultEnvPassword = process.env.SEED_DEFAULT_PASSWORD;
  if (defaultEnvPassword && defaultEnvPassword.trim().length >= 8) {
    return defaultEnvPassword.trim();
  }

  // 3. Strict fail-closed environment check: refuse dev fallback in production-like or unknown environments
  if (!isExplicitLocalDevOrTestEnv()) {
    const rawEnv = (process.env.NODE_ENV || 'UNKNOWN').trim();
    throw new Error(
      `[SECURITY] Seed credential provisioning rejected: Environment "${rawEnv}" is not an authorized local development environment. ` +
      `Predictable default credentials are forbidden. Provide ${roleEnvKey} or SEED_DEFAULT_PASSWORD via environment variables (minimum 8 characters).`
    );
  }

  // 4. Authorized local development fallback
  const devPassword = process.env.DEV_SEED_PASSWORD;
  if (devPassword && devPassword.trim().length >= 8) {
    return devPassword.trim();
  }

  return 'dwellora@2026';
}

/**
 * Resolves or creates user credentials idempotently.
 * Preserves existing database passwords when re-seeding.
 */
export async function resolveSeedCredentials(
  userOrId: string | { id?: string; passwordHash?: string | null; salt?: string | null } | null,
  role: string
): Promise<{ passwordHash: string; salt: string }> {
  if (userOrId && typeof userOrId === 'object') {
    if (userOrId.passwordHash && userOrId.salt) {
      return { passwordHash: userOrId.passwordHash, salt: userOrId.salt };
    }
  } else if (typeof userOrId === 'string') {
    try {
      const existing = await prisma.user.findUnique({
        where: { id: userOrId },
        select: { passwordHash: true, salt: true },
      });
      if (existing?.passwordHash && existing?.salt) {
        return { passwordHash: existing.passwordHash, salt: existing.salt };
      }
    } catch {
      // If database query fails, fall through to fresh credential generation
    }
  }

  const seedPassword = getSeedPasswordForRole(role);
  const salt = generateSalt(16);
  const passwordHash = hashPasswordScrypt(seedPassword, salt);
  return { passwordHash, salt };
}

async function seed() {
  console.log('🌱 Starting comprehensive AARIZO database seed...');

  // Safe idempotent cleanup: Only purge if explicitly authorized via dual confirmation in local dev
  const shouldClean = isDestructiveCleanAuthorized();
  if (shouldClean) {
    console.log('🧹 Explicit dual-confirmed clean authorized: Purging existing database tables...');
    await prisma.auditLog.deleteMany({});
    await prisma.advertisement.deleteMany({});
    await prisma.notification.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.emergencyIncident.deleteMany({});
    await prisma.maintenanceTicket.deleteMany({});
    await prisma.billingInvoice.deleteMany({});
    await prisma.billingCycle.deleteMany({});
    await prisma.parcel.deleteMany({});
    await prisma.visitorPass.deleteMany({});
    await prisma.vehicle.deleteMany({});
    await prisma.familyMember.deleteMany({});
    await prisma.parkingSlot.deleteMany({});
    await prisma.amenity.deleteMany({});
    await prisma.domesticWorker.deleteMany({});
    await prisma.staff.deleteMany({});
    await prisma.vendor.deleteMany({});
    await prisma.resident.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.flat.deleteMany({});
    await prisma.tower.deleteMany({});
    await prisma.society.deleteMany({});
  } else {
    console.log('🔄 Running in safe idempotent mode (preserving existing users and credentials)...');
  }

  // 2. Societies
  console.log('🏢 Seeding Societies...');
  const socGVS = await prisma.society.upsert({
    where: { id: 'soc-gvs' },
    update: {
      name: 'Green Valley Society',
      code: 'GVS-01',
      city: 'Mumbai',
      address: 'Plot 42, Off Link Road, Bandra West',
      pincode: '400050',
      totalTowers: 3,
      totalFlats: 240,
      establishedYear: 2020,
      gateCount: 2,
      amenitiesCount: 6,
      status: 'ACTIVE',
    },
    create: {
      id: 'soc-gvs',
      name: 'Green Valley Society',
      code: 'GVS-01',
      city: 'Mumbai',
      address: 'Plot 42, Off Link Road, Bandra West',
      pincode: '400050',
      totalTowers: 3,
      totalFlats: 240,
      establishedYear: 2020,
      gateCount: 2,
      amenitiesCount: 6,
      status: 'ACTIVE',
      settings: {
        visitorApprovalRequired: true,
        deliveryLockerEnabled: true,
        sosBroadcasting: true,
      },
    },
  });

  const socRoyal = await prisma.society.upsert({
    where: { id: 'soc-royal' },
    update: {
      name: 'Royal Palms Residency',
      code: 'RPR-02',
      city: 'Mumbai',
      address: 'Central Avenue, Powai',
      pincode: '400076',
      totalTowers: 5,
      totalFlats: 500,
      establishedYear: 2022,
      gateCount: 3,
      amenitiesCount: 8,
      status: 'ACTIVE',
    },
    create: {
      id: 'soc-royal',
      name: 'Royal Palms Residency',
      code: 'RPR-02',
      city: 'Mumbai',
      address: 'Central Avenue, Powai',
      pincode: '400076',
      totalTowers: 5,
      totalFlats: 500,
      establishedYear: 2022,
      gateCount: 3,
      amenitiesCount: 8,
      status: 'ACTIVE',
    },
  });

  // 3. Towers
  console.log('🏗️ Seeding Towers...');
  const towerA = await prisma.tower.upsert({
    where: { id: 'tow-a' },
    update: {
      societyId: socGVS.id,
      name: 'Tower A - Aster',
      blockCode: 'A',
      totalFloors: 14,
      totalUnits: 56,
      hasElevator: true,
      status: 'ACTIVE',
    },
    create: {
      id: 'tow-a',
      societyId: socGVS.id,
      name: 'Tower A - Aster',
      blockCode: 'A',
      totalFloors: 14,
      totalUnits: 56,
      hasElevator: true,
      status: 'ACTIVE',
    },
  });

  const towerB = await prisma.tower.upsert({
    where: { id: 'tow-b' },
    update: {
      societyId: socGVS.id,
      name: 'Tower B - Bluebell',
      blockCode: 'B',
      totalFloors: 16,
      totalUnits: 64,
      hasElevator: true,
      status: 'ACTIVE',
    },
    create: {
      id: 'tow-b',
      societyId: socGVS.id,
      name: 'Tower B - Bluebell',
      blockCode: 'B',
      totalFloors: 16,
      totalUnits: 64,
      hasElevator: true,
      status: 'ACTIVE',
    },
  });

  const towerC = await prisma.tower.upsert({
    where: { id: 'tow-c' },
    update: {
      societyId: socGVS.id,
      name: 'Tower C - Carnation',
      blockCode: 'C',
      totalFloors: 12,
      totalUnits: 48,
      hasElevator: true,
      status: 'ACTIVE',
    },
    create: {
      id: 'tow-c',
      societyId: socGVS.id,
      name: 'Tower C - Carnation',
      blockCode: 'C',
      totalFloors: 12,
      totalUnits: 48,
      hasElevator: true,
      status: 'ACTIVE',
    },
  });

  // 4. Flats
  console.log('🚪 Seeding Flats...');
  const flatB1204 = await prisma.flat.upsert({
    where: { id: 'flat-1204' },
    update: {
      societyId: socGVS.id,
      towerId: towerB.id,
      flatNumber: 'B-1204',
      floorNumber: 12,
      intercomExtension: '1204',
      bhkType: '3BHK',
      carpetAreaSqft: 1450.0,
      occupancyStatus: 'OWNER_OCCUPIED',
      status: 'ACTIVE',
    },
    create: {
      id: 'flat-1204',
      societyId: socGVS.id,
      towerId: towerB.id,
      flatNumber: 'B-1204',
      floorNumber: 12,
      intercomExtension: '1204',
      bhkType: '3BHK',
      carpetAreaSqft: 1450.0,
      occupancyStatus: 'OWNER_OCCUPIED',
      status: 'ACTIVE',
    },
  });

  const flatA402 = await prisma.flat.upsert({
    where: { id: 'flat-402' },
    update: {
      societyId: socGVS.id,
      towerId: towerA.id,
      flatNumber: 'A-402',
      floorNumber: 4,
      intercomExtension: '0402',
      bhkType: '2BHK',
      carpetAreaSqft: 1050.0,
      occupancyStatus: 'TENANT_OCCUPIED',
      status: 'ACTIVE',
    },
    create: {
      id: 'flat-402',
      societyId: socGVS.id,
      towerId: towerA.id,
      flatNumber: 'A-402',
      floorNumber: 4,
      intercomExtension: '0402',
      bhkType: '2BHK',
      carpetAreaSqft: 1050.0,
      occupancyStatus: 'TENANT_OCCUPIED',
      status: 'ACTIVE',
    },
  });

  const flatC301 = await prisma.flat.upsert({
    where: { id: 'flat-301' },
    update: {
      societyId: socGVS.id,
      towerId: towerC.id,
      flatNumber: 'C-301',
      floorNumber: 3,
      intercomExtension: '0301',
      bhkType: '4BHK',
      carpetAreaSqft: 2100.0,
      occupancyStatus: 'OWNER_OCCUPIED',
      status: 'ACTIVE',
    },
    create: {
      id: 'flat-301',
      societyId: socGVS.id,
      towerId: towerC.id,
      flatNumber: 'C-301',
      floorNumber: 3,
      intercomExtension: '0301',
      bhkType: '4BHK',
      carpetAreaSqft: 2100.0,
      occupancyStatus: 'OWNER_OCCUPIED',
      status: 'ACTIVE',
    },
  });

  const flatB402 = await prisma.flat.upsert({
    where: { id: 'flat-b402' },
    update: {
      societyId: socGVS.id,
      towerId: towerB.id,
      flatNumber: 'B-402',
      floorNumber: 4,
      intercomExtension: '0402',
      bhkType: '3BHK',
      carpetAreaSqft: 1380.0,
      occupancyStatus: 'OWNER_OCCUPIED',
      status: 'ACTIVE',
    },
    create: {
      id: 'flat-b402',
      societyId: socGVS.id,
      towerId: towerB.id,
      flatNumber: 'B-402',
      floorNumber: 4,
      intercomExtension: '0402',
      bhkType: '3BHK',
      carpetAreaSqft: 1380.0,
      occupancyStatus: 'OWNER_OCCUPIED',
      status: 'ACTIVE',
    },
  });

  // 5. Users
  console.log('👤 Seeding Portal Users with Secure Password Hashes...');
  const credVikram = await resolveSeedCredentials('user-res-1', 'resident');
  const userVikram = await prisma.user.upsert({
    where: { id: 'user-res-1' },
    update: {
      societyId: socGVS.id,
      flatId: flatB1204.id,
      name: 'Vikram Joshi',
      email: 'vikram.joshi@aarizo.com',
      phone: '9820098200',
      role: 'resident',
      flatNumber: 'B-1204',
      flatDetails: 'Tower B · B-1204',
      status: 'ACTIVE',
      passwordHash: credVikram.passwordHash,
      salt: credVikram.salt,
    },
    create: {
      id: 'user-res-1',
      societyId: socGVS.id,
      flatId: flatB1204.id,
      name: 'Vikram Joshi',
      email: 'vikram.joshi@aarizo.com',
      phone: '9820098200',
      role: 'resident',
      flatNumber: 'B-1204',
      flatDetails: 'Tower B · B-1204',
      status: 'ACTIVE',
      passwordHash: credVikram.passwordHash,
      salt: credVikram.salt,
    },
  });

  const credAnanya = await resolveSeedCredentials('user-res-2', 'resident');
  const userAnanya = await prisma.user.upsert({
    where: { id: 'user-res-2' },
    update: {
      societyId: socGVS.id,
      flatId: flatA402.id,
      name: 'Ananya Roy',
      email: 'ananya.roy@aarizo.com',
      phone: '9819998199',
      role: 'resident',
      flatNumber: 'A-402',
      flatDetails: 'Tower A · A-402',
      status: 'ACTIVE',
      passwordHash: credAnanya.passwordHash,
      salt: credAnanya.salt,
    },
    create: {
      id: 'user-res-2',
      societyId: socGVS.id,
      flatId: flatA402.id,
      name: 'Ananya Roy',
      email: 'ananya.roy@aarizo.com',
      phone: '9819998199',
      role: 'resident',
      flatNumber: 'A-402',
      flatDetails: 'Tower A · A-402',
      status: 'ACTIVE',
      passwordHash: credAnanya.passwordHash,
      salt: credAnanya.salt,
    },
  });

  const credSecretary = await resolveSeedCredentials('user-sec-1', 'secretary');
  const userSecretary = await prisma.user.upsert({
    where: { id: 'user-sec-1' },
    update: {
      societyId: socGVS.id,
      flatId: flatC301.id,
      name: 'Mayuri Udar',
      email: 'mayuri.udar@aarizo.com',
      phone: '9876543210',
      role: 'secretary',
      flatNumber: 'C-301',
      flatDetails: 'Tower C · C-301',
      designation: 'General Secretary',
      status: 'ACTIVE',
      passwordHash: credSecretary.passwordHash,
      salt: credSecretary.salt,
    },
    create: {
      id: 'user-sec-1',
      societyId: socGVS.id,
      flatId: flatC301.id,
      name: 'Mayuri Udar',
      email: 'mayuri.udar@aarizo.com',
      phone: '9876543210',
      role: 'secretary',
      flatNumber: 'C-301',
      flatDetails: 'Tower C · C-301',
      designation: 'General Secretary',
      status: 'ACTIVE',
      passwordHash: credSecretary.passwordHash,
      salt: credSecretary.salt,
    },
  });

  const credGuard = await resolveSeedCredentials('user-guard-1', 'guard');
  const userGuard = await prisma.user.upsert({
    where: { id: 'user-guard-1' },
    update: {
      societyId: socGVS.id,
      name: 'Officer Ramesh Shinde',
      email: 'guard.ramesh@aarizo.com',
      phone: '9892011223',
      role: 'guard',
      designation: 'Chief Security Officer',
      status: 'ACTIVE',
      passwordHash: credGuard.passwordHash,
      salt: credGuard.salt,
    },
    create: {
      id: 'user-guard-1',
      societyId: socGVS.id,
      name: 'Officer Ramesh Shinde',
      email: 'guard.ramesh@aarizo.com',
      phone: '9892011223',
      role: 'guard',
      designation: 'Chief Security Officer',
      status: 'ACTIVE',
      passwordHash: credGuard.passwordHash,
      salt: credGuard.salt,
    },
  });

  const credCommittee = await resolveSeedCredentials('user-com-1', 'committee');
  const userCommittee = await prisma.user.upsert({
    where: { id: 'user-com-1' },
    update: {
      societyId: socGVS.id,
      flatId: flatB402.id,
      name: 'Dr. Ashok Mehta',
      email: 'ashok.mehta@aarizo.com',
      phone: '9833445566',
      role: 'committee',
      flatNumber: 'B-402',
      designation: 'Treasurer & Committee Board Member',
      status: 'ACTIVE',
      passwordHash: credCommittee.passwordHash,
      salt: credCommittee.salt,
    },
    create: {
      id: 'user-com-1',
      societyId: socGVS.id,
      flatId: flatB402.id,
      name: 'Dr. Ashok Mehta',
      email: 'ashok.mehta@aarizo.com',
      phone: '9833445566',
      role: 'committee',
      flatNumber: 'B-402',
      designation: 'Treasurer & Committee Board Member',
      status: 'ACTIVE',
      passwordHash: credCommittee.passwordHash,
      salt: credCommittee.salt,
    },
  });

  const credFacility = await resolveSeedCredentials('user-fac-1', 'facility_manager');
  const userFacility = await prisma.user.upsert({
    where: { id: 'user-fac-1' },
    update: {
      societyId: socGVS.id,
      name: 'Rajesh Patil',
      email: 'rajesh.patil@aarizo.com',
      phone: '9811223344',
      role: 'facility_manager',
      designation: 'Senior Facility Engineer',
      status: 'ACTIVE',
      passwordHash: credFacility.passwordHash,
      salt: credFacility.salt,
    },
    create: {
      id: 'user-fac-1',
      societyId: socGVS.id,
      name: 'Rajesh Patil',
      email: 'rajesh.patil@aarizo.com',
      phone: '9811223344',
      role: 'facility_manager',
      designation: 'Senior Facility Engineer',
      status: 'ACTIVE',
      passwordHash: credFacility.passwordHash,
      salt: credFacility.salt,
    },
  });

  const credVendor = await resolveSeedCredentials('user-ven-1', 'vendor');
  const userVendor = await prisma.user.upsert({
    where: { id: 'user-ven-1' },
    update: {
      societyId: socGVS.id,
      name: 'Ramesh Gupta',
      email: 'ramesh.gupta@aquapure.com',
      phone: '9822100445',
      role: 'vendor',
      designation: 'Managing Director, AquaPure Ltd',
      status: 'ACTIVE',
      passwordHash: credVendor.passwordHash,
      salt: credVendor.salt,
    },
    create: {
      id: 'user-ven-1',
      societyId: socGVS.id,
      name: 'Ramesh Gupta',
      email: 'ramesh.gupta@aquapure.com',
      phone: '9822100445',
      role: 'vendor',
      designation: 'Managing Director, AquaPure Ltd',
      status: 'ACTIVE',
      passwordHash: credVendor.passwordHash,
      salt: credVendor.salt,
    },
  });

  const credAdmin = await resolveSeedCredentials('user-adm-1', 'admin');
  const userAdmin = await prisma.user.upsert({
    where: { id: 'user-adm-1' },
    update: {
      societyId: socGVS.id,
      name: 'Super Administrator',
      email: 'admin@aarizo.com',
      phone: '9999988888',
      role: 'admin',
      designation: 'Enterprise Platform Administrator',
      status: 'ACTIVE',
      passwordHash: credAdmin.passwordHash,
      salt: credAdmin.salt,
    },
    create: {
      id: 'user-adm-1',
      societyId: socGVS.id,
      name: 'Super Administrator',
      email: 'admin@aarizo.com',
      phone: '9999988888',
      role: 'admin',
      designation: 'Enterprise Platform Administrator',
      status: 'ACTIVE',
      passwordHash: credAdmin.passwordHash,
      salt: credAdmin.salt,
    },
  });

  // 5b. Canonical Demo Role Users (@dwellora.com)
  console.log('🌟 Seeding Canonical Demo Accounts for Multi-Portal Testing (@dwellora.com)...');

  const credDemoResident = await resolveSeedCredentials('user-demo-resident', 'resident');
  const userDemoResident = await prisma.user.upsert({
    where: { id: 'user-demo-resident' },
    update: {
      societyId: socGVS.id,
      flatId: flatB1204.id,
      name: 'Sarvesh Kulkarni',
      email: 'resident@dwellora.com',
      phone: '9876543210',
      role: 'resident',
      flatNumber: 'B-1204',
      flatDetails: 'Tower B · Flat 1204',
      status: 'ACTIVE',
      passwordHash: credDemoResident.passwordHash,
      salt: credDemoResident.salt,
    },
    create: {
      id: 'user-demo-resident',
      societyId: socGVS.id,
      flatId: flatB1204.id,
      name: 'Sarvesh Kulkarni',
      email: 'resident@dwellora.com',
      phone: '9876543210',
      role: 'resident',
      flatNumber: 'B-1204',
      flatDetails: 'Tower B · Flat 1204',
      status: 'ACTIVE',
      passwordHash: credDemoResident.passwordHash,
      salt: credDemoResident.salt,
    },
  });

  const credDemoSecretary = await resolveSeedCredentials('user-demo-secretary', 'secretary');
  const userDemoSecretary = await prisma.user.upsert({
    where: { id: 'user-demo-secretary' },
    update: {
      societyId: socGVS.id,
      flatId: flatC301.id,
      name: 'Mayuri Udar',
      email: 'secretary@dwellora.com',
      phone: '9820012345',
      role: 'secretary',
      flatNumber: 'A-101',
      flatDetails: 'Block A · Flat 101',
      designation: 'Society Secretary',
      status: 'ACTIVE',
      passwordHash: credDemoSecretary.passwordHash,
      salt: credDemoSecretary.salt,
    },
    create: {
      id: 'user-demo-secretary',
      societyId: socGVS.id,
      flatId: flatC301.id,
      name: 'Mayuri Udar',
      email: 'secretary@dwellora.com',
      phone: '9820012345',
      role: 'secretary',
      flatNumber: 'A-101',
      flatDetails: 'Block A · Flat 101',
      designation: 'Society Secretary',
      status: 'ACTIVE',
      passwordHash: credDemoSecretary.passwordHash,
      salt: credDemoSecretary.salt,
    },
  });

  const credDemoGuard = await resolveSeedCredentials('user-demo-guard', 'guard');
  const userDemoGuard = await prisma.user.upsert({
    where: { id: 'user-demo-guard' },
    update: {
      societyId: socGVS.id,
      name: 'Officer R. Singh',
      email: 'guard@dwellora.com',
      phone: '9123456789',
      role: 'guard',
      flatDetails: 'Main Gate #1 Terminal',
      designation: 'Chief Security Officer',
      status: 'ACTIVE',
      passwordHash: credDemoGuard.passwordHash,
      salt: credDemoGuard.salt,
    },
    create: {
      id: 'user-demo-guard',
      societyId: socGVS.id,
      name: 'Officer R. Singh',
      email: 'guard@dwellora.com',
      phone: '9123456789',
      role: 'guard',
      flatDetails: 'Main Gate #1 Terminal',
      designation: 'Chief Security Officer',
      status: 'ACTIVE',
      passwordHash: credDemoGuard.passwordHash,
      salt: credDemoGuard.salt,
    },
  });

  const credDemoCommittee = await resolveSeedCredentials('user-demo-committee', 'committee');
  const userDemoCommittee = await prisma.user.upsert({
    where: { id: 'user-demo-committee' },
    update: {
      societyId: socGVS.id,
      flatId: flatB402.id,
      name: 'Rajesh Mehta',
      email: 'committee@dwellora.com',
      phone: '9900112233',
      role: 'committee',
      flatNumber: 'A-201',
      flatDetails: 'Tower A · Flat 201',
      designation: 'Management Committee Member',
      status: 'ACTIVE',
      passwordHash: credDemoCommittee.passwordHash,
      salt: credDemoCommittee.salt,
    },
    create: {
      id: 'user-demo-committee',
      societyId: socGVS.id,
      flatId: flatB402.id,
      name: 'Rajesh Mehta',
      email: 'committee@dwellora.com',
      phone: '9900112233',
      role: 'committee',
      flatNumber: 'A-201',
      flatDetails: 'Tower A · Flat 201',
      designation: 'Management Committee Member',
      status: 'ACTIVE',
      passwordHash: credDemoCommittee.passwordHash,
      salt: credDemoCommittee.salt,
    },
  });

  const credDemoFacility = await resolveSeedCredentials('user-demo-facility', 'facility_manager');
  const userDemoFacility = await prisma.user.upsert({
    where: { id: 'user-demo-facility' },
    update: {
      societyId: socGVS.id,
      name: 'Suresh Patil',
      email: 'facility@dwellora.com',
      phone: '9811223344',
      role: 'facility_manager',
      flatDetails: 'Office Block',
      designation: 'Facility Manager',
      status: 'ACTIVE',
      passwordHash: credDemoFacility.passwordHash,
      salt: credDemoFacility.salt,
    },
    create: {
      id: 'user-demo-facility',
      societyId: socGVS.id,
      name: 'Suresh Patil',
      email: 'facility@dwellora.com',
      phone: '9811223344',
      role: 'facility_manager',
      flatDetails: 'Office Block',
      designation: 'Facility Manager',
      status: 'ACTIVE',
      passwordHash: credDemoFacility.passwordHash,
      salt: credDemoFacility.salt,
    },
  });

  const credDemoVendor = await resolveSeedCredentials('user-demo-vendor', 'vendor');
  const userDemoVendor = await prisma.user.upsert({
    where: { id: 'user-demo-vendor' },
    update: {
      societyId: socGVS.id,
      name: 'Priya Cleaning Services',
      email: 'vendor@dwellora.com',
      phone: '9844556677',
      role: 'vendor',
      designation: 'Registered Vendor',
      status: 'ACTIVE',
      passwordHash: credDemoVendor.passwordHash,
      salt: credDemoVendor.salt,
    },
    create: {
      id: 'user-demo-vendor',
      societyId: socGVS.id,
      name: 'Priya Cleaning Services',
      email: 'vendor@dwellora.com',
      phone: '9844556677',
      role: 'vendor',
      designation: 'Registered Vendor',
      status: 'ACTIVE',
      passwordHash: credDemoVendor.passwordHash,
      salt: credDemoVendor.salt,
    },
  });

  const credDemoAdmin = await resolveSeedCredentials('user-demo-admin', 'admin');
  const userDemoAdmin = await prisma.user.upsert({
    where: { id: 'user-demo-admin' },
    update: {
      societyId: socGVS.id,
      name: 'Platform Admin',
      email: 'admin@dwellora.com',
      phone: '9000000001',
      role: 'admin',
      designation: 'Platform Administrator',
      status: 'ACTIVE',
      passwordHash: credDemoAdmin.passwordHash,
      salt: credDemoAdmin.salt,
    },
    create: {
      id: 'user-demo-admin',
      societyId: socGVS.id,
      name: 'Platform Admin',
      email: 'admin@dwellora.com',
      phone: '9000000001',
      role: 'admin',
      designation: 'Platform Administrator',
      status: 'ACTIVE',
      passwordHash: credDemoAdmin.passwordHash,
      salt: credDemoAdmin.salt,
    },
  });

  // 6. Residents
  console.log('👥 Seeding Resident Records...');
  const resVikram = await prisma.resident.upsert({
    where: { id: 'res-1' },
    update: {
      societyId: socGVS.id,
      userId: userVikram.id,
      flatId: flatB1204.id,
      name: 'Vikram Joshi',
      phone: '9820098200',
      email: 'vikram.joshi@aarizo.com',
      residentType: 'OWNER',
      moveInDate: new Date('2023-06-01'),
      emergencyContactName: 'Pooja Joshi',
      emergencyContactPhone: '9820098205',
      isVerified: true,
      status: 'ACTIVE',
    },
    create: {
      id: 'res-1',
      societyId: socGVS.id,
      userId: userVikram.id,
      flatId: flatB1204.id,
      name: 'Vikram Joshi',
      phone: '9820098200',
      email: 'vikram.joshi@aarizo.com',
      residentType: 'OWNER',
      moveInDate: new Date('2023-06-01'),
      emergencyContactName: 'Pooja Joshi',
      emergencyContactPhone: '9820098205',
      isVerified: true,
      status: 'ACTIVE',
    },
  });

  const resDemoResident = await prisma.resident.upsert({
    where: { id: 'res-demo-resident' },
    update: {
      societyId: socGVS.id,
      userId: userDemoResident.id,
      flatId: flatB1204.id,
      name: 'Sarvesh Kulkarni',
      phone: '9876543210',
      email: 'resident@dwellora.com',
      residentType: 'OWNER',
      moveInDate: new Date('2023-01-01'),
      emergencyContactName: 'Family Support',
      emergencyContactPhone: '9876543211',
      isVerified: true,
      status: 'ACTIVE',
    },
    create: {
      id: 'res-demo-resident',
      societyId: socGVS.id,
      userId: userDemoResident.id,
      flatId: flatB1204.id,
      name: 'Sarvesh Kulkarni',
      phone: '9876543210',
      email: 'resident@dwellora.com',
      residentType: 'OWNER',
      moveInDate: new Date('2023-01-01'),
      emergencyContactName: 'Family Support',
      emergencyContactPhone: '9876543211',
      isVerified: true,
      status: 'ACTIVE',
    },
  });

  const resAnanya = await prisma.resident.upsert({
    where: { id: 'res-2' },
    update: {
      societyId: socGVS.id,
      userId: userAnanya.id,
      flatId: flatA402.id,
      name: 'Ananya Roy',
      phone: '9819998199',
      email: 'ananya.roy@aarizo.com',
      residentType: 'TENANT',
      moveInDate: new Date('2024-01-15'),
      emergencyContactName: 'Subir Roy',
      emergencyContactPhone: '9819998100',
      isVerified: true,
      status: 'ACTIVE',
    },
    create: {
      id: 'res-2',
      societyId: socGVS.id,
      userId: userAnanya.id,
      flatId: flatA402.id,
      name: 'Ananya Roy',
      phone: '9819998199',
      email: 'ananya.roy@aarizo.com',
      residentType: 'TENANT',
      moveInDate: new Date('2024-01-15'),
      emergencyContactName: 'Subir Roy',
      emergencyContactPhone: '9819998100',
      isVerified: true,
      status: 'ACTIVE',
    },
  });

  const resMayuri = await prisma.resident.upsert({
    where: { id: 'res-3' },
    update: {
      societyId: socGVS.id,
      userId: userSecretary.id,
      flatId: flatC301.id,
      name: 'Mayuri Udar',
      phone: '9876543210',
      email: 'mayuri.udar@aarizo.com',
      residentType: 'OWNER',
      moveInDate: new Date('2022-11-10'),
      isVerified: true,
      status: 'ACTIVE',
    },
    create: {
      id: 'res-3',
      societyId: socGVS.id,
      userId: userSecretary.id,
      flatId: flatC301.id,
      name: 'Mayuri Udar',
      phone: '9876543210',
      email: 'mayuri.udar@aarizo.com',
      residentType: 'OWNER',
      moveInDate: new Date('2022-11-10'),
      isVerified: true,
      status: 'ACTIVE',
    },
  });

  // 7. Family Members
  console.log('👨‍👩‍👦 Seeding Family Members...');
  await prisma.familyMember.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'fam-1',
        residentId: resVikram.id,
        name: 'Pooja Joshi',
        relationship: 'SPOUSE',
        phone: '9820098205',
        age: 34,
        hasAppAccess: true,
      },
      {
        id: 'fam-2',
        residentId: resVikram.id,
        name: 'Aarav Joshi',
        relationship: 'CHILD',
        age: 8,
        hasAppAccess: false,
      },
      {
        id: 'fam-3',
        residentId: resAnanya.id,
        name: 'Rahul Sen',
        relationship: 'ROOMMATE',
        phone: '9819998155',
        age: 28,
        hasAppAccess: true,
      },
    ],
  });

  // 8. Vehicles
  console.log('🚗 Seeding Registered Vehicles...');
  await prisma.vehicle.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'veh-1',
        residentId: resVikram.id,
        vehicleNumber: 'MH-02-CB-4092',
        vehicleType: 'CAR',
        makeModel: 'BMW 330i Luxury Line',
        color: 'Alpine White',
        parkingSlotId: 'B-P12',
        rfidTag: 'RFID-98402',
        isVerified: true,
      },
      {
        id: 'veh-2',
        residentId: resAnanya.id,
        vehicleNumber: 'MH-03-AZ-1120',
        vehicleType: 'BIKE',
        makeModel: 'Honda Activa 6G',
        color: 'Matte Grey',
        parkingSlotId: 'A-S04',
        rfidTag: 'RFID-11204',
        isVerified: true,
      },
      {
        id: 'veh-3',
        residentId: resMayuri.id,
        vehicleNumber: 'MH-01-DE-7788',
        vehicleType: 'CAR',
        makeModel: 'Hyundai Creta SX(O)',
        color: 'Phantom Black',
        parkingSlotId: 'C-P01',
        rfidTag: 'RFID-77881',
        isVerified: true,
      },
    ],
  });

  // 9. Staff
  console.log('🛡️ Seeding Security & Operations Staff...');
  await prisma.staff.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'st-1',
        societyId: socGVS.id,
        userId: userGuard.id,
        name: 'Officer Ramesh Shinde',
        roleCategory: 'HEAD_GUARD',
        phone: '9892011223',
        shiftTimings: '08:00 AM - 08:00 PM (Day Shift)',
        isPoliceVerified: true,
        status: 'ACTIVE',
      },
      {
        id: 'st-2',
        societyId: socGVS.id,
        name: 'Suresh Kumar',
        roleCategory: 'ELECTRICIAN',
        phone: '9892011224',
        shiftTimings: '09:00 AM - 06:00 PM',
        isPoliceVerified: true,
        status: 'ACTIVE',
      },
      {
        id: 'st-3',
        societyId: socGVS.id,
        name: 'Anita Sharma',
        roleCategory: 'HOUSEKEEPING_SUPERVISOR',
        phone: '9892011225',
        shiftTimings: '07:00 AM - 04:00 PM',
        isPoliceVerified: true,
        status: 'ACTIVE',
      },
    ],
  });

  // 10. Domestic Workers
  console.log('🧹 Seeding Domestic Workers & Helpers...');
  await prisma.domesticWorker.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'dw-1',
        societyId: socGVS.id,
        name: 'Sunita Bai',
        profession: 'Housekeeping & Maid',
        phone: '9892110022',
        passcode: '8841',
        rating: 4.9,
        associatedFlats: ['B-1204', 'A-402'],
        currentStatus: 'INSIDE',
        isPoliceVerified: true,
      },
      {
        id: 'dw-2',
        societyId: socGVS.id,
        name: 'Ramu Chaurasia',
        profession: 'Cook & Culinary',
        phone: '9892110033',
        passcode: '6620',
        rating: 5.0,
        associatedFlats: ['B-1204', 'C-301'],
        currentStatus: 'OUTSIDE',
        isPoliceVerified: true,
      },
      {
        id: 'dw-3',
        societyId: socGVS.id,
        name: 'Asha Patil',
        profession: 'Nanny & Childcare',
        phone: '9892110044',
        passcode: '3301',
        rating: 4.8,
        associatedFlats: ['B-1204'],
        currentStatus: 'OUTSIDE',
        isPoliceVerified: true,
      },
    ],
  });

  // 11. Vendors
  console.log('🏪 Seeding Society Vendors...');
  await prisma.vendor.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'ven-1',
        societyId: socGVS.id,
        userId: userVendor.id,
        businessName: 'AquaPure Mineral Water Ltd',
        contactPerson: 'Ramesh Gupta',
        serviceType: 'WATER_SUPPLY',
        phone: '9822100445',
        email: 'sales@aquapure.com',
        gstNumber: '27AABCU9603R1ZM',
        rating: 4.9,
        status: 'ACTIVE',
      },
      {
        id: 'ven-2',
        societyId: socGVS.id,
        businessName: 'SwiftLift Elevator Engineering',
        contactPerson: 'Sanjay Deshmukh',
        serviceType: 'LIFT_AMC',
        phone: '9822100889',
        email: 'amc@swiftlift.com',
        gstNumber: '27AABCS4401Q1ZN',
        rating: 4.8,
        status: 'ACTIVE',
      },
      {
        id: 'ven-3',
        societyId: socGVS.id,
        businessName: 'GreenScape Garden Care',
        contactPerson: 'Harish Jadhav',
        serviceType: 'LANDSCAPING',
        phone: '9822100777',
        rating: 4.7,
        status: 'ACTIVE',
      },
    ],
  });

  // 12. Visitor Passes
  console.log('🎟️ Seeding Smart Visitor Passes...');
  const now = new Date();
  await prisma.visitorPass.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'pass-8492',
        societyId: socGVS.id,
        residentId: resVikram.id,
        flatId: flatB1204.id,
        visitorName: 'Rahul Verma',
        phone: '9820198201',
        passType: 'GUEST',
        vehicleNumber: 'MH-04-ER-9912',
        purpose: 'Family Dinner Visit',
        status: 'APPROVED',
        qrCodeHash: 'COMMUNITYOS:8492:SOC-GVS:FLAT-1204',
        validFrom: new Date(now.getTime() - 1 * 3600000),
        validTo: new Date(now.getTime() + 10 * 3600000),
      },
      {
        id: 'pass-9102',
        societyId: socGVS.id,
        residentId: resVikram.id,
        flatId: flatB1204.id,
        visitorName: 'Zomato Food Delivery',
        phone: '9870011223',
        passType: 'DELIVERY',
        purpose: 'Food Delivery Order (#ZOM-99102)',
        status: 'APPROVED',
        qrCodeHash: 'COMMUNITYOS:9102:SOC-GVS:FLAT-1204',
        validFrom: now,
        validTo: new Date(now.getTime() + 2 * 3600000),
      },
      {
        id: 'pass-3301',
        societyId: socGVS.id,
        residentId: resAnanya.id,
        flatId: flatA402.id,
        visitorName: 'Urban Company AC Technician',
        phone: '9820011445',
        passType: 'SERVICE',
        purpose: 'AC Maintenance Service',
        status: 'EXPIRED',
        qrCodeHash: 'COMMUNITYOS:3301:SOC-GVS:FLAT-402',
        validFrom: new Date(now.getTime() - 48 * 3600000),
        validTo: new Date(now.getTime() - 2 * 3600000),
      },
      {
        id: 'pass-104',
        societyId: socGVS.id,
        residentId: resAnanya.id,
        flatId: flatA402.id,
        visitorName: 'Dr. Sanjay Mehra',
        phone: '9833441122',
        passType: 'GUEST',
        purpose: 'Medical Consultation',
        status: 'PENDING',
        qrCodeHash: 'COMMUNITYOS:GVS-5521:SOC-GVS:FLAT-402',
        validFrom: new Date(now.getTime() + 1 * 3600000),
        validTo: new Date(now.getTime() + 6 * 3600000),
      },
    ],
  });

  // 13. Parking Slots
  console.log('🅿️ Seeding Parking Inventory...');
  await prisma.parkingSlot.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'slot-1',
        societyId: socGVS.id,
        slotNumber: 'B-P12',
        towerBlock: 'Tower B',
        slotType: 'RESIDENT',
        allocatedFlatId: flatB1204.id,
        isOccupied: true,
        status: 'ACTIVE',
      },
      {
        id: 'slot-2',
        societyId: socGVS.id,
        slotNumber: 'A-S04',
        towerBlock: 'Tower A',
        slotType: 'RESIDENT',
        allocatedFlatId: flatA402.id,
        isOccupied: true,
        status: 'ACTIVE',
      },
      {
        id: 'slot-3',
        societyId: socGVS.id,
        slotNumber: 'C-P01',
        towerBlock: 'Tower C',
        slotType: 'RESIDENT',
        allocatedFlatId: flatC301.id,
        isOccupied: false,
        status: 'ACTIVE',
      },
      {
        id: 'slot-4',
        societyId: socGVS.id,
        slotNumber: 'VIS-01',
        towerBlock: 'Visitor Bay',
        slotType: 'VISITOR',
        isOccupied: true,
        status: 'ACTIVE',
      },
      {
        id: 'slot-5',
        societyId: socGVS.id,
        slotNumber: 'VIS-02',
        towerBlock: 'Visitor Bay',
        slotType: 'VISITOR',
        isOccupied: false,
        status: 'ACTIVE',
      },
    ],
  });

  // 14. Parcels
  console.log('📦 Seeding Parcel Locker Records...');
  await prisma.parcel.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'pcl-1',
        societyId: socGVS.id,
        residentId: resVikram.id,
        flatId: flatB1204.id,
        courierCompany: 'BlueDart Express',
        deliveryPartnerName: 'Santosh K.',
        trackingNumber: 'BD-994102-IN',
        arrivalTime: new Date(now.getTime() - 2 * 3600000),
        pickupCode: '7309',
        status: 'AT_GATE',
      },
      {
        id: 'pcl-2',
        societyId: socGVS.id,
        residentId: resAnanya.id,
        flatId: flatA402.id,
        courierCompany: 'Amazon Logistics',
        deliveryPartnerName: 'Ravi Kumar',
        trackingNumber: 'AMZ-IN-88401',
        arrivalTime: new Date(now.getTime() - 6 * 3600000),
        pickedUpAt: new Date(now.getTime() - 1 * 3600000),
        pickupCode: '4421',
        status: 'PICKED_UP',
      },
    ],
  });

  // 15. Amenities
  console.log('🏊 Seeding Amenities...');
  await prisma.amenity.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'amn-1',
        societyId: socGVS.id,
        name: 'Grand Clubhouse & Banquet Hall',
        category: 'EVENT_SPACE',
        capacityPerSlot: 150,
        slotDurationMinutes: 240,
        hourlyCharge: 1500.0,
        requiresApproval: true,
        status: 'ACTIVE',
        rulesText: 'Music allowed until 10:00 PM. No open flames.',
      },
      {
        id: 'amn-2',
        societyId: socGVS.id,
        name: 'Olympic Infinity Swimming Pool',
        category: 'SPORTS',
        capacityPerSlot: 30,
        slotDurationMinutes: 60,
        hourlyCharge: 0.0,
        requiresApproval: false,
        status: 'ACTIVE',
        rulesText: 'Proper swimming costume mandatory. Shower before entering.',
      },
      {
        id: 'amn-3',
        societyId: socGVS.id,
        name: 'Air-Conditioned Badminton Arena',
        category: 'SPORTS',
        capacityPerSlot: 4,
        slotDurationMinutes: 60,
        hourlyCharge: 100.0,
        requiresApproval: false,
        status: 'ACTIVE',
        rulesText: 'Non-marking gum rubber shoes required.',
      },
      {
        id: 'amn-4',
        societyId: socGVS.id,
        name: 'Rooftop Yoga & Fitness Pavilion',
        category: 'WELLNESS',
        capacityPerSlot: 25,
        slotDurationMinutes: 60,
        hourlyCharge: 0.0,
        requiresApproval: false,
        status: 'ACTIVE',
      },
    ],
  });

  // 16. Maintenance Tickets
  console.log('🔧 Seeding Maintenance Tickets...');
  await prisma.maintenanceTicket.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'tkt-1',
        societyId: socGVS.id,
        residentId: resVikram.id,
        flatId: flatB1204.id,
        category: 'PLUMBING',
        title: 'Bathroom Flush Valve Water Leakage',
        description: 'Master bathroom flush valve is continuously running water. Please send plumber urgently.',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
        assignedStaffName: 'Suresh Kumar (Plumbing Team)',
      },
      {
        id: 'tkt-2',
        societyId: socGVS.id,
        residentId: resAnanya.id,
        flatId: flatA402.id,
        category: 'ELECTRICAL',
        title: 'Corridor Sensor Light Flickering outside A-402',
        description: 'Common area lighting outside flat entrance is dimming and flickering.',
        priority: 'LOW',
        status: 'RESOLVED',
        assignedStaffName: 'Suresh Kumar',
        resolvedAt: new Date(now.getTime() - 24 * 3600000),
        feedbackNotes: 'LED driver replaced with new Philips 18W unit.',
        rating: 5,
      },
      {
        id: 'tkt-3',
        societyId: socGVS.id,
        category: 'ELEVATOR',
        title: 'Tower B Passenger Lift #2 Abnormal Sound',
        description: 'Vibration observed between floors 8 and 10.',
        priority: 'EMERGENCY',
        status: 'OPEN',
        assignedStaffName: 'SwiftLift Elevator Engineering',
      },
    ],
  });

  // 17. Billing Cycles
  console.log('💳 Seeding Billing Cycles & Invoices...');
  const cycleOct = await prisma.billingCycle.upsert({
    where: { id: 'cycle-2026-10' },
    update: {
      societyId: socGVS.id,
      cycleName: 'October 2026 Maintenance Levy',
      monthYear: '10-2026',
      billingDate: new Date('2026-10-01'),
      dueDate: new Date('2026-10-15'),
      lateFeeAmount: 250.0,
      totalBilledAmount: 850000.0,
      totalCollectedAmount: 620000.0,
    },
    create: {
      id: 'cycle-2026-10',
      societyId: socGVS.id,
      cycleName: 'October 2026 Maintenance Levy',
      monthYear: '10-2026',
      billingDate: new Date('2026-10-01'),
      dueDate: new Date('2026-10-15'),
      lateFeeAmount: 250.0,
      totalBilledAmount: 850000.0,
      totalCollectedAmount: 620000.0,
    },
  });

  // 18. Billing Invoices
  await prisma.billingInvoice.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'inv-101',
        societyId: socGVS.id,
        cycleId: cycleOct.id,
        residentId: resVikram.id,
        flatId: flatB1204.id,
        invoiceNumber: 'GVS-INV-2026-10-001',
        maintenanceAmount: 3500.0,
        utilityAmount: 500.0,
        sinkingFund: 250.0,
        lateFee: 0.0,
        totalAmount: 4250.0,
        paidAmount: 4250.0,
        dueDate: new Date('2026-10-15'),
        status: 'PAID',
        paymentMode: 'UPI',
        paidAt: new Date('2026-10-02'),
        breakdown: {
          maintenanceCharge: 3500,
          waterCharges: 500,
          sinkingFundContribution: 250,
        },
      },
      {
        id: 'inv-102',
        societyId: socGVS.id,
        cycleId: cycleOct.id,
        residentId: resAnanya.id,
        flatId: flatA402.id,
        invoiceNumber: 'GVS-INV-2026-10-002',
        maintenanceAmount: 3100.0,
        utilityAmount: 450.0,
        sinkingFund: 250.0,
        lateFee: 0.0,
        totalAmount: 3800.0,
        paidAmount: 0.0,
        dueDate: new Date('2026-10-15'),
        status: 'PENDING',
        breakdown: {
          maintenanceCharge: 3100,
          waterCharges: 450,
          sinkingFundContribution: 250,
        },
      },
      {
        id: 'inv-103',
        societyId: socGVS.id,
        cycleId: cycleOct.id,
        residentId: resMayuri.id,
        flatId: flatC301.id,
        invoiceNumber: 'GVS-INV-2026-10-003',
        maintenanceAmount: 4500.0,
        utilityAmount: 600.0,
        sinkingFund: 400.0,
        lateFee: 0.0,
        totalAmount: 5500.0,
        paidAmount: 5500.0,
        dueDate: new Date('2026-10-15'),
        status: 'PAID',
        paymentMode: 'NET_BANKING',
        paidAt: new Date('2026-10-01'),
      },
    ],
  });

  // 18b. Payments
  console.log('💳 Seeding Payment Transactions...');
  await prisma.payment.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'pay-101',
        societyId: socGVS.id,
        invoiceId: 'inv-101',
        residentId: resVikram.id,
        userId: userVikram.id,
        amount: 4250.0,
        currency: 'INR',
        status: 'SUCCESS',
        razorpayOrderId: 'order_GVS_101_OCT',
        razorpayPaymentId: 'pay_rzp_oct_001_success',
        razorpaySignatureVerified: true,
        paymentMethod: 'RAZORPAY_UPI',
        metadata: {
          invoiceNumber: 'GVS-INV-2026-10-001',
          bank: 'HDFC',
        },
      },
      {
        id: 'pay-103',
        societyId: socGVS.id,
        invoiceId: 'inv-103',
        residentId: resMayuri.id,
        userId: userSecretary.id,
        amount: 5500.0,
        currency: 'INR',
        status: 'SUCCESS',
        razorpayOrderId: 'order_GVS_103_OCT',
        razorpayPaymentId: 'pay_rzp_oct_003_success',
        razorpaySignatureVerified: true,
        paymentMethod: 'RAZORPAY_NETBANKING',
        metadata: {
          invoiceNumber: 'GVS-INV-2026-10-003',
          bank: 'ICICI',
        },
      },
    ],
  });

  // 19. Emergency Incidents
  console.log('🚨 Seeding Emergency Incident Command Logs...');
  await prisma.emergencyIncident.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'inc-1',
        societyId: socGVS.id,
        incidentType: 'ELEVATOR_INTERCOM_ALARM',
        severity: 'CRITICAL',
        location: 'Tower B Passenger Elevator #2',
        description: 'Passenger alarm activated between 6th & 7th floor. Technician dispatched.',
        dispatchStatus: 'RESOLVED',
        resolvedAt: new Date(now.getTime() - 48 * 3600000),
      },
      {
        id: 'inc-2',
        societyId: socGVS.id,
        incidentType: 'GATE_SECURITY_ALERT',
        severity: 'HIGH',
        location: 'Main Gate 1',
        description: 'Unregistered vehicle attempted unauthorized gate breach. Security intervention logged.',
        dispatchStatus: 'RESOLVED',
        resolvedAt: new Date(now.getTime() - 12 * 3600000),
      },
    ],
  });

  // 20. Notifications
  console.log('🔔 Seeding System Notifications...');
  await prisma.notification.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'notif-1',
        societyId: socGVS.id,
        recipientId: userVikram.id,
        title: 'Guest Check-In Verified',
        body: 'Visitor Rahul Verma entered through Main Gate 1 for Flat B-1204.',
        category: 'SECURITY',
        isRead: false,
      },
      {
        id: 'notif-2',
        societyId: socGVS.id,
        recipientId: userVikram.id,
        title: 'Maintenance Invoice Generated',
        body: 'Your October Maintenance bill of ₹4,250 is generated. Due date is Oct 15.',
        category: 'BILLING',
        isRead: true,
        readAt: new Date(now.getTime() - 24 * 3600000),
      },
      {
        id: 'notif-3',
        societyId: socGVS.id,
        recipientId: userAnanya.id,
        title: 'Package Arrived at Gate Locker',
        body: 'Amazon package #AMZ-88401 arrived at Gate 1. Pickup code: 4421.',
        category: 'SECURITY',
        isRead: true,
        readAt: new Date(now.getTime() - 1 * 3600000),
      },
      {
        id: 'notif-4',
        societyId: socGVS.id,
        recipientId: userSecretary.id,
        title: 'New Complaint Filed: Ticket #PL-204',
        body: 'Flat B-1204 reported a bathroom flush leak requiring plumbing dispatch.',
        category: 'MAINTENANCE',
        isRead: false,
      },
    ],
  });

  // 21. Audit Logs
  console.log('📜 Seeding Audit Trails...');
  await prisma.auditLog.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'audit-1',
        societyId: socGVS.id,
        actorId: userGuard.id,
        actorName: 'Officer Ramesh Shinde',
        role: 'guard',
        action: 'VISITOR_CHECK_IN',
        entityName: 'VisitorPass',
        entityId: 'pass-101',
        metadata: { gate: 'Main Gate 1', visitor: 'Rahul Verma', flat: 'B-1204' },
      },
      {
        id: 'audit-2',
        societyId: socGVS.id,
        actorId: userVikram.id,
        actorName: 'Vikram Joshi',
        role: 'resident',
        action: 'PAYMENT_COMPLETED',
        entityName: 'BillingInvoice',
        entityId: 'inv-101',
        metadata: { amount: 4250, method: 'UPI' },
      },
      {
        id: 'audit-3',
        societyId: socGVS.id,
        actorId: userSecretary.id,
        actorName: 'Mayuri Udar',
        role: 'secretary',
        action: 'UPDATE_SOCIETY_CONFIG',
        entityName: 'Society',
        entityId: socGVS.id,
        metadata: { field: 'gateCount', oldValue: 1, newValue: 2 },
      },
    ],
  });

  console.log('📢 Seeding Announcements and Community Events...');
  await prisma.announcement.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'ann-1',
        societyId: socGVS.id,
        title: 'Water Supply Scheduled Maintenance',
        content: 'Borewell pump inspection scheduled for tomorrow from 10:00 AM to 2:00 PM. Please store water in advance.',
        category: 'MAINTENANCE',
        authorName: 'Mayuri Udar (Secretary)',
        isUrgent: true,
      },
      {
        id: 'ann-2',
        societyId: socGVS.id,
        title: 'Annual General Body Meeting (AGM)',
        content: 'The 2026 Annual General Body meeting will be held at the Clubhouse banquet on Saturday at 6:30 PM. All flat owners are requested to attend.',
        category: 'COMMUNITY',
        authorName: 'Managing Committee',
        isUrgent: false,
      },
      {
        id: 'ann-3',
        societyId: socGVS.id,
        title: 'EV Charging Station Commissioned',
        content: 'Two 7.4kW AC Type-2 EV chargers have been activated in Basement Level 1. Residents can use via the app.',
        category: 'FACILITIES',
        authorName: 'Amit Shah (Treasurer)',
        isUrgent: false,
      },
    ],
  });

  await prisma.communityEvent.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'evt-1',
        societyId: socGVS.id,
        title: 'Diwali Cultural Night & Potluck Dinner',
        description: 'Celebrate the festival of lights with your neighbors! Music, lights, games for kids, and community dinner.',
        location: 'Central Lawn & Amphitheater',
        startDate: new Date(Date.now() + 86400000 * 7),
        rsvpCount: 42,
      },
      {
        id: 'evt-2',
        societyId: socGVS.id,
        title: 'Weekly Yoga & Wellness Session',
        description: 'Morning yoga led by certified resident instructor. Suitable for all age groups.',
        location: 'Clubhouse Terrace',
        startDate: new Date(Date.now() + 86400000 * 2),
        rsvpCount: 18,
      },
    ],
  });

  // 24. Advertisements / Sponsored Offers
  console.log('📢 Seeding Society Advertisements & Vendor Offers...');
  await prisma.advertisement.createMany({ skipDuplicates: true,
    data: [
      {
        id: 'ad-1',
        societyId: socGVS.id,
        vendorId: 'ven-1',
        title: 'Urban Clean Pro — 25% Off Deep Home Cleaning',
        tagline: 'Exclusive Society Resident Offer',
        description: 'Professional 4-step sanitization, kitchen chimney degreasing & sofa shampooing. Trusted by 120+ society flats.',
        imageUrl: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=800&q=80',
        discountCode: 'AARIZO25',
        ctaText: 'Claim 25% Discount',
        ctaLink: 'tel:9844556677',
        category: 'HOME_SERVICES',
        status: 'ACTIVE',
        viewsCount: 142,
        clicksCount: 38,
      },
      {
        id: 'ad-2',
        societyId: socGVS.id,
        title: 'FarmFresh Organic — Free 7 AM Doorstep Delivery',
        tagline: 'Directly from Nashik & Pune Farms',
        description: 'Fresh organic greens, A2 Cow Milk, and cold-pressed cooking oils delivered directly to your flat before 7:00 AM daily.',
        imageUrl: 'https://images.unsplash.com/photo-1610348725531-843dff563e2c?auto=format&fit=crop&w=800&q=80',
        discountCode: 'FRESHVALLEY',
        ctaText: 'Order Farm Produce',
        ctaLink: 'https://wa.me/919876543210?text=I%20want%20to%20order%20farm%20produce',
        category: 'GROCERIES',
        status: 'ACTIVE',
        viewsCount: 98,
        clicksCount: 24,
      },
      {
        id: 'ad-3',
        societyId: socGVS.id,
        title: 'CoolBreeze AC Jet Service — Flat ₹499',
        tagline: 'Pre-Season Society Special AMC',
        description: 'High-pressure jet servicing, gas leak audit & anti-bacterial coil wash. 90-day cooling guarantee with genuine spares.',
        imageUrl: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=800&q=80',
        discountCode: 'COOL499',
        ctaText: 'Book AC Jet Service',
        ctaLink: 'tel:9822100889',
        category: 'MAINTENANCE',
        status: 'ACTIVE',
        viewsCount: 215,
        clicksCount: 52,
      },
    ],
  });

  console.log('🎉 SUCCESS! All models in AARIZO database successfully seeded!');
}

// Execute seed only when invoked directly as the main process script,
// and not when helper functions are imported by tests or other modules.
const isMainScript = Boolean(
  (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) ||
  (process.argv[1] && /(?:^|[/\\])seed\.(?:ts|js|mjs|cjs)$/.test(process.argv[1]))
);

if (isMainScript) {
  seed()
    .catch((e) => {
      console.error('❌ Seeding failed:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
