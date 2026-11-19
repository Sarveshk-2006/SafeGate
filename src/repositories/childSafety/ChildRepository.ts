import type { FirestoreDataConverter, QueryDocumentSnapshot, SnapshotOptions } from 'firebase/firestore';
import { BaseRepository } from '../BaseRepository';
import type { ChildProfile } from '../../types/childSafety';

/**
 * @deprecated Legacy Firestore Child Safety repository (Phase B.2.3 Phase 3).
 * Authoritative Child Safety data is now stored exclusively in PostgreSQL and accessed
 * via `childSafetyService` (`src/services/childSafetyService.ts`).
 * Retained temporarily for type/export compatibility only until Phase 7 retirement.
 * Do NOT invoke `create` / `update` / `delete` on this repository for Child Safety workflows.
 */
export class ChildRepository extends BaseRepository<ChildProfile> {
  constructor() {
    super('children');
  }

  protected getConverter(): FirestoreDataConverter<ChildProfile> {
    return {
      toFirestore(child: ChildProfile): any {
        const { id, ...data } = child;
        return data;
      },
      fromFirestore(snapshot: QueryDocumentSnapshot, options: SnapshotOptions): ChildProfile {
        const data = snapshot.data(options);
        return {
          id: snapshot.id,
          societyId: data.societyId || '',
          flatNumber: data.flatNumber || '',
          fullName: data.fullName || '',
          dateOfBirth: data.dateOfBirth || '',
          gender: data.gender || 'MALE',
          photoUrl: data.photoUrl,
          medicalNotes: data.medicalNotes,
          status: data.status || 'SAFE',
          guardians: data.guardians || [],
          emergencyContacts: data.emergencyContacts || [],
          authorizedPickups: data.authorizedPickups || [],
          createdAt: data.createdAt || new Date().toISOString(),
          updatedAt: data.updatedAt || new Date().toISOString(),
        } as ChildProfile;
      }
    };
  }
}

export const childRepository = new ChildRepository();
