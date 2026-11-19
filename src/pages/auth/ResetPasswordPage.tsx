import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import '../../components/auth/auth.css';

export const ResetPasswordPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const tokenParam = searchParams.get('token') || '';
  const [verifying, setVerifying] = useState<boolean>(Boolean(tokenParam));
  const [verifyError, setVerifyError] = useState<string | null>(tokenParam.trim() ? null : 'Password reset link is missing token.');
  const [targetEmail, setTargetEmail] = useState<string>('');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (!tokenParam.trim()) {
      setVerifyError('Password reset link is missing token.');
      setVerifying(false);
      return;
    }

    let isMounted = true;
    apiClient
      .verifyPasswordResetToken(tokenParam.trim())
      .then((res) => {
        if (!isMounted) return;
        if (res && res.valid) {
          setTargetEmail(res.email || '');
        } else {
          setVerifyError(res?.message || 'Invalid or expired password reset link.');
        }
      })
      .catch((err: any) => {
        if (!isMounted) return;
        setVerifyError(err?.message || 'Failed to verify reset link.');
      })
      .finally(() => {
        if (isMounted) setVerifying(false);
      });

    return () => {
      isMounted = false;
    };
  }, [tokenParam]);

  const handleSubmit = async (e: React.FormEvent) => {
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
      const res = await apiClient.confirmPasswordReset({
        token: tokenParam.trim(),
        newPassword: password.trim(),
      });

      if (res && res.success) {
        setIsSuccess(true);
      } else {
        setSubmitError(res?.message || 'Failed to update password.');
      }
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to update password. Link may have expired.');
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
          maxWidth: '420px',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: '16px',
              background: '#083B56',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(8, 59, 86, 0.25)',
              margin: '0 auto 0.75rem',
            }}
          >
            <Lock size={26} color="#ffffff" />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#083B56', margin: '0 0 0.25rem 0' }}>
            Set New Password
          </h1>
          {targetEmail && (
            <p style={{ fontSize: '0.85rem', color: '#657785', margin: 0, fontWeight: 500 }}>
              Updating credentials for <strong>{targetEmail}</strong>
            </p>
          )}
        </div>

        {/* Card */}
        <div
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
          {verifying && (
            <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              <Loader2 size={28} color="#F06543" className="animate-spin" style={{ margin: '0 auto 0.75rem' }} />
              <p style={{ fontSize: '0.875rem', color: '#083B56', fontWeight: 700 }}>Verifying reset link...</p>
            </div>
          )}

          {verifyError && !verifying && (
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: '#FFF0F1',
                  color: '#D9535B',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 1rem',
                }}
              >
                <AlertCircle size={28} />
              </div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#083B56', margin: '0 0 0.5rem' }}>
                Invalid Reset Link
              </h3>
              <p style={{ fontSize: '0.875rem', color: '#657785', lineHeight: 1.5, marginBottom: '1.5rem' }}>
                {verifyError}
              </p>
              <Link
                to="/forgot-password"
                style={{
                  display: 'inline-block',
                  width: '100%',
                  background: '#F06543',
                  color: '#ffffff',
                  textAlign: 'center',
                  padding: '0.875rem',
                  borderRadius: '14px',
                  fontWeight: 800,
                  fontSize: '0.9375rem',
                  textDecoration: 'none',
                  boxSizing: 'border-box',
                }}
              >
                Request Fresh Reset Link
              </Link>
            </div>
          )}

          {isSuccess && (
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: '#E8F5EE',
                  color: '#3F8F58',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 1rem',
                }}
              >
                <CheckCircle2 size={30} />
              </div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#083B56', margin: '0 0 0.5rem' }}>
                Password Updated!
              </h3>
              <p style={{ fontSize: '0.875rem', color: '#4B5563', lineHeight: 1.5, marginBottom: '1.5rem' }}>
                Your password has been changed successfully. You can now log in using your new credentials.
              </p>
              <button
                type="button"
                onClick={() => navigate('/login')}
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
                }}
              >
                <span>Sign In with New Password</span>
                <ArrowRight size={16} />
              </button>
            </div>
          )}

          {!verifying && !verifyError && !isSuccess && (
            <form onSubmit={handleSubmit}>
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

              {/* New Password */}
              <div style={{ marginBottom: '1rem' }}>
                <label
                  style={{
                    fontSize: '0.78125rem',
                    fontWeight: 800,
                    color: '#083B56',
                    display: 'block',
                    marginBottom: '0.35rem',
                  }}
                >
                  New Password
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

              {/* Confirm New Password */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label
                  style={{
                    fontSize: '0.78125rem',
                    fontWeight: 800,
                    color: '#083B56',
                    display: 'block',
                    marginBottom: '0.35rem',
                  }}
                >
                  Confirm New Password
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Re-enter new password"
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
                    <span>Updating Password...</span>
                  </>
                ) : (
                  <>
                    <span>Save New Password</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
