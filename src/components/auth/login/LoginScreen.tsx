import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { isNativeApp, registerGlobalBackHandler } from '../../../utils/nativeMobile';
import { App } from '@capacitor/app';
import {
  ArrowRight,
  AlertCircle,
  Eye,
  EyeOff,
  Lock,
  Loader2,
  Mail,
  KeyRound,
  ChevronDown,
  Sparkles,
  CheckCircle2,
  Home,
  Building2,
  ShieldCheck,
  Users,
  Wrench,
  Truck,
  Zap,
} from 'lucide-react';
import { apiClient } from '../../../services/apiClient';
import type { UserRole, UserProfile } from '../../../domains/auth/types';
import {
  DEMO_ACCOUNTS,
  findDemoAccount,
  DEMO_PASSWORD,
  type DemoAccount,
} from '../../../mockData/auth/demoAccounts';
import {
  findProvisionedAccount,
  getProvisionedAccounts,
  mapProvisionedToProfile,
} from '../../../services/provisionedAccountsStore';
import '../auth.css';

export const LoginScreen: React.FC = () => {
  const navigate = useNavigate();
  const { loginWithProfile, error, setError } = useAuth();

  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [showDemoAccounts, setShowDemoAccounts] = useState<boolean>(false);
  const [demoSelectedNotice, setDemoSelectedNotice] = useState<string | null>(null);

  // Prevent back navigation on Android when on Login screen -> Exit App safely
  useEffect(() => {
    if (isNativeApp()) {
      const handleBack = registerGlobalBackHandler(() => {
        App.exitApp();
        return true;
      });
      return () => handleBack();
    }
  }, []);

  const routeByRole = (role: UserRole) => {
    if (role === 'secretary') return '/admin';
    if (role === 'guard') return '/security';
    if (role === 'committee') return '/committee';
    if (role === 'facility_manager') return '/facility';
    if (role === 'vendor') return '/vendor';
    if (role === 'admin') return '/super-admin';
    return '/resident';
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = email.toLowerCase().trim();

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    if (!password.trim()) {
      setError('Please enter your account password.');
      return;
    }

    setLoading(true);
    setError(null);
    setDemoSelectedNotice(null);

    try {
      const res = await apiClient.loginWithPassword({
        email: normalizedEmail,
        password: password.trim(),
      });

      if (res && res.success && res.user) {
        const userRole = (res.user.role || 'resident').toLowerCase() as UserRole;
        const userProfile: UserProfile = {
          id: res.user.id,
          uid: res.user.id,
          name: res.user.name,
          email: res.user.email,
          phone: res.user.phone,
          role: userRole,
          societyId: res.user.societyId || 'soc-gvs',
          societyName: res.user.societyName || 'Green Valley Society',
          flatNumber: res.user.flatNumber,
          status: 'ACTIVE',
          avatarUrl: `https://images.unsplash.com/photo-1534528741775?auto=format&fit=crop&w=250&q=80`,
        };

        loginWithProfile(userProfile, res.token);
        setLoading(false);
        navigate(routeByRole(userRole), { replace: true });
        return;
      }

      // Check dynamically provisioned accounts (Added in real-time by Secretary / Admin)
      const provisioned = findProvisionedAccount(normalizedEmail, password.trim());
      if (provisioned) {
        loginWithProfile(provisioned.profile, 'dwellora-provisioned-session-token');
        setLoading(false);
        navigate(provisioned.route, { replace: true });
        return;
      }

      // Offline / standalone demo credentials fallback
      const demoAccount = findDemoAccount(normalizedEmail, password.trim());
      if (demoAccount) {
        loginWithProfile(demoAccount.profile, 'dwellora-demo-session-token');
        setLoading(false);
        navigate(demoAccount.route, { replace: true });
        return;
      }

      setError('Invalid email or password. Please verify your credentials.');
      setLoading(false);
    } catch (err: any) {
      // If network fails (e.g. mobile APK offline or unreachable backend), check provisioned accounts first
      const provisioned = findProvisionedAccount(normalizedEmail, password.trim());
      if (provisioned) {
        loginWithProfile(provisioned.profile, 'dwellora-provisioned-session-token');
        setLoading(false);
        navigate(provisioned.route, { replace: true });
        return;
      }

      // Check demo credentials
      const demoAccount = findDemoAccount(normalizedEmail, password.trim());
      if (demoAccount) {
        loginWithProfile(demoAccount.profile, 'dwellora-demo-session-token');
        setLoading(false);
        navigate(demoAccount.route, { replace: true });
        return;
      }

      setError(err?.message || 'Invalid email or password. Please verify credentials.');
      setLoading(false);
    }
  };

  // 1-Tap Auto-fill for any demo persona
  const handleFillDemo = (account: DemoAccount) => {
    setEmail(account.primaryEmail);
    setPassword(account.password);
    setError(null);
    setDemoSelectedNotice(`Filled credentials for ${account.badge} (${account.name}).`);
  };

  // Instant direct login for testing
  const handleDirectDemoLogin = (account: DemoAccount) => {
    setLoading(true);
    loginWithProfile(account.profile, 'dwellora-demo-session-token');
    navigate(account.route, { replace: true });
  };

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'resident':
        return <Home size={15} color="#083B56" />;
      case 'secretary':
        return <Building2 size={15} color="#083B56" />;
      case 'guard':
        return <ShieldCheck size={15} color="#083B56" />;
      case 'committee':
        return <Users size={15} color="#083B56" />;
      case 'facility_manager':
        return <Wrench size={15} color="#083B56" />;
      case 'vendor':
        return <Truck size={15} color="#083B56" />;
      case 'admin':
        return <Zap size={15} color="#083B56" />;
    }
  };

  return (
    <div
      className="auth-container"
      style={{
        minHeight: '100dvh',
        background: '#FAF6F0',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding:
          'calc(1.5rem + env(safe-area-inset-top, 0px)) 1.25rem calc(1.5rem + env(safe-area-inset-bottom, 0px))',
        fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif',
        boxSizing: 'border-box',
        overflowX: 'hidden',
      }}
    >
      {/* Main Form Container */}
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {/* ── Brand Header ── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            marginBottom: '1.5rem',
          }}
        >
          {/* Logo Badge */}
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '16px',
              background: '#000000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
              marginBottom: '0.75rem',
              overflow: 'hidden',
            }}
          >
            <img
              src="/dwellora-symbol.png"
              alt="Dwellora"
              style={{
                width: 40,
                height: 40,
                objectFit: 'contain',
                display: 'block',
              }}
            />
          </div>

          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 900,
              color: '#083B56',
              letterSpacing: '-0.02em',
              margin: '0 0 0.25rem 0',
              lineHeight: 1.2,
            }}
          >
            Sign In to Dwellora
          </h1>

          <p
            style={{
              fontSize: '0.84375rem',
              color: '#657785',
              margin: 0,
              fontWeight: 500,
            }}
          >
            Secure Communities, Connected Living
          </p>
        </div>

        {/* ── Inline Error Alert Banner ── */}
        {error && (
          <div
            style={{
              width: '100%',
              background: '#FFF0F1',
              border: '1px solid #FBC5C8',
              color: '#D9535B',
              padding: '0.75rem 1rem',
              borderRadius: '12px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxSizing: 'border-box',
              animation: 'onboardingSlideIn 0.2s ease forwards',
            }}
          >
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* ── Demo Selection Info Banner ── */}
        {demoSelectedNotice && (
          <div
            style={{
              width: '100%',
              background: '#F0FDF4',
              border: '1px solid #BBF7D0',
              color: '#166534',
              padding: '0.65rem 0.85rem',
              borderRadius: '12px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxSizing: 'border-box',
            }}
          >
            <CheckCircle2 size={16} color="#16A34A" style={{ flexShrink: 0 }} />
            <span>{demoSelectedNotice}</span>
          </div>
        )}

        {/* ── Production Login Form ── */}
        <form
          onSubmit={handleFormSubmit}
          style={{
            width: '100%',
            background: '#ffffff',
            border: '1px solid #E5E9EC',
            borderRadius: '20px',
            padding: '1.5rem',
            boxShadow: '0 8px 28px rgba(8, 59, 86, 0.06)',
            boxSizing: 'border-box',
          }}
        >
          {/* Email Address Field */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label
              style={{
                fontSize: '0.78125rem',
                fontWeight: 800,
                color: '#083B56',
                marginBottom: '0.4rem',
                display: 'block',
              }}
            >
              Email Address
            </label>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: '#F8FAFC',
                border: '1px solid #CBD5E1',
                borderRadius: '12px',
                overflow: 'hidden',
                transition: 'border-color 0.2s ease',
              }}
            >
              <div
                style={{
                  padding: '0.75rem 0.875rem',
                  color: '#657785',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Mail size={16} />
              </div>
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="name@community.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                  setDemoSelectedNotice(null);
                }}
                style={{
                  flex: 1,
                  padding: '0.75rem 0.875rem 0.75rem 0',
                  border: 'none',
                  background: 'transparent',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: '#083B56',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Password Field */}
          <div style={{ marginBottom: '0.75rem' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '0.4rem',
              }}
            >
              <label
                style={{
                  fontSize: '0.78125rem',
                  fontWeight: 800,
                  color: '#083B56',
                }}
              >
                Password
              </label>
              <Link
                to="/forgot-password"
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: '#F06543',
                  textDecoration: 'none',
                }}
              >
                Forgot Password?
              </Link>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: '#F8FAFC',
                border: '1px solid #CBD5E1',
                borderRadius: '12px',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  padding: '0.75rem 0.875rem',
                  color: '#657785',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Lock size={16} />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                  setDemoSelectedNotice(null);
                }}
                style={{
                  flex: 1,
                  padding: '0.75rem 2.5rem 0.75rem 0',
                  border: 'none',
                  background: 'transparent',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: '#083B56',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '12px',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  color: '#657785',
                }}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Primary Action Button */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              background: '#F06543',
              color: '#ffffff',
              border: 'none',
              padding: '0.875rem',
              borderRadius: '14px',
              fontWeight: 800,
              fontSize: '0.9375rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              boxShadow: '0 8px 24px rgba(240, 101, 67, 0.4)',
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              opacity: loading ? 0.7 : 1,
              marginTop: '1.25rem',
            }}
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span>Authenticating...</span>
              </>
            ) : (
              <>
                <span>Sign In</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>

          {/* Invitation Activation Entry Point */}
          <div
            style={{
              marginTop: '1.5rem',
              paddingTop: '1.25rem',
              borderTop: '1px solid #F1F5F9',
              textAlign: 'center',
            }}
          >
            <p
              style={{
                fontSize: '0.8125rem',
                color: '#657785',
                margin: '0 0 0.5rem 0',
                fontWeight: 500,
              }}
            >
              Have a society invite code?
            </p>
            <Link
              to="/activate"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.875rem',
                fontWeight: 800,
                color: '#083B56',
                textDecoration: 'none',
              }}
            >
              <KeyRound size={15} color="#F06543" />
              <span>Activate Your Account</span>
            </Link>
          </div>
        </form>

        {/* ── Demo Accounts Drawer (Direct Role Testing) ── */}
        <div
          style={{
            width: '100%',
            marginTop: '1rem',
          }}
        >
          <button
            type="button"
            onClick={() => setShowDemoAccounts(!showDemoAccounts)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 1rem',
              background: '#ffffff',
              border: '1px solid #CBD5E1',
              borderRadius: '14px',
              color: '#083B56',
              fontSize: '0.8125rem',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(8, 59, 86, 0.04)',
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Sparkles size={16} color="#F06543" />
              <span>Demo Role Accounts (Tap to test)</span>
            </div>
            <ChevronDown
              size={16}
              color="#657785"
              style={{
                transform: showDemoAccounts ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s ease',
              }}
            />
          </button>

          {showDemoAccounts && (
            <div
              style={{
                marginTop: '0.625rem',
                background: '#ffffff',
                border: '1px solid #E2E8F0',
                borderRadius: '16px',
                padding: '0.875rem',
                boxShadow: '0 8px 24px rgba(8, 59, 86, 0.06)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingBottom: '0.5rem',
                  borderBottom: '1px solid #F1F5F9',
                }}
              >
                <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#083B56' }}>
                  Select a Role to Auto-Fill
                </span>
                <span
                  style={{
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    color: '#657785',
                    background: '#F1F5F9',
                    padding: '0.2rem 0.5rem',
                    borderRadius: '6px',
                  }}
                >
                  Password: {DEMO_PASSWORD}
                </span>
              </div>

              {/* Dynamically Provisioned Accounts (Created by Secretary / Admin in real-time) */}
              {getProvisionedAccounts().length > 0 && (
                <div style={{ marginBottom: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <div
                    style={{
                      fontSize: '0.6875rem',
                      fontWeight: 800,
                      color: '#F06543',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      marginTop: '0.25rem',
                    }}
                  >
                    ✨ Real-Time Provisioned Accounts ({getProvisionedAccounts().length})
                  </div>
                  {getProvisionedAccounts().map((prov) => (
                    <div
                      key={prov.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.625rem 0.75rem',
                        background: '#FFF8F6',
                        border: '1.5px solid #FDC5B8',
                        borderRadius: '12px',
                        gap: '0.5rem',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: '0.78125rem',
                            fontWeight: 800,
                            color: '#083B56',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {prov.name} ({prov.flatDetails || prov.role.toUpperCase()})
                        </div>
                        <div
                          style={{
                            fontSize: '0.6875rem',
                            color: '#657785',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {prov.email} · Pass: <strong style={{ color: '#083B56' }}>{prov.password}</strong>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => {
                            setEmail(prov.email);
                            setPassword(prov.password);
                            setError(null);
                            setDemoSelectedNotice(`Filled credentials for ${prov.name}.`);
                          }}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #CBD5E1',
                            color: '#083B56',
                            padding: '0.3rem 0.6rem',
                            borderRadius: '8px',
                            fontSize: '0.6875rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Fill
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const { profile, route } = mapProvisionedToProfile(prov);
                            loginWithProfile(profile, 'dwellora-provisioned-session-token');
                            navigate(route, { replace: true });
                          }}
                          style={{
                            background: '#F06543',
                            border: 'none',
                            color: '#ffffff',
                            padding: '0.3rem 0.6rem',
                            borderRadius: '8px',
                            fontSize: '0.6875rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Log In
                        </button>
                      </div>
                    </div>
                  ))}
                  <div
                    style={{
                      height: '1px',
                      background: '#E2E8F0',
                      margin: '0.4rem 0',
                    }}
                  />
                  <div
                    style={{
                      fontSize: '0.6875rem',
                      fontWeight: 800,
                      color: '#657785',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Canonical Testing Accounts (7 Roles)
                  </div>
                </div>
              )}

              {DEMO_ACCOUNTS.map((acc) => (
                <div
                  key={acc.role}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.625rem 0.75rem',
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: '12px',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: '8px',
                        background: '#EEF2F6',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {getRoleIcon(acc.role)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '0.78125rem',
                          fontWeight: 800,
                          color: '#083B56',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {acc.badge}
                      </div>
                      <div
                        style={{
                          fontSize: '0.6875rem',
                          color: '#657785',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {acc.primaryEmail}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => handleFillDemo(acc)}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #CBD5E1',
                        color: '#083B56',
                        padding: '0.3rem 0.6rem',
                        borderRadius: '8px',
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Fill
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDirectDemoLogin(acc)}
                      style={{
                        background: '#083B56',
                        border: 'none',
                        color: '#ffffff',
                        padding: '0.3rem 0.6rem',
                        borderRadius: '8px',
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Log In
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Welcome / Onboarding Link */}
        <div style={{ textAlign: 'center', marginTop: '1.25rem', marginBottom: '1.5rem' }}>
          <Link
            to="/"
            style={{
              fontSize: '0.8125rem',
              fontWeight: 700,
              color: '#657785',
              textDecoration: 'none',
            }}
          >
            ← Back to Welcome Carousel
          </Link>
        </div>
      </div>
    </div>
  );
};
