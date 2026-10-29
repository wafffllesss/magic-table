# Windows Defender investigation: v0.0.6

Investigated on 2026-10-28. Defender engine: `1.1.26100.4`; signatures: `1.463.8.0`.

## Reproduction

| Sample | Result |
| --- | --- |
| Published v0.0.5 EXE | Custom scan found no threats |
| Published v0.0.6 EXE | Real-time protection detected `Trojan:Script/Conteban.A!ml` on download, without launching the application |
| v0.0.6 source rebuilt locally: renderer, unpacked Electron runtime and app.asar | Custom scans found no threats |
| Same local rebuild as a portable EXE | Custom scan found no threats |
| Same unpacked runtime in a ZIP | Custom scan found no threats |

Published v0.0.5 SHA-256, verified locally against GitHub's asset digest:
`bc5c0e816b148df02a4b46218e1cf5dce5f3228b757932d12935fe0f4065e945`.

Published v0.0.6 SHA-256 reported by GitHub's asset metadata (and verified locally during the follow-up below):
`e7a43e782be905720c3c5ae3179394967ef4d4685771905092ad7ef25c0a7c56`.
During the initial investigation, Defender blocked access before a local hash or extraction could be performed. No quarantine restore or protection exclusions were used.

The local portable v0.0.6 rebuild had SHA-256
`c2a4b34bcc2a941eafee92311c53d8751c908ae5f04c5ca46db03eadce360f3d`.
It is not byte-identical to the published artifact. The rebuild used the release commit in a separate source directory, existing local dependencies and local Firebase Web configuration. This is not an exact reproduction of the hosted build environment or configuration.

## Source comparison

Compared the release commits `ed6f611` (v0.0.5) and `6004dac` (v0.0.6).

- `package.json`, `pnpm-lock.yaml`, `electron-builder.cjs`, `scripts/make-desktop.cjs` and `scripts/build-electron-mcp.cjs` were unchanged. Both releases use Electron 45.0.0 and electron-builder 26.15.3. The unsigned portable format predates this incident; it cannot by itself explain the difference.
- `electron/updates.cjs` adds downloads of two Markdown release-note assets from fixed GitHub release paths, with size checks. The content is displayed as Vue text interpolation in `ChangelogDialog.vue`. This path does not download or execute program updates. All three update tests passed.
- `electron/main.cjs` increases the notification body limit and permits an HTTPS link to the developer's GitHub profile. The preload bridge and sandbox settings are unchanged.
- The MCP server source is unchanged. Its published v0.0.5 bundle and the local v0.0.6 bundle match after normalizing dependency path prefixes introduced by the local node_modules junction. MCP tools dispatch game actions; this server does not expose a system shell.
- Solo play and saving use application state and IndexedDB. Custom playmats add HTTP/HTTPS image loading and corresponding image CSP permission. These are renderer changes; the reviewed paths do not add system command execution.
- CI splits the existing compile/package command into explicit steps and adds release-note validation/upload. It previously checked hashes but did not run a release antivirus scan.

## Conclusion and mitigation

In the initial investigation, the published v0.0.6 artifact triggered Defender while the same source rebuilt locally did not. No particular application feature was demonstrated to cause the verdict. A classification specific to the generated artifact or build environment remained plausible; a false positive was not established. The follow-up below updates these findings after a change in Defender signatures.

v0.0.7 changed distribution to a ZIP without an NSIS self-extracting launcher and added a Defender release scan. The ZIP passed locally, but that did not demonstrate that the launcher caused the detection. The format change is reversed in v0.0.8 to preserve the single-file launch experience. The pre-publication Defender check is retained and scans the final portable EXE.

## Follow-up: changelog isolation and updated Defender verdict

The initial v0.0.5 comparison was against the version before changelogs, but also before other v0.0.6 changes. It was not a controlled changelog-only comparison.

During the follow-up, the local Defender signatures had advanced to `1.463.16.0` (engine still `1.1.26100.4`). A fresh download of the published v0.0.6 EXE was allowed, its SHA-256 matched the previously recorded GitHub digest, and a diagnostic scan found no threats. The artifact's bytes were unchanged. This strongly supports a change in Defender's classification rather than a source-code fix; the precise internal rule or cloud-model change is unavailable.

Static extraction of this original published EXE then confirmed that `main.cjs`, `preload.cjs` and `updates.cjs` match the v0.0.6 release source, and its MCP bundle is byte-identical to the published v0.0.5 bundle. The app file list changes only the renderer's hashed JavaScript/CSS assets.

For a controlled local comparison, a separate v0.0.6 source copy uses the same version, dependencies and Firebase configuration but removes the changelog dialog, bundled notes, changelog initialization and Markdown downloads (restoring the v0.0.5 update checker). The rest of the v0.0.6 application remains. Both samples use the original portable EXE packaging. The standard v0.0.6 rebuild with changelogs passed again using the updated signatures. These tests cannot recreate the earlier Defender signatures or cloud verdict.

The no-changelog variant also passed the same diagnostic scan with signatures `1.463.16.0`. Its SHA-256 was `fac5e9cbf0ff7e1fca03df1d857e7d8c429e6b03ed25910274fd11b526d7a4e6`. Its TypeScript check and renderer build passed. This comparison found no detection difference between the two variants; it does not establish whether the changelog's bytes influenced the earlier classification. The application therefore retains its changelog feature and restores single-EXE distribution, with a Defender scan before publication.

Scanner return codes and diagnostic archive scanning behavior are documented in [Microsoft's MpCmdRun reference](https://learn.microsoft.com/en-us/defender-endpoint/command-line-arguments-microsoft-defender-antivirus). With default remediation, return code 0 can mean a threat was removed; the release gate therefore uses the custom scan's `-DisableRemediation` option.
