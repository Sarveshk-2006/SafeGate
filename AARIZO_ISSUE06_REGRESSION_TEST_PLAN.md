# AARIZO — ISSUE-06 Regression Test Plan

**Target**: ISSUE-06 — Tri-Tier State Desynchronization (LocalStorage vs PostgreSQL vs Firestore / BaseRepository)  
**Priority**: P1 (High Severity — Data Integrity & Cross-Device Operational Blocker)  
**Mode**: TEST SPECIFICATION — STRICT AUDIT PHASE  
**Date**: 2026-11-17  
**Workspace**: `D:\AAZIRA\AARIZO`  

---

## 1. Regression Test Strategy Overview

The regression test plan for ISSUE-06 is designed to verify that:
1. The **split-brain condition** between browser `localStorage`, generic `entityRecord`, and relational PostgreSQL tables is completely eliminated.
2. Cross-device workflows (Resident -> Gate Guard -> Secretary -> Super Admin) synchronize authoritatively through the backend API.
3. Server-Sent Events (SSE) invalidate and rehydrate client caches reliably.
4. Schema translation between frontend `SmartVisitorPass` / `ChildProfile` and backend Prisma models functions without HTTP 500 errors.
5. All 242 existing repository tests across 15 test suites continue to pass without regression.

---

## 2. Test Matrix: Scenarios & Acceptance Criteria

| Test ID | Domain | Test Scenario | Inputs / Action | Expected Result | Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-06-01** | Visitor Passes | Multi-Client Pass Creation & Discovery | Client A creates pass via `visitorService.createVisitorPass`. Client B calls `visitorService.fetchPasses`. | Pass created in PostgreSQL `visitor_passes` table; Client B retrieves the exact pass with matching `passCode`. | Client B sees Client A's pass without sharing `localStorage`. |
| **TC-06-02** | Visitor Passes | Guard Check-In State Reflection | Guard checks in visitor on Client B via `visitorService.checkInVisitor`. Client A receives `VISITOR_ENTRY` event. | Status in PostgreSQL updates to `CHECKED_IN`; `checkInTime` populated; Client A cache updates to `INSIDE`. | Resident portal reflects `INSIDE` status in real-time. |
| **TC-06-03** | Visitor Passes | Schema Field Mapping & Prisma Compatibility | Post frontend `SmartVisitorPass` object (`visitorPhone`, `category`, `validUntil`) to `POST /api/visitor-passes`. | Backend transforms fields to `phone`, `passType`, `validTo`; returns HTTP 201 Created. | Zero Prisma `Unknown argument` errors or HTTP 500 responses. |
| **TC-06-04** | Child Safety | Parent QR Pass -> Guard Gate Verification | Parent creates pickup QR via `childSafetyService.generatePickupQR`. Guard verifies via `verifyAndScanChildPickup`. | Pass saved in PostgreSQL `child_pickup_passes`; Guard verification queries live API and returns `allowed: true`. | Guard scanner authorizes pickup without relying on Guard's local storage. |
| **TC-06-05** | Child Safety | Emergency Missing Child Exit Blockade | Parent flags child as `MISSING`. Guard attempts to scan pickup QR code at gate. | Child status updates in DB; Guard verification returns `allowed: false` with `CRITICAL SAFETY ALERT`. | Unauthorized exit blocked immediately across all gate terminals. |
| **TC-06-06** | Provisioning | Secretary Provisioning Cross-Portal Sync | Secretary creates society, tower, flat, and resident via `societyService`. | All records created in canonical tables (`societies`, `towers`, `flats`, `residents`); relational integrity preserved. | Super Admin and Resident see newly provisioned entities in PostgreSQL. |
| **TC-06-07** | Error Handling | Elimination of Silent Failure (`.catch`) | Simulate database disconnection or invalid payload during `createVisitorPass`. | Service rejects promise or returns structured error; local cache does not falsely show successful persistence. | No silent `.catch(() => {})` swallowing errors. |
| **TC-06-08** | Realtime SSE | Cache Rehydration on Event | Fire mock SSE event `VISITOR_ARRIVAL` into client event subscriber. | Client invokes `fetchPasses()`, retrieves latest passes from API, updates `localStorage` and React state. | Cache updated from network payload, not re-read from stale local storage. |
| **TC-06-09** | Offline Mode | Graceful Offline Fallback | Network offline: client attempts to read passes or validate code. | Service returns cached passes from `localStorage`; validation warns about offline status. | Application does not crash; UI shows offline indicator. |
| **TC-06-10** | Regression | Full Repository Test Suite | Execute complete test runner (`npm test`). | All existing 242 tests across 15 test suites pass. | 100% pass rate maintained across all previously closed issues. |

---

## 3. Automated Test Suite Specification

When entering the implementation phase, an automated test suite will be created at:  
`tests/issue06_state_synchronization.test.ts`

### 3.1 Test Suite Structure

```typescript
describe('ISSUE-06: Tri-Tier State Desynchronization Remediation', () => {
  describe('1. Relational API Persistence & Schema Normalization', () => {
    test('POST /api/visitor-passes maps frontend SmartVisitorPass fields to Prisma schema', async () => { ... });
    test('PATCH /api/visitor-passes/:id updates status and timestamps in PostgreSQL', async () => { ... });
    test('POST /api/visitor-passes/verify authoritatively validates pass code against database', async () => { ... });
    test('POST /api/towers persists towers to relational database', async () => { ... });
  });

  describe('2. Multi-Client Synchronization & Cache Invalidation', () => {
    test('visitorService.createVisitorPass persists to API and updates local cache', async () => { ... });
    test('Client B fetches passes created by Client A without shared localStorage', async () => { ... });
    test('Guard check-in propagates status to resident subscriber', async () => { ... });
    test('Incoming SSE event triggers network fetch and updates local cache', async () => { ... });
  });

  describe('3. Child Safety Gate Verification', () => {
    test('Parent pickup QR pass is verifiable by gate scanner on separate client', async () => { ... });
    test('Missing child status blocks gate exit across all clients', async () => { ... });
  });

  describe('4. Error Handling & Offline Fallback', () => {
    test('Network failures reject or return explicit error state without corrupting cache', async () => { ... });
    test('Offline mode safely serves cached data with offline flag', async () => { ... });
    test('Elimination of unhandled or swallowed .catch(() => {}) promises', async () => { ... });
  });
});
```

---

## 4. Execution Commands & Verification Protocol

### Command 1: Focused State Synchronization Test Run
```powershell
npm test -- tests/issue06_state_synchronization.test.ts
```
*Expected*: All tests pass cleanly with zero warnings or unhandled rejections.

### Command 2: Full Repository Regression Run
```powershell
npm test
```
*Expected*: 16 test suites (15 existing + 1 new), >= 255 tests passing, 0 failing.

### Command 3: Build & Bundle Integrity Verification
```powershell
npm run build
```
*Expected*: Clean compilation with Vite and TypeScript; zero type errors.

---

## 5. Exit Criteria & Readiness Sign-Off

The remediation for ISSUE-06 will be considered fully verified only when:
1. `tests/issue06_state_synchronization.test.ts` passes 100%.
2. All 242 existing repository tests continue to pass.
3. Multi-client simulation confirms that Client A's creations appear on Client B.
4. Gate scanner validates passes against the central PostgreSQL database.
5. TypeScript build completes without any type errors.

