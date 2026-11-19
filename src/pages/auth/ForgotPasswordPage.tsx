import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Mail, ArrowRight, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import '../../components/auth/auth.css';

export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await apiClient.requestPasswordReset(email.trim().toLowerCase());
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to request password reset. Please try again.');
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
            <KeyRound size={26} color="#ffffff" />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#083B56', margin: '0 0 0.25rem 0' }}>
            Reset Password
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#657785', margin: 0, fontWeight: 500 }}>
            Enter your email to receive recovery instructions
          </p>
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
          {error && (
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
              <span>{error}</span>
            </div>
          )}

          {submitted ? (
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
                Instructions Sent
              </h3>
              <p style={{ fontSize: '0.875rem', color: '#4B5563', lineHeight: 1.5, marginBottom: '1.5rem' }}>
                If an active account exists for <strong>{email}</strong>, a secure reset link has been dispatched. Please check your inbox and spam folders.
              </p>
              <Link
                to="/login"
                style={{
                  display: 'inline-block',
                  width: '100%',
                  background: '#083B56',
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
                Return to Login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label
                  style={{
                    fontSize: '0.78125rem',
                    fontWeight: 800,
                    color: '#083B56',
                    display: 'block',
                    marginBottom: '0.4rem',
                  }}
                >
                  Registered Email Address
                </label>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: '#F8FAFC',
                    border: '1px solid #CBD5E1',
                    borderRadius: '12px',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ padding: '0.75rem 0.875rem', color: '#657785' }}>
                    <Mail size={16} />
                  </div>
                  <input
                    type="email"
                    required
                    placeholder="name@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.75rem 0.875rem 0.75rem 0',
                      border: 'none',
                      background: 'transparent',
                      fontSize: '0.875rem',
                      color: '#083B56',
                      fontWeight: 600,
                      outline: 'none',
                    }}
                  />
                </div>
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
                    <span>Sending Reset Link...</span>
                  </>
                ) : (
                  <>
                    <span>Send Reset Link</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>

              <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
                <Link to="/login" style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#657785', textDecoration: 'none' }}>
                  Remembered your password? <span style={{ color: '#F06543' }}>Sign In</span>
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
