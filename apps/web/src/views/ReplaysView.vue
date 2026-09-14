<script setup lang="ts">
import { onMounted, ref } from 'vue'; import { api } from '../api';
type Replay={id:string;startedAt:string;endedAt:string;durationSeconds?:number;peakViewers:number;recordingUrl:string;room:{roomNumber:number;title:string;cover?:string}};
const items=ref<Replay[]>([]),error=ref(''),page=ref(1),total=ref(0),loading=ref(false);
async function load(){loading.value=true;try{const res=await api<{data:Replay[];meta:{total:number}}>(`/api/replays?page=${page.value}`);items.value.push(...res.data);total.value=res.meta.total}catch(e){error.value=(e as Error).message}finally{loading.value=false}}
function fmt(v:string){return new Date(v).toLocaleString()}
onMounted(load);
</script>
<template><div><div class="section-head"><h2>直播回放</h2><span class="muted">共 {{ total }} 场</span></div><p v-if="error" class="error">{{ error }}</p><div class="grid"><router-link v-for="r in items" :key="r.id" :to="`/room/${r.room.roomNumber}?replay=${r.id}`" class="room-card"><div class="cover"><img v-if="r.room.cover" :src="r.room.cover" :alt="r.room.title"><span class="replay-badge">回放</span></div><div class="card-body"><div class="card-title">{{ r.room.title }} · {{ fmt(r.startedAt) }}</div><div class="card-meta"><span>{{ r.durationSeconds??'-' }} 秒</span><span>{{ r.peakViewers }} 人在线</span></div></div></router-link></div><div v-if="!items.length&&!loading" class="panel empty">还没有直播回放</div><div v-if="items.length<total" class="empty"><button class="button" :disabled="loading" @click="page++;load()">{{ loading?'加载中…':'加载更多' }}</button></div></div></template>
