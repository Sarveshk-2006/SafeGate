# AARIZO — ISSUE-06 — PHASE B.2 — STEP 2.3 — PHASE 4.6.7
# FINAL INDEPENDENT CHILD SAFETY SYSTEM VERIFICATION & SECURITY CLOSURE
## DELIVERABLE 3: CROSS-PORTAL LIFECYCLE VALIDATION & DOMAIN BOUNDARY REPORT

---

## 1. Executive Summary

This report documents the end-to-end verification of the **14 core cross-portal lifecycle workflows** across the three client interfaces (Resident Safety Portal, Security Command Hub / Child Gate Scanner, and Society Admin Child Safety Desk) and their underlying backend services and PostgreSQL persistence.

In addition, this report explicitly audits the domain boundaries between Child Safety and other core AARIZO domains, with particular emphasis on **General Emergency Incidents** (`MEDICAL`, `FIRE`, `SECURITY`, `LIFT`, `ELECTRICAL`) and responder dispatch.

---

## 2. End-to-End Cross-Portal Lifecycle Matrix (14 Workflows)

```mermaid
sequenceDiagram
    autonumber
    actor Resident as Resident Portal
    actor Guard as Security Gate Scanner
    actor Admin as Admin Safety Desk
    participant API as Backend Child Safety Engine
    participant DB as PostgreSQL Database
    participant SSE as Authenticated SSE Bus

    Note over Resident,DB: Phase 1: Child Profile & Escort Registration
    Resident->>API: POST /api/children (Name, Age, Emergency Contact)
    API->>DB: INSERT INTO child_profiles (society_id, ...)
    API->>SSE: Emit CHILD_SAFETY_PROFILE_CREATED
    SSE-->>Admin: Realtime UI Refresh (Debounced 50ms)

    Resident->>API: POST /api/children/:id/escorts (Authorized Escort)
    API->>DB: INSERT INTO child_escorts (...)
    API->>SSE: Emit CHILD_SAFETY_ESCORT_ADDED
    SSE-->>Admin: Realtime UI Refresh

    Note over Resident,Guard: Phase 2: Gate Pass Issuance & Perimeter Verification
    Resident->>API: POST /api/children/passes (childId, escortId, validHours)
    API->>DB: INSERT INTO child_gate_passes (token_hash, pass_code, status='ACTIVE')
    API-->>Resident: Return plaintext Bearer Token (once) & Pass Code (CGP-XXXXXX)
    API->>SSE: Emit CHILD_SAFETY_PASS_ISSUED
    SSE-->>Guard: Scanner Cache Invalidation
    SSE-->>Admin: Pass Log Table Refresh

    Guard->>API: POST /api/children/passes/verify (Bearer Token, GateId)
    API->>DB: BEGIN TX; Lock Child; CAS currentUses=1; status='EXHAUSTED'
    API->>DB: INSERT INTO child_exit_logs (result='ALLOWED', ...)
    API->>DB: COMMIT TX
    API-->>Guard: 200 ALLOWED (Child Name, Photo, Escort Name)
    API->>SSE: Emit CHILD_SAFETY_PASS_VERIFIED & CHILD_SAFETY_EXIT_RECORDED
    SSE-->>Resident: Instant Exit Push Notification & Pass Marked 'EXHAUSTED'
    SSE-->>Admin: Live Exit Log Appended

    Note over Resident,Admin: Phase 3: Child SOS & Resolution Workflow
    Resident->>API: POST /api/children/sos (childId, location, reason)
    API->>DB: BEGIN TX; INSERT INTO child_safety_alerts (status='ACTIVE')
    API->>DB: INSERT INTO emergency_incidents (category='SECURITY', subtype='CHILD_SOS')
    API->>DB: COMMIT TX
    API->>SSE: Emit CHILD_SAFETY_SOS_TRIGGERED & EMERGENCY_INCIDENT_CREATED
    SSE-->>Guard: SafetyCommandHub Urgent Alert Banner + Web Audio Siren
    SSE-->>Admin: AdminChildSafetyPage Urgent Red Alert Banner

    Guard->>API: POST /api/children/alerts/:id/acknowledge
    API->>DB: UPDATE child_safety_alerts SET status='ACKNOWLEDGED', acknowledged_by=guardId
    API->>SSE: Emit CHILD_SAFETY_ALERT_ACKNOWLEDGED
    SSE-->>Guard: Siren Muted
    SSE-->>Admin: Alert Status Updated to ACKNOWLEDGED

    Admin->>API: POST /api/children/alerts/:id/resolve (resolutionNotes, status='RESOLVED')
    API->>DB: UPDATE child_safety_alerts SET status='RESOLVED', resolution_notes=...
    API->>SSE: Emit CHILD_SAFETY_ALERT_RESOLVED
    SSE-->>Resident: Alert Cleared
    SSE-->>Guard: Alert Banner Removed
    SSE-->>Admin: Resolution Logged in History Tab
```

### Detailed Lifecycle Step Trace:
1. **Child Profile Creation:** Resident registers child profile. Backend validates age (0–17), enforces tenant society ID from JWT, inserts record with `status: 'SAFE'`. Admin desk receives `CHILD_SAFETY_PROFILE_CREATED` via SSE and updates child table.
2. **Profile Archival (Soft Delete):** Resident archives child. Database updates `archived_at` timestamp. Historical exit logs and pass records are preserved via `onDelete: Restrict`.
3. **Escort Registration:** Resident attaches trusted escort with photo URL, phone, relationship, and government ID type.
4. **Escort Revocation:** Resident revokes escort. Pass generation with revoked escort fails closed with `422 ESCORT_REVOKED`.
5. **Pass Generation:** Resident requests single-use exit pass. Backend generates 256-bit CSPRNG token, computes HMAC-SHA256, stores hash in `token_hash`, and returns plaintext token to resident.
6. **Pass Expiration Window:** Backend enforces `validUntil <= validFrom + 24 hours`. Expired pass verification attempts fail closed with `422 PASS_EXPIRED`.
7. **Perimeter Verification Attempt (Allowed):** Security guard scans QR code. Backend transaction verifies child is `SAFE`, pass is `ACTIVE`, and compares hashes with timing-safe comparison. Updates `currentUses: 1`, marks `status: 'EXHAUSTED'`.
8. **Exit Log Append:** Append-only row inserted into `child_exit_logs` with guard ID, gate ID, child ID, escort ID, and timestamp.
9. **Replay Rejection (Denied):** Subsequent scan of the same pass finds `status === 'EXHAUSTED'`, records audit row with `result: 'DENIED_EXHAUSTED'`, and returns `422 PASS_ALREADY_USED`.
10. **Display Code Fail-Closed Rejection:** If guard inputs `CGP-123456` reference code, scanner rejects locally or backend rejects with `400 BEARER_TOKEN_REQUIRED`. Display code cannot authorize exit.
11. **Resident Child SOS Trigger:** Resident triggers SOS from mobile app. Backend atomically creates `ChildSafetyAlert` and `EmergencyIncident`. Realtime broadcasts alert to guards and admins.
12. **Command Hub Audio Siren:** `SafetyCommandHub.tsx` triggers Web Audio synthesizer alert tone. Guards receive visible flashing banner and audio prompt.
13. **Security Alert Acknowledgment:** Guard acknowledges alert. Siren silences immediately. Database updates `acknowledged_at` and `acknowledged_by`.
14. **Admin Alert Resolution:** Society Admin or Secretary opens resolution modal, inputs mandatory investigation notes, and selects resolution status (`RESOLVED` or `FALSE_ALARM`). All connected clients reflect resolution instantly.

---

## 3. Domain Boundary & Isolation Verification

### 3.1 General Emergency Incident Isolation
- **Coexistence:** The Child Safety SOS workflow interacts with the broader `EmergencyIncident` domain by creating a cross-referenced emergency incident record with `category: 'SECURITY'` and `subtype: 'CHILD_SOS'`.
- **Preservation of General Emergency Handlers:** General emergency categories (`MEDICAL`, `FIRE`, `SECURITY`, `LIFT`, `ELECTRICAL`) in [`src/domains/safety/components/SafetyCommandHub.tsx`](file:///d:/AAZIRA/AARIZO/src/domains/safety/components/SafetyCommandHub.tsx) operate completely unimpeded.
- **Responder Assignment:** Dispatching security responders, recording emergency actions, and general emergency resolution flows continue to execute without regression or interference from Child Safety events.

### 3.2 Visitor Management Boundary
- Child Gate Passes (`child_gate_passes`) and Visitor Gate Passes (`visitor_passes`) utilize separate database tables, distinct token signing keys, and dedicated API routes (`/api/children/passes` vs `/api/visitors/passes`).
- Scanning a visitor pass in the Child Gate Scanner fails closed (`400 INVALID_PASS_TYPE`).

### 3.3 Broadcast & Community Notice Isolation
- General community notices and polls have zero access to the child safety event stream.
- Protected child safety topics cannot be published from frontend clients via generic notice broadcast routes.

---

## 4. Cross-Portal Verification Verdict: **PASS**
All 14 lifecycle steps and domain boundaries are fully functional, properly decoupled, and securely enforced.
