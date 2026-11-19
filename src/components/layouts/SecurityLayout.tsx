import { Outlet, Link } from 'react-router-dom';
import { MobileAppShell } from '../mobile/MobileAppShell';
import {
  LayoutDashboard,
  QrCode,
  Scan,
  ShieldAlert,
  User,
  Package,
  Car,
  Bell,
  HardHat,
  ShieldCheck,
  BedDouble,
} from 'lucide-react';

const DRAWER_NAV = [
  { label: 'Security Home', path: '/security', icon: LayoutDashboard },
  { label: 'Gate Terminal', path: '/security/terminal', icon: QrCode },
  { label: 'Visitor & Pass Scanner', path: '/security/verify', icon: Scan },
  { label: 'Child Gate Scanner', path: '/security/child-safety', icon: ShieldAlert },
  { label: 'Staff & Worker Terminal', path: '/security/staff-scanner', icon: HardHat },
  { label: 'Parking Boom Barrier', path: '/security/parking', icon: Car },
  { label: 'Parcel Intelligence', path: '/security/delivery-intelligence', icon: Package },
  { label: 'Emergency Command', path: '/security/emergency-command', icon: ShieldAlert },
  { label: 'Guest Stays Scanner', path: '/security/guest-stay', icon: BedDouble },
  { label: 'Privacy & Gate Audit', path: '/security/privacy-hub', icon: ShieldCheck },
  { label: 'Officer Profile', path: '/security/profile', icon: User },
];

const BOTTOM_NAV = [
  { label: 'Home', path: '/security', icon: LayoutDashboard },
  { label: 'Gate', path: '/security/terminal', icon: QrCode },
  { label: 'Scan', path: '/security/verify', icon: Scan },
  { label: 'Emergency', path: '/security/emergency-command', icon: ShieldAlert },
  { label: 'Profile', path: '/security/profile', icon: User },
];

export const SecurityLayout = () => {
  return (
    <MobileAppShell
      roleTitle="Security Guard"
      societyName="Green Valley Society"
      drawerItems={DRAWER_NAV}
      bottomItems={BOTTOM_NAV}
      showFab={false}
      topRightActions={
        <Link
          to="/security/emergency-command"
          aria-label="Emergency Alerts"
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.2)',
            color: '#ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textDecoration: 'none',
          }}
        >
          <Bell size={18} />
        </Link>
      }
    >
      <Outlet />
    </MobileAppShell>
  );
};
