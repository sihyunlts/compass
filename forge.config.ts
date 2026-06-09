import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

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
    asar: true,
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
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerDMG({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
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
