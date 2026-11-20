import * as Application from 'expo-application';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Updates from 'expo-updates';

import buildInfo from '@/constants/build-info.json';

/** Everything that says which copy of the app is running. */
export type AppVersionDetails = {
  /** The version in the stores, such as "1.0.0". */
  version: string | null;
  /** The store build number EAS gave the installed app, such as "23". */
  nativeBuild: string | null;
  /** The build-N tag of the code that is running (docs/beta-builds.md, "Which build is this?"). */
  build: number | null;
  /** The short commit id, shown when the code isn't on main and so has no build number. */
  commit: string | null;
  /** The over-the-air update that is running, or null for the code the app was built with. */
  updateId: string | null;
  updateCreatedAt: Date | null;
};

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * The lines shown at the foot of the opening screen, Find your club, sign-in
 * and home, such as "Version 1.0.0 (23) · Build 714" and, when an over-the-air
 * update is running, "Update 1a2b3c4d · 20 Nov 2026".
 */
export function describeAppVersion(details: AppVersionDetails): string[] {
  const first: string[] = [];
  if (details.version) {
    first.push(
      details.nativeBuild
        ? `Version ${details.version} (${details.nativeBuild})`
        : `Version ${details.version}`,
    );
  }
  if (details.build !== null) first.push(`Build ${details.build}`);
  else if (details.commit) first.push(`Commit ${details.commit}`);

  const lines = first.length > 0 ? [first.join(' · ')] : [];
  if (details.updateId) {
    const id = details.updateId.slice(0, 8);
    const when = details.updateCreatedAt;
    lines.push(
      when && !Number.isNaN(when.getTime())
        ? `Update ${id} · ${dateFormat.format(when)}`
        : `Update ${id}`,
    );
  }
  return lines;
}

/** Reads the details from the installed app, the running update and build-info.json. */
export function readAppVersion(): AppVersionDetails {
  // Expo Go reports its own version and build, not this app's.
  const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  const version = (inExpoGo ? null : Application.nativeApplicationVersion)
    ?? Constants.expoConfig?.version
    ?? null;
  const nativeBuild = inExpoGo ? null : (Application.nativeBuildVersion ?? null);
  // The code the app was built with has an update id too; only a downloaded update is shown.
  const runningUpdate = Updates.isEnabled && !Updates.isEmbeddedLaunch;
  return {
    version,
    nativeBuild,
    build: typeof buildInfo.build === 'number' ? buildInfo.build : null,
    commit: typeof buildInfo.commit === 'string' ? buildInfo.commit : null,
    updateId: runningUpdate ? (Updates.updateId ?? null) : null,
    updateCreatedAt: runningUpdate ? (Updates.createdAt ?? null) : null,
  };
}

/** The lines for the app that is running. */
export function appVersionLines(): string[] {
  return describeAppVersion(readAppVersion());
}
