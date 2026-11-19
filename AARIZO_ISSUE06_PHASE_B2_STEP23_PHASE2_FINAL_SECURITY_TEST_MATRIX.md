# AARIZO — ISSUE-06 | Phase B.2.3 | Phase 2 Final Security Test Matrix

**Date:** 2026-11-18  
**Test Suites:** `tests/issue06_b23_realtime_sse.test.ts` (40 tests) & `tests/issue06_b23_auth_realtime_lifecycle.test.ts` (4 tests)  
**Total Phase 2 Tests:** **44 passed, 0 failed**

---

## 1. `F-P2-01A` — Canonical Emergency & Topic Classification Matrix

| Topic / Input | Canonical Classification | `BroadcastChannel` Result | `LOCAL_PUBLISH` Result | Authenticated Fetch `SSE` Result | Verified Test |
| --- | --- | --- | --- | --- | --- |
| `FIRE_EMERGENCY` | `UNKNOWN` (`isEmergency: false`, `isProtected: true`) | Blocked (0 subscribers, 0 alerts, 0 audio, 0 haptics) | Local subscriber only; 0 alerts/audio/haptics, 0 network POST | Subscriber only; **0 alerts, 0 audio, 0 haptics** | `tests/issue06_b23_realtime_sse.test.ts` §6 & §9 |
| `EMERGENCY` (bare) | `UNKNOWN` (`isEmergency: false`, `isProtected: true`) | Blocked (0 side effects) | Local subscriber only; 0 alerts/audio/haptics, 0 network POST | Subscriber only; **0 alerts, 0 audio, 0 haptics** | `tests/issue06_b23_realtime_sse.test.ts` §6 & §9 |
| `EMERGENCY_ALERT` | `EMERGENCY` (`isEmergency: true`, `isProtected: true`) | Blocked (0 subscribers, 0 alerts, 0 audio, 0 haptics) | Local subscriber only; 0 alerts/audio/haptics, 0 network POST | Full emergency alert (`urgency: 'emergency'`, `/emergency`), sawtooth siren, `'heavy'` haptic | `tests/issue06_b23_realtime_sse.test.ts` §6 & §9 |
| `EMERGENCY_INCIDENT_CREATED` | `EMERGENCY` (`isEmergency: true`, `isProtected: true`) | Blocked (0 side effects) | Local subscriber only; 0 alerts/audio/haptics, 0 network POST | Full emergency alert (`urgency: 'emergency'`, `/emergency`), sawtooth siren, `'heavy'` haptic | `tests/issue06_b23_realtime_sse.test.ts` §6 & §9 |
| `CHILD_SAFETY_SOS_TRIGGERED` | `CHILD_EMERGENCY` (`isEmergency: true`, `isProtected: true`) | Blocked (0 side effects) | Local subscriber only; 0 alerts/audio/haptics, 0 network POST | Full child SOS alert (`urgency: 'emergency'`, role-aware `/security/child-safety`), sawtooth siren, `'heavy'` haptic | `tests/issue06_b23_realtime_sse.test.ts` §4, §6, §9 |
| `SECURITY_ALERT_CREATED` | `SECURITY_ALERT` (`isEmergency: false`, `isProtected: true`) | Blocked (0 side effects) | Local subscriber only; 0 alerts/audio/haptics, 0 network POST | Security alert (`urgency: 'alert'`, `/emergency`), alert chime (not siren), `'medium'` haptic | `tests/issue06_b23_realtime_sse.test.ts` §6 & §9 |
| `UNKNOWN_CUSTOM_EVENT` / `UNKNOWN_FUTURE_TOPIC` | `UNKNOWN` (`isEmergency: false`, `isProtected: true`) | Blocked (0 side effects) | Local subscriber only; 0 alerts/audio/haptics, 0 network POST | Subscriber only; **0 alerts, 0 audio, 0 haptics** | `tests/issue06_b23_realtime_sse.test.ts` §6 & §9 |
| `""`, `"   "`, `null`, `123`, `"BAD TOPIC!!"`, `"LINE\nBREAK"` | `UNKNOWN` (`normalizedTopic: ""`, `isProtected: true`) | Blocked (0 side effects) | Dropped before dispatch | Dropped before dispatch (**0 subscribers, 0 alerts, 0 audio, 0 haptics**) | `tests/issue06_b23_realtime_sse.test.ts` §6 & §9 |

---

## 2. `F-P2-01B` — Zero `BroadcastChannel` Domain-Event Relay Matrix

| # | Behavioral Security Requirement (STEP 4) | Suite & Test Case | Observable Assertions Verified | Status |
| :---: | --- | --- | --- | :---: |
| 1 | No domain event can enter through `BroadcastChannel` | `issue06_b23_realtime_sse.test.ts` §6 (`blocks ALL inbound BroadcastChannel domain events...`) | 29 forged topics + null/string/numeric payloads posted by external `MockBroadcastChannel` produce `0` subscriber deliveries, `0` alerts, `0` haptics, unchanged `lastEventId` | **PASS** |
| 2 | No domain event can leave through `BroadcastChannel` | `issue06_b23_realtime_sse.test.ts` §6 (`blocks ALL outbound BroadcastChannel forwarding...`) | `tabA.publish()` across 23 sensitive/unknown topics + `ANNOUNCEMENT_CREATED` produces `0` observed `BroadcastChannel` messages and `0` deliveries to `tabB` | **PASS** |
| 3 | Forged emergency topics cannot trigger emergency UI effects | `issue06_b23_realtime_sse.test.ts` §9 (`forged/unsupported topics...`, `identical canonical emergency...`) | Asserts `0` alert toasts, `0` `AudioContext` sawtooth oscillators, `0` `triggerHaptic('heavy')` calls | **PASS** |
| 4 | Sensitive visitor, gate, resident & financial events cannot be relayed | `issue06_b23_realtime_sse.test.ts` §6 | Explicitly tests `VISITOR_ARRIVAL/APPROVAL/ENTRY/EXIT`, `DELIVERY_STATUS`, `WORKER_ENTRY_EXIT`, `QR_SCAN`, `PARKING_GATE_TRIGGERED`, `PAYMENT_COMPLETED/STATUS`, `OFFLINE_PAYMENT_LOGGED`, `GUEST_STAY_BOOKED`, `NOTIFICATIONS`, `CHILD_*`, `RESIDENT_PRIVATE_*` (0 BroadcastChannel + 0 `/api/realtime/broadcast` POST) | **PASS** |
| 5 | Platform-admin session cannot relay/accept domain events through `BroadcastChannel` | `issue06_b23_realtime_sse.test.ts` §6 (`platform-admin session CANNOT relay or accept...`) | `role: 'admin'`, `societyId: 'soc-platform'` receives `0` BroadcastChannel messages while receiving legitimate authenticated SSE normally | **PASS** |
| 6 | Forged `societyId`, `userId`, and `role` do not authorize messages | `issue06_b23_realtime_sse.test.ts` §6 & `issue06_b23_auth_realtime_lifecycle.test.ts` | Forged messages carrying exact active user's `societyId`, `userId`, and `role` are completely ignored | **PASS** |
| 7 | Unknown and malformed messages fail closed | `issue06_b23_realtime_sse.test.ts` §6 & §9 | Empty, whitespace, numeric, null, non-object, punctuation/newline, and unknown topics fail closed | **PASS** |
| 8 | Coordination messages (N/A — `BroadcastChannel` completely removed) | `issue06_b23_realtime_sse.test.ts` §6 & `issue06_b23_auth_realtime_lifecycle.test.ts` | `RealtimeService` opens `0` `BroadcastChannel` instances across entire lifecycle; cross-tab auth sync remains via `AuthContext` `storage` listener | **PASS** |
| 9 | Authenticated SSE still delivers legitimate domain events | `issue06_b23_realtime_sse.test.ts` §2, §4, §6, §9 | Verified `VISITOR_ARRIVAL`, `CHILD_SAFETY_SOS_TRIGGERED`, `CHILD_GATE_PASS_GENERATED`, `EMERGENCY_ALERT`, `EMERGENCY_INCIDENT_CREATED`, `SECURITY_ALERT_CREATED`, `ANNOUNCEMENT_CREATED` over SSE | **PASS** |
| 10 | Logout, invalidation, user switch & destruction clean up state | `issue06_b23_realtime_sse.test.ts` §2, §6, §8 & `issue06_b23_auth_realtime_lifecycle.test.ts` (all 4 tests) | `0` open channels, SSE `AbortSignal.aborted === true` synchronously before `clearAuthSession()`, late events rejected | **PASS** |
| 11 | Existing SSE reconnection, retry & far-future `Retry-After` cap intact | `issue06_b23_realtime_sse.test.ts` §3, §7, §8, §9 | `401`/`403`/`400`/`404`/`408`/`429`/`503`/`204`/wrong `Content-Type`, HTTP-date + year-2099 60s cap, backoff reset & cancellation all pass | **PASS** |
| 12 | Existing parser, `Last-Event-ID` replay & session-generation protections intact | `issue06_b23_realtime_sse.test.ts` §1, §5, §8 | BOM/CR/UTF-8/EOF discard/empty `id:`/NUL `id:`/subscriber exception isolation & replay recovery/same-token society & role switches/Strict Mode all pass | **PASS** |

