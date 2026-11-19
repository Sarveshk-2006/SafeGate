import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import {
  ArrowRight,
  ChevronRight,
  ChevronLeft,
  Users,
  QrCode,
  Building,
  CreditCard,
  ShieldAlert,
  HeartHandshake,
  LogIn,
  KeyRound,
} from 'lucide-react';
import imgVisitorManagement from '../../../assets/images/onboarding_visitor_management.png';
import imgCommunityServices from '../../../assets/images/onboarding_community_services.png';
import imgFamilyHub from '../../../assets/images/onboarding_family_hub.png';
import '../auth.css';

interface FloatingBadge {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  iconBg: string;
  position: 'top-left' | 'bottom-right';
}

interface OnboardingSlide {
  id: number;
  eyebrow: string;
  titlePart1: string;
  titlePart2: string;
  subtitle: string;
  image: string;
  badges: FloatingBadge[];
}

const ONBOARDING_SLIDES: OnboardingSlide[] = [
  {
    id: 1,
    eyebrow: '01 / 03',
    titlePart1: 'Smart Visitor ',
    titlePart2: 'Management',
    subtitle:
      'Pre-approve visitors, track entry history, and manage guest access seamlessly. Keep your society secure with real-time visitor notifications and digital gate passes.',
    image: imgVisitorManagement,
    badges: [
      {
        icon: <Users size={16} color="#ffffff" />,
        title: 'Pre-approved Visitor',
        subtitle: 'Entry made easy',
        iconBg: '#F06543',
        position: 'top-left',
      },
      {
        icon: <QrCode size={16} color="#ffffff" />,
        title: 'Digital Gate Pass',
        subtitle: 'Secure & Contactless',
        iconBg: '#E5B842',
        position: 'bottom-right',
      },
    ],
  },
  {
    id: 2,
    eyebrow: '02 / 03',
    titlePart1: 'Community & Society ',
    titlePart2: 'Services',
    subtitle:
      'Connect with neighbors, view official society notices, book clubhouse amenities, and pay maintenance dues seamlessly.',
    image: imgCommunityServices,
    badges: [
      {
        icon: <Building size={16} color="#ffffff" />,
        title: 'Clubhouse Booking',
        subtitle: 'Amenities & Events',
        iconBg: '#083B56',
        position: 'top-left',
      },
      {
        icon: <CreditCard size={16} color="#ffffff" />,
        title: 'Instant Dues',
        subtitle: 'Zero Hassle Payments',
        iconBg: '#F06543',
        position: 'bottom-right',
      },
    ],
  },
  {
    id: 3,
    eyebrow: '03 / 03',
    titlePart1: 'Complete Family & ',
    titlePart2: 'Security Hub',
    subtitle:
      'Manage family profiles, registered vehicles, staff attendance, and one-tap emergency SOS broadcasts for complete peace of mind.',
    image: imgFamilyHub,
    badges: [
      {
        icon: <ShieldAlert size={16} color="#ffffff" />,
        title: '1-Tap Emergency SOS',
        subtitle: 'Instant Broadcast',
        iconBg: '#F06543',
        position: 'top-left',
      },
      {
        icon: <HeartHandshake size={16} color="#ffffff" />,
        title: 'Staff & Vehicle Sync',
        subtitle: '24/7 Gate Protection',
        iconBg: '#E5B842',
        position: 'bottom-right',
      },
    ],
  },
];

export const OnboardingFlow: React.FC = () => {
  const navigate = useNavigate();
  const { completeOnboarding } = useAuth();
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(0);
  const [isExiting, setIsExiting] = useState<boolean>(false);

  // Live Touch / Mouse Dragging States for Native-feel Horizontal Carousel
  const [dragOffset, setDragOffset] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const startX = useRef<number>(0);
  const startY = useRef<number>(0);

  const isLastSlide = currentSlideIndex === ONBOARDING_SLIDES.length - 1;

  const handleNavigateToLogin = () => {
    if (isExiting) return;
    setIsExiting(true);
    setTimeout(() => {
      completeOnboarding();
      navigate('/login');
    }, 200);
  };

  const handleNavigateToActivation = () => {
    if (isExiting) return;
    setIsExiting(true);
    setTimeout(() => {
      completeOnboarding();
      navigate('/activate');
    }, 200);
  };

  const handleNext = () => {
    if (isLastSlide) {
      handleNavigateToActivation();
    } else {
      setCurrentSlideIndex((prev) => Math.min(prev + 1, ONBOARDING_SLIDES.length - 1));
    }
  };

  const handlePrev = () => {
    setCurrentSlideIndex((prev) => Math.max(prev - 1, 0));
  };

  // Keyboard navigation: Left/Right arrows
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentSlideIndex]);

  // Touch Swipe Handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - startX.current;
    const deltaY = Math.abs(currentY - startY.current);

    if (Math.abs(deltaX) > deltaY) {
      setDragOffset(deltaX);
    }
  };

  const handleTouchEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);

    const threshold = 45;
    if (dragOffset < -threshold) {
      if (currentSlideIndex < ONBOARDING_SLIDES.length - 1) {
        setCurrentSlideIndex((prev) => prev + 1);
      }
    } else if (dragOffset > threshold) {
      if (currentSlideIndex > 0) {
        setCurrentSlideIndex((prev) => prev - 1);
      }
    }
    setDragOffset(0);
  };

  // Mouse Drag Handlers for Desktop
  const handleMouseDown = (e: React.MouseEvent) => {
    startX.current = e.clientX;
    startY.current = e.clientY;
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const deltaX = e.clientX - startX.current;
    setDragOffset(deltaX);
  };

  const handleMouseUp = () => {
    if (!isDragging) return;
    setIsDragging(false);

    const threshold = 45;
    if (dragOffset < -threshold) {
      if (currentSlideIndex < ONBOARDING_SLIDES.length - 1) {
        setCurrentSlideIndex((prev) => prev + 1);
      }
    } else if (dragOffset > threshold) {
      if (currentSlideIndex > 0) {
        setCurrentSlideIndex((prev) => prev - 1);
      }
    }
    setDragOffset(0);
  };

  return (
    <div
      className={`auth-container ${isExiting ? 'onboarding-exit' : ''}`}
      style={{
        background: '#FAF6F0',
        minHeight: '100dvh',
        height: '100dvh',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        fontFamily: 'Plus Jakarta Sans, system-ui, -apple-system, sans-serif',
        userSelect: isDragging ? 'none' : 'auto',
      }}
    >
      {/* ── Warm Organic Background Shapes ── */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: '100%',
          height: '240px',
          pointerEvents: 'none',
          zIndex: 0,
        }}
        viewBox="0 0 390 240"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M180 0C280 0 390 70 390 180V0H180Z"
          fill="#F5EBE0"
          fillOpacity="0.75"
        />
        <circle cx="340" cy="80" r="140" fill="#FFF3E8" fillOpacity="0.6" />
      </svg>

      <svg
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          height: '220px',
          pointerEvents: 'none',
          zIndex: 0,
        }}
        viewBox="0 0 390 220"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <circle cx="20" cy="200" r="150" fill="#F5EBE0" fillOpacity="0.6" />
        <path
          d="M0 120C80 120 160 170 180 220H0V120Z"
          fill="#FFF0E5"
          fillOpacity="0.8"
        />
      </svg>

      {/* ── Top Header Bar ── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'calc(1.25rem + env(safe-area-inset-top, 0px)) 1.25rem 0.5rem',
          zIndex: 20,
          position: 'relative',
        }}
      >
        {/* Brand Logo & Name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: '12px',
              background: '#000000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
              overflow: 'hidden',
            }}
          >
            <img
              src="/dwellora-symbol.png"
              alt="Dwellora"
              style={{
                width: 26,
                height: 26,
                objectFit: 'contain',
                display: 'block',
              }}
            />
          </div>
          <div>
            <div
              style={{
                fontSize: '1.125rem',
                fontWeight: 900,
                color: '#083B56',
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
              }}
            >
              Dwellora
            </div>
            <div
              style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: '#657785',
                letterSpacing: '-0.01em',
              }}
            >
              Secure Communities, Safer Living
            </div>
          </div>
        </div>

        {/* Top-Right Log In & Navigation Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn-auth-text"
            onClick={handleNavigateToLogin}
            aria-label="Log in to existing account"
            style={{
              background: '#ffffff',
              border: '1px solid #E2E8F0',
              borderRadius: '12px',
              fontWeight: 700,
              fontSize: '0.875rem',
              color: '#083B56',
              cursor: 'pointer',
              padding: '0.45rem 0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              boxShadow: '0 2px 6px rgba(8, 59, 86, 0.05)',
              minHeight: 38,
            }}
          >
            <LogIn size={15} color="#F06543" />
            <span>Log In</span>
          </button>

          {!isLastSlide && (
            <button
              type="button"
              className="btn-auth-text"
              onClick={handleNavigateToLogin}
              style={{
                background: 'none',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.875rem',
                color: '#657785',
                cursor: 'pointer',
                padding: '0.45rem 0.6rem',
                minHeight: 38,
              }}
            >
              Skip
            </button>
          )}
        </div>
      </header>

      {/* ── Main Slide Viewport Carousel Container ── */}
      <main
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          maxWidth: '440px',
          margin: '0 auto',
          width: '100%',
          overflow: 'hidden',
          boxSizing: 'border-box',
          position: 'relative',
          zIndex: 10,
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
      >
        {/* Desktop Prev / Next Navigation Arrows */}
        {currentSlideIndex > 0 && (
          <button
            type="button"
            onClick={handlePrev}
            aria-label="Previous slide"
            style={{
              position: 'absolute',
              left: 4,
              top: '38%',
              transform: 'translateY(-50%)',
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.9)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              border: '1px solid #E2E8F0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 30,
              color: '#083B56',
            }}
          >
            <ChevronLeft size={20} />
          </button>
        )}

        {!isLastSlide && (
          <button
            type="button"
            onClick={handleNext}
            aria-label="Next slide"
            style={{
              position: 'absolute',
              right: 4,
              top: '38%',
              transform: 'translateY(-50%)',
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.9)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              border: '1px solid #E2E8F0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 30,
              color: '#083B56',
            }}
          >
            <ChevronRight size={20} />
          </button>
        )}

        {/* Horizontal Track for Smooth Carousel Slide Transition */}
        <div
          style={{
            display: 'flex',
            width: `${ONBOARDING_SLIDES.length * 100}%`,
            transform: `translateX(calc(-${(currentSlideIndex * 100) / ONBOARDING_SLIDES.length}% + ${dragOffset}px))`,
            transition: isDragging
              ? 'none'
              : 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)',
            willChange: 'transform',
          }}
        >
          {ONBOARDING_SLIDES.map((slide) => (
            <div
              key={slide.id}
              style={{
                width: `${100 / ONBOARDING_SLIDES.length}%`,
                flexShrink: 0,
                padding: '0 1.25rem',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
              }}
            >
              {/* Image Container with Organic Background Pill Accent & Floating Glass Badges */}
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  maxWidth: '350px',
                  margin: '0 auto 1.25rem',
                  display: 'flex',
                  justifyContent: 'center',
                }}
              >
                {/* Red/Coral Peeking Accent Oval on the Left Side */}
                <div
                  style={{
                    position: 'absolute',
                    left: '-8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '32px',
                    height: '60px',
                    borderRadius: '20px',
                    background: '#F06543',
                    zIndex: 1,
                  }}
                  aria-hidden="true"
                />

                {/* Hero Image Container */}
                <div
                  style={{
                    position: 'relative',
                    width: '92%',
                    height: '260px',
                    borderRadius: '28px',
                    overflow: 'hidden',
                    boxShadow: '0 16px 36px rgba(8, 59, 86, 0.16)',
                    border: '1.5px solid rgba(255, 255, 255, 0.8)',
                    background: '#ffffff',
                    zIndex: 2,
                  }}
                >
                  <img
                    src={slide.image}
                    alt={`${slide.titlePart1}${slide.titlePart2}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />

                  {/* Floating Glassmorphic Overlay Badges */}
                  {slide.badges.map((badge, idx) => {
                    const isTopLeft = badge.position === 'top-left';
                    return (
                      <div
                        key={idx}
                        style={{
                          position: 'absolute',
                          top: isTopLeft ? '16px' : 'auto',
                          bottom: isTopLeft ? 'auto' : '16px',
                          left: isTopLeft ? '14px' : 'auto',
                          right: isTopLeft ? 'auto' : '14px',
                          background: 'rgba(255, 255, 255, 0.92)',
                          backdropFilter: 'blur(10px)',
                          WebkitBackdropFilter: 'blur(10px)',
                          borderRadius: '16px',
                          padding: '0.45rem 0.75rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.625rem',
                          boxShadow: '0 8px 20px rgba(0, 0, 0, 0.12)',
                          border: '1px solid rgba(255, 255, 255, 0.6)',
                          maxWidth: '220px',
                          zIndex: 10,
                        }}
                      >
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: '10px',
                            background: badge.iconBg,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            boxShadow: `0 3px 8px ${badge.iconBg}50`,
                          }}
                        >
                          {badge.icon}
                        </div>
                        <div style={{ textAlign: 'left' }}>
                          <div
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 800,
                              color: '#083B56',
                              lineHeight: 1.2,
                            }}
                          >
                            {badge.title}
                          </div>
                          <div
                            style={{
                              fontSize: '0.65rem',
                              fontWeight: 600,
                              color: '#657785',
                              lineHeight: 1.1,
                            }}
                          >
                            {badge.subtitle}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Eyebrow Numbering with Horizontal Accent Divider Line */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '0.4rem',
                }}
              >
                <span
                  style={{
                    fontSize: '0.8125rem',
                    fontWeight: 800,
                    letterSpacing: '0.04em',
                    color: '#F06543',
                  }}
                >
                  {slide.eyebrow}
                </span>
                <div
                  style={{
                    width: '36px',
                    height: '2px',
                    background:
                      'linear-gradient(90deg, #F06543 0%, rgba(240, 101, 67, 0) 100%)',
                    borderRadius: '1px',
                  }}
                  aria-hidden="true"
                />
              </div>

              {/* Two-Tone Colored Title */}
              <h2
                style={{
                  fontSize: '1.75rem',
                  fontWeight: 900,
                  margin: '0 0 0.5rem 0',
                  letterSpacing: '-0.03em',
                  lineHeight: 1.15,
                  textAlign: 'left',
                  width: '100%',
                  maxWidth: '340px',
                }}
              >
                <span style={{ color: '#083B56' }}>{slide.titlePart1}</span>
                <span style={{ color: '#F06543' }}>{slide.titlePart2}</span>
              </h2>

              {/* Description Paragraph */}
              <p
                style={{
                  fontSize: '0.875rem',
                  color: '#5C6F7E',
                  lineHeight: 1.5,
                  margin: 0,
                  maxWidth: '340px',
                  fontWeight: 500,
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                {slide.subtitle}
              </p>
            </div>
          ))}
        </div>
      </main>

      {/* ── Footer Bar: Left Pagination & Right Action Controls ── */}
      <footer
        style={{
          padding:
            '0.75rem 1.5rem calc(1.5rem + env(safe-area-inset-bottom, 0px))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          maxWidth: '440px',
          margin: '0 auto',
          width: '100%',
          boxSizing: 'border-box',
          zIndex: 20,
          position: 'relative',
        }}
      >
        {/* Pagination Indicators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          {ONBOARDING_SLIDES.map((_, idx) => {
            const isActive = idx === currentSlideIndex;
            return (
              <div
                key={idx}
                onClick={() => setCurrentSlideIndex(idx)}
                style={{
                  width: isActive ? 24 : 8,
                  height: 8,
                  borderRadius: 4,
                  background: isActive ? '#F06543' : '#DCE8EF',
                  transition: 'all 0.35s cubic-bezier(0.25, 1, 0.5, 1)',
                  cursor: 'pointer',
                }}
                role="button"
                tabIndex={0}
                aria-label={`Go to slide ${idx + 1}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setCurrentSlideIndex(idx);
                }}
              />
            );
          })}
        </div>

        {/* Action Button: Circular Coral Floating Button on Slides 1&2, Full CTA on Slide 3 */}
        {!isLastSlide ? (
          <button
            type="button"
            onClick={handleNext}
            aria-label="Next Slide"
            style={{
              width: 54,
              height: 54,
              borderRadius: '50%',
              background: '#F06543',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 8px 24px rgba(240, 101, 67, 0.4)',
              transition: 'all 0.2s ease',
            }}
          >
            <ArrowRight size={24} strokeWidth={2.8} />
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              onClick={handleNavigateToActivation}
              style={{
                padding: '0.85rem 1.25rem',
                minHeight: '48px',
                borderRadius: '16px',
                background: '#F06543',
                color: '#ffffff',
                fontSize: '0.9375rem',
                fontWeight: 800,
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                boxShadow: '0 8px 24px rgba(240, 101, 67, 0.4)',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <KeyRound size={18} strokeWidth={2.5} />
              <span>Activate</span>
            </button>
            <button
              type="button"
              onClick={handleNavigateToLogin}
              style={{
                padding: '0.85rem 1.25rem',
                minHeight: '48px',
                borderRadius: '16px',
                background: '#083B56',
                color: '#ffffff',
                fontSize: '0.9375rem',
                fontWeight: 800,
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                boxShadow: '0 8px 24px rgba(8, 59, 86, 0.3)',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <LogIn size={18} strokeWidth={2.5} />
              <span>Login</span>
            </button>
          </div>
        )}
      </footer>
    </div>
  );
};

export default OnboardingFlow;
