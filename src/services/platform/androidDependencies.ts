// src/services/platform/androidDependencies.ts
// DI factory for Android-specific AutoPilot dependencies

import { AndroidScheduler } from './androidScheduler';
import { AndroidSecurityService } from './androidSecurityService';
import { AndroidArchiveService } from './androidArchiveService';

export interface AutoPilotDependencies {
  scheduler: AndroidScheduler;
  security: AndroidSecurityService;
  archive: AndroidArchiveService;
}

export async function createAndroidDependencies(): Promise<AutoPilotDependencies> {
  const security = AndroidSecurityService.getInstance();
  await security.initialize();

  const scheduler = new AndroidScheduler();
  const archive = new AndroidArchiveService();

  return { scheduler, security, archive };
}
