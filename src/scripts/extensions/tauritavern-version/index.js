import { CLIENT_VERSION, displayVersion } from '../../../script.js';
import {
    getClientVersion as getBridgeClientVersion,
    invoke,
    openExternalUrl,
} from '../../../tauri-bridge.js';
import { renderExtensionTemplateAsync } from '../../extensions.js';
import { translate } from '../../i18n.js';
import { POPUP_TYPE, Popup } from '../../popup.js';
import { isIosRuntime } from '../../util/mobile-runtime.js';
import { extractErrorText, toUserFacingErrorText } from '../../util/user-facing-error.js';
import { getActiveIosPolicyCapabilities } from '../../tauritavern/ios-policy.js';

const MODULE_NAME = 'tauritavern-version';
const LINKS = Object.freeze({
    authorName: 'Darkatse',
    repositoryUrl: 'https://github.com/Darkatse/TauriTavern',
    discordUrl: 'https://discord.com/channels/1134557553011998840/1472415443078742188',
});

const UNKNOWN_VALUE = 'UNKNOWN';

function resolveIosAboutCapabilities() {
    return getActiveIosPolicyCapabilities()?.about ?? null;
}

function localize(key, fallback) {
    return translate(fallback, key);
}

function localizeTemplate(key, fallback, ...values) {
    const template = localize(key, fallback);
    return template.replace(/\$\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? ''));
}

function extractCompatVersion(agent) {
    const segments = String(agent || '')
        .split(':')
        .map(segment => segment.trim())
        .filter(Boolean);

    return segments.length >= 2 ? segments[1] : UNKNOWN_VALUE;
}

function getFallbackVersion() {
    const normalized = String(displayVersion || '')
        .replace(/^TauriTavern\s*/i, '')
        .trim();

    return normalized || UNKNOWN_VALUE;
}

function buildVersionInfo(payload = null) {
    const agent = typeof payload?.agent === 'string' && payload.agent.trim()
        ? payload.agent.trim()
        : (String(CLIENT_VERSION || '').trim() || 'SillyTavern:UNKNOWN:TauriTavern');

    const packageVersion = typeof payload?.tauriVersion === 'string' && payload.tauriVersion.trim()
        ? payload.tauriVersion.trim()
        : (typeof payload?.pkgVersion === 'string' && payload.pkgVersion.trim()
            ? payload.pkgVersion.trim()
            : getFallbackVersion());

    const gitBranch = typeof payload?.gitBranch === 'string' ? payload.gitBranch.trim() : '';
    const gitRevision = typeof payload?.gitRevision === 'string' ? payload.gitRevision.trim() : '';
    const gitInfo = gitBranch && gitRevision
        ? `${gitBranch} (${gitRevision})`
        : (gitBranch || gitRevision || 'N/A');

    const compatVersion = extractCompatVersion(agent);
    const compatBaseline = `SillyTavern ${compatVersion}`;

    return {
        packageVersion,
        compatBaseline,
        gitInfo,
    };
}

async function resolveVersionInfo() {
    try {
        const payload = await getBridgeClientVersion();
        return buildVersionInfo(payload);
    } catch (error) {
        console.warn('TauriTavern version extension fallback:', error);
        return buildVersionInfo();
    }
}

function renderVersionInfo(info) {
    $('#tauritavern_version_number').text(info.packageVersion);
    $('#tauritavern_compat_version').text(info.compatBaseline);
    $('#tauritavern_git_info').text(info.gitInfo);
}

async function onExportDebugBundleClick() {
    const $btn = $('#tauritavern_export_debug_bundle');
    const $icon = $btn.find('i');
    const $text = $btn.find('span');
    const defaultText = String($text.data('defaultLabel') || $text.text()).trim();

    $text.data('defaultLabel', defaultText);
    $icon.addClass('fa-spin');
    $text.text(localize('ttv_version.exporting_bundle', 'Exporting...'));
    $btn.prop('disabled', true);

    try {
        const devApi = window.__TAURITAVERN__?.api?.dev;
        if (!devApi || typeof devApi.exportBundle !== 'function') {
            throw new Error('TauriTavern host dev API exportBundle is unavailable');
        }

        const savedPath = await devApi.exportBundle();

        if (isIosRuntime()) {
            const shareResult = await invoke('ios_share_file', { filePath: savedPath });
            if (shareResult?.completed === true) {
                globalThis.toastr?.success?.(localize('ttv_version.export_success', 'Export completed.'));
            }
            return;
        }

        globalThis.toastr?.success?.(localize('ttv_version.export_success', 'Export completed.'));
        await new Popup(savedPath, POPUP_TYPE.TEXT, localize('ttv_version.export_debug_bundle', 'Export Debug Bundle'), {
            okButton: localize('ttv_version.ok', 'OK'),
            allowVerticalScrolling: true,
            wide: true,
            large: false,
        }).show();
    } catch (error) {
        console.error('TauriTavern debug bundle export failed:', error);
        globalThis.toastr?.error?.(
            localizeTemplate(
                'ttv_version.export_failed',
                'Failed to export debug bundle: ${0}',
                toUserFacingErrorText(error) || extractErrorText(error),
            ),
        );
    } finally {
        $icon.removeClass('fa-spin');
        $text.text(defaultText);
        $btn.prop('disabled', false);
    }
}

async function openVersionUrl(url) {
    try {
        await openExternalUrl(url);
    } catch (error) {
        globalThis.toastr?.error?.(
            localizeTemplate(
                'ttv_version.open_link_failed',
                'Failed to open link: ${0}',
                toUserFacingErrorText(error) || extractErrorText(error),
            ),
        );
        throw error;
    }
}

function shouldInterceptExternalLink(event) {
    return event.button === 0
        && !event.metaKey
        && !event.ctrlKey
        && !event.shiftKey
        && !event.altKey;
}

function onExternalLinkClick(event) {
    if (!shouldInterceptExternalLink(event)) {
        return;
    }

    const href = String(event.currentTarget?.href || '').trim();
    if (!href) {
        return;
    }

    event.preventDefault();
    void openVersionUrl(href);
}

jQuery(async () => {
    const container = $('#tauritavern_version_container');
    if (!container.length) {
        return;
    }

    const html = await renderExtensionTemplateAsync(MODULE_NAME, 'settings', LINKS);
    container.append(html);
    $('#tauritavern_export_debug_bundle').on('click', () => void onExportDebugBundleClick());

    const aboutCaps = resolveIosAboutCapabilities();
    if (aboutCaps && aboutCaps.git_info === false) {
        const gitRow = document.getElementById('ttv-git-row');
        if (!(gitRow instanceof HTMLElement)) {
            throw new Error('[TauriTavern][iOSPolicy] ttv-git-row not found');
        }
        gitRow.hidden = true;
    }

    container.on('click', 'a[target="_blank"]', onExternalLinkClick);

    const versionInfo = await resolveVersionInfo();
    renderVersionInfo(versionInfo);
});
