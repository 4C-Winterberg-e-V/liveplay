<!--
  LivePlay — Web-Share modal (AGPL-3.0-only)

  Lets the desktop operator expose the bundled web UI to phones/tablets:
    • LAN     — same Wi-Fi, scan a QR → http://<mac-ip>:8088
    • Tunnel  — bundled Cloudflare quick-tunnel → public https URL + BasicAuth

  Electron-only: the underlying host server lives in the main process
  (electron/web-share.js). In the browser build this modal is never reachable.
-->
<template>
  <div class="modal-overlay" @click.self="close">
    <div class="modal-content web-share-modal">
      <button class="modal-close" @click="close" :title="t('actions.close')">
        <span class="material-symbols-rounded">close</span>
      </button>

      <h1 class="ws-title">
        <span class="material-symbols-rounded">share</span>
        {{ t('webShare.title') }}
      </h1>
      <p class="ws-subtitle">{{ t('webShare.subtitle') }}</p>

      <!-- ── LAN ──────────────────────────────────────────────────────── -->
      <section class="ws-section">
        <div class="ws-section__head">
          <div>
            <h2>{{ t('webShare.lanTitle') }}</h2>
            <p class="ws-hint">{{ t('webShare.lanHint') }}</p>
          </div>
          <button
            type="button"
            class="ws-toggle"
            :class="{ 'ws-toggle--on': status.hosting }"
            :disabled="busy"
            @click="status.hosting ? stopLan() : startLan()"
          >
            {{ status.hosting ? t('webShare.stop') : t('webShare.start') }}
          </button>
        </div>

        <div v-if="status.hosting && status.lanUrls.length" class="ws-share">
          <img v-if="status.lanQr" :src="status.lanQr" alt="LAN QR" class="ws-qr" />
          <div class="ws-share__info">
            <div v-for="url in status.lanUrls" :key="url" class="ws-url-row">
              <code class="ws-url">{{ url }}</code>
              <button class="ws-copy" :title="t('webShare.copy')" @click="copy(url)">
                <span class="material-symbols-rounded">content_copy</span>
              </button>
            </div>
            <p class="ws-hint">{{ t('webShare.lanScanHint') }}</p>
          </div>
        </div>
      </section>

      <!-- ── Cloudflare tunnel ────────────────────────────────────────── -->
      <section class="ws-section">
        <div class="ws-section__head">
          <div>
            <h2>
              {{ t('webShare.tunnelTitle') }}
              <span v-if="status.tunnelStable" class="ws-badge" :title="t('webShare.tunnelStableHint')">
                <span class="material-symbols-rounded">push_pin</span>
                {{ t('webShare.tunnelStableBadge') }}
              </span>
            </h2>
            <p class="ws-hint">{{ t('webShare.tunnelHint') }}</p>
          </div>
          <button
            type="button"
            class="ws-toggle"
            :class="{ 'ws-toggle--on': status.tunnel === 'up' }"
            :disabled="busy || status.tunnel === 'starting'"
            @click="status.tunnel === 'down' ? startTunnel() : stopTunnel()"
          >
            <template v-if="status.tunnel === 'starting'">{{ t('webShare.starting') }}</template>
            <template v-else>{{ status.tunnel === 'up' ? t('webShare.stop') : t('webShare.start') }}</template>
          </button>
        </div>

        <!-- Optional BasicAuth gate. Off ⇒ the shared site is public. -->
        <label class="ws-authtoggle">
          <input type="checkbox" :checked="status.authEnabled" :disabled="busy" @change="toggleAuth" />
          <span>{{ t('webShare.authToggle') }}</span>
        </label>
        <p v-if="!status.authEnabled" class="ws-hint ws-hint--warn">{{ t('webShare.authOffWarn') }}</p>

        <div v-if="status.tunnel === 'up' && status.tunnelUrl" class="ws-share">
          <img v-if="status.tunnelQr" :src="status.tunnelQr" alt="Tunnel QR" class="ws-qr" />
          <div class="ws-share__info">
            <div class="ws-url-row">
              <code class="ws-url">{{ status.tunnelUrl }}</code>
              <button class="ws-copy" :title="t('webShare.copy')" @click="copy(status.tunnelUrl)">
                <span class="material-symbols-rounded">content_copy</span>
              </button>
            </div>
            <div v-if="status.auth" class="ws-auth">
              <span class="material-symbols-rounded">lock</span>
              <span>{{ t('webShare.login') }}: <strong>{{ status.auth.user }}</strong> / <strong>{{ status.auth.pass }}</strong></span>
            </div>
            <p class="ws-hint ws-hint--warn">{{ t('webShare.tunnelWarn') }}</p>
          </div>
        </div>

        <!-- Failure reason (e.g. cloudflared couldn't start) for easy debugging. -->
        <p v-if="status.tunnel === 'down' && status.tunnelError" class="ws-error">
          {{ status.tunnelError }}
        </p>

        <!-- ── Stable-URL setup (optional, per machine) ──────────────────── -->
        <details class="ws-config" :open="tcfg.configured && !tcfg.fromEnv">
          <summary>{{ t('webShare.tunnelConfigTitle') }}</summary>
          <p class="ws-hint ws-config__intro">{{ t('webShare.tunnelConfigIntro') }}</p>

          <p v-if="tcfg.fromEnv" class="ws-hint ws-config__env">
            <span class="material-symbols-rounded">terminal</span>
            {{ t('webShare.tunnelConfigEnv') }}
          </p>

          <fieldset class="ws-config__form" :disabled="tcfg.fromEnv || busy">
            <label class="ws-field">
              <span>{{ t('webShare.tunnelConfigHostname') }}</span>
              <input v-model.trim="form.hostname" type="text" inputmode="url"
                     placeholder="liveplay.deine-domain.de" />
            </label>
            <label class="ws-field">
              <span>{{ t('webShare.tunnelConfigToken') }}</span>
              <input v-model.trim="form.token" type="password" autocomplete="off"
                     :placeholder="tcfg.hasToken ? '••••••••••  (gespeichert)' : 'eyJ…'" />
            </label>

            <div class="ws-config__actions">
              <button type="button" class="ws-toggle ws-toggle--on" @click="saveTunnelConfig">
                {{ t('webShare.tunnelConfigSave') }}
              </button>
              <button v-if="tcfg.configured" type="button" class="ws-toggle" @click="clearTunnelConfig">
                {{ t('webShare.tunnelConfigClear') }}
              </button>
            </div>
            <p v-if="tcfgMsg" class="ws-hint ws-config__saved">{{ tcfgMsg }}</p>
            <p class="ws-hint ws-config__path">{{ t('webShare.tunnelConfigPath') }} <code>{{ tcfg.configPath }}</code></p>
          </fieldset>
        </details>
      </section>

      <p v-if="error" class="ws-error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{ (e: 'close'): void }>();
const { t } = useLocalization();

interface WebShareStatus {
  hosting: boolean;
  webPort: number | null;
  lanUrls: string[];
  lanQr: string | null;
  tunnel: 'down' | 'starting' | 'up';
  tunnelUrl: string | null;
  tunnelQr: string | null;
  tunnelError: string | null;
  tunnelStable: boolean;
  tunnelHostname: string | null;
  authEnabled: boolean;
  auth: { user: string; pass: string } | null;
}

const defaultStatus: WebShareStatus = {
  hosting: false, webPort: null, lanUrls: [], lanQr: null,
  tunnel: 'down', tunnelUrl: null, tunnelQr: null, tunnelError: null,
  tunnelStable: false, tunnelHostname: null, authEnabled: true, auth: null,
};

// Stable-URL (named-tunnel) config — fetched once on mount, refreshed on save.
interface TunnelConfig {
  configured: boolean;
  fromEnv: boolean;
  configPath: string;
  hostname: string;
  hasToken: boolean;
}
const defaultTcfg: TunnelConfig = {
  configured: false, fromEnv: false, configPath: '', hostname: '', hasToken: false,
};

const status = ref<WebShareStatus>({ ...defaultStatus });
const tcfg = ref<TunnelConfig>({ ...defaultTcfg });
const form = ref({ hostname: '', token: '' });
const tcfgMsg = ref('');
const busy = ref(false);
const error = ref('');

const api = () => (window as any).electronAPI?.webShare;
let unsub: (() => void) | null = null;

function close() { emit('close'); }

async function copy(text: string | null) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
}

async function run(fn: () => Promise<any>) {
  error.value = '';
  busy.value = true;
  try {
    const res = await fn();
    if (res && res.ok === false) error.value = res.error || 'Error';
    else if (res && typeof res === 'object') status.value = { ...defaultStatus, ...res };
  } catch (e: any) {
    error.value = String(e?.message || e);
  } finally {
    busy.value = false;
  }
}

const startLan     = () => run(() => api()?.startLan({ port: 8088 }));
const stopLan      = () => run(() => api()?.stopLan());
const startTunnel  = () => run(() => api()?.startTunnel({ port: 8088 }));
const stopTunnel   = () => run(() => api()?.stopTunnel());

const toggleAuth = (e: Event) =>
  run(() => api()?.setAuthEnabled?.((e.target as HTMLInputElement).checked));

async function loadTunnelConfig() {
  const res = await api()?.getTunnelConfig?.();
  if (res && res.ok) {
    tcfg.value = {
      configured: !!res.configured, fromEnv: !!res.fromEnv,
      configPath: res.configPath || '', hostname: res.hostname || '',
      hasToken: !!res.hasToken,
    };
    form.value.hostname = res.hostname || '';
    form.value.token = '';   // never pre-fill the secret
  }
}

async function saveTunnelConfig() {
  tcfgMsg.value = '';
  await run(async () => {
    // A blank token field on an edit keeps the previously stored token
    // (the backend merges it), so the hostname can change on its own.
    const payload: any = { hostname: form.value.hostname };
    if (form.value.token) payload.token = form.value.token;
    const res = await api()?.setTunnelConfig?.(payload);
    if (res && res.ok) {
      tcfgMsg.value = (!form.value.token && tcfg.value.hasToken)
        ? t('webShare.tunnelConfigKeepToken')
        : t('webShare.tunnelConfigSaved');
      form.value.token = '';
      await loadTunnelConfig();
      if (res.tunnel !== undefined) status.value = { ...defaultStatus, ...res };
    } else if (res && res.error) {
      error.value = res.error;
    }
  });
}

async function clearTunnelConfig() {
  tcfgMsg.value = '';
  await run(async () => {
    const res = await api()?.setTunnelConfig?.({ hostname: '' });
    if (res && res.ok) {
      form.value = { hostname: '', token: '' };
      await loadTunnelConfig();
      if (res.tunnel !== undefined) status.value = { ...defaultStatus, ...res };
    } else if (res && res.error) {
      error.value = res.error;
    }
  });
}

onMounted(async () => {
  const w = api();
  if (!w) return;
  // Live status pushes (tunnel coming up, cloudflared exiting, …).
  unsub = w.onStateChange((s: WebShareStatus) => { status.value = { ...defaultStatus, ...s }; });
  const s = await w.getStatus();
  if (s) status.value = { ...defaultStatus, ...s };
  await loadTunnelConfig();
});

onUnmounted(() => { if (unsub) unsub(); });
</script>

<style scoped lang="scss">
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.web-share-modal {
  position: relative;
  width: 560px;
  max-width: 92vw;
  max-height: 88vh;
  overflow-y: auto;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  padding: var(--spacing-xl);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.modal-close {
  position: absolute;
  top: var(--spacing-md);
  right: var(--spacing-md);
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  .material-symbols-rounded { font-size: 22px; }
  &:hover { color: var(--color-text-primary); }
}

.ws-title {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 4px;
}
.ws-subtitle {
  color: var(--color-text-secondary);
  font-size: 14px;
  margin: 0 0 var(--spacing-lg);
}

.ws-section {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  padding: var(--spacing-md);
  margin-bottom: var(--spacing-md);

  h2 { font-size: 16px; margin: 0 0 2px; color: var(--color-text-primary); }
}
.ws-section__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-md);
}

.ws-hint {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin: 0;
}
.ws-hint--warn { color: var(--color-warning); margin-top: var(--spacing-sm); }

.ws-toggle {
  flex-shrink: 0;
  padding: var(--spacing-sm) var(--spacing-lg);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  background: var(--color-background);
  color: var(--color-text-primary);
  font-weight: 600;
  cursor: pointer;
  &:hover:not(:disabled) { border-color: var(--color-accent); }
  &:disabled { opacity: 0.5; cursor: default; }
}
.ws-toggle--on { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }

.ws-share {
  display: flex;
  gap: var(--spacing-lg);
  margin-top: var(--spacing-md);
  align-items: flex-start;
}
.ws-qr {
  width: 150px;
  height: 150px;
  border-radius: var(--border-radius-sm);
  background: #fff;
  padding: 6px;
  flex-shrink: 0;
}
.ws-share__info { flex: 1; min-width: 0; }

.ws-url-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}
.ws-url {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  padding: 6px 8px;
  overflow-x: auto;
  white-space: nowrap;
  color: var(--color-text-primary);
}
.ws-copy {
  flex-shrink: 0;
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 5px;
  &:hover { color: var(--color-text-primary); border-color: var(--color-accent); }
  .material-symbols-rounded { font-size: 18px; }
}

.ws-auth {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: 13px;
  color: var(--color-text-primary);
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  padding: 6px 8px;
  .material-symbols-rounded { font-size: 16px; color: var(--color-warning); }
  strong { font-family: var(--font-mono); }
}

.ws-error {
  color: var(--color-error, #dc2626);
  font-size: 13px;
  margin: var(--spacing-sm) 0 0;
}

/* Optional-auth toggle. */
.ws-authtoggle {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-md);
  font-size: 13px;
  color: var(--color-text-primary);
  cursor: pointer;
  input { cursor: pointer; }
}

/* "Feste URL" badge next to the tunnel title. */
.ws-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: var(--spacing-sm);
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  vertical-align: middle;
  background: var(--color-accent);
  color: #fff;
  .material-symbols-rounded { font-size: 13px; }
}

/* Collapsible stable-URL setup. */
.ws-config {
  margin-top: var(--spacing-md);
  border-top: 1px solid var(--color-border);
  padding-top: var(--spacing-sm);

  summary {
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-secondary);
    &:hover { color: var(--color-text-primary); }
  }
}
.ws-config__intro { margin-top: var(--spacing-sm); }
.ws-config__env {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: var(--spacing-sm);
  color: var(--color-warning);
  .material-symbols-rounded { font-size: 15px; }
}
.ws-config__form {
  border: none;
  margin: 0;
  padding: 0;
  &:disabled { opacity: 0.6; }
}
.ws-field {
  display: block;
  margin-top: var(--spacing-sm);
  span { display: block; font-size: 12px; color: var(--color-text-secondary); margin-bottom: 3px; }
  input {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-mono);
    font-size: 13px;
    background: var(--color-background);
    border: 1px solid var(--color-border);
    border-radius: var(--border-radius-sm);
    padding: 6px 8px;
    color: var(--color-text-primary);
    &:focus { outline: none; border-color: var(--color-accent); }
  }
}
.ws-config__actions {
  display: flex;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-md);
}
.ws-config__saved { margin-top: var(--spacing-sm); color: var(--color-accent); }
.ws-config__path {
  margin-top: var(--spacing-sm);
  code { font-family: var(--font-mono); font-size: 11px; word-break: break-all; }
}
</style>
