import React, { useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import {
  Phone,
  LogOut,
  Camera,
  Edit3,
  X,
  QrCode,
  Clock,
  ShieldCheck,
  Building2,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { FileUploader } from '../../../components/common/FileUploader';

interface StaffProfilePageProps {
  staffType?: 'DOMESTIC_WORKER' | 'SERVICE_PROVIDER';
}

export const StaffProfilePage: React.FC<StaffProfilePageProps> = ({ staffType = 'DOMESTIC_WORKER' }) => {
  const { currentUser, logout, updateCurrentUser } = useAuth();

  const isDomestic = staffType === 'DOMESTIC_WORKER';
  const defaultName = isDomestic ? 'Sunita Devi' : 'Rajesh Carpenter';
  const defaultRole = isDomestic ? 'Domestic Help / Maid' : 'Certified Service Technician';
  const defaultId = isDomestic ? 'DW-9042' : 'SP-4410';

  const isStaffRole = (currentUser?.role as string) === 'domestic_worker' || currentUser?.role === 'vendor' || (currentUser?.role as string) === 'service_provider';

  const [profileData, setProfileData] = useState({
    name: (isStaffRole ? currentUser?.name : undefined) || defaultName,
    phone: (isStaffRole ? currentUser?.phone : undefined) || (isDomestic ? '9876543210' : '9844556677'),
    email: (isStaffRole ? currentUser?.email : undefined) || (isDomestic ? 'sunita.maid@greenvalley.com' : 'rajesh.service@greenvalley.com'),
    role: defaultRole,
    staffId: defaultId,
    societyName: currentUser?.societyName || 'Green Valley Society',
    shift: '08:00 AM – 05:30 PM (Mon-Sat)',
  });

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState(profileData);
  const [saveStatus, setSaveStatus] = useState<'IDLE' | 'SAVING' | 'SUCCESS'>('IDLE');

  const [avatarUrl, setAvatarUrl] = useState<string>(() => {
    return (typeof localStorage !== 'undefined' ? localStorage.getItem(`aarizo_staff_avatar_${staffType}`) : null) || currentUser?.avatarUrl || '';
  });
  const [isEditingAvatar, setIsEditingAvatar] = useState(false);

  const handleAvatarUpload = (url: string) => {
    setAvatarUrl(url);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`aarizo_staff_avatar_${staffType}`, url);
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

  return (
    <div
      style={{ backgroundColor: 'var(--aarizo-page, #F7FBFE)', minHeight: '100%' }}
      className="p-3 sm:p-6 max-w-5xl mx-auto pb-24 font-sans text-slate-800"
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Left Column (5 cols on desktop): Identity & QR */}
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
                  background: 'var(--aarizo-light-blue, #EAF6FC)',
                  border: '2px solid var(--aarizo-border, #DCE8EF)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--aarizo-navy, #083B56)',
                  fontWeight: 900,
                  fontSize: '2rem',
                  overflow: 'hidden',
                  boxShadow: '0 4px 12px rgba(8, 59, 86, 0.08)',
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
                  background: 'var(--aarizo-navy, #083B56)',
                  border: '2px solid #ffffff',
                  color: '#ffffff',
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
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)', margin: 0 }}>
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
                  background: '#ECFDF5',
                  color: '#059669',
                  fontSize: '0.6875rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  border: '1px solid #A7F3D0',
                }}
              >
                <ShieldCheck size={12} color="#059669" />
                <span>Verified Staff · {profileData.staffId}</span>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)', margin: '0.35rem 0 0', fontWeight: 500 }}>
                {profileData.role} · {profileData.societyName}
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
              <span>Edit Staff Details</span>
            </button>
          </div>

          {/* Gate Pass QR Card */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
              padding: '1.5rem',
              boxShadow: '0 2px 10px rgba(8, 59, 86, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--aarizo-navy, #083B56)' }}>
              <QrCode size={18} />
              <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 800 }}>Gate Entry QR Pass</h3>
            </div>
            <div style={{ background: '#ffffff', padding: '10px', borderRadius: '12px', border: '1px solid #DCE8EF' }}>
              <QRCodeSVG
                value={`AARIZO:STAFF:${profileData.staffId}:${profileData.name}:${profileData.phone}`}
                size={140}
                level="M"
              />
            </div>
            <p style={{ margin: 0, fontSize: '0.72rem', color: '#657785' }}>
              Show this QR code at Security Gate #1 for fast hands-free check-in.
            </p>
          </div>
        </div>

        {/* Right Column (7 cols on desktop): Shift & Contact Details */}
        <div className="md:col-span-7 space-y-4">
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
              padding: '1.25rem',
              boxShadow: '0 2px 10px rgba(8, 59, 86, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)' }}>
              Contact &amp; Work Hours
            </h3>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ width: 36, height: 36, borderRadius: '10px', background: '#EAF6FC', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#176B91', flexShrink: 0 }}>
                <Phone size={17} />
              </div>
              <div>
                <span style={{ fontSize: '0.6875rem', color: '#657785', fontWeight: 600 }}>Mobile Number</span>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--aarizo-navy, #083B56)' }}>
                  +91 {profileData.phone}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ width: 36, height: 36, borderRadius: '10px', background: '#EAF6FC', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#176B91', flexShrink: 0 }}>
                <Clock size={17} />
              </div>
              <div>
                <span style={{ fontSize: '0.6875rem', color: '#657785', fontWeight: 600 }}>Standard Working Hours</span>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--aarizo-navy, #083B56)' }}>
                  {profileData.shift}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ width: 36, height: 36, borderRadius: '10px', background: '#EAF6FC', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#176B91', flexShrink: 0 }}>
                <Building2 size={17} />
              </div>
              <div>
                <span style={{ fontSize: '0.6875rem', color: '#657785', fontWeight: 600 }}>Registered Society</span>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--aarizo-navy, #083B56)' }}>
                  {profileData.societyName}
                </div>
              </div>
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
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Profile Edit Modal */}
      {isEditModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(8, 59, 86, 0.6)', backdropFilter: 'blur(3px)' }} onClick={() => setIsEditModalOpen(false)} />
          <div style={{ position: 'relative', background: '#ffffff', borderRadius: '20px', width: '100%', maxWidth: '440px', padding: '1.5rem', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)' }}>
                Edit Details
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
                {saveStatus === 'SAVING' ? 'Saving Updates...' : saveStatus === 'SUCCESS' ? 'Saved Successfully!' : 'Save Details'}
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
              Update Profile Photo
            </h3>
            <FileUploader
              label="Select or Snap Profile Photo"
              accept="image/*"
              maxSizeMB={5}
              entityType="general"
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
