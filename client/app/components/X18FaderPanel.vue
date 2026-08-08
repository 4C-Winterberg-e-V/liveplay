<template>
  <div class="x18-faders">
    <!-- Scope, not a filter: 16 channels + 6 buses + master is 23 rows, and a
         phone that has to scroll past two thirds of the desk to reach BUS 3 is
         the exact failure this avoids. One tap per section, thumb-sized. -->
    <div class="x18-faders__scopes" role="group" :aria-label="t('x18.faderSection')">
      <button
        v-for="s in SCOPES"
        :key="s.id"
        type="button"
        class="x18-faders__scope"
        :class="{ 'x18-faders__scope--active': scope === s.id }"
        :aria-pressed="scope === s.id ? 'true' : 'false'"
        @click="scope = s.id"
      >
        {{ t(s.label) }}
        <span v-if="s.count > 1" class="x18-faders__scope-count">{{ s.count }}</span>
      </button>
    </div>

    <div class="x18-faders__list lp-scroll-fade">
      <!-- Above the faders, not below sixteen of them: this is the one piece of
           UI that says the numbers are what LivePlay last sent rather than the
           desk's actual state, and at the bottom of the scroller nobody reads it
           before acting on a level. -->
      <p class="x18-faders__note">{{ t('x18.faderStateNote') }}</p>
      <X18FaderStrip
        v-for="strip in strips"
        :key="strip.id"
        :strip="strip"
        :disabled="!isConfigured"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import X18FaderStrip from './X18FaderStrip.vue';
import {
  X18_BUS_COUNT,
  X18_CHANNEL_COUNT,
  x18StripsForScope,
  type X18FaderScope,
} from '~/utils/x18Fader';

const { t } = useLocalization();
const { isConfigured, consoleIp, restore } = useX18Faders();

const SCOPES: Array<{ id: X18FaderScope; label: string; count: number }> = [
  { id: 'channels', label: 'x18.scopeChannels', count: X18_CHANNEL_COUNT },
  { id: 'buses',    label: 'x18.scopeBuses',    count: X18_BUS_COUNT },
  { id: 'master',   label: 'x18.scopeMaster',   count: 1 },
];

// Shared so switching away from the X18 view and back lands on the same desk
// section instead of resetting to channel 1 mid-show.
const scope = useState<X18FaderScope>('x18.faderScope', () => 'channels');

const strips = computed(() => x18StripsForScope(scope.value));

// Keyed on the IP rather than done once on mount: the operator can open this
// panel, discover the console IP is missing, set it in Project Settings and come
// straight back — and the cached levels for that desk have to load then, not on
// a mount that already happened.
watch(consoleIp, () => restore(), { immediate: true });
</script>

<style scoped>
.x18-faders {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.x18-faders__scopes {
  display: flex;
  gap: 8px;
  padding: var(--spacing-sm) var(--spacing-md) 0;
  flex: none;
}

.x18-faders__scope {
  flex: 1;
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
}
.x18-faders__scope--active {
  color: var(--color-text-primary);
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 18%, var(--color-surface));
}
.x18-faders__scope-count {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 500;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.22);
}

/* One column on a phone, more as the window grows. A single strip stretched
   across a 1440px desktop is a 1300px-long fader for one channel — absurd to
   aim at, and it wastes the width that could be showing eight more channels.
   min(340px, 100%) keeps a 320px phone from overflowing sideways. */
.x18-faders__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr));
  align-content: start;
  gap: 8px;
  padding: var(--spacing-sm) var(--spacing-md) var(--spacing-md);
  overscroll-behavior: contain;
}

.x18-faders__note {
  grid-column: 1 / -1;
  margin: 0 0 2px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--color-text-secondary);
}

@media (any-hover: hover) and (any-pointer: fine) {
  .x18-faders__scope:hover { background: var(--color-surface-hover); }
  .x18-faders__scope--active:hover { background: color-mix(in srgb, var(--color-accent) 24%, var(--color-surface)); }
}

@media (max-width: 767px), (max-width: 1024px) and (any-pointer: coarse), (max-height: 559px) and (any-pointer: coarse) {
  .x18-faders__scopes {
    gap: var(--spacing-sm);
    padding: var(--spacing-sm) var(--spacing-sm) 0;
  }
  .x18-faders__scope {
    min-height: var(--lp-tap);
    font-size: 15px;
  }
  .x18-faders__list {
    gap: var(--spacing-sm);
    padding: var(--spacing-sm);
  }
  .x18-faders__note { font-size: 12px; }
}

/* ---- Phone in landscape: height is the scarce axis ---------------------- */
/* Two columns of two-line strips would show four channels; one column of the
   single-line strips (see X18FaderStrip) shows five AND leaves the fader the
   full width of the screen. */
@media (max-height: 559px) and (any-pointer: coarse) and (min-width: 600px) {
  .x18-faders__list {
    grid-template-columns: 1fr;
    gap: 6px;
    padding: 6px var(--spacing-sm) var(--spacing-sm);
  }
  .x18-faders__scopes { padding: 6px var(--spacing-sm) 0; }
  .x18-faders__scope { min-height: var(--lp-tap-sm); }
}
</style>
