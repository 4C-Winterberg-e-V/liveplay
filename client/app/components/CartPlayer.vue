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

    <div class="cart-grid" :class="gridClass">
      <CartSlot
        v-for="slot in 16"
        :key="slot"
        :slot="slot - 1"
        :item="getCartItem(slot - 1)"
        :keyLabel="getKeyLabel(slot - 1)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AudioItem } from '~/types/project';
import { formatKeyLabel } from '~/composables/useCartHotkeys';
import Btn from './Btn.vue';

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
function onCartTitleClick() {
  if (import.meta.client && window.matchMedia?.('(max-width: 768px)').matches) {
    cartCollapsed.value = !cartCollapsed.value;
  }
}

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

  // Adjust grid columns based on width
  if (width < 500) {
    gridClass.value = 'grid-cols-2';
  } else if (width < 800) {
    gridClass.value = 'grid-cols-2';
  } else if (width < 1100) {
    gridClass.value = 'grid-cols-3';
  } else {
    gridClass.value = 'grid-cols-4';
  }
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
  min-height: 68px;
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

/* Phones: enable collapse, fold the grid away, and drop the Attach button
   (pointless in a browser/touch context). */
@media (max-width: 768px) {
  /* Slimmer header to reclaim vertical space. */
  .cart-header {
    min-height: 44px;
    padding: var(--spacing-xs) var(--spacing-md);
  }
  .cart-header h2 { font-size: 16px; cursor: pointer; flex: 1; }
  .cart-collapse-toggle { display: inline-flex; width: 32px; height: 32px; }
  .cart-header-actions { display: none; }
  .cart-player.collapsed { height: auto; }
  .cart-player.collapsed .cart-grid { display: none; }
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
