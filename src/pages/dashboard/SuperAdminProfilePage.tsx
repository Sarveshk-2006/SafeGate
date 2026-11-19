import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  Shield,
  Phone,
  Mail,
  LogOut,
  ChevronRight,
  Bell,
  Camera,
  Edit3,
  X,
  Database,
  Building2,
  Server,
} from 'lucide-react';
import { FileUploader } from '../../components/common/FileUploader';

export const SuperAdminProfilePage: React.FC = () => {
  const { currentUser, logout, updateCurrentUser } = useAuth();
  const navigate = useNavigate();

  const [profileData, setProfileData] = useState({
    name: currentUser?.name || 'Platform Administrator',
    phone: currentUser?.phone || '9988776655',
    email: currentUser?.email || 'admin@dwellora.io',
    role: 'Root Platform Administrator',
    scope: 'Global Multi-Tenant Root (*)',
  });

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState(profileData);
  const [saveStatus, setSaveStatus] = useState<'IDLE' | 'SAVING' | 'SUCCESS'>('IDLE');

  const [avatarUrl, setAvatarUrl] = useState<string>(() => {
    return (typeof localStorage !== 'undefined' ? localStorage.getItem('aarizo_superadmin_avatar') : null) || currentUser?.avatarUrl || '';
  });
  const [isEditingAvatar, setIsEditingAvatar] = useState(false);

  const handleAvatarUpload = (url: string) => {
    setAvatarUrl(url);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('aarizo_superadmin_avatar', url);
    }
    updateCurrentUser({ avatarUrl: url });
    setIsEditingAvatar(false);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus('SAVING');
    setTimeout(() => {
      setProfileData(editForm);
      updateCurrentUser({
        name: editForm.name,
        phone: editForm.phone,
        email: editForm.email,
      });
      setSaveStatus('SUCCESS');
      setTimeout(() => {
        setSaveStatus('IDLE');
        setIsEditModalOpen(false);
      }, 800);
    }, 400);
  };

  const adminShortcuts = [
    { label: 'Developer Database Studio', icon: Database, path: '/dev/database', desc: 'Direct SQL & schema inspection' },
    { label: 'Societies & Tenants Provisioning', icon: Building2, path: '/super-admin/societies', desc: 'Configure tenant societies' },
    { label: 'Platform System Notifications', icon: Bell, path: '/notifications', desc: 'Global platform alerts' },
  ];

  return (
    <div
      style={{ backgroundColor: 'var(--aarizo-page, #F7FBFE)', minHeight: '100%' }}
      className="p-3 sm:p-6 max-w-5xl mx-auto pb-24 font-sans text-slate-800"
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Left Column (5 cols on desktop): Profile & Role */}
        <div className="md:col-span-5 space-y-4">
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
              padding: '1.5rem 1rem',
              boxShadow: '0 2px 10px rgba(8, 59, 86, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: '0.75rem',
            }}
          >
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: '50%',
                  background: 'var(--aarizo-navy, #083B56)',
                  border: '2px solid #E5B842',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                  fontWeight: 900,
                  fontSize: '2rem',
                  overflow: 'hidden',
                  boxShadow: '0 4px 12px rgba(8, 59, 86, 0.15)',
                }}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt={profileData.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  profileData.name.charAt(0).toUpperCase()
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsEditingAvatar(true)}
                aria-label="Change profile photo"
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: '#E5B842',
                  border: '2px solid #ffffff',
                  color: '#083B56',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                }}
              >
                <Camera size={14} />
              </button>
            </div>

            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: '1.25rem',
                  fontWeight: 800,
                  color: 'var(--aarizo-navy, #083B56)',
                  letterSpacing: '-0.01em',
                }}
              >
                {profileData.name}
              </h2>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  marginTop: '0.35rem',
                  padding: '0.2rem 0.65rem',
                  borderRadius: '9999px',
                  background: 'var(--aarizo-navy, #083B56)',
                  color: '#E5B842',
                  fontSize: '0.6875rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                <Shield size={12} color="#E5B842" />
                <span>ROOT ADMIN</span>
              </div>
              <p
                style={{
                  margin: '0.35rem 0 0',
                  fontSize: '0.75rem',
                  color: 'var(--aarizo-text-secondary, #657785)',
                  fontWeight: 500,
                }}
              >
                Dwellora Platform Infrastructure
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setEditForm(profileData);
                setIsEditModalOpen(true);
              }}
              style={{
                width: '100%',
                padding: '0.6rem',
                borderRadius: '12px',
                background: 'var(--aarizo-pale-blue, #F4FAFE)',
                border: '1px solid var(--aarizo-border, #DCE8EF)',
                color: 'var(--aarizo-navy, #083B56)',
                fontWeight: 700,
                fontSize: '0.8125rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.45rem',
                cursor: 'pointer',
                marginTop: '0.25rem',
              }}
            >
              <Edit3 size={15} />
              <span>Edit Administrator Details</span>
            </button>
          </div>

          {/* Contact Details */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
              padding: '1.25rem 1rem',
              boxShadow: '0 2px 10px rgba(8, 59, 86, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.875rem',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              System Credentials
            </h3>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '10px',
                  background: 'var(--aarizo-light-blue, #EAF6FC)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--aarizo-blue, #176B91)',
                  flexShrink: 0,
                }}
              >
                <Mail size={17} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '0.6875rem', color: '#657785', fontWeight: 600 }}>Master Email</span>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--aarizo-navy, #083B56)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {profileData.email}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '10px',
                  background: 'var(--aarizo-light-blue, #EAF6FC)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--aarizo-blue, #176B91)',
                  flexShrink: 0,
                }}
              >
                <Phone size={17} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '0.6875rem', color: '#657785', fontWeight: 600 }}>Secure Contact Phone</span>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--aarizo-navy, #083B56)' }}>
                  +91 {profileData.phone}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (7 cols on desktop): Platform Shortcuts & Actions */}
        <div className="md:col-span-7 space-y-4">
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
              padding: '1.25rem',
              boxShadow: '0 2px 10px rgba(8, 59, 86, 0.05)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.875rem' }}>
              <Server size={18} color="#083B56" />
              <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)' }}>
                Platform Control Shortcuts
              </h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {adminShortcuts.map((sc) => {
                const Icon = sc.icon;
                return (
                  <button
                    key={sc.label}
                    type="button"
                    onClick={() => navigate(sc.path)}
                    style={{
                      background: 'var(--aarizo-pale-blue, #F4FAFE)',
                      border: '1px solid var(--aarizo-border, #DCE8EF)',
                      borderRadius: '14px',
                      padding: '0.875rem 1rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      textAlign: 'left',
                      width: '100%',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: '10px',
                          background: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--aarizo-navy, #083B56)',
                          flexShrink: 0,
                          boxShadow: '0 2px 6px rgba(8, 59, 86, 0.06)',
                        }}
                      >
                        <Icon size={18} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '0.84375rem', color: 'var(--aarizo-navy, #083B56)' }}>
                          {sc.label}
                        </div>
                        <div style={{ fontSize: '0.71875rem', color: '#657785', marginTop: 1 }}>
                          {sc.desc}
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={16} color="#8B9AA5" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sign Out Button */}
          <button
            type="button"
            onClick={logout}
            style={{
              width: '100%',
              padding: '0.875rem',
              borderRadius: '16px',
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              color: '#DC2626',
              fontWeight: 800,
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(220, 38, 38, 0.06)',
            }}
          >
            <LogOut size={17} />
            <span>Sign Out of Platform Admin Console</span>
          </button>
        </div>
      </div>

      {/* Profile Edit Modal */}
      {isEditModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(8, 59, 86, 0.6)', backdropFilter: 'blur(3px)' }} onClick={() => setIsEditModalOpen(false)} />
          <div style={{ position: 'relative', background: '#ffffff', borderRadius: '20px', width: '100%', maxWidth: '460px', padding: '1.5rem', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)' }}>
                Edit Administrator Details
              </h3>
              <button type="button" onClick={() => setIsEditModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#657785' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#657785', marginBottom: '0.25rem' }}>Full Name</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #DCE8EF', fontSize: '0.875rem' }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#657785', marginBottom: '0.25rem' }}>Phone Number</label>
                <input
                  type="tel"
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #DCE8EF', fontSize: '0.875rem' }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#657785', marginBottom: '0.25rem' }}>Email Address</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #DCE8EF', fontSize: '0.875rem' }}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={saveStatus === 'SAVING'}
                style={{
                  marginTop: '0.5rem',
                  padding: '0.75rem',
                  borderRadius: '12px',
                  background: 'var(--aarizo-navy, #083B56)',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: '0.875rem',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {saveStatus === 'SAVING' ? 'Saving Updates...' : saveStatus === 'SUCCESS' ? 'Saved Successfully!' : 'Save Administrator Profile'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Avatar Upload Modal */}
      {isEditingAvatar && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(8, 59, 86, 0.6)', backdropFilter: 'blur(3px)' }} onClick={() => setIsEditingAvatar(false)} />
          <div style={{ position: 'relative', background: '#ffffff', borderRadius: '20px', width: '100%', maxWidth: '420px', padding: '1.5rem', zIndex: 1 }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)' }}>
              Update Administrator Photo
            </h3>
            <FileUploader
              label="Select or Snap Administrator Photo"
              accept="image/*"
              maxSizeMB={5}
              entityType="admin"
              onUploadSuccess={(res) => handleAvatarUpload(res.downloadUrl)}
            />
            <button
              type="button"
              onClick={() => setIsEditingAvatar(false)}
              style={{ marginTop: '1rem', width: '100%', padding: '0.65rem', borderRadius: '10px', background: '#F4FAFE', border: '1px solid #DCE8EF', color: '#657785', fontWeight: 700 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
