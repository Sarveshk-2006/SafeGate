import React, { useState } from 'react';
import { ChevronRight, AlertCircle, X, Clock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export function getPortalGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// ─────────────────────────────────────────────────────────────
// 1. Unified Greeting Banner (Pale Sky Blue #EAF6FC)
// ─────────────────────────────────────────────────────────────
export interface PortalGreetingBannerProps {
  userName?: string;
  roleBadge: string;
  roleBadgeBg?: string;
  roleBadgeColor?: string;
  contextSubtitle?: string;
  rightAction?: React.ReactNode;
}

export const PortalGreetingBanner: React.FC<PortalGreetingBannerProps> = ({
  userName = 'Officer',
  roleBadge,
  roleBadgeBg = '#EAF6FC',
  roleBadgeColor = '#176B91',
  contextSubtitle,
  rightAction,
}) => {
  return (
    <div
      style={{
        background: 'var(--aarizo-light-blue, #EAF6FC)',
        borderBottom: '1px solid var(--aarizo-border, #DCE8EF)',
        padding: '1.25rem 1rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '0.75rem',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <p
            style={{
              color: 'var(--aarizo-text-secondary, #657785)',
              fontSize: '0.75rem',
              margin: 0,
              fontWeight: 500,
            }}
          >
            {getPortalGreeting()},
          </p>
          <span
            style={{
              fontSize: '0.625rem',
              fontWeight: 800,
              padding: '0.125rem 0.5rem',
              borderRadius: '9999px',
              background: roleBadgeBg,
              color: roleBadgeColor,
              border: `1px solid ${roleBadgeColor}33`,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {roleBadge}
          </span>
        </div>
        <h1
          style={{
            color: 'var(--aarizo-navy, #083B56)',
            fontWeight: 800,
            fontSize: '1.375rem',
            lineHeight: 1.2,
            margin: '0.125rem 0 0.25rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {userName}
        </h1>
        {contextSubtitle && (
          <p
            style={{
              color: 'var(--aarizo-text-muted, #8B9AA5)',
              fontSize: '0.6875rem',
              margin: 0,
              fontWeight: 500,
            }}
          >
            {contextSubtitle}
          </p>
        )}
      </div>

      {rightAction && <div style={{ flexShrink: 0 }}>{rightAction}</div>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// 2. Unified Urgent Alert Banner
// ─────────────────────────────────────────────────────────────
export interface PortalUrgentAlertProps {
  title: string;
  message: string;
  onDismiss?: () => void;
  actionLabel?: string;
  onAction?: () => void;
}

export const PortalUrgentAlertBanner: React.FC<PortalUrgentAlertProps> = ({
  title,
  message,
  onDismiss,
  actionLabel,
  onAction,
}) => {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      style={{
        margin: '0.75rem 1rem 0',
        background: 'var(--aarizo-warning-bg, #FFF8E8)',
        border: '1px solid #fce3b8',
        borderLeft: '4px solid var(--aarizo-warning, #D99A2B)',
        borderRadius: '16px',
        padding: '0.875rem 1rem',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.625rem',
      }}
    >
      <AlertCircle
        size={18}
        style={{ color: 'var(--aarizo-warning, #D99A2B)', flexShrink: 0, marginTop: 1 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '0.8125rem', color: 'var(--aarizo-navy, #083B56)' }}>
          {title}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--aarizo-text-secondary, #657785)', marginTop: '0.125rem' }}>
          {message}
        </div>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            style={{
              marginTop: '0.375rem',
              fontSize: '0.72rem',
              fontWeight: 700,
              color: 'var(--aarizo-navy, #083B56)',
              background: '#ffffff',
              border: '1px solid #fce3b8',
              borderRadius: '8px',
              padding: '0.2rem 0.5rem',
              cursor: 'pointer',
            }}
          >
            {actionLabel}
          </button>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            onDismiss();
          }}
          style={{
            color: 'var(--aarizo-text-muted, #8B9AA5)',
            background: 'none',
            border: 'none',
            padding: '0.25rem',
            cursor: 'pointer',
          }}
          aria-label="Dismiss alert"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// 3. Unified Hero Action Cards
// ─────────────────────────────────────────────────────────────
export interface HeroActionItem {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon | React.ElementType;
  iconColor?: string;
  gradient: string;
  textColor?: string;
  subtextColor?: string;
  borderColor?: string;
  boxShadow?: string;
  onClick: () => void;
}

export const PortalHeroActionCards: React.FC<{ items: HeroActionItem[] }> = ({ items }) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))`,
        gap: '0.75rem',
      }}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            className="card-elevate"
            style={{
              padding: '0.85rem 1rem',
              borderRadius: '16px',
              background: item.gradient,
              color: item.textColor || '#ffffff',
              border: item.borderColor ? `1px solid ${item.borderColor}` : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
              textAlign: 'left',
              boxShadow: item.boxShadow || '0 4px 14px rgba(8, 59, 86, 0.12)',
              width: '100%',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.18)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Icon size={20} color={item.iconColor || '#E5B842'} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: '0.8125rem',
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {item.title}
              </div>
              <div
                style={{
                  fontSize: '0.6875rem',
                  color: item.subtextColor || 'rgba(255, 255, 255, 0.8)',
                  marginTop: '2px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {item.subtitle}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// 4. Unified Quick Actions Grid (Screenshot matched)
// ─────────────────────────────────────────────────────────────
export interface QuickActionGridItem {
  id: string;
  label: string;
  icon: LucideIcon | React.ElementType;
  path?: string;
  color: string;
  bg: string;
  badge?: string;
  onClick?: () => void;
}

export const PortalQuickActionsGrid: React.FC<{
  title?: string;
  subtitle?: string;
  items: QuickActionGridItem[];
}> = ({ title = 'Quick Actions', subtitle, items }) => {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.625rem' }}>
        <h2
          style={{
            fontWeight: 800,
            fontSize: '0.8125rem',
            color: 'var(--aarizo-navy, #083B56)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            margin: 0,
          }}
        >
          {title}
        </h2>
        {subtitle && (
          <span style={{ fontSize: '0.6875rem', color: 'var(--aarizo-text-secondary, #657785)', fontWeight: 600 }}>
            {subtitle}
          </span>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(95px, 1fr))',
          gap: '0.625rem',
        }}
      >
        {items.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              onClick={action.onClick}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '1rem 0.5rem',
                borderRadius: '16px',
                background: '#ffffff',
                border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
                cursor: 'pointer',
                minHeight: 88,
                boxShadow: '0 2px 8px rgba(8, 59, 86, 0.04)',
                position: 'relative',
                width: '100%',
              }}
              aria-label={action.label}
            >
              {action.badge && (
                <span
                  style={{
                    position: 'absolute',
                    top: '6px',
                    right: '6px',
                    background: '#DC2626',
                    color: '#ffffff',
                    fontSize: '0.5625rem',
                    fontWeight: 800,
                    borderRadius: '9999px',
                    padding: '1px 5px',
                  }}
                >
                  {action.badge}
                </span>
              )}
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: '12px',
                  background: action.bg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon size={20} style={{ color: action.color }} />
              </div>
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: 'var(--aarizo-text, #203746)',
                  textAlign: 'center',
                  lineHeight: 1.2,
                }}
              >
                {action.label}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};

// ─────────────────────────────────────────────────────────────
// 5. Unified Live Status Badges
// ─────────────────────────────────────────────────────────────
export type StatusSeverity = 'good' | 'normal' | 'warning' | 'alert';

export interface StatusBadgeItem {
  label: string;
  icon: LucideIcon | React.ElementType;
  status: StatusSeverity;
  statusText: string;
}

const STATUS_SEVERITY_MAP: Record<StatusSeverity, { bg: string; text: string; dot: string }> = {
  good: { bg: '#EDF8F0', text: '#3F8F58', dot: '#3F8F58' },
  normal: { bg: '#EAF6FC', text: '#176B91', dot: '#83CBEA' },
  warning: { bg: '#FFF8E8', text: '#D99A2B', dot: '#D99A2B' },
  alert: { bg: '#FFF0F1', text: '#D9535B', dot: '#D9535B' },
};

export const PortalStatusBadges: React.FC<{
  title?: string;
  items: StatusBadgeItem[];
}> = ({ title = 'Operational Status', items }) => {
  return (
    <section>
      <h2
        style={{
          fontWeight: 800,
          fontSize: '0.8125rem',
          color: 'var(--aarizo-navy, #083B56)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: '0.625rem',
        }}
      >
        {title}
      </h2>
      <div className="scroll-x" style={{ paddingBottom: '0.25rem', display: 'flex', gap: '0.625rem', overflowX: 'auto' }}>
        {items.map((item) => {
          const Icon = item.icon;
          const colors = STATUS_SEVERITY_MAP[item.status] || STATUS_SEVERITY_MAP.normal;
          return (
            <div
              key={item.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.375rem',
                padding: '0.75rem 0.875rem',
                borderRadius: '14px',
                background: '#ffffff',
                border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
                minWidth: 88,
                flexShrink: 0,
                boxShadow: '0 2px 8px rgba(8, 59, 86, 0.04)',
              }}
            >
              <Icon size={20} style={{ color: colors.text }} />
              <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--aarizo-text-secondary, #657785)' }}>
                {item.label}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors.dot, flexShrink: 0 }} />
                <span style={{ fontSize: '0.625rem', color: colors.text, fontWeight: 700 }}>
                  {item.statusText}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

// ─────────────────────────────────────────────────────────────
// 6. Unified Action Required List
// ─────────────────────────────────────────────────────────────
export interface ActionRequiredItem {
  id: string | number;
  label: string;
  subtitle?: string;
  urgent?: boolean;
  onClick: () => void;
}

export const PortalActionRequiredList: React.FC<{
  title?: string;
  items: ActionRequiredItem[];
}> = ({ title = 'Action Required', items }) => {
  if (!items || items.length === 0) return null;

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.625rem' }}>
        <h2
          style={{
            fontWeight: 800,
            fontSize: '0.8125rem',
            color: 'var(--aarizo-navy, #083B56)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            margin: 0,
          }}
        >
          {title}
        </h2>
        <span
          style={{
            background: 'var(--aarizo-warning-bg, #FFF8E8)',
            color: 'var(--aarizo-warning, #D99A2B)',
            border: '1px solid #fce3b8',
            borderRadius: '9999px',
            padding: '1px 7px',
            fontSize: '0.6875rem',
            fontWeight: 800,
          }}
        >
          {items.length} Pending
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {items.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={action.onClick}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.875rem 1rem',
              borderRadius: '16px',
              background: '#ffffff',
              border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              minHeight: 52,
              boxShadow: '0 2px 6px rgba(8, 59, 86, 0.04)',
            }}
            aria-label={action.label}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: action.urgent ? 'var(--aarizo-warning, #D99A2B)' : 'var(--aarizo-blue, #176B91)',
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.84375rem', fontWeight: 600, color: 'var(--aarizo-text, #203746)' }}>
                {action.label}
              </div>
              {action.subtitle && (
                <div style={{ fontSize: '0.6875rem', color: 'var(--aarizo-text-secondary, #657785)', marginTop: 1 }}>
                  {action.subtitle}
                </div>
              )}
            </div>
            <ChevronRight size={16} style={{ color: 'var(--aarizo-text-muted, #8B9AA5)', flexShrink: 0 }} />
          </button>
        ))}
      </div>
    </section>
  );
};

// ─────────────────────────────────────────────────────────────
// 7. Unified Activity Stream
// ─────────────────────────────────────────────────────────────
export interface ActivityItem {
  id: string | number;
  text: string;
  subtext?: string;
  time: string;
  icon: LucideIcon | React.ElementType;
  color?: string;
  bg?: string;
}

export const PortalActivityList: React.FC<{
  title?: string;
  items: ActivityItem[];
  onSeeAll?: () => void;
}> = ({ title = 'Recent Activity', items, onSeeAll }) => {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.625rem' }}>
        <h2
          style={{
            fontWeight: 800,
            fontSize: '0.8125rem',
            color: 'var(--aarizo-navy, #083B56)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            margin: 0,
          }}
        >
          {title}
        </h2>
        {onSeeAll && (
          <button
            type="button"
            onClick={onSeeAll}
            style={{
              fontSize: '0.75rem',
              color: 'var(--aarizo-blue, #176B91)',
              fontWeight: 700,
              background: 'none',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              cursor: 'pointer',
            }}
          >
            See all <ChevronRight size={12} />
          </button>
        )}
      </div>

      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          border: '1px solid var(--aarizo-border-soft, #E8F1F5)',
          overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(8, 59, 86, 0.04)',
        }}
      >
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                padding: '0.875rem 1rem',
                borderBottom:
                  index < items.length - 1 ? '1px solid var(--aarizo-border-soft, #E8F1F5)' : 'none',
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  background: item.bg || 'var(--aarizo-light-blue, #EAF6FC)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon size={16} style={{ color: item.color || '#176B91' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontSize: '0.8125rem',
                    color: 'var(--aarizo-text, #203746)',
                    lineHeight: 1.4,
                    margin: 0,
                    fontWeight: 600,
                  }}
                >
                  {item.text}
                </p>
                {item.subtext && (
                  <p style={{ fontSize: '0.6875rem', color: '#657785', margin: '2px 0 0' }}>
                    {item.subtext}
                  </p>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.25rem' }}>
                  <Clock size={11} style={{ color: 'var(--aarizo-text-muted, #8B9AA5)' }} />
                  <span style={{ fontSize: '0.6875rem', color: 'var(--aarizo-text-muted, #8B9AA5)' }}>
                    {item.time}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

