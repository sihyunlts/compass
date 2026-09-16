import path from 'node:path';
import { rename, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { version } from './package.json';

const RELEASE_VERSION = `v${version}`;
const ARTIFACT_NAME = `Compass-${RELEASE_VERSION}`;
const NATIVE_MODULE_BUILD_PATH = '/native/macos/build/Release';

const isNativeModulePackagePath = (filePath: string): boolean =>
  NATIVE_MODULE_BUILD_PATH.startsWith(filePath)
  || (
    filePath.startsWith(`${NATIVE_MODULE_BUILD_PATH}/`)
    && filePath.endsWith('.node')
  );

const buildNativeModules = (args: string[] = []): void => {
  execFileSync(
    process.execPath,
    ['scripts/build-native-modules.mjs', ...args],
    { stdio: 'inherit' },
  );
};

const PRESET_DOCUMENT_TYPES = [
  {
    kind: 'device',
    name: 'Compass Device',
    extension: 'compassdevice',
    identifier: 'com.sihyunlights.compass.device',
  },
  {
    kind: 'group',
    name: 'Compass Group',
    extension: 'compassgroup',
    identifier: 'com.sihyunlights.compass.group',
  },
  {
    kind: 'rack',
    name: 'Compass Rack',
    extension: 'compassrack',
    identifier: 'com.sihyunlights.compass.rack',
  },
] as const;

const config: ForgeConfig = {
  packagerConfig: {
    ignore: (filePath) =>
      !filePath.startsWith('/.vite')
      && !isNativeModulePackagePath(filePath),
    asar: {
      unpack: '*.node',
    },
    extendInfo: {
      CFBundleDocumentTypes: PRESET_DOCUMENT_TYPES.map((type) => ({
        CFBundleTypeExtensions: [type.extension],
        CFBundleTypeName: type.name,
        CFBundleTypeRole: 'Editor',
        LSHandlerRank: 'Owner',
        LSItemContentTypes: [type.identifier],
      })),
      UTExportedTypeDeclarations: PRESET_DOCUMENT_TYPES.map((type) => ({
        UTTypeConformsTo: ['public.json'],
        UTTypeDescription: type.name,
        UTTypeIdentifier: type.identifier,
        UTTypeTagSpecification: {
          'public.filename-extension': [type.extension],
          'public.mime-type': [`application/vnd.compass.${type.kind}+json`],
        },
      })),
    },
    icon: 'assets/compass',
  },
  makers: [
    new MakerSquirrel({
      setupExe: `${ARTIFACT_NAME}-Setup.exe`,
      setupIcon: 'assets/compass.ico',
      authors: 'sihyunlights',
      owners: 'sihyunlights',
      iconUrl: 'https://raw.githubusercontent.com/sihyunlts/compass/master/assets/compass.ico',
    }),
    new MakerZIP({}, ['darwin', 'linux']),
    new MakerDMG({
      name: ARTIFACT_NAME,
      icon: 'assets/compass.icns',
      background: 'assets/dmg-background.png',
      contents: (opts) => [
        {
          x: 260,
          y: 349,
          type: 'file',
          path: opts.appPath,
        },
        {
          x: 398,
          y: 349,
          type: 'link',
          path: '/Applications',
        },
      ],
    }, ['darwin']),
    new MakerRpm({
      options: {
        icon: 'assets/compass.png',
        categories: ['AudioVideo'],
      },
    }),
    new MakerDeb({
      options: {
        icon: 'assets/compass.png',
        categories: ['AudioVideo'],
      },
    }),
  ],
  hooks: {
    preStart: async () => {
      if (process.platform === 'darwin') {
        buildNativeModules();
      }
    },
    packageAfterCopy: async (
      _forgeConfig,
      buildPath,
      _electronVersion,
      platform,
      arch,
    ) => {
      if (platform === 'darwin') {
        buildNativeModules([
          '--arch',
          arch,
          '--output-root',
          buildPath,
        ]);
      }
    },
    postMake: async (_forgeConfig, makeResults) => Promise.all(makeResults.map(async (result) => {
      result.artifacts = await Promise.all(result.artifacts.map(async (artifact) => {
        const extension = path.extname(artifact);
        if (!['.dmg', '.zip', '.exe', '.deb', '.rpm'].includes(extension)) {
          return artifact;
        }

        const suffix = result.platform === 'linux'
          ? `-linux-${result.arch}${extension}`
          : extension === '.exe'
            ? `-${result.arch}-Setup.exe`
            : `-${result.arch}${extension}`;
        const nextArtifact = path.join(
          path.dirname(artifact),
          `${ARTIFACT_NAME}${suffix}`,
        );
        if (nextArtifact === artifact) {
          return artifact;
        }

        await rm(nextArtifact, { force: true });
        await rename(artifact, nextArtifact);
        return nextArtifact;
      }));
      return result;
    })),
  },
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
