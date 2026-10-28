<script setup lang="ts">
import { ref } from 'vue';
import { useAppI18n } from '../i18n';
import { MAT_HEIGHT, MAT_WIDTH } from '../domain/tableView';
import { PLAYMATS, validPlaymatId, playmatColor, playmatCustomImage } from '../services/playmats';
import PlaymatArt from './PlaymatArt.vue';

const props = defineProps<{ id?: string; busy?: boolean; eyebrow?: string }>();
const emit = defineEmits<{ close: []; apply: [id: string | undefined] }>();
const { t } = useAppI18n();
const playmatDraft = ref(validPlaymatId(props.id));
const playmatColorDraft = ref(playmatColor(playmatDraft.value) ?? '#315b3b');
const playmatUrlDraft = ref(playmatCustomImage(playmatDraft.value) ?? '');
const playmatUrlSelected = ref(!!playmatCustomImage(playmatDraft.value));
function applyPlaymat(): void { emit('apply', playmatDraft.value); emit('close'); }
</script>

<template>
  <div class="modal-scrim" @click.self="emit('close')" @keydown.esc="emit('close')"><section class="playmat-modal" role="dialog" :aria-label="t('table.playmatDialog')"><button class="modal-close" :aria-label="t('common.close')" @click="emit('close')">×</button><span class="eyebrow">{{ eyebrow || t('table.playmatEyebrow') }}</span><h2>{{ t('table.choosePlaymat') }}</h2><div class="playmat-preview" :style="{ aspectRatio: `${MAT_WIDTH} / ${MAT_HEIGHT}` }"><PlaymatArt v-if="playmatDraft" :id="playmatDraft" class="playmat-preview-art" /><span>{{ PLAYMATS.find(item=>item.id===playmatDraft)?.name ?? (playmatColor(playmatDraft) ? t('table.solidColor') : playmatCustomImage(playmatDraft) ? t('table.customImage') : t('table.greenFelt')) }}</span></div><div class="playmat-options"><button class="playmat-choice felt-choice" :class="{selected:!playmatDraft}" @click="playmatDraft=undefined; playmatUrlSelected=false"><span class="playmat-choice-art">✳</span><strong>{{ t('table.greenFelt') }}</strong></button><button v-for="playmat in PLAYMATS" :key="playmat.id" class="playmat-choice" :class="{selected:playmatDraft===playmat.id}" @click="playmatDraft=playmat.id; playmatUrlSelected=false"><img :src="playmat.thumbnail" alt=""><strong>{{ playmat.name }}</strong></button></div><div class="playmat-custom-options"><label><span>{{ t('table.solidColor') }}</span><input type="color" v-model="playmatColorDraft" @input="playmatDraft='color:' + ($event.target as HTMLInputElement).value; playmatUrlSelected=false" @click="playmatDraft='color:' + playmatColorDraft; playmatUrlSelected=false"></label><label><span>{{ t('table.customImage') }}</span><input type="url" v-model.trim="playmatUrlDraft" :placeholder="t('table.imageUrlPlaceholder')" maxlength="2042" @input="playmatUrlSelected=true; playmatDraft=validPlaymatId('image:' + playmatUrlDraft)"><small v-if="playmatUrlSelected && !playmatDraft">{{ t('table.invalidImageUrl') }}</small></label></div><footer><a :href="PLAYMATS[0].source" target="_blank" rel="noreferrer">{{ t('table.officialMagicArt') }} ↗</a><button class="button button-primary" :disabled="busy || (playmatUrlSelected && !playmatDraft)" @click="applyPlaymat">{{ t('table.applyPlaymat') }}</button></footer></section></div>
</template>
