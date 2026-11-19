import os
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, HRFlowable
)

def create_credentials_pdf(output_path):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    styles = getSampleStyleSheet()
    
    # Custom Brand Styles
    brand_primary = colors.HexColor('#083B56')
    brand_coral = colors.HexColor('#F06543')
    brand_bg = colors.HexColor('#F8FAFC')
    border_color = colors.HexColor('#CBD5E1')
    text_dark = colors.HexColor('#0F172A')
    text_muted = colors.HexColor('#475569')

    header_style = ParagraphStyle(
        'DocHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=24,
        textColor=brand_primary,
        alignment=0,
    )

    sub_header_style = ParagraphStyle(
        'DocSubHeader',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=brand_coral,
        alignment=0,
    )

    h2_style = ParagraphStyle(
        'H2Style',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=brand_primary,
        spaceAfter=6,
    )

    body_style = ParagraphStyle(
        'Body',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12,
        textColor=text_dark,
    )

    body_bold = ParagraphStyle(
        'BodyBold',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=12,
        textColor=text_dark,
    )

    body_muted = ParagraphStyle(
        'BodyMuted',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=7.5,
        leading=10.5,
        textColor=text_muted,
    )

    code_style = ParagraphStyle(
        'CodeStyle',
        parent=styles['Normal'],
        fontName='Courier-Bold',
        fontSize=8.5,
        leading=11,
        textColor=brand_primary,
    )

    table_th = ParagraphStyle(
        'TableTH',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=11,
        textColor=colors.white,
    )

    story = []

    # Title & Header
    story.append(Paragraph("DWELLORA COMMUNITY OS", sub_header_style))
    story.append(Spacer(1, 2))
    story.append(Paragraph("Multi-Portal Demo Accounts & Credentials Guide", header_style))
    story.append(Paragraph("Complete testing personas and verified credentials for all 7 residential community portals.", body_muted))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=1.5, color=brand_coral, spaceAfter=10))

    # Quick Access Overview Box
    quick_info = [
        [
            Paragraph("<b>Universal Demo Password:</b>", body_style),
            Paragraph("<font color='#F06543'><b>dwellora@2026</b></font> (Applies to all accounts)", body_style),
            Paragraph("<b>Live Web URL:</b>", body_style),
            Paragraph("<font color='#083B56'><u>https://safegate-chi.vercel.app/login</u></font>", body_style)
        ],
        [
            Paragraph("<b>Android APK:</b>", body_style),
            Paragraph("<b>Dwellora.apk</b> (11.4 MB · Production Enabled)", body_style),
            Paragraph("<b>GitHub Repo:</b>", body_style),
            Paragraph("<b>SafeGate</b> (Sarveshk-2006/SafeGate)", body_style)
        ]
    ]

    info_table = Table(quick_info, colWidths=[130, 160, 95, 140])
    info_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), brand_bg),
        ('BOX', (0,0), (-1,-1), 1, border_color),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(info_table)
    story.append(Spacer(1, 14))

    # Section 1: Master Credentials Table
    story.append(Paragraph("1. Canonical Demo Credentials Table", h2_style))
    story.append(Paragraph("Enter the primary email and universal password below, or tap the demo drawer on the login screen.", body_muted))
    story.append(Spacer(1, 6))

    headers = [
        Paragraph("Role & Portal", table_th),
        Paragraph("Persona & Unit", table_th),
        Paragraph("Primary Demo Email", table_th),
        Paragraph("Password", table_th),
        Paragraph("Portal Route", table_th),
    ]

    accounts = [
        [
            Paragraph("<b>Resident</b><br/><font color='#657785'>Owner Portal</font>", body_style),
            Paragraph("<b>Sarvesh Kulkarni</b><br/>Tower B · Flat 1204", body_style),
            Paragraph("<b>resident@dwellora.com</b><br/><font color='#657785'>sarvesh@greenvalley.com</font>", body_style),
            Paragraph("dwellora@2026", code_style),
            Paragraph("<b>/resident</b>", code_style),
        ],
        [
            Paragraph("<b>Secretary</b><br/><font color='#657785'>Admin Portal</font>", body_style),
            Paragraph("<b>Mayuri Udar</b><br/>Block A · Flat 101", body_style),
            Paragraph("<b>secretary@dwellora.com</b><br/><font color='#657785'>secretary@greenvalley.com</font>", body_style),
            Paragraph("dwellora@2026", code_style),
            Paragraph("<b>/admin</b>", code_style),
        ],
        [
            Paragraph("<b>Security Guard</b><br/><font color='#657785'>Terminal Portal</font>", body_style),
            Paragraph("<b>Officer R. Singh</b><br/>Main Gate #1 Terminal", body_style),
            Paragraph("<b>guard@dwellora.com</b><br/><font color='#657785'>guard1@greenvalley.com</font>", body_style),
            Paragraph("dwellora@2026", code_style),
            Paragraph("<b>/security</b>", code_style),
        ],
        [
            Paragraph("<b>Committee</b><br/><font color='#657785'>Board Portal</font>", body_style),
            Paragraph("<b>Rajesh Mehta</b><br/>Tower A · Flat 201", body_style),
            Paragraph("<b>committee@dwellora.com</b><br/><font color='#657785'>rajesh.committee@greenvalley.com</font>", body_style),
            Paragraph("dwellora@2026", code_style),
            Paragraph("<b>/committee</b>", code_style),
        ],
        [
            Paragraph("<b>Facility Manager</b><br/><font color='#657785'>Operations Portal</font>", body_style),
            Paragraph("<b>Suresh Patil</b><br/>Office Block", body_style),
            Paragraph("<b>facility@dwellora.com</b><br/><font color='#657785'>facility@greenvalley.com</font>", body_style),
            Paragraph("dwellora@2026", code_style),
            Paragraph("<b>/facility</b>", code_style),
        ],
        [
            Paragraph("<b>Vendor Partner</b><br/><font color='#657785'>Service Portal</font>", body_style),
            Paragraph("<b>Priya Cleaning Services</b><br/>Verified Partner", body_style),
            Paragraph("<b>vendor@dwellora.com</b><br/><font color='#657785'>priya.vendor@greenvalley.com</font>", body_style),
            Paragraph("dwellora@2026", code_style),
            Paragraph("<b>/vendor</b>", code_style),
        ],
        [
            Paragraph("<b>Super Admin</b><br/><font color='#657785'>Platform Admin</font>", body_style),
            Paragraph("<b>Platform Admin</b><br/>Enterprise Platform", body_style),
            Paragraph("<b>admin@dwellora.com</b><br/><font color='#657785'>superadmin@dwellora.com</font>", body_style),
            Paragraph("dwellora@2026", code_style),
            Paragraph("<b>/super-admin</b>", code_style),
        ],
    ]

    table_data = [headers] + accounts
    creds_table = Table(table_data, colWidths=[95, 110, 165, 85, 70])
    creds_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), brand_primary),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('BOX', (0,0), (-1,-1), 1, border_color),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, brand_bg]),
    ]))
    story.append(creds_table)
    story.append(Spacer(1, 14))

    # Section 2: Role Responsibilities & Primary Modules
    story.append(Paragraph("2. Role Capabilities & Portal Workflows", h2_style))

    roles_summary = [
        [
            Paragraph("<b>1. Resident Portal (/resident)</b>", body_bold),
            Paragraph("Pre-approved visitor passes, child safety departure authorization & exit alerts, domestic helper passcodes, bill payments (maintenance & utilities), and society notices.", body_style)
        ],
        [
            Paragraph("<b>2. Secretary Portal (/admin)</b>", body_bold),
            Paragraph("Society resident roster, flat occupancy allocations, official email invitations, committee voting, financial collections, guard shift schedules, and broadcast announcements.", body_style)
        ],
        [
            Paragraph("<b>3. Security Guard Portal (/security)</b>", body_bold),
            Paragraph("Main gate visitor verification, 6-digit gate code validator, QR scanner, walk-in registration, child safety departure checkpoint verification, and emergency SOS lockdown.", body_style)
        ],
        [
            Paragraph("<b>4. Committee Portal (/committee)</b>", body_bold),
            Paragraph("Society resolution governance, capital expenditure approvals, meeting minutes, vendor contract approvals, and financial health audits.", body_style)
        ],
        [
            Paragraph("<b>5. Facility Portal (/facility)</b>", body_bold),
            Paragraph("Infrastructure maintenance tickets, plumbing/electrical work orders, elevator AMC logs, clubhouse bookings, and diesel generator fuel tracking.", body_style)
        ],
        [
            Paragraph("<b>6. Vendor Portal (/vendor)</b>", body_bold),
            Paragraph("Service staff daily entry passes, contractual billing invoices, assigned work orders, and compliance document locker.", body_style)
        ],
        [
            Paragraph("<b>7. Super Admin (/super-admin)</b>", body_bold),
            Paragraph("Multi-society provisioning, enterprise platform audit logs, database connection telemetry, and tenant billing tiers.", body_style)
        ],
    ]

    roles_table = Table(roles_summary, colWidths=[150, 375])
    roles_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('LEFTPADDING', (0,0), (-1,-1), 4),
        ('RIGHTPADDING', (0,0), (-1,-1), 4),
        ('LINEBELOW', (0,0), (-1,-2), 0.5, colors.HexColor('#F1F5F9')),
    ]))
    story.append(roles_table)
    story.append(Spacer(1, 14))

    # Section 3: How to Test Instructions
    story.append(Paragraph("3. How to Test on Mobile & Web", h2_style))
    instructions_text = (
        "<b>• Instant Web Testing (Recommended):</b> Open <u>https://safegate-chi.vercel.app/login</u> in any mobile or desktop browser. "
        "Directly below the Sign In form, click <b>'Demo Role Accounts (Tap to test)'</b> to expand all 7 personas. "
        "Click <b>'Fill'</b> to populate credentials or <b>'Log In'</b> to jump directly into that role's dashboard.<br/>"
        "<b>• Installed Mobile APK:</b> Install <b>Dwellora.apk</b> (11.4 MB). The latest build connects directly to the live production server "
        "and includes automatic offline fallback authentication so logins never fail on mobile networks."
    )
    
    inst_box = Table([[Paragraph(instructions_text, body_style)]], colWidths=[525])
    inst_box.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), brand_bg),
        ('BOX', (0,0), (-1,-1), 1, brand_coral),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
    ]))
    story.append(inst_box)

    doc.build(story)
    print(f"PDF generated successfully at: {output_path}")

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'Dwellora_Demo_Accounts_and_Credentials.pdf'
    create_credentials_pdf(out)

