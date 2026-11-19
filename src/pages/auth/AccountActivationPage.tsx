import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import {
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Eye,
  EyeOff,
  Building,
  Home,
  User,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import '../../components/auth/auth.css';

export const AccountActivationPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const tokenParam = searchParams.get('token') || '';
  const [tokenInput, setTokenInput] = useState<string>(tokenParam);
  const [activeToken, setActiveToken] = useState<string>(tokenParam);

  const [verifying, setVerifying] = useState<boolean>(Boolean(tokenParam));
  const [invitationData, setInvitationData] = useState<{
    id: string;
    email: string;
    role: string;
    societyId: string;
    societyName: string;
    residentName?: string;
    flatNumber?: string;
  } | null>(null);

  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [displayName, setDisplayName] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isActivated, setIsActivated] = useState<boolean>(false);

  // Auto-verify when activeToken changes or is provided via URL
  useEffect(() => {
    if (!activeToken.trim()) {
      setVerifying(false);
      return;
    }

    let isMounted = true;
    setVerifying(true);
    setVerifyError(null);

    apiClient
      .verifyInvitation(activeToken.trim())
      .then((res) => {
        if (!isMounted) return;
        if (res && res.valid && res.invitation) {
          setInvitationData(res.invitation);
          setDisplayName(res.invitation.residentName || '');
        } else {
          setVerifyError(res?.message || 'Invalid or expired invitation token.');
        }
      })
      .catch((err: any) => {
        if (!isMounted) return;
        setVerifyError(err?.message || 'Failed to verify invitation token. Please check your link.');
      })
      .finally(() => {
        if (isMounted) setVerifying(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeToken]);

  const handleManualTokenSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) {
      setVerifyError('Please enter an invitation token.');
      return;
    }
    setActiveToken(tokenInput.trim());
  };

  const handleActivationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!password || password.length < 8) {
      setSubmitError('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setSubmitError('Passwords do not match. Please re-enter.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiClient.acceptInvitation({
        token: activeToken.trim(),
        password: password.trim(),
        name: displayName.trim() || undefined,
      });

      if (res && res.success) {
        setIsActivated(true);
      } else {
        setSubmitError(res?.message || 'Failed to activate account.');
      }
    } catch (err: any) {
      setSubmitError(err?.message || 'Account activation failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#FAF6F0',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 'calc(1.5rem + env(safe-area-inset-top, 0px)) 1.25rem calc(1.5rem + env(safe-area-inset-bottom, 0px))',
        fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: '16px',
              background: '#083B56',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(8, 59, 86, 0.25)',
              margin: '0 auto 0.75rem',
            }}
          >
            <KeyRound size={28} color="#ffffff" />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#083B56', margin: '0 0 0.25rem 0' }}>
            Account Activation
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#657785', margin: 0, fontWeight: 500 }}>
            Establish your credentials to join your society
          </p>
        </div>

        {/* Loading State */}
        {verifying && (
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              border: '1px solid #E2E8F0',
              padding: '2.5rem 1.5rem',
              textAlign: 'center',
              width: '100%',
              boxShadow: '0 8px 28px rgba(8, 59, 86, 0.06)',
            }}
          >
            <Loader2 size={32} color="#F06543" className="animate-spin" style={{ margin: '0 auto 1rem' }} />
            <div style={{ fontWeight: 700, color: '#083B56' }}>Verifying your invitation...</div>
            <p style={{ fontSize: '0.8125rem', color: '#657785', marginTop: '0.25rem' }}>
              Validating token against society records
            </p>
          </div>
        )}

        {/* Success / Activated State */}
        {isActivated && (
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              border: '1px solid #B8E2C8',
              padding: '2rem 1.5rem',
              textAlign: 'center',
              width: '100%',
              boxShadow: '0 8px 28px rgba(63, 143, 88, 0.1)',
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: '#E8F5EE',
                color: '#3F8F58',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1rem',
              }}
            >
              <CheckCircle2 size={32} />
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#083B56', margin: '0 0 0.5rem' }}>
              Account Activated!
            </h2>
            <p style={{ fontSize: '0.875rem', color: '#4B5563', lineHeight: 1.5, marginBottom: '1.5rem' }}>
              Your account has been successfully configured. You can now sign in using your email and the password you established.
            </p>
            <button
              type="button"
              onClick={() => navigate('/login')}
              style={{
                width: '100%',
                background: '#F06543',
                color: '#ffffff',
                border: 'none',
                padding: '0.875rem',
                borderRadius: '14px',
                fontWeight: 800,
                fontSize: '0.9375rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: '0 6px 18px rgba(240, 101, 67, 0.35)',
              }}
            >
              <span>Continue to Sign In</span>
              <ArrowRight size={18} />
            </button>
          </div>
        )}

        {/* Manual Token Entry Form (When no token provided or invalid) */}
        {!verifying && !isActivated && (!activeToken || verifyError) && (
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              border: '1px solid #E5E9EC',
              padding: '1.5rem',
              width: '100%',
              boxShadow: '0 8px 28px rgba(8, 59, 86, 0.06)',
              boxSizing: 'border-box',
            }}
          >
            {verifyError && (
              <div
                style={{
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
                }}
              >
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{verifyError}</span>
              </div>
            )}

            <p style={{ fontSize: '0.875rem', color: '#4B5563', lineHeight: 1.5, margin: '0 0 1rem' }}>
              Enter the activation token provided in your society invitation email:
            </p>

            <form onSubmit={handleManualTokenSubmit}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    color: '#083B56',
                    textTransform: 'uppercase',
                    display: 'block',
                    marginBottom: '0.4rem',
                  }}
                >
                  Invitation Token
                </label>
                <input
                  type="text"
                  placeholder="Paste your 64-character token"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    borderRadius: '12px',
                    border: '1px solid #CBD5E1',
                    fontSize: '0.875rem',
                    fontFamily: 'monospace',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>

              <button
                type="submit"
                style={{
                  width: '100%',
                  background: '#083B56',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.875rem',
                  borderRadius: '14px',
                  fontWeight: 800,
                  fontSize: '0.9375rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  boxShadow: '0 6px 18px rgba(8, 59, 86, 0.25)',
                }}
              >
                <span>Verify Token</span>
                <ArrowRight size={16} />
              </button>
            </form>

            <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
              <Link to="/login" style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#F06543', textDecoration: 'none' }}>
                Return to Login
              </Link>
            </div>
          </div>
        )}

        {/* Valid Invitation Form — Set Password */}
        {!verifying && !isActivated && invitationData && !verifyError && (
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              border: '1px solid #E5E9EC',
              padding: '1.5rem',
              width: '100%',
              boxShadow: '0 8px 28px rgba(8, 59, 86, 0.06)',
              boxSizing: 'border-box',
            }}
          >
            {/* Society & Resident Verified Badge Box */}
            <div
              style={{
                background: '#EAF6FC',
                border: '1px solid #DCE8EF',
                borderRadius: '14px',
                padding: '1rem',
                marginBottom: '1.25rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <Building size={16} color="#083B56" />
                <span style={{ fontSize: '0.9375rem', fontWeight: 800, color: '#083B56' }}>
                  {invitationData.societyName}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.8125rem', color: '#4B5563' }}>
                {invitationData.flatNumber && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Home size={14} color="#657785" />
                    <span>Unit: <strong>{invitationData.flatNumber}</strong></span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <User size={14} color="#657785" />
                  <span>Role: <strong>{invitationData.role.toUpperCase()}</strong></span>
                </div>
              </div>
            </div>

            {submitError && (
              <div
                style={{
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
                }}
              >
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{submitError}</span>
              </div>
            )}

            <form onSubmit={handleActivationSubmit}>
              {/* Full Name */}
              <div style={{ marginBottom: '1rem' }}>
                <label
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    color: '#083B56',
                    textTransform: 'uppercase',
                    display: 'block',
                    marginBottom: '0.35rem',
                  }}
                >
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    borderRadius: '12px',
                    border: '1px solid #CBD5E1',
                    fontSize: '0.875rem',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Password */}
              <div style={{ marginBottom: '1rem' }}>
                <label
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    color: '#083B56',
                    textTransform: 'uppercase',
                    display: 'block',
                    marginBottom: '0.35rem',
                  }}
                >
                  Create Password
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Minimum 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.75rem 2.5rem 0.75rem 1rem',
                      borderRadius: '12px',
                      border: '1px solid #CBD5E1',
                      fontSize: '0.875rem',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: '#657785',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    color: '#083B56',
                    textTransform: 'uppercase',
                    display: 'block',
                    marginBottom: '0.35rem',
                  }}
                >
                  Confirm Password
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    borderRadius: '12px',
                    border: '1px solid #CBD5E1',
                    fontSize: '0.875rem',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                style={{
                  width: '100%',
                  background: '#F06543',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.875rem',
                  borderRadius: '14px',
                  fontWeight: 800,
                  fontSize: '0.9375rem',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  boxShadow: '0 6px 18px rgba(240, 101, 67, 0.35)',
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>Activating Account...</span>
                  </>
                ) : (
                  <>
                    <span>Activate Account</span>
                    <ShieldCheck size={18} />
                  </>
                )}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
