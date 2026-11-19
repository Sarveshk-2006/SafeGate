import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import {
  Building2,
  Phone,
  Mail,
  LogOut,
  ChevronRight,
  Bell,
  Shield,
  Camera,
  Edit3,
  FileText,
  X,
  ShieldCheck,
  BarChart3,
} from 'lucide-react';
import { FileUploader } from '../../../components/common/FileUploader';

interface AdminDocument {
  id: string;
  title: string;
  desc: string;
  url?: string;
  filename?: string;
  status: 'VERIFIED' | 'UNDER_REVIEW' | 'NOT_UPLOADED';
  updatedAt?: string;
}

export const AdminProfilePage: React.FC = () => {
  const { currentUser, logout, updateCurrentUser } = useAuth();
  const navigate = useNavigate();

  // Local state for profile details with fallback
  const [profileData, setProfileData] = useState({
    name: currentUser?.name || 'Society Secretary',
    phone: currentUser?.phone || '9820011223',
    email: currentUser?.email || 'secretary@greenvalley.com',
    designation: currentUser?.designation || 'Hon. Secretary',
    societyName: currentUser?.societyName || 'Green Valley Society',
    officeLocation: 'Admin Office · Wing A Ground Floor',
  });

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState(profileData);
  const [saveStatus, setSaveStatus] = useState<'IDLE' | 'SAVING' | 'SUCCESS'>('IDLE');

  // Avatar state
  const [avatarUrl, setAvatarUrl] = useState<string>(() => {
    return (typeof localStorage !== 'undefined' ? localStorage.getItem('aarizo_admin_avatar') : null) || currentUser?.avatarUrl || '';
  });
  const [isEditingAvatar, setIsEditingAvatar] = useState(false);

  // Secretary Verification Documents State
  const [docs, setDocs] = useState<AdminDocument[]>([
    {
      id: 'doc-admin-reg',
      title: 'Society Registration Certificate',
      desc: 'Certified registration certificate under Societies Registration Act / State MCS Act',
      status: 'VERIFIED',
      filename: 'society_registration_gvs_2024.pdf',
      updatedAt: '10 Jan 2024',
      url: '#',
    },
    {
      id: 'doc-admin-appointment',
      title: 'Secretary Election Resolution',
      desc: 'Annual General Body resolution certifying election of honorary secretary',
      status: 'VERIFIED',
      filename: 'agm_election_resolution_2025.pdf',
      updatedAt: '15 Sep 2025',
      url: '#',
    },
    {
      id: 'doc-admin-pan',
      title: 'Society PAN & Tax Exemption Certificate',
      desc: 'Permanent Account Number record and 80G/12A registration documents',
      status: 'VERIFIED',
      filename: 'society_pan_tax_card.pdf',
      updatedAt: '01 Apr 2024',
      url: '#',
    },
  ]);

  const [activeUploadDoc, setActiveUploadDoc] = useState<AdminDocument | null>(null);

  const handleAvatarUpload = (url: string) => {
    setAvatarUrl(url);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('aarizo_admin_avatar', url);
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
        designation: editForm.designation,
      });
      setSaveStatus('SUCCESS');
      setTimeout(() => {
        setSaveStatus('IDLE');
        setIsEditModalOpen(false);
      }, 800);
    }, 400);
  };

  const handleDocUploadSuccess = (url: string, filename: string) => {
    if (!activeUploadDoc) return;
    const updated = docs.map((d) =>
      d.id === activeUploadDoc.id
        ? {
            ...d,
            url,
            filename,
            status: 'UNDER_REVIEW' as const,
            updatedAt: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          }
        : d
    );
    setDocs(updated);
    setActiveUploadDoc(null);
  };

  const menuItems = [
    { label: 'Admin Notification Settings', icon: Bell, path: '/notifications' },
    { label: 'Society Analytics & Health', icon: BarChart3, path: '/admin/intelligence' },
    { label: 'Audit Logs & Governance', icon: ShieldCheck, path: '/admin/audit-logs' },
    { label: 'Staff & Security Rosters', icon: Shield, path: '/admin/staff' },
  ];

  return (
    <div
      style={{ backgroundColor: 'var(--aarizo-page, #F7FBFE)', minHeight: '100%' }}
      className="p-3 sm:p-6 max-w-5xl mx-auto pb-24 font-sans text-slate-800"
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Left Column (5 cols on desktop): Profile & Personal Details */}
        <div className="md:col-span-5 space-y-4">
          {/* Admin Profile Header Card */}
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
                  background: '#EAF6FC',
                  color: '#083B56',
                  fontSize: '0.6875rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  border: '1px solid #DCE8EF',
                }}
              >
                <ShieldCheck size={12} color="#083B56" />
                <span>{profileData.designation}</span>
              </div>
              <p
                style={{
                  margin: '0.35rem 0 0',
                  fontSize: '0.75rem',
                  color: 'var(--aarizo-text-secondary, #657785)',
                  fontWeight: 500,
                }}
              >
                {profileData.societyName}
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
              <span>Edit Secretary Profile</span>
            </button>
          </div>

          {/* Secretary Details List */}
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
            <h3
              style={{
                margin: 0,
                fontSize: '0.8125rem',
                fontWeight: 800,
                color: 'var(--aarizo-navy, #083B56)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Official Contact & Office
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
                <Phone size={17} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '0.6875rem', color: '#657785', fontWeight: 600 }}>Official Phone</span>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--aarizo-navy, #083B56)' }}>
                  +91 {profileData.phone}
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
                <Mail size={17} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '0.6875rem', color: '#657785', fontWeight: 600 }}>Official Email</span>
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
                <Building2 size={17} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '0.6875rem', color: '#657785', fontWeight: 600 }}>Society Office Location</span>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--aarizo-navy, #083B56)' }}>
                  {profileData.officeLocation}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (7 cols on desktop): Documents & Settings */}
        <div className="md:col-span-7 space-y-4">
          {/* Statutory Documents Locker */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
              padding: '1.25rem',
              boxShadow: '0 2px 10px rgba(8, 59, 86, 0.05)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={18} color="#083B56" />
                <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)' }}>
                  Statutory & Society Records
                </h3>
              </div>
              <span style={{ fontSize: '0.6875rem', color: '#059669', background: '#ECFDF5', border: '1px solid #A7F3D0', padding: '0.15rem 0.5rem', borderRadius: '8px', fontWeight: 700 }}>
                Executive Verified
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {docs.map((doc) => (
                <div
                  key={doc.id}
                  style={{
                    background: 'var(--aarizo-pale-blue, #F4FAFE)',
                    border: '1px solid var(--aarizo-border, #DCE8EF)',
                    borderRadius: '14px',
                    padding: '0.875rem 1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, fontSize: '0.84375rem', color: 'var(--aarizo-navy, #083B56)' }}>
                        {doc.title}
                      </span>
                      <span
                        style={{
                          fontSize: '0.625rem',
                          fontWeight: 800,
                          padding: '0.1rem 0.45rem',
                          borderRadius: '6px',
                          background: doc.status === 'VERIFIED' ? '#ECFDF5' : '#FFFBEB',
                          color: doc.status === 'VERIFIED' ? '#059669' : '#D97706',
                          border: `1px solid ${doc.status === 'VERIFIED' ? '#A7F3D0' : '#FDE68A'}`,
                        }}
                      >
                        {doc.status}
                      </span>
                    </div>
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.71875rem', color: '#657785' }}>
                      {doc.desc}
                    </p>
                    {doc.filename && (
                      <div style={{ marginTop: '0.25rem', fontSize: '0.6875rem', color: 'var(--aarizo-blue, #176B91)', fontWeight: 600 }}>
                        {doc.filename} · Updated {doc.updatedAt}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveUploadDoc(doc)}
                    style={{
                      padding: '0.45rem 0.75rem',
                      borderRadius: '10px',
                      background: '#ffffff',
                      border: '1px solid var(--aarizo-border, #DCE8EF)',
                      color: 'var(--aarizo-navy, #083B56)',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    Replace
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Management Links */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
              overflow: 'hidden',
              boxShadow: '0 2px 10px rgba(8, 59, 86, 0.05)',
            }}
          >
            {menuItems.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => navigate(item.path)}
                  style={{
                    width: '100%',
                    padding: '0.95rem 1.15rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'none',
                    border: 'none',
                    borderBottom: index < menuItems.length - 1 ? '1px solid var(--aarizo-border-soft, #E8F1F5)' : 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: '10px',
                        background: 'var(--aarizo-light-blue, #EAF6FC)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--aarizo-navy, #083B56)',
                      }}
                    >
                      <Icon size={17} />
                    </div>
                    <span style={{ fontSize: '0.84375rem', fontWeight: 700, color: 'var(--aarizo-navy, #083B56)' }}>
                      {item.label}
                    </span>
                  </div>
                  <ChevronRight size={17} color="#8B9AA5" />
                </button>
              );
            })}
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
            <span>Sign Out of Secretary Portal</span>
          </button>
        </div>
      </div>

      {/* Profile Edit Modal */}
      {isEditModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(8, 59, 86, 0.6)', backdropFilter: 'blur(3px)' }} onClick={() => setIsEditModalOpen(false)} />
          <div
            style={{
              position: 'relative',
              background: '#ffffff',
              borderRadius: '20px',
              width: '100%',
              maxWidth: '460px',
              padding: '1.5rem',
              boxShadow: '0 8px 32px rgba(8, 59, 86, 0.2)',
              zIndex: 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)' }}>
                Edit Secretary Details
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

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#657785', marginBottom: '0.25rem' }}>Designation Title</label>
                <input
                  type="text"
                  value={editForm.designation}
                  onChange={(e) => setEditForm({ ...editForm, designation: e.target.value })}
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
                  gap: '0.5rem',
                }}
              >
                {saveStatus === 'SAVING' ? 'Saving Updates...' : saveStatus === 'SUCCESS' ? 'Saved Successfully!' : 'Save Profile Changes'}
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

      {/* Document Upload Modal */}
      {activeUploadDoc && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(8, 59, 86, 0.6)', backdropFilter: 'blur(3px)' }} onClick={() => setActiveUploadDoc(null)} />
          <div style={{ position: 'relative', background: '#ffffff', borderRadius: '20px', width: '100%', maxWidth: '440px', padding: '1.5rem', zIndex: 1 }}>
            <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.05rem', fontWeight: 800, color: 'var(--aarizo-navy, #083B56)' }}>
              Upload {activeUploadDoc.title}
            </h3>
            <p style={{ margin: '0 0 1rem', fontSize: '0.75rem', color: '#657785' }}>
              Upload verified government PDF or high-resolution document scan.
            </p>
            <FileUploader
              label={`Upload ${activeUploadDoc.title}`}
              accept="application/pdf,image/*"
              maxSizeMB={15}
              entityType="admin"
              onUploadSuccess={(res) => handleDocUploadSuccess(res.downloadUrl, res.name || 'admin_document.pdf')}
            />
            <button
              type="button"
              onClick={() => setActiveUploadDoc(null)}
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
