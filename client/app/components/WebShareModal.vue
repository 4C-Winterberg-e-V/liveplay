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
            <h2>{{ t('webShare.tunnelTitle') }}</h2>
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
  auth: { user: string; pass: string } | null;
}

const defaultStatus: WebShareStatus = {
  hosting: false, webPort: null, lanUrls: [], lanQr: null,
  tunnel: 'down', tunnelUrl: null, tunnelQr: null, auth: null,
};

const status = ref<WebShareStatus>({ ...defaultStatus });
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

onMounted(async () => {
  const w = api();
  if (!w) return;
  // Live status pushes (tunnel coming up, cloudflared exiting, …).
  unsub = w.onStateChange((s: WebShareStatus) => { status.value = { ...defaultStatus, ...s }; });
  const s = await w.getStatus();
  if (s) status.value = { ...defaultStatus, ...s };
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
</style>
