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
} from 'lucide-react';
import { MOCK_USERS } from '../../../mockData/auth/mockUsers';
import { apiClient } from '../../../services/apiClient';
import type { UserRole, UserProfile } from '../../../domains/auth/types';
import '../auth.css';

export const LoginScreen: React.FC = () => {
  const navigate = useNavigate();
  const { loginWithProfile, error, setError } = useAuth();

  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  // Development Only: Test Persona Quick-Fill Collapsible (strictly hidden in production)
  const isDevEnvironment = Boolean(
    typeof (globalThis as any).process !== 'undefined' &&
    (globalThis as any).process?.env?.NODE_ENV === 'development'
  );
  const [showDevPersonas, setShowDevPersonas] = useState<boolean>(false);

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

        if (userRole === 'secretary') navigate('/admin', { replace: true });
        else if (userRole === 'guard') navigate('/security', { replace: true });
        else if (userRole === 'committee') navigate('/committee', { replace: true });
        else if (userRole === 'facility_manager') navigate('/facility', { replace: true });
        else if (userRole === 'vendor') navigate('/vendor', { replace: true });
        else if (userRole === 'admin') navigate('/super-admin', { replace: true });
        else navigate('/resident', { replace: true });
        return;
      }

      setError('Invalid email or password. Please verify your credentials.');
      setLoading(false);
    } catch (err: any) {
      setError(err?.message || 'Invalid email or password. Please verify credentials.');
      setLoading(false);
    }
  };

  // Development quick-fill helper for test personas
  const handleQuickFill = (role: UserRole) => {
    const mockUser = MOCK_USERS[role];
    if (mockUser && mockUser.email) {
      setEmail(mockUser.email);
      setPassword('dwellora@2026');
      setError(null);
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

        {/* Welcome / Onboarding Link */}
        <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
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

        {/* ── Developer Personas Collapsible (Strictly DEV Only) ── */}
        {isDevEnvironment && (
          <div
            style={{
              width: '100%',
              marginTop: '2rem',
              borderTop: '1px dashed #CBD5E1',
              paddingTop: '1rem',
            }}
          >
            <button
              type="button"
              onClick={() => setShowDevPersonas(!showDevPersonas)}
              style={{
                background: 'none',
                border: 'none',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.5rem',
                color: '#94A3B8',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Sparkles size={13} />
                <span>DEV: Quick-Fill Test Credentials</span>
              </div>
              <ChevronDown
                size={14}
                style={{
                  transform: showDevPersonas ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s ease',
                }}
              />
            </button>

            {showDevPersonas && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '0.4rem',
                  marginTop: '0.5rem',
                  background: '#F8FAFC',
                  padding: '0.75rem',
                  borderRadius: '12px',
                  border: '1px solid #E2E8F0',
                }}
              >
                {(['resident', 'secretary', 'guard', 'committee', 'facility_manager', 'vendor', 'admin'] as UserRole[]).map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => handleQuickFill(role)}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #CBD5E1',
                      borderRadius: '8px',
                      padding: '0.35rem',
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      color: '#083B56',
                      cursor: 'pointer',
                      textAlign: 'center',
                      textTransform: 'capitalize',
                    }}
                  >
                    {role.replace('_', ' ')}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
