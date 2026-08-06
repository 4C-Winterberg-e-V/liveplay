<template>
  <div class="cart-player" :class="{ collapsed: cartCollapsed }" ref="cartPlayerRef">
    <div class="cart-header">
      <!-- Collapse toggle: phones only. Folds the cart away to give the
           playlist more height. -->
      <button
        type="button"
        class="cart-collapse-toggle"
        :aria-expanded="!cartCollapsed"
        :aria-label="t('cart.title')"
        @click="cartCollapsed = !cartCollapsed"
      >
        <span class="material-symbols-rounded">{{ cartCollapsed ? 'expand_more' : 'expand_less' }}</span>
      </button>
      <h2 @click="onCartTitleClick">{{ t('cart.title') }}</h2>
      <div class="cart-header-actions">
        <!-- Empty pads are hidden on touch by default: 16 pads x 2 columns is
             888px of mostly-blank grid in a ~300px viewport. This restores them,
             and the corner number on each pad keeps "fire cart 7" sayable once
             position no longer encodes the pad number. -->
        <Btn
          icon="grid_view"
          :text="t('cart.showEmptySlots')"
          :aria-label="t('cart.showEmptySlots')"
          class="cart-empty-toggle"
          :class="{ 'cart-empty-toggle--on': showEmptySlots }"
          @click="showEmptySlots = !showEmptySlots"
        />
        <Btn
          v-if="!isDetachedWindow && hasElectron"
          icon="open_in_new"
          :text="t('cart.detach')"
          :disabled="!currentProject"
          @click="handleDetach"
        />
        <Btn
          v-else
          icon="picture_in_picture_alt"
          :text="t('cart.attach')"
          @click="handleAttach"
        />
      </div>
    </div>

    <div class="cart-grid lp-scroll-fade" :class="gridClass">
      <CartSlot
        v-for="s in visibleSlots"
        :key="s"
        :slot="s"
        :item="getCartItem(s)"
        :keyLabel="getKeyLabel(s)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AudioItem } from '~/types/project';
import { formatKeyLabel } from '~/composables/useCartHotkeys';
import Btn from './Btn.vue';
import { useCompactLayout } from '~/composables/useCompactLayout';

const props = defineProps<{
  isDetachedWindow?: boolean;
}>();

const { currentProject, requestDeleteFromKeyboard } = useProject();
const { getCartItem } = useCartItems();
const { keyMappings, mount: mountHotkeys, unmount: unmountHotkeys } = useCartHotkeys();
const { mount: mountMidi, unmount: unmountMidi } = useMidiController();
const { t } = useLocalization();

// Popping the cart into a separate OS window needs Electron's multi-window IPC;
// hide the button in a pure browser context (no dead click).
const hasElectron = import.meta.client && !!(window as any).electronAPI;

// Mobile: collapse the cart to free vertical space for the playlist. Shared via
// useState so MainWorkspace can shrink the cart section to its header. No effect
// on desktop (toggle + collapse CSS are gated to the phone media query).
const cartCollapsed = useState('cart.collapsed', () => false);
// isCompact for layout, isCoarse for behaviour. Which pads exist is gated on the
// POINTER, not the width: `?cartWindow=1` renders this component alone in a
// window Electron lets shrink to 380x400, and a mouse-driven cart must keep all
// 16 pads in their fixed positions.
const { isCompact, isCoarse } = useCompactLayout();
function onCartTitleClick() {
  if (!isCompact.value) return;
  cartCollapsed.value = !cartCollapsed.value;
}

const showEmptySlots = useState('lp.cart.showEmpty', () => false);
const visibleSlots = computed(() => {
  const all = Array.from({ length: 16 }, (_, i) => i);
  if (!isCoarse.value || showEmptySlots.value) return all;
  const filled = all.filter(i => !!getCartItem(i));
  // Fail open. getCartItem resolves a slot's uuid against the cart-only map or
  // the playlist, so a slot whose item has not hydrated yet (or whose uuid went
  // stale) resolves to null. Filtering blindly would then leave a blank panel
  // under a deck tab that still reads "CART 6" — the worst possible mid-show
  // surprise. Sixteen empty pads is at least legible.
  return filled.length > 0 ? filled : all;
});

const handleDetach = () => {
  if (!currentProject.value || !import.meta.client || !window.electronAPI) return;
  window.electronAPI.openCartPlayerWindow(currentProject.value.folderPath);
};

const handleAttach = () => {
  if (!import.meta.client || !window.electronAPI) return;
  window.electronAPI.attachCartPlayerWindow();
};

const cartPlayerRef = ref<HTMLElement | null>(null);
const gridClass = ref('grid-cols-2');

// Watch for resize and adjust grid columns
const updateGridColumns = () => {
  if (!cartPlayerRef.value) return;

  const width = cartPlayerRef.value.offsetWidth;

  // The <500 and <800 branches both produced grid-cols-2, so this is the same
  // output with the dead branch removed.
  gridClass.value = width < 800 ? 'grid-cols-2' : width < 1100 ? 'grid-cols-3' : 'grid-cols-4';
};

const getKeyLabel = (slotIndex: number): string => {
  const binding = keyMappings.value[slotIndex];
  return binding ? formatKeyLabel(binding) : '';
};

// In the detached cart window there's no MainWorkspace to own the global
// DEL key, so handle it here. (In the attached layout MainWorkspace already
// does — adding it there too would double-fire.)
const isTextInputFocused = (): boolean => {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable;
};
const handleCartKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  if (isTextInputFocused() || !currentProject.value) return;
  if (requestDeleteFromKeyboard()) e.preventDefault();
};

onMounted(() => {
  if (import.meta.client) {
    mountHotkeys();
    mountMidi();
    // Initial setup
    updateGridColumns();
    if (props.isDetachedWindow) window.addEventListener('keydown', handleCartKeydown);

    // Watch for resize
    const resizeObserver = new ResizeObserver(() => {
      updateGridColumns();
    });

    if (cartPlayerRef.value) {
      resizeObserver.observe(cartPlayerRef.value);
    }

    onUnmounted(() => {
      unmountHotkeys();
      unmountMidi();
      if (props.isDetachedWindow) window.removeEventListener('keydown', handleCartKeydown);
      resizeObserver.disconnect();
    });
  }
});
</script>

<style scoped>
.cart-player {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--color-background);
}

.cart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md) var(--spacing-lg);
  /* --lp-panel-header-h is compact-only, so desktop keeps 68px. */
  min-height: var(--lp-panel-header-h, 68px);
  box-sizing: border-box;
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-surface);
}

.cart-header h2 {
  font-size: 18px;
  font-weight: 600;
}

.cart-header-actions {
  display: flex;
  gap: var(--spacing-sm);
}

/* Collapse chevron — hidden on desktop, shown only in the phone media query. */
.cart-collapse-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-right: var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  background: var(--color-background);
  color: var(--color-text-primary);
  cursor: pointer;
  flex-shrink: 0;
}
.cart-collapse-toggle .material-symbols-rounded { font-size: 22px; }

/* Hidden on desktop; revealed only in the compact block below. */
.cart-empty-toggle {
  display: none;
}
.cart-empty-toggle--on {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

/* Phones: the deck tab is the panel's label and carries its count, so the title
   row goes and the actions get the width. The actions are deliberately NOT
   relocated into the shell: `?cartWindow=1` mounts this component without
   MainWorkspace, so a shell-level bar would make Attach and "show empty pads"
   unreachable in a 380px detached window. */
@media (max-width: 767px), (max-width: 1024px) and (any-pointer: coarse), (max-height: 559px) and (any-pointer: coarse) {
  .cart-header {
    min-height: var(--lp-panel-header-h);
    padding: 0 var(--spacing-sm);
  }
  .cart-header h2,
  .cart-collapse-toggle {
    display: none;
  }
  .cart-header-actions {
    display: flex;
    gap: var(--spacing-sm);
    margin-inline-start: auto;
  }
  .cart-empty-toggle {
    display: flex;
  }
  .cart-header-actions :deep(.btn) {
    width: var(--lp-tap);
    height: var(--lp-tap);
    min-height: var(--lp-tap);
    padding: 0;
    justify-content: center;
  }
  .cart-header-actions :deep(.btn > span:not(.material-symbols-rounded)) {
    display: none;
  }
  .cart-header-actions :deep(.btn .material-symbols-rounded) {
    font-size: var(--lp-tap-icon);
  }
  .cart-grid {
    grid-auto-rows: minmax(var(--lp-cart-row-h), 1fr);
    gap: var(--spacing-sm);
    padding: var(--spacing-sm);
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
}


.cart-grid {
  flex: 1;
  display: grid;
  grid-auto-rows: minmax(100px, 1fr);
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  overflow-y: auto;
  align-content: start;

  &.grid-cols-2 {
    grid-template-columns: repeat(2, 1fr);
  }

  &.grid-cols-3 {
    grid-template-columns: repeat(3, 1fr);
  }

  &.grid-cols-4 {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>
