<template>
  <div class="properties-panel">
    <div class="properties-header">
      <h3>{{ selectedItems.size > 1 ? t('properties.multipleItemsSelected', { count: selectedItems.size }) : (t('properties.title') + ': ' + (selectedItem?.displayName || '')) }}</h3>
      <button class="close-btn" @click="handleClose">
        <span class="material-symbols-rounded">close</span>
      </button>
    </div>
    
    <!-- Tab Navigation -->
    <div class="properties-tabs">
      <button 
        v-for="tab in availableTabs" 
        :key="tab.id"
        :class="['tab-btn', { active: activeTab === tab.id }]"
        @click="activeTab = tab.id"
      >
        <span class="material-symbols-rounded">{{ tab.icon }}</span>
        <span>{{ tab.label }}</span>
      </button>
    </div>
    
    <div class="properties-content">
      <!-- Basic Info Tab -->
      <div v-if="activeTab === 'basic'" class="tab-panel">
        <div class="property-field">
          <label>{{ t('properties.displayName') }}</label>
          <input 
            v-model="selectedItem.displayName" 
            type="text" 
            @change="handleSave"
          />
        </div>
        
        <div class="property-field">
          <label>{{ t('properties.color') }}</label>
          <div class="color-picker">
            <button
              v-for="color in PRESET_COLORS"
              :key="color"
              class="color-btn"
              :style="{ backgroundColor: color }"
              :class="{ active: selectedItem.color === color }"
              @click="() => { selectedItem.color = color; handleSave(); }"
            ></button>
          </div>
        </div>
        
        <div class="property-field">
          <label>{{ t('properties.uuid') }}</label>
          <div class="input-with-btn">
            <input :value="selectedItem.uuid" readonly />
            <button class="icon-btn" @click="copyToClipboard(selectedItem.uuid)">
              <span class="material-symbols-rounded">content_copy</span>
            </button>
          </div>
        </div>
        
        <div class="property-field">
          <label>{{ t('properties.index') }}</label>
          <input :value="selectedItem.index.join(',')" readonly />
        </div>
        
        <div class="property-field" v-if="selectedItem.type === 'audio'">
          <label>{{ t('properties.apiTriggerUrl') }}</label>
          <div class="input-with-btn">
            <input :value="apiTriggerUrl" readonly />
            <button class="icon-btn" @click="copyToClipboard(apiTriggerUrl)">
              <span class="material-symbols-rounded">content_copy</span>
            </button>
          </div>
        </div>
      </div>
      
      <!-- Media Tab -->
      <div v-if="activeTab === 'media' && selectedItem.type === 'audio'" class="tab-panel">
        <div class="property-field">
          <label>{{ t('properties.file') }}</label>
          <div class="input-with-btn">
            <input :value="audioItem.mediaFileName" readonly />
            <button class="icon-btn" @click="handleReplaceMedia">
              <span class="material-symbols-rounded">swap_horiz</span>
            </button>
          </div>
        </div>

        <div class="property-field">
          <label>{{ t('properties.duration') }}</label>
          <input :value="formatTime(audioItem.duration)" readonly />
        </div>

        <div class="property-field">
          <label>{{ t('properties.waveform') }}</label>
          <button class="icon-btn regen-btn" :disabled="isRegenerating" @click="handleRegenerateWaveform">
            <span class="material-symbols-rounded" :class="{ spinning: isRegenerating }">refresh</span>
            <span>{{ isRegenerating ? t('properties.regeneratingWaveform') : t('properties.regenerateWaveform') }}</span>
          </button>
        </div>
      </div>
      
      <!-- Playback Tab -->
      <div v-if="activeTab === 'playback' && selectedItem.type === 'audio'" class="tab-panel">
        <WaveformTrimmer
          v-if="audioItem && audioItem.mediaPath && audioItem.duration > 0"
          :audio-item="audioItem"
          :multi-select="selectedItems.size > 1"
          @update:volume="(v) => { beginItemBatch(); audioItem.volume = v; }"
          @update:in-point="(v) => { beginItemBatch(); audioItem.inPoint = v; }"
          @update:out-point="(v) => { beginItemBatch(); audioItem.outPoint = v; }"
          @update:play-fade="(v) => { beginItemBatch(); handlePlayFadeUpdate(v); }"
          @update:stop-fade="(v) => { beginItemBatch(); handleStopFadeUpdate(v); }"
          @update:cross-fade="(v) => { beginItemBatch(); handleCrossFadeUpdate(v); }"
          @change="handleSave"
          @normalize="handleNormalize"
          @trim-silence="handleTrimSilence"
        />
        <div v-else class="loading-message">
          <span class="material-symbols-rounded">pending</span>
          <p>{{ t('properties.loadingAudioData')}}</p>
        </div>
      </div>
      
      <!-- Output Tab -->
      <div v-if="activeTab === 'output' && selectedItem.type === 'audio'" class="tab-panel">
        <div class="property-field">
          <label>{{ t('properties.deviceOverride') }}</label>
          <select
            :value="(audioItem as any).deviceOverride ?? ''"
            @change="onDeviceOverrideChange"
          >
            <option value="">{{ t('settings.useProjectDefault') }}</option>
            <option
              v-for="d in devicesList"
              :key="d.id"
              :value="d.id"
            >
              {{ d.display_name }}{{ d.is_default ? ' (' + t('common.default') + ')' : '' }}
            </option>
          </select>
          <p class="property-help">{{ t('properties.deviceOverrideHelp') }}</p>
        </div>

        <!-- LTC Output Section -->
        <div class="property-field" :class="{ 'field-disabled': !ltcDeviceConfigured }">
          <label class="ltc-checkbox-label">
            <input
              type="checkbox"
              :checked="(audioItem.ltcEnabled ?? false) && ltcDeviceConfigured"
              :disabled="!ltcDeviceConfigured"
              @change="onLtcEnabledChange"
            />
            {{ t('properties.ltcOutputTimecode') }}
          </label>
          <p class="property-help">
            {{ ltcDeviceConfigured
                ? t('properties.ltcOutputTimecodeHelp')
                : (t('properties.ltcRequiresDevice') || 'Select an LTC output device in Project Settings to enable timecode output.') }}
          </p>
        </div>

        <div class="property-field" :class="{ 'field-disabled': !(audioItem.ltcEnabled ?? false) }">
          <label>{{ t('properties.ltcStartTimecode') }}</label>
          <input
            type="text"
            :value="audioItem.ltcStartTimecode ?? '00:00:00:00'"
            :disabled="!(audioItem.ltcEnabled ?? false)"
            :class="{ invalid: !ltcTimecodeValid }"
            placeholder="HH:MM:SS:FF"
            maxlength="11"
            @change="onLtcTimecodeChange"
          />
          <p v-if="!ltcTimecodeValid" class="property-help property-help--error">
            {{ t('properties.ltcTimecodeFormat') }}
          </p>
        </div>

        <div class="property-field" :class="{ 'field-disabled': !(audioItem.ltcEnabled ?? false) }">
          <label>{{ t('properties.ltcFrameRate') }}</label>
          <select
            :value="audioItem.ltcFrameRate ?? 4"
            :disabled="!(audioItem.ltcEnabled ?? false)"
            @change="onLtcFrameRateChange"
          >
            <option v-for="opt in ltcFrameRateOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
      </div>

      <!-- Ducking Tab -->
      <div v-if="activeTab === 'ducking' && selectedItem.type === 'audio'" class="tab-panel">
        <div class="property-field">
          <label>{{ t('properties.mode') }}</label>
          <select v-model="audioItem.duckingBehavior.mode" @change="handleSave">
            <option value="stop-all">{{ t('duckingBehavior.stopAll') }}</option>
            <option value="no-ducking">{{ t('duckingBehavior.noDucking') }}</option>
            <option value="duck-others">{{ t('duckingBehavior.duckOthers') }}</option>
          </select>
        </div>
        
        <div class="property-field" v-if="audioItem.duckingBehavior.mode === 'duck-others'">
          <label>{{ t('properties.duckLevel') }} ({{ duckLevelDB.toFixed(1) }} dB)</label>
          <input 
            v-model.number="duckLevelDB" 
            type="range" 
            min="-60" 
            max="0" 
            step="0.5"
            @change="handleSave"
          />
          <div class="db-range-labels">
            <span>-60 dB</span>
            <span>0 dB</span>
          </div>
        </div>
      </div>
      
      <!-- End Behavior Tab -->
      <div v-if="activeTab === 'endBehavior'" class="tab-panel">
        <div class="property-field">
          <label>{{ t('properties.action') }}</label>
          <select v-model="endBehaviorAction" @change="handleSave">
            <option value="nothing">{{ t('endBehavior.nothing') }}</option>
            <option value="next">{{ t('endBehavior.next') }}</option>
            <option value="goto-item">{{ t('endBehavior.gotoItem') }}</option>
            <option value="goto-index">{{ t('endBehavior.gotoIndex') }}</option>
            <option v-if="selectedItem.type === 'audio'" value="loop">{{ t('endBehavior.loop') }}</option>
          </select>
        </div>
        
        <div class="property-field" v-if="endBehaviorAction === 'goto-item'">
          <label>{{ t('properties.targetUuid') }}</label>
          <input 
            v-model="endBehaviorTargetUuid" 
            type="text"
            @change="handleSave"
          />
        </div>
        
        <div class="property-field" v-if="endBehaviorAction === 'goto-index'">
          <label>{{ t('properties.targetIndex') }}</label>
          <input 
            :value="endBehaviorTargetIndex?.join(',') || ''"
            @change="handleEndBehaviorIndexChange"
            type="text"
          />
        </div>
      </div>
      
      <!-- Start Behavior Tab -->
      <div v-if="activeTab === 'startBehavior'" class="tab-panel">
        <div class="property-field">
          <label>{{ t('properties.action') }}</label>
          <select v-model="startBehaviorAction" @change="handleSave">
            <option v-if="selectedItem.type === 'audio'" value="nothing">{{ t('startBehavior.nothing') }}</option>
            <option v-if="selectedItem.type === 'audio'" value="play-next">{{ t('startBehavior.playNext') }}</option>
            <option v-if="selectedItem.type === 'audio'" value="play-item">{{ t('startBehavior.playItem') }}</option>
            <option v-if="selectedItem.type === 'audio'" value="play-index">{{ t('startBehavior.playIndex') }}</option>
            <option v-if="selectedItem.type === 'group'" value="play-first">{{ t('startBehavior.playFirst') }}</option>
            <option v-if="selectedItem.type === 'group'" value="play-all">{{ t('startBehavior.playAll') }}</option>
          </select>
        </div>
        
        <div class="property-field" v-if="startBehaviorAction === 'play-item'">
          <label>{{ t('properties.targetUuid') }}</label>
          <input 
            v-model="startBehaviorTargetUuid" 
            type="text"
            @change="handleSave"
          />
        </div>
        
        <div class="property-field" v-if="startBehaviorAction === 'play-index'">
          <label>{{ t('properties.targetIndex') }}</label>
          <input
            :value="startBehaviorTargetIndex?.join(',') || ''"
            @change="handleStartBehaviorIndexChange"
            type="text"
          />
        </div>
      </div>

      <!-- X18 Mixer Tab -->
      <div v-if="activeTab === 'x18' && selectedItem.type === 'audio'" class="tab-panel">
        <p v-if="!x18Configured" class="property-help property-help--error">
          {{ t('properties.x18RequiresIp') }}
        </p>
        <p class="property-help">{{ t('properties.x18Help') }}</p>

        <div
          v-for="(action, i) in x18Actions"
          :key="i"
          class="x18-action"
        >
          <div class="x18-action-row">
            <select v-model="action.trigger" @change="handleSave">
              <option value="start">{{ t('x18.triggerStart') }}</option>
              <option value="stop">{{ t('x18.triggerStop') }}</option>
            </select>
            <select v-model="action.target" @change="onX18TargetChange(action)">
              <option value="master">{{ t('x18.targetMaster') }}</option>
              <option value="channel">{{ t('x18.targetChannel') }}</option>
            </select>
            <button class="icon-btn x18-remove" :title="t('common.delete')" @click="removeX18Action(i)">
              <span class="material-symbols-rounded">delete</span>
            </button>
          </div>
          <div class="x18-action-row">
            <label v-if="action.target === 'channel'" class="x18-inline">
              {{ t('x18.channel') }}
              <input
                type="number"
                min="1"
                max="16"
                step="1"
                v-model.number="action.channel"
                @change="onX18ChannelChange(action)"
              />
            </label>
            <label class="x18-inline">
              {{ t('x18.level') }}
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                v-model.number="action.level"
                @change="onX18LevelChange(action)"
              />
              %
            </label>
          </div>
        </div>

        <button class="x18-add" @click="addX18Action">
          <span class="material-symbols-rounded">add</span>
          {{ t('x18.addAction') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AudioItem, GroupItem, X18Action } from '~/types/project';
import { PRESET_COLORS } from '~/types/project';
import { calculatePerceivedLoudness } from '~/utils/audio';
import { useOutputTarget } from '~/composables/useOutputTarget';

const { selectedItem, selectedItems, propertiesPanelOpen, getSelectedItems, saveProject, currentProject, beginItemBatch, endItemBatch } = useProject();
const { t } = useLocalization();
const { levels: outputTargetLevels } = useOutputTarget();

const audioItem = computed(() => selectedItem.value as AudioItem);

// LTC output is only meaningful when a project-wide LTC device is configured.
// The checkbox stays disabled until then to prevent users from "enabling"
// timecode that has nowhere to go (which is the most common LTC-silent
// support report we get).
const ltcDeviceConfigured = computed(() => {
  const dev = (currentProject.value as any)?.settings?.ltcDevice;
  return typeof dev === 'string' && dev.length > 0;
});

// Available output devices (for the per-item Output tab). Pulled from the
// shared server state — populated once on connect.
const _server = useLiveplayServer();
const devicesList = computed(() => _server.devices ?? []);

// API endpoint that triggers playback of the selected item. Points at the
// audio server's transport route (routed through ProjectState so ducking,
// in-point, and fades are honoured) — not the client's local trigger proxy.
const apiTriggerUrl = computed(() => {
  const base = (_server.serverUrl ?? 'http://127.0.0.1:4480').replace(/\/+$/, '');
  return `${base}/api/project/items/${selectedItem.value?.uuid}/play`;
});
const onDeviceOverrideChange = (e: Event) => {
  const v = (e.target as HTMLSelectElement).value;
  const it = audioItem.value as any;
  if (!v) {
    delete it.deviceOverride;
  } else {
    it.deviceOverride = v;
  }
  handleSave();
};

// LTC helpers
const SMPTE_RE = /^\d{2}:\d{2}:\d{2}[:;]\d{2}$/;

const ltcTimecodeValid = computed(() => {
  const tc = audioItem.value?.ltcStartTimecode ?? '00:00:00:00';
  return SMPTE_RE.test(tc);
});

const ltcFrameRateOptions = [
  { value: 0, label: '24 fps' },
  { value: 1, label: '25 fps' },
  { value: 2, label: '29.97 fps NDF' },
  { value: 3, label: '29.97 fps DF' },
  { value: 4, label: '30 fps' },
];

const onLtcEnabledChange = (e: Event) => {
  audioItem.value.ltcEnabled = (e.target as HTMLInputElement).checked;
  if (audioItem.value.ltcEnabled && !audioItem.value.ltcStartTimecode) {
    audioItem.value.ltcStartTimecode = '00:00:00:00';
  }
  if (audioItem.value.ltcFrameRate === undefined) {
    audioItem.value.ltcFrameRate = 4;
  }
  handleSave();
};

const onLtcTimecodeChange = (e: Event) => {
  const raw = (e.target as HTMLInputElement).value.trim();
  // Normalise: replace semicolon separator (DF convention) with colon for storage.
  const normalised = raw.replace(/;(\d{2})$/, ':$1');
  if (SMPTE_RE.test(normalised)) {
    audioItem.value.ltcStartTimecode = normalised;
    handleSave();
  } else {
    // Reset the input to the last valid value.
    (e.target as HTMLInputElement).value = audioItem.value.ltcStartTimecode ?? '00:00:00:00';
  }
};

const onLtcFrameRateChange = (e: Event) => {
  audioItem.value.ltcFrameRate = parseInt((e.target as HTMLSelectElement).value, 10);
  handleSave();
};
const groupItem = computed(() => selectedItem.value as GroupItem);

// Check if selected item is a cart item
const isCartItem = computed(() => {
  if (selectedItem.value && selectedItem.value.type === 'audio') {
    const item = selectedItem.value as AudioItem;
    return item.index && item.index.length > 0 && item.index[0] === -1;
  }
  return false;
});

// Tab management
const activeTab = ref('basic');

interface Tab {
  id: string;
  label: string;
  icon: string;
  audioOnly?: boolean;
}

const allTabs = computed<Tab[]>(() => [
  { id: 'basic', label: t('properties.basicInfo'), icon: 'info' },
  { id: 'media', label: t('properties.media'), icon: 'audio_file', audioOnly: true },
  { id: 'playback', label: t('properties.playback'), icon: 'play_circle', audioOnly: true },
  { id: 'output', label: t('properties.output'), icon: 'speaker', audioOnly: true },
  { id: 'ducking', label: t('properties.ducking'), icon: 'volume_down', audioOnly: true },
  { id: 'startBehavior', label: t('properties.startBehavior'), icon: 'play_arrow' },
  { id: 'endBehavior', label: t('properties.endBehavior'), icon: 'stop_circle' },
  { id: 'x18', label: t('properties.x18'), icon: 'tune', audioOnly: true }
]);

const availableTabs = computed(() => {
  return allTabs.value.filter(tab => !tab.audioOnly || selectedItem.value?.type === 'audio');
});

// Computed properties for behavior fields
const endBehaviorAction = computed({
  get: () => {
    if (selectedItem.value?.type === 'audio') {
      return audioItem.value.endBehavior.action;
    } else if (selectedItem.value?.type === 'group') {
      return groupItem.value.endBehavior.action;
    }
    return 'nothing';
  },
  set: (value) => {
    if (selectedItem.value?.type === 'audio') {
      audioItem.value.endBehavior.action = value as any;
    } else if (selectedItem.value?.type === 'group') {
      groupItem.value.endBehavior.action = value as any;
    }
  }
});

const endBehaviorTargetUuid = computed({
  get: () => {
    if (selectedItem.value?.type === 'audio') {
      return audioItem.value.endBehavior.targetUuid || '';
    } else if (selectedItem.value?.type === 'group') {
      return groupItem.value.endBehavior.targetUuid || '';
    }
    return '';
  },
  set: (value) => {
    if (selectedItem.value?.type === 'audio') {
      audioItem.value.endBehavior.targetUuid = value;
    } else if (selectedItem.value?.type === 'group') {
      groupItem.value.endBehavior.targetUuid = value;
    }
  }
});

const endBehaviorTargetIndex = computed(() => {
  if (selectedItem.value?.type === 'audio') {
    return audioItem.value.endBehavior.targetIndex;
  } else if (selectedItem.value?.type === 'group') {
    return groupItem.value.endBehavior.targetIndex;
  }
  return undefined;
});

// Parse a user-typed index path into a clean number[] path.
// Accepts both "1,10" and "1.10" (in case the user mixes up comma and full
// stop) and normalises to a comma-separated path. Empty/garbage segments are
// dropped so a stray separator can't inject NaN into the path.
const parseIndexPath = (raw: string): number[] => {
  return raw
    .split(/[.,]/)            // treat "." and "," as the same separator
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => parseInt(s, 10))  // explicit radix — `.map(parseInt)` passes the
    .filter(n => Number.isFinite(n)); // array index as radix and corrupts entries
};

const handleEndBehaviorIndexChange = (e: Event) => {
  const input = e.target as HTMLInputElement;
  const parsed = parseIndexPath(input.value);
  // Reflect the normalised path back into the field so the user sees the
  // canonical comma form (e.g. typing "1.10" shows "1,10").
  input.value = parsed.join(',');
  if (selectedItem.value?.type === 'audio') {
    audioItem.value.endBehavior.targetIndex = parsed;
  } else if (selectedItem.value?.type === 'group') {
    groupItem.value.endBehavior.targetIndex = parsed;
  }
  handleSave();
};

const startBehaviorAction = computed({
  get: () => {
    if (selectedItem.value?.type === 'audio') {
      return audioItem.value.startBehavior.action;
    } else if (selectedItem.value?.type === 'group') {
      return groupItem.value.startBehavior.action;
    }
    return 'nothing';
  },
  set: (value) => {
    if (selectedItem.value?.type === 'audio') {
      audioItem.value.startBehavior.action = value as any;
    } else if (selectedItem.value?.type === 'group') {
      groupItem.value.startBehavior.action = value as any;
    }
  }
});

const startBehaviorTargetUuid = computed({
  get: () => {
    if (selectedItem.value?.type === 'audio') {
      return audioItem.value.startBehavior.targetUuid || '';
    }
    return '';
  },
  set: (value) => {
    if (selectedItem.value?.type === 'audio') {
      audioItem.value.startBehavior.targetUuid = value;
    }
  }
});

const startBehaviorTargetIndex = computed(() => {
  if (selectedItem.value?.type === 'audio') {
    return audioItem.value.startBehavior.targetIndex;
  }
  return undefined;
});

const handleStartBehaviorIndexChange = (e: Event) => {
  const input = e.target as HTMLInputElement;
  const parsed = parseIndexPath(input.value);
  input.value = parsed.join(',');
  if (selectedItem.value?.type === 'audio') {
    audioItem.value.startBehavior.targetIndex = parsed;
  }
  handleSave();
};

// ---- X18 mixer actions ----------------------------------------------------
// A console IP must be set in Project Settings for these to do anything; the
// editor stays usable regardless so actions can be prepared ahead of time.
const x18Configured = computed(() => {
  const ip = (currentProject.value as any)?.settings?.x18Ip;
  return typeof ip === 'string' && ip.trim().length > 0;
});

// Live reference to the selected item's x18Actions array (created lazily so
// older items without the field still get an editable list).
const x18Actions = computed<X18Action[]>(() => {
  const it = selectedItem.value as any;
  if (!it) return [];
  if (!Array.isArray(it.x18Actions)) it.x18Actions = [];
  return it.x18Actions as X18Action[];
});

const addX18Action = () => {
  x18Actions.value.push({ trigger: 'start', target: 'master', level: 0 });
  handleSave();
};

const removeX18Action = (i: number) => {
  x18Actions.value.splice(i, 1);
  handleSave();
};

const onX18TargetChange = (action: X18Action) => {
  // Channel target needs a valid channel number; default to 1.
  if (action.target === 'channel') {
    if (!action.channel || action.channel < 1 || action.channel > 16) action.channel = 1;
  } else {
    delete action.channel;
  }
  handleSave();
};

const onX18ChannelChange = (action: X18Action) => {
  const ch = Math.round(Number(action.channel) || 1);
  action.channel = Math.min(16, Math.max(1, ch));
  handleSave();
};

const onX18LevelChange = (action: X18Action) => {
  let lvl = Number(action.level);
  if (!Number.isFinite(lvl)) lvl = 0;
  action.level = Math.min(100, Math.max(0, lvl));
  handleSave();
};

// Duck level in dB
const duckLevelDB = computed({
  get: () => {
    const linear = audioItem.value.duckingBehavior.duckLevel;
    if (linear <= 0) return -60;
    return 20 * Math.log10(linear);
  },
  set: (db: number) => {
    const linear = db <= -60 ? 0 : Math.pow(10, db / 20);
    audioItem.value.duckingBehavior.duckLevel = linear;
  }
});

// Store a snapshot of the original values when properties panel opens
const originalSnapshot = ref<any>(null);
const isInitializing = ref(false);

// When selectedItem changes, take a snapshot
watch(selectedItem, (newItem, oldItem) => {
  if (newItem) {
    // Only reset tab if it's a different item (not just property updates)
    const isDifferentItem = !oldItem || newItem.uuid !== oldItem.uuid;
    
    if (isDifferentItem) {
      isInitializing.value = true;
      originalSnapshot.value = JSON.parse(JSON.stringify(newItem));
      
      // Only reset to basic tab if properties panel was previously closed (no oldItem)
      // If panel was already open, keep the current tab
      if (!oldItem) {
        activeTab.value = 'basic';
      }
      
      setTimeout(() => {
        isInitializing.value = false;
      }, 0);
    }
  } else {
    originalSnapshot.value = null;
  }
}, { immediate: true });

const handleClose = () => {
  // Close the panel but leave the current selection intact so the highlighted
  // rows stay highlighted. Only the panel's visibility is toggled here.
  propertiesPanelOpen.value = false;
  originalSnapshot.value = null;
};

const handleSave = async () => {
  // End any active drag batch so stale intermediate values are never
  // PATCHed to the server and echoed back as item_updated reversions.
  endItemBatch();
  // If multiple items are selected, update all of them with ONLY changed properties
  const items = getSelectedItems();
  if (items.length > 1 && originalSnapshot.value && selectedItem.value) {
    const current = selectedItem.value;
    const original = originalSnapshot.value;
    
    items.forEach(item => {
      // Only update properties that have changed
      if (current.displayName !== original.displayName) {
        item.displayName = current.displayName;
      }
      if (current.color !== original.color) {
        item.color = current.color;
      }
      
      // Copy type-specific properties only if they changed
      if (item.type === 'audio' && current.type === 'audio') {
        const sourceAudio = current as AudioItem;
        const originalAudio = original as AudioItem;
        const targetAudio = item as AudioItem;
        
        if (sourceAudio.volume !== originalAudio.volume) {
          targetAudio.volume = sourceAudio.volume;
        }
        if (sourceAudio.inPoint !== originalAudio.inPoint) {
          targetAudio.inPoint = sourceAudio.inPoint;
        }
        if (sourceAudio.outPoint !== originalAudio.outPoint) {
          targetAudio.outPoint = sourceAudio.outPoint;
        }
        if (JSON.stringify(sourceAudio.duckingBehavior) !== JSON.stringify(originalAudio.duckingBehavior)) {
          targetAudio.duckingBehavior = { ...sourceAudio.duckingBehavior };
        }
        if (JSON.stringify(sourceAudio.endBehavior) !== JSON.stringify(originalAudio.endBehavior)) {
          targetAudio.endBehavior = { ...sourceAudio.endBehavior };
        }
        if (JSON.stringify(sourceAudio.startBehavior) !== JSON.stringify(originalAudio.startBehavior)) {
          targetAudio.startBehavior = { ...sourceAudio.startBehavior };
        }
        if (JSON.stringify(sourceAudio.x18Actions) !== JSON.stringify(originalAudio.x18Actions)) {
          targetAudio.x18Actions = JSON.parse(JSON.stringify(sourceAudio.x18Actions ?? []));
        }
      } else if (item.type === 'group' && current.type === 'group') {
        const sourceGroup = current as GroupItem;
        const originalGroup = original as GroupItem;
        const targetGroup = item as GroupItem;
        
        if (JSON.stringify(sourceGroup.startBehavior) !== JSON.stringify(originalGroup.startBehavior)) {
          targetGroup.startBehavior = { ...sourceGroup.startBehavior };
        }
        if (JSON.stringify(sourceGroup.endBehavior) !== JSON.stringify(originalGroup.endBehavior)) {
          targetGroup.endBehavior = { ...sourceGroup.endBehavior };
        }
        if (JSON.stringify((sourceGroup as any).x18Actions) !== JSON.stringify((originalGroup as any).x18Actions)) {
          (targetGroup as any).x18Actions = JSON.parse(JSON.stringify((sourceGroup as any).x18Actions ?? []));
        }
      }
    });
    
  }

  // Always refresh the diff baseline to the primary item's current state —
  // for single AND multi selection. This is what prevents an earlier edit
  // (e.g. a colour change made while only one item was selected) from later
  // leaking onto the rest of a multi-selection: every save resets the
  // baseline so the next diff only ever reflects the property just touched.
  if (selectedItem.value) {
    originalSnapshot.value = JSON.parse(JSON.stringify(selectedItem.value));
  }

  await saveProject();
};

// Handle normalize: normalize ALL selected audio items individually
const handleNormalize = () => {
  let items = getSelectedItems();
  
  // Fallback to selectedItem if no items in selectedItems set (shouldn't happen now, but safe)
  if (items.length === 0 && selectedItem.value) {
    items = [selectedItem.value];
  }
  
  const targetLoudness = outputTargetLevels.value.autoVolumeTargetDb;
  
  let normalizedCount = 0;
  
  items.forEach(item => {
    if (item.type !== 'audio') return;
    
    const audioItem = item as AudioItem;
    
    // Skip if no waveform data
    if (!audioItem.waveform || !audioItem.waveform.peaks || audioItem.waveform.peaks.length === 0) {
      console.warn(`Skipping ${audioItem.displayName}: no waveform data`);
      return;
    }
    
    const peaks = audioItem.waveform.peaks;
    const duration = audioItem.duration;
    
    // Get trimmed region
    const inPoint = audioItem.inPoint || 0;
    const outPoint = audioItem.outPoint || duration;
    const startIndex = Math.floor((inPoint / duration) * peaks.length);
    const endIndex = Math.ceil((outPoint / duration) * peaks.length);
    const trimmedPeaks = peaks.slice(startIndex, endIndex);
    
    // Calculate INTRINSIC perceived loudness
    const intrinsicLoudness = calculatePerceivedLoudness(trimmedPeaks);
    
    // Calculate the ABSOLUTE volume needed
    const gainDb = targetLoudness - intrinsicLoudness;
    const newVolume = Math.pow(10, gainDb / 20);
    
    // Clamp to reasonable range (0.001 to 3.162, where 3.162 = +10dB max)
    const maxVolume = Math.pow(10, 10 / 20); // +10dB = 3.162
    const clampedVolume = Math.min(Math.max(newVolume, 0.001), maxVolume);
    audioItem.volume = clampedVolume;
    
    normalizedCount++;
    console.log(`Normalized ${audioItem.displayName}: ${intrinsicLoudness.toFixed(1)}dB -> ${targetLoudness}dB (volume: ${clampedVolume.toFixed(3)})`);
  });
  
  if (normalizedCount > 0) {
    saveProject();
    console.log(`Normalized ${normalizedCount} item(s)`);
  }
};

// Handle trim silence: trim ALL selected audio items individually
const handleTrimSilence = () => {
  let items = getSelectedItems();
  
  // Fallback to selectedItem if no items in selectedItems set (shouldn't happen now, but safe)
  if (items.length === 0 && selectedItem.value) {
    items = [selectedItem.value];
  }
  
  const padding = 0.1; // Padding in seconds
  
  let trimmedCount = 0;
  
  items.forEach(item => {
    if (item.type !== 'audio') return;
    
    const audioItem = item as AudioItem;
    
    // Skip if no waveform data
    if (!audioItem.waveform || !audioItem.waveform.peaks || audioItem.waveform.peaks.length === 0) {
      console.warn(`Skipping ${audioItem.displayName}: no waveform data`);
      return;
    }
    
    const peaks = audioItem.waveform.peaks;
    const duration = audioItem.duration;
    
    // Find the maximum peak value to calculate relative threshold
    const maxPeak = Math.max(...peaks);
    
    // Use 5% of max peak as threshold (more sensitive to actual silence)
    const threshold = maxPeak * 0.05;
    
    // Find first non-silent sample from start
    let startIndex = 0;
    for (let i = 0; i < peaks.length; i++) {
      if (peaks[i] > threshold) {
        startIndex = i;
        break;
      }
    }
    
    // Find first non-silent sample from end
    let endIndex = peaks.length - 1;
    for (let i = peaks.length - 1; i >= 0; i--) {
      if (peaks[i] > threshold) {
        endIndex = i;
        break;
      }
    }
    
    // Convert indices to time
    const newInPoint = (startIndex / peaks.length) * duration;
    const newOutPoint = ((endIndex + 1) / peaks.length) * duration;
    
    // Apply with padding
    audioItem.inPoint = Math.max(0, newInPoint - padding);
    audioItem.outPoint = Math.min(duration, newOutPoint + padding);
    
    trimmedCount++;
    console.log(`Trimmed ${audioItem.displayName}: maxPeak=${maxPeak.toFixed(3)}, threshold=${threshold.toFixed(3)}, ${newInPoint.toFixed(2)}s - ${newOutPoint.toFixed(2)}s`);
  });
  
  if (trimmedCount > 0) {
    saveProject();
    console.log(`Trimmed ${trimmedCount} item(s)`);
  }
};

// Handle fade updates: apply to ALL selected audio items
const handlePlayFadeUpdate = (value: number) => {
  const items = getSelectedItems();
  items.forEach(item => {
    if (item.type === 'audio') {
      (item as AudioItem).playFade = value;
    }
  });
};

const handleStopFadeUpdate = (value: number) => {
  const items = getSelectedItems();
  items.forEach(item => {
    if (item.type === 'audio') {
      (item as AudioItem).stopFade = value;
    }
  });
};

const handleCrossFadeUpdate = (value: number) => {
  const items = getSelectedItems();
  items.forEach(item => {
    if (item.type === 'audio') {
      (item as AudioItem).crossFade = value;
    }
  });
};

const isRegenerating = ref(false);

const handleRegenerateWaveform = async () => {
  if (isRegenerating.value) return;

  let items = getSelectedItems().filter(i => i.type === 'audio') as AudioItem[];
  if (items.length === 0 && selectedItem.value?.type === 'audio') {
    items = [selectedItem.value as AudioItem];
  }
  if (items.length === 0) return;

  isRegenerating.value = true;
  try {
    const folder = currentProject.value?.folderPath || '';
    for (const item of items) {
      let path = item.mediaServerPath || '';
      if (!path && item.mediaPath && folder) {
        const rel = item.mediaPath.replace(/^[\\/]+/, '');
        path = `${folder.replace(/[\\/]+$/, '')}/${rel}`;
      }
      if (!path) continue;
      item.waveform = undefined;
      await _server.requestWaveformGeneration(path, item.uuid, true).catch((e: Error) => {
        console.warn(`[waveform] regeneration failed for ${item.displayName}:`, e);
      });
    }
  } finally {
    isRegenerating.value = false;
  }
};

const handleReplaceMedia = async () => {
  if (!import.meta.client || !window.electronAPI) return;
  
  const files = await window.electronAPI.selectAudioFiles();
  if (!files || files.length === 0) return;
  
  // Implementation would replace the media file
  console.log('Replace media with:', files[0]);
};

const copyToClipboard = async (text: string) => {
  if (import.meta.client) {
    try {
      await navigator.clipboard.writeText(text);
      // Could show a toast notification here
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }
};

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};
</script>

<style scoped>
.properties-panel {
  height: var(--properties-panel-height);
  border-top: 1px solid var(--color-border);
  background-color: var(--color-surface);
  display: flex;
  flex-direction: column;
}

.properties-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-secondary);
}

.properties-header h3 {
  font-size: 16px;
  font-weight: 600;
}

.close-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text);
  
  &:hover {
    background-color: var(--color-surface-hover);
  }
  
  .material-symbols-rounded {
    font-size: 20px;
    color: var(--color-text);
  }
}

/* Tab Navigation */
.properties-tabs {
  display: flex;
  gap: 2px;
  padding: 0 var(--spacing-lg);
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-surface);
  overflow-x: auto;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  transition: all 0.2s;
  
  .material-symbols-rounded {
    font-size: 18px;
    color: inherit;
  }
  
  &:hover {
    color: var(--color-text-primary);
    background-color: var(--color-surface-hover);
  }
  
  &.active {
    color: var(--color-accent);
    border-bottom-color: var(--color-accent);
  }
}

/* Tab Content */
.properties-content {
  flex: 1;
  overflow-x: auto;
  overflow-y: auto;
  padding: var(--spacing-lg);
  min-height: 0;
}

.tab-panel {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-md);
  align-content: flex-start;
  min-height: min-content;
}

/* Special handling for playback tab with waveform trimmer */
.tab-panel:has(.waveform-trimmer) {
  display: block;
}

.property-field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 250px;
  flex: 0 0 auto;
  color: var(--color-text-secondary);
}

.property-field label {
  font-size: 13px;
  font-weight: 500;
}

.property-field input,
.property-field select {
  width: 100%;
  padding: var(--spacing-sm);
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 13px;
  
  &:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  
  &[readonly] {
    opacity: 0.6;
    cursor: default;
  }
}

.input-with-btn {
  display: flex;
  gap: var(--spacing-xs);
  
  input {
    flex: 1;
  }
}

.icon-btn {
  padding: var(--spacing-sm);
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text);
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover:not(:disabled) {
    background-color: var(--color-accent);
    border-color: var(--color-accent);
    color: white;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .material-symbols-rounded {
    font-size: 18px;
    color: inherit;
  }
}

.regen-btn {
  gap: var(--spacing-xs);
  font-size: 13px;
  padding: var(--spacing-sm) var(--spacing-md);

  .spinning {
    animation: spin 1s linear infinite;
  }
}

.color-picker {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: var(--spacing-xs);
}

.color-btn {
  aspect-ratio: 1;
  border-radius: var(--border-radius-sm);
  border: 2px solid transparent;
  transition: all var(--transition-fast);
  
  &:hover {
    transform: scale(1.1);
  }
  
  &.active {
    border-color: var(--color-text-primary);
    box-shadow: 0 0 0 2px var(--color-background);
  }
}

.uuid-field,
.file-field {
  display: flex;
  gap: var(--spacing-xs);
}

.uuid-field input,
.file-field input {
  flex: 1;
  min-width: 0;
}

.copy-btn,
.action-btn-small {
  padding: var(--spacing-sm);
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-sm);
  white-space: nowrap;
  
  &:hover {
    background-color: var(--color-surface-hover);
    border-color: var(--color-accent);
  }
}

.db-range-labels {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-top: 4px;
}

.ltc-checkbox-label {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;

  input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--color-accent);
    cursor: pointer;
  }
}

.field-disabled {
  opacity: 0.45;
  pointer-events: none;
}

.property-field input.invalid {
  border-color: #e53e3e;

  &:focus {
    border-color: #e53e3e;
  }
}

.property-help {
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-top: 2px;
}

.property-help--error {
  color: #e53e3e;
}

/* ---- X18 mixer actions ------------------------------------------------- */
.x18-action {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.x18-action-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
}

.x18-action-row select {
  flex: 1;
  min-width: 90px;
}

.x18-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.x18-inline input {
  width: 70px;
}

.x18-remove {
  margin-left: auto;
}

.x18-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: var(--spacing-sm);
  background: var(--color-surface);
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  color: var(--color-text-primary);
  cursor: pointer;
  font-size: 13px;
}

.x18-add:hover {
  background: var(--color-surface-hover);
}

.loading-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-xl);
  color: var(--color-text-secondary);
}

.loading-message .material-symbols-rounded {
  font-size: 48px;
  animation: spin 2s linear infinite;
}

.loading-message p {
  font-size: 14px;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* ---- Phones: full-screen properties ----------------------------------- */
/* On a phone the bottom-docked panel is too small to edit in. It's dismissed
   with the X anyway, so make it a full-screen overlay. dvh tracks the dynamic
   mobile viewport (browser chrome show/hide); env() keeps the header/footer
   clear of the notch and home indicator. */
@media (max-width: 768px) {
  .properties-panel {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100vh;
    height: 100dvh;
    z-index: 1500;
    border-top: none;
    box-sizing: border-box;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }

  /* Bigger touch target for the close button. */
  .close-btn {
    width: 40px;
    height: 40px;
  }
  .close-btn .material-symbols-rounded {
    font-size: 24px;
  }
}
</style>


