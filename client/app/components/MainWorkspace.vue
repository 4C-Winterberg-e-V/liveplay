<template>
  <div class="main-workspace">
    <ProjectHeader />
    <PlaybackControls />
    
    <!-- v-show (not v-if) so CartPlayer stays mounted across view switches —
         it owns the global keyboard-hotkey listener lifecycle. On phones the
         deck class decides which of the two panels is on screen; both stay
         mounted for the same reason. -->
    <div v-show="mainView === 'workspace'" class="workspace-content" :class="'lp-deck--' + deckPane">
      <div v-if="!cartFullscreen" class="playlist-section" :class="{ 'playlist-collapsed': playlistCollapsed }" :style="{ width: (cartClosed || cartDetached) ? '100%' : `calc(100% - ${cartWidth}px)` }">
        <PlaylistView />
      </div>

      <div
        v-if="!cartDetached"
        class="resize-handle"
        :class="{ 'collapsed-left': cartFullscreen, 'collapsed-right': cartClosed }"
        @pointerdown="startResize"
      ></div>

      <div v-if="!cartClosed && !cartDetached" class="cart-section" :class="{ 'cart-collapsed': cartCollapsed }" :style="{ width: cartFullscreen ? '100%' : `${cartWidth}px` }">
        <CartPlayer />
      </div>
    </div>

    <!-- X18 control board: a full main view, mounted only when active. -->
    <X18View v-if="mainView === 'x18'" />

    <!-- Phone bottom bar: which surface you are on, and the two controls that
         must never be more than one thumb away. A flex SIBLING of the content
         rather than position:fixed, so "content hidden under the bar" is
         structurally impossible instead of avoided by a padding number that
         drifts. Hidden outright on desktop. -->
    <div ref="bottomBarRef" class="lp-bottom-bar">
      <nav class="lp-deck-tabs" :aria-label="t('playlist.title')">
        <button
          type="button"
          class="lp-deck-tab"
          :class="{ 'lp-deck-tab--active': mainView === 'workspace' && deckPane === 'playlist' }"
          @click="selectDeck('playlist')"
        >
          <span class="lp-deck-tab__label">{{ t('playlist.title') }}</span>
          <span class="lp-deck-tab__count">{{ cueCount }}</span>
        </button>
        <button
          type="button"
          class="lp-deck-tab"
          :class="{ 'lp-deck-tab--active': mainView === 'workspace' && deckPane === 'cart' }"
          @click="selectDeck('cart')"
        >
          <span class="lp-deck-tab__label">{{ t('cart.title') }}</span>
          <span class="lp-deck-tab__count">{{ cartCount }}</span>
        </button>
        <button
          type="button"
          class="lp-deck-tab"
          :class="{ 'lp-deck-tab--active': mainView === 'x18' }"
          @click="selectX18()"
        >
          <span class="lp-deck-tab__label">{{ t('x18.title') }}</span>
          <span class="lp-deck-tab__count">{{ x18Count }}</span>
        </button>
      </nav>
      <TransportButtons class="lp-transport-bar" />
    </div>

    <PropertiesPanel v-if="propertiesPanelOpen && selectedItem" />

    <ProgressModal
      :visible="progressModal.visible"
      :title="progressModal.title"
      :message="progressModal.message"
      :percentage="progressModal.percentage"
    />

    <!-- Export: server vs client choice (only shown for remote servers). -->
    <LocationChoiceModal
      :visible="exportChoiceVisible"
      :title="t('exportProject.chooseLocationTitle')"
      :message="t('exportProject.chooseLocationMessage')"
      :server-label="t('exportProject.saveOnServer')"
      :client-label="t('exportProject.downloadHere')"
      :cancel-label="t('common.cancel')"
      @pick="onExportChoice"
      @cancel="exportChoiceVisible = false"
    />

    <!-- Server file picker (directory mode) for "save on server" path. -->
    <ServerFilePickerModal
      :open="exportServerPickerOpen"
      mode="directory"
      filter="all"
      :filter-options="['all']"
      :start-path="currentProject?.folderPath ?? ''"
      @pick="onExportServerPath"
      @close="exportServerPickerOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import LocationChoiceModal from './LocationChoiceModal.vue';
import ServerFilePickerModal from './ServerFilePickerModal.vue';
import TransportButtons from './TransportButtons.vue';

const {
  selectedItem,
  selectedItems,
  propertiesPanelOpen,
  saveProject,
  closeProject,
  confirmUnsavedChanges,
  currentProject,
  findItemByUuid,
  selectAllItems,
  duplicateItems,
  copyItemsToClipboard,
  pasteItemsFromClipboard,
  requestDeleteFromKeyboard,
} = useProject();
const { triggerByUuid, triggerByIndex, stopCue, stopAllCues, playCue } = useAudioEngine();
const { getCartItem, cartOnlyItems, updateCartOnlyItem } = useCartItems();
const { t } = useLocalization();
const server = useLiveplayServer();

// Progress modal state
const progressModal = ref({
  visible: false,
  title: '',
  message: '',
  percentage: 0
});

// Resizable cart width
const cartWidth = ref(500);
const isResizing = ref(false);
const cartClosed = ref(false);
const cartFullscreen = ref(false);
const cartDetached = ref(false);

// Phone-only: when the playlist is collapsed (toggled in PlaylistView) shrink
// its section to the header so the cart player takes the remaining height.
// Shared via useState. No effect on desktop (the collapse CSS is gated to the
// phone media query).
const playlistCollapsed = useState('playlist.collapsed', () => false);
// Same idea for the cart player — collapse it to hand the height to the playlist.
const cartCollapsed = useState('cart.collapsed', () => false);

// Which top-level view is shown: the normal playlist/cart workspace, or the
// X18 control board. Shared via useState so the header nav button can toggle it.
const mainView = useState<'workspace' | 'x18'>('mainView', () => 'workspace');

// ---------------------------------------------------------------------------
// Phone shell: one surface at a time, plus a permanent transport row.
// ---------------------------------------------------------------------------
// The deck is driven entirely by CSS media queries — no JS gate is needed here,
// which is the point: where the transport bar sits must not depend on a
// listener having fired.
//
// Which panel the phone deck is showing. On desktop this class is present but
// has no declarations attached, so the side-by-side split is untouched.
const deckPane = useState<'playlist' | 'cart'>('lp.deckPane', () => 'playlist');
const { buttons: x18Buttons } = useX18Board();

// Live counts on the deck tabs. One-panel-at-a-time only costs the operator
// something if the hidden surface is opaque — the count is what makes it
// legible, and it is information neither panel header ever carried.
const cueCount  = computed(() => currentProject.value?.items.length ?? 0);
// Counts pads that actually RESOLVE to an item, not raw cartItems entries — a
// tab that claims 6 while the grid can only show 4 is worse than no count.
const cartCount = computed(() =>
  Array.from({ length: 16 }, (_, i) => i).filter(i => !!getCartItem(i)).length);
const x18Count  = computed(() => x18Buttons.value.length);

function selectDeck(pane: 'playlist' | 'cart') {
  mainView.value = 'workspace';
  deckPane.value = pane;
}
function selectX18() {
  mainView.value = 'x18';
}

// The bar's real height, published so the properties sheet can stop above it.
// Measured rather than hand-maintained: a drifted constant is exactly how a
// control ends up underneath the bar.
const bottomBarRef = ref<HTMLElement | null>(null);

// Pointer events rather than mouse events: PointerEvent extends MouseEvent, so
// every clientX calculation and both snap zones below are unchanged, but the
// handle now also works under a finger or a pen.
const startResize = (e: PointerEvent) => {
  // Reproduces the old implicit left-button-only behaviour without rejecting
  // touch, which reports button 0 anyway.
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  isResizing.value = true;
  e.preventDefault();
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not fatal */ }

  const handlePointerMove = (e: PointerEvent) => {
    if (!isResizing.value) return;

    const container = document.querySelector('.workspace-content');
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const newWidth = rect.right - e.clientX;

    // Snap zones
    const snapThreshold = 100; // pixels from edge to trigger snap
    const minWidth = 300;
    const maxWidth = rect.width * 0.95; // Allow up to 95% to trigger fullscreen

    // Check for close snap (dragging very close to right edge)
    if (newWidth < snapThreshold) {
      cartClosed.value = true;
      cartFullscreen.value = false;
      return;
    }

    // Check for fullscreen snap (dragging very close to left edge)
    if (newWidth > rect.width - snapThreshold) {
      cartFullscreen.value = true;
      cartClosed.value = false;
      return;
    }

    // Normal resize
    cartClosed.value = false;
    cartFullscreen.value = false;
    cartWidth.value = Math.max(minWidth, Math.min(maxWidth, newWidth));
  };

  const handlePointerUp = () => {
    isResizing.value = false;
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerUp);
    document.removeEventListener('pointercancel', handlePointerUp);
  };

  document.addEventListener('pointermove', handlePointerMove);
  document.addEventListener('pointerup', handlePointerUp);
  // Without pointercancel a drag interrupted by the OS (a system gesture, an
  // incoming call) would strand the move listener.
  document.addEventListener('pointercancel', handlePointerUp);
};

// Listen for menu events
if (import.meta.client && window.electronAPI) {
  window.electronAPI.onMenuSaveProject(() => {
    // File > Save always writes to disk, even when autosave is off.
    saveProject({ force: true });
  });

  window.electronAPI.onMenuExportProject(() => {
    startExportFlow();
  });

  window.electronAPI.onMenuCloseProject(async () => {
    if (!(await confirmUnsavedChanges())) return;
    void closeProject();
  });

  // File > New and File > Open while a project is already open: close the
  // current project (locally + on the server) and stash the intent so the
  // welcome screen pops the corresponding picker as soon as it mounts.
  // Without this, these menu items were silent when something was open —
  // only WelcomeScreen used to subscribe, and it isn't mounted right now.
  window.electronAPI.onMenuNewProject(async () => {
    if (!(await confirmUnsavedChanges())) return;
    try { sessionStorage.setItem('liveplay:welcomeIntent', 'new'); } catch {}
    await closeProject();
  });

  window.electronAPI.onMenuOpenProject(async () => {
    if (!(await confirmUnsavedChanges())) return;
    try { sessionStorage.setItem('liveplay:welcomeIntent', 'open'); } catch {}
    await closeProject();
  });

  // File > Open Recent > <project> while a project is already open. Same
  // shape as onMenuOpenProject, but we stash the exact path so the welcome
  // screen opens it directly instead of popping the file picker.
  window.electronAPI.onMenuOpenRecentProject(async (_e, projectPath) => {
    if (!projectPath) return;
    if (!(await confirmUnsavedChanges())) return;
    try { sessionStorage.setItem('liveplay:welcomeOpenPath', projectPath); } catch {}
    await closeProject();
  });

  window.electronAPI.onMenuOpenProjectFolder(() => {
    if (currentProject.value) {
      window.electronAPI.openFolder(currentProject.value.folderPath);
    }
  });

  // Cart window detach/attach
  window.electronAPI.onCartPlayerWindowOpened(() => {
    cartDetached.value = true;
  });
  window.electronAPI.onCartPlayerWindowClosed(() => {
    cartDetached.value = false;
  });

  // Listen for API triggers
  window.electronAPI.onTriggerItem((_event, data) => {
    if (data.type === 'uuid') {
      triggerByUuid(data.value);
    } else if (data.type === 'index') {
      triggerByIndex(data.value);
    }
  });

  window.electronAPI.onStopItem((_event, data) => {
    if (data.type === 'uuid') {
      stopCue(data.value);
    }
  });

  // Trigger a cart slot by slot number (from HTTP API)
  window.electronAPI.onTriggerCartSlot((_event, data) => {
    const item = getCartItem(data.slot);
    if (item) playCue(item);
  });

  // Stop all cues (from HTTP API)
  window.electronAPI.onStopAllCues(() => {
    stopAllCues();
  });

  // Update a cue's properties (from HTTP API PATCH /api/cues/:id)
  const READONLY_ITEM_KEYS = new Set(['uuid', 'type', 'index', 'mediaFileName', 'mediaPath', 'waveformPath', 'waveform', 'duration']);
  window.electronAPI.onApiUpdateItem((_event, { requestId, id, updates }) => {
    const item = findItemByUuid(id);
    if (!item || item.type !== 'audio') {
      window.electronAPI.sendApiResponse({ requestId, success: false, message: 'Cue not found' });
      return;
    }
    for (const [key, value] of Object.entries(updates)) {
      if (!READONLY_ITEM_KEYS.has(key)) (item as any)[key] = value;
    }
    saveProject();
    window.electronAPI.sendApiResponse({ requestId, success: true, cue: item });
  });

  // Update a cart slot's audio item properties (from HTTP API PATCH /api/carts/:slot)
  window.electronAPI.onApiUpdateCartItem((_event, { requestId, slot, updates }) => {
    const item = getCartItem(slot);
    if (!item) {
      window.electronAPI.sendApiResponse({ requestId, success: false, message: 'Cart slot is empty' });
      return;
    }
    for (const [key, value] of Object.entries(updates)) {
      if (!READONLY_ITEM_KEYS.has(key)) (item as any)[key] = value;
    }
    updateCartOnlyItem(item.uuid, item);
    saveProject();
    window.electronAPI.sendApiResponse({ requestId, success: true, cart: { slot, item } });
  });
}

// ---------------------------------------------------------------------------
// Export project flow (dual-dialog when the server is on another machine).
// ---------------------------------------------------------------------------
// When server runs locally, jump straight to a server-side directory picker.
// Otherwise, ask the user where to save: on the server, or back to this
// computer (via a one-shot download token). This replaces the old purely-
// Electron archiver path, which only worked when the project files were
// reachable from this machine.
const exportChoiceVisible   = ref(false);
const exportServerPickerOpen = ref(false);

async function startExportFlow() {
  if (!currentProject.value) return;
  if (server.isLocalServer) {
    // Local: skip the choice modal and go straight to the server picker
    // (the "server" here is this same computer, so this matches the user's
    // expectation of a familiar OS-style directory chooser).
    exportServerPickerOpen.value = true;
  } else {
    exportChoiceVisible.value = true;
  }
}

async function onExportChoice(choice: 'server' | 'client') {
  exportChoiceVisible.value = false;
  if (!currentProject.value) return;

  if (choice === 'server') {
    exportServerPickerOpen.value = true;
    return;
  }

  // client → server packages to its temp dir, returns a token, we download
  // the blob and save it via Electron's native save dialog.
  await exportToClientDownload();
}

async function onExportServerPath(serverDir: string) {
  exportServerPickerOpen.value = false;
  if (!serverDir || !currentProject.value) return;
  const project = currentProject.value;
  const outPath = `${serverDir.replace(/[\\/]+$/, '')}/${project.name}.lpa`;
  await runExport({ outputPath: outPath });
}

async function exportToClientDownload() {
  if (!currentProject.value) return;
  const project = currentProject.value;
  const defaultName = `${project.name}.lpa`;
  // Pick the local destination FIRST so a cancelled save dialog doesn't
  // leave a stray .lpa sitting in the server's temp dir.
  const localDest = await window.electronAPI.showSaveArchiveDialog(defaultName);
  if (!localDest) return;
  await runExport({ outputPath: '', downloadTo: localDest });
}

async function runExport(opts: { outputPath: string; downloadTo?: string }) {
  if (!currentProject.value) return;
  const project = currentProject.value;
  progressModal.value = {
    visible: true,
    title: t('exportProgress.title'),
    message: `${t('exportProgress.message')} ${project.name}.lpa…`,
    percentage: 30,
  };
  try {
    const result = await server.exportProjectArchive(
      project.folderPath, project.name, opts.outputPath);
    progressModal.value.percentage = opts.downloadTo ? 60 : 100;

    if (opts.downloadTo && result.downloadToken) {
      progressModal.value.message =
        `${t('exportProgress.downloading')} ${project.name}.lpa…`;
      const blob = await server.downloadArchive(result.downloadToken);
      const buf  = await blob.arrayBuffer();
      const w = await window.electronAPI.writeBinaryFile(opts.downloadTo, buf);
      if (!w.success) throw new Error(w.error || 'write failed');
    }
    progressModal.value.percentage = 100;
  } catch (e) {
    console.error('Export failed:', e);
  } finally {
    setTimeout(() => { progressModal.value.visible = false; }, 400);
  }
}

// Keep the main process HTTP API server up-to-date with the full project state.
// Waveform peak arrays are stripped from the bulk playlist (large, and API
// consumers don't need them), but PRESERVED for items the detached cart
// window has to render: cart-only items, plus any playlist item referenced
// by a cart slot. Without this the detached cart window's waveform canvases
// stay blank because it can't poll the project folder when the server is
// remote.
// NOTE: This watcher should NOT run in cart window mode to avoid feedback loops.
const stripWaveformsKeeping = (items: any[], keep: Set<string>): any[] =>
  items.map(item => {
    const copy: any = { ...item };
    if (!keep.has(item.uuid)) copy.waveform = null;
    if (copy.children) copy.children = stripWaveformsKeeping(copy.children, keep);
    return copy;
  });

// Check if this is cart window mode by looking at URL query param
const isCartWindowMode = import.meta.client
  ? new URLSearchParams(window.location.search).get('cartWindow') === '1'
  : false;

watch(currentProject, (project) => {
  // Only sync from main window, not from detached cart window
  if (!import.meta.client || !window.electronAPI || !project || isCartWindowMode) return;
  const cartReferenced = new Set<string>(
    (project.cartItems || []).map((ci: any) => ci.itemUuid).filter(Boolean)
  );
  const data = {
    ...project,
    items: stripWaveformsKeeping(project.items || [], cartReferenced),
    // Cart-only items always keep their waveform — the detached cart window
    // needs them and they're a small set (≤ 16 slots in practice).
    cartOnlyItems: Array.from(cartOnlyItems.value.values()).map(i => ({ ...i }))
  };
  window.electronAPI.syncProjectData(JSON.parse(JSON.stringify(data)));
}, { deep: true, immediate: true });

// True when the user is typing in a text field — selection/clipboard
// shortcuts must defer to native editing behaviour there.
const isTextInputFocused = (): boolean => {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable;
};

const handleKeydown = (e: KeyboardEvent) => {
  // Save on F1 key (alternative to big play button)
  if (e.key === 'F1') {
    e.preventDefault();
    if (selectedItem.value && selectedItem.value.type === 'audio') {
      const { playCue } = useAudioEngine();
      playCue(selectedItem.value as any);
    }
    return;
  }

  // Delete / Backspace removes the current selection. A multi-selection opens
  // the confirm dialog; a single item is removed outright. Must defer to
  // native editing inside text fields.
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (isTextInputFocused() || !currentProject.value) return;
    if (requestDeleteFromKeyboard()) e.preventDefault();
    return;
  }

  // Selection / clipboard shortcuts. These all require a project and must not
  // fire while editing text (so native Ctrl+A/C/V keep working in inputs).
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl || e.altKey || !currentProject.value || isTextInputFocused()) return;

  const key = e.key.toLowerCase();

  if (key === 'a') {
    e.preventDefault();
    selectAllItems();
  } else if (key === 'd') {
    e.preventDefault();
    const uuids = Array.from(selectedItems.value);
    if (uuids.length > 0) duplicateItems(uuids);
  } else if (key === 'c') {
    const uuids = Array.from(selectedItems.value);
    if (uuids.length > 0) {
      e.preventDefault();
      void copyItemsToClipboard(uuids);
    }
  } else if (key === 'v') {
    e.preventDefault();
    void pasteItemsFromClipboard();
  }
};

let bottomBarObserver: ResizeObserver | null = null;

onMounted(() => {
  if (import.meta.client) {
    window.addEventListener('keydown', handleKeydown);

    // Publish the bar's measured height. `display: none` on desktop means the
    // box is 0x0 there, so --lp-bottom-h stays 0px and no sheet arithmetic
    // changes outside the compact query.
    if (bottomBarRef.value && typeof ResizeObserver !== 'undefined') {
      bottomBarObserver = new ResizeObserver(() => {
        const h = bottomBarRef.value?.getBoundingClientRect().height ?? 0;
        document.documentElement.style.setProperty('--lp-bottom-h', `${h}px`);
      });
      bottomBarObserver.observe(bottomBarRef.value);
    }
  }
});

onUnmounted(() => {
  if (import.meta.client) {
    window.removeEventListener('keydown', handleKeydown);
    bottomBarObserver?.disconnect();
    bottomBarObserver = null;
    document.documentElement.style.setProperty('--lp-bottom-h', '0px');
  }
});
</script>

<style scoped lang="scss">
.main-workspace {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* Themed dark background so any area not covered by a panel (e.g. when the
     playlist/cart are collapsed on mobile) stays in the app's dark tone
     instead of showing the page's default white. */
  background-color: var(--color-background);
  /* The shell owns the horizontal safe-area insets so individual bars don't
     each have to remember them. env() is 0 where there is no inset, so this is
     a genuine no-op on desktop and in Electron. */
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}

/* Phone bottom bar. Renders nothing outside the compact query — both the deck
   tabs and the second TransportButtons instance are inert on desktop. */
.lp-bottom-bar {
  display: none;
}

.workspace-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
  background-color: var(--color-background);
}

.playlist-section {
  min-width: 30%;
  overflow: hidden;
}

.resize-handle {
  width: 5px;
  background-color: var(--color-border);
  cursor: col-resize;
  transition: background-color var(--transition-fast);
  position: relative;
  z-index: 10;
  
  &:hover {
    background-color: var(--color-accent);
  }
  
  &:active {
    background-color: var(--color-accent);
  }
  
  &.collapsed-left {
    /* When cart is fullscreen, show handle at left edge */
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 8px;
    background-color: transparent;
    
    &::after {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 2px;
      background-color: var(--color-border);
      opacity: 0.5;
    }
    
    &:hover::after {
      width: 4px;
      background-color: var(--color-accent);
      opacity: 1;
    }
  }
  
  &.collapsed-right {
    /* When cart is closed, show handle at right edge */
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 8px;
    background-color: transparent;
    
    &::after {
      content: '';
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: 2px;
      background-color: var(--color-border);
      opacity: 0.5;
    }
    
    &:hover::after {
      width: 4px;
      background-color: var(--color-accent);
      opacity: 1;
    }
  }
}

.cart-section {
  overflow: hidden;
}

// ---- Phone: one surface at a time, transport always in reach -------------
// Splitting the height 50/50 gave neither panel a workable amount of room —
// two visible cue rows out of a 40-cue show file — and left rows whose Play
// button was bisected by the panel boundary. The deck shows one panel at full
// height instead, and the surface you are not looking at is legible through the
// count on its tab.
@media (max-width: 767px), (max-width: 1024px) and (any-pointer: coarse), (max-height: 559px) and (any-pointer: coarse) {
  .workspace-content {
    flex-direction: column;
  }
  // The JS-driven inline widths at :style must be overridden, and no selector
  // specificity beats an inline style — hence !important.
  .playlist-section,
  .cart-section {
    width: 100% !important;
    min-width: 0;
    flex: 1 1 0;
    min-height: 0;
  }
  // Only the selected deck is on screen. display:none rather than v-if keeps
  // CartPlayer mounted — it owns the global cart-hotkey listener lifecycle.
  .lp-deck--playlist .cart-section {
    display: none;
  }
  .lp-deck--cart .playlist-section {
    display: none;
  }
  .resize-handle {
    display: none;
  }

  .lp-bottom-bar {
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    position: relative;
    z-index: 1600;
    background: var(--color-surface);
    border-top: 1px solid var(--color-border);
    padding: var(--spacing-xs) var(--spacing-md)
      calc(var(--spacing-xs) + env(safe-area-inset-bottom));
  }

  .lp-deck-tabs {
    display: flex;
    gap: var(--spacing-xs);
    /* Dead space between navigation and transport. Mis-tapping CARTS costs
       nothing; mis-tapping STOP ALL CUES ends the number. */
    margin-bottom: 20px;
  }

  .lp-deck-tab {
    flex: 1 1 0;
    min-height: var(--lp-tap-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid var(--color-border);
    border-radius: var(--border-radius-sm);
    background: var(--color-background);
    color: var(--color-text-secondary);
  }

  .lp-deck-tab--active {
    color: var(--color-accent);
    border-color: var(--color-accent);
  }

  .lp-deck-tab__label {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .lp-deck-tab__count {
    font-family: var(--font-mono);
    font-size: 11px;
    opacity: 0.8;
  }

  .lp-transport-bar :deep(.transport-buttons) {
    gap: var(--lp-sep);
  }
  .lp-transport-bar :deep(.control-btn) {
    flex: 1 1 0;
    min-height: var(--lp-tap-lg);
    justify-content: center;
    padding: 0 var(--spacing-sm);
  }
  // Stop-All gets the larger share: it is the one control that must be hit
  // without looking.
  .lp-transport-bar :deep(.panic-btn) {
    flex: 1.4 1 0;
  }
  .lp-transport-bar :deep(.control-btn__label) {
    display: inline;
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: normal;
    line-height: 1.05;
  }
}

// ---- Phone in landscape: spend the width, don't hide a panel ------------
// There really are ~850px here, and refusing to use them is what made
// landscape unusable. The deck tab becomes a 2:1 weight switch, so the control
// means the same thing in both orientations and nothing relocates on rotation.
@media (max-height: 559px) and (any-pointer: coarse) and (min-width: 600px) {
  .workspace-content {
    flex-direction: row;
  }
  .playlist-section,
  .cart-section {
    display: block !important;
    width: auto !important;
    min-width: 0;
  }
  .lp-deck--playlist .playlist-section { flex: 2 1 0; }
  .lp-deck--playlist .cart-section     { flex: 1 1 0; }
  .lp-deck--cart .playlist-section     { flex: 1 1 0; }
  .lp-deck--cart .cart-section         { flex: 2 1 0; }
  .resize-handle {
    display: none;
  }
  // One row: vertical space is the scarce axis here.
  .lp-bottom-bar {
    flex-direction: row;
    align-items: stretch;
    gap: var(--lp-sep);
  }
  .lp-deck-tabs {
    flex: 1 1 auto;
    margin-bottom: 0;
  }
  .lp-transport-bar {
    flex: 0 0 auto;
  }
}
</style>
